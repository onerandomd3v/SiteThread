"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FindingReviewPanel } from "@/components/finding-review-panel";
import { isActiveProcessingStatus, isReviewStatus, processingStages, processingStatusLabel } from "@/lib/processing/status-labels";
import { SiteReportSchema } from "@/lib/schemas/report";
import { WalkthroughReviewSchema, type WalkthroughReview } from "@/lib/schemas/review";
import { saveReviewDecision } from "@/lib/observations/review-client";

type StatusResponse = {
  walkthrough: { id: string; title: string | null; project: { id: string; name: string } };
  asset: { status: string; byteSize: number | null; mimeType: string };
  run: { status: string; retryCount: number; failedStep: string | null; errorMessage: string | null; retryable: boolean | null } | null;
  report: { id: string } | null;
};

const POLL_INTERVAL_MS = 4000;

function stageIndex(status: string | null | undefined): number {
  if (status === "QUEUED" || status === "UPLOADED") return status === "UPLOADED" ? -1 : 0;
  if (status === "TRANSCRIBING") return 1;
  if (status === "ANALYZING_MEDIA") return 2;
  if (status === "EXTRACTING_OBSERVATIONS") return 3;
  if (status === "NEEDS_REVIEW" || status === "REVIEWED" || status === "REPORT_READY") return 4;
  return -1;
}

async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? fallback);
  return payload;
}

export function WalkthroughStatusCard({ walkthroughId }: { walkthroughId: string }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [review, setReview] = useState<WalkthroughReview | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [pollCycle, setPollCycle] = useState(0);
  const requestSequence = useRef(0);
  const inFlightOwner = useRef<number | null>(null);
  const pollTimer = useRef<number | null>(null);
  const generation = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const router = useRouter();

  const refresh = useCallback(async (signal?: AbortSignal, expectedGeneration?: number): Promise<StatusResponse | null> => {
    if (inFlightOwner.current !== null) return null;
    const owner = ++requestSequence.current;
    inFlightOwner.current = owner;
    setError(null);
    const requestGeneration = expectedGeneration ?? generation.current;
    const isStale = () => signal?.aborted === true || requestGeneration !== generation.current;
    try {
      const body = await parseResponse<StatusResponse>(await fetch(`/api/walkthroughs/${walkthroughId}/status`, { cache: "no-store", signal }), "The walkthrough status could not be loaded.");
      if (isStale()) return null;
      let nextStatus = body;
      if (body.run && isReviewStatus(body.run.status)) {
        const reviewBody = await parseResponse<WalkthroughReview>(await fetch(`/api/walkthroughs/${walkthroughId}/observations`, { cache: "no-store", signal }), "The findings could not be loaded.");
        if (isStale()) return null;
        const parsedReview = WalkthroughReviewSchema.parse(reviewBody);
        if (parsedReview.totalCount === 0 && body.run.status === "NEEDS_REVIEW") {
          const completeBody = await parseResponse<WalkthroughReview>(await fetch(`/api/walkthroughs/${walkthroughId}/observations`, { method: "POST", signal }), "The empty review could not be completed.");
          if (isStale()) return null;
          const completedReview = WalkthroughReviewSchema.parse(completeBody);
          setReview(completedReview);
          nextStatus = { ...body, run: { ...body.run, status: "REVIEWED" } };
        } else setReview(parsedReview);
      } else setReview(null);
      setStatus(nextStatus);
      return nextStatus;
    } catch (caught) {
      if (isStale() || (caught instanceof DOMException && caught.name === "AbortError")) return null;
      setError(caught instanceof Error ? caught.message : "The walkthrough status could not be loaded.");
      return null;
    } finally {
      if (inFlightOwner.current === owner) {
        inFlightOwner.current = null;
        if (!isStale()) setLoading(false);
      }
    }
  }, [walkthroughId]);

  useEffect(() => {
    const controller = new AbortController();
    const expectedGeneration = generation.current + 1;
    generation.current = expectedGeneration;
    activeController.current = controller;
    let cancelled = false;
    const poll = async () => {
      const nextStatus = await refresh(controller.signal, expectedGeneration);
      if (!cancelled && isActiveProcessingStatus(nextStatus?.run?.status)) pollTimer.current = window.setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
    };
    void poll();
    return () => { cancelled = true; generation.current += 1; controller.abort(); inFlightOwner.current = null; if (activeController.current === controller) activeController.current = null; if (pollTimer.current !== null) window.clearTimeout(pollTimer.current); };
  }, [pollCycle, refresh]);

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      await parseResponse<{ run: unknown }>(await fetch(`/api/walkthroughs/${walkthroughId}/retry`, { method: "POST", signal: activeController.current?.signal }), "Processing could not be retried.");
      await refresh(activeController.current?.signal);
      setPollCycle((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Processing could not be retried.");
    } finally {
      setRetrying(false);
    }
  }

  async function reviewObservation(observationId: string, decision: { state: "CONFIRMED" | "DISMISSED" } | { state: "EDITED"; editedText: string }) {
    const body = await saveReviewDecision(fetch, walkthroughId, observationId, decision);
    setReview(body.review);
    setStatus((current) => current?.run ? { ...current, run: { ...current.run, status: body.review.runStatus ?? current.run.status } } : current);
  }

  async function generateReport() {
    setGeneratingReport(true);
    setError(null);
    try {
      const report = SiteReportSchema.parse(await parseResponse<unknown>(await fetch(`/api/walkthroughs/${walkthroughId}/report`, { method: "POST" }), "The report could not be generated."));
      router.push(`/reports/${report.reportId}` as never);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The report could not be generated.");
    } finally {
      setGeneratingReport(false);
    }
  }

  const currentStatus = status?.run?.status;
  const reportReady = currentStatus === "REPORT_READY" || review?.runStatus === "REPORT_READY";
  const currentStage = stageIndex(currentStatus);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-7 px-5 py-8 sm:px-8 sm:py-12">
      <Link href="/" className="w-fit text-sm font-semibold text-slate-600 underline">← Back to projects</Link>
      <header className="space-y-2"><p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Walkthrough status</p><h1 className="text-3xl font-semibold text-slate-950 sm:text-4xl">{status?.walkthrough.title ?? "Loading walkthrough…"}</h1>{status && <p className="text-sm text-slate-600">{status.walkthrough.project.name}</p>}</header>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert"><p>{error}</p><button type="button" onClick={() => void refresh()} className="mt-2 font-semibold underline">Try again</button></div>}
      {loading && !status && <p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600" role="status">Loading walkthrough status…</p>}
      {status && <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-labelledby="processing-heading">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Processing</p><h2 id="processing-heading" className="mt-1 text-2xl font-semibold text-slate-950">{processingStatusLabel(currentStatus)}</h2></div><button type="button" onClick={() => void refresh()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Refresh status</button></div>
        <p className="text-sm leading-6 text-slate-600">SiteThread is preparing source-backed findings for you to review. This page updates while processing is active.</p>
        {currentStatus === "PROCESSING_FAILED" ? <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4"><p className="font-semibold text-red-950">This walkthrough needs attention before findings can be prepared.</p>{status.run?.errorMessage && <p className="text-sm leading-6 text-red-900">{status.run.errorMessage}</p>}{status.run?.failedStep && <p className="text-sm text-red-900">Stage: {processingStatusLabel(status.run.failedStep)}</p>}<div className="flex flex-wrap items-center gap-3"><button type="button" disabled={retrying} onClick={() => void retry()} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{retrying ? "Retrying…" : "Retry processing"}</button>{status.run?.retryable === false && <span className="text-sm text-red-900">Resolve the underlying issue, then retry.</span>}</div></div> : <ol className="space-y-3" aria-label="Processing stages">{processingStages.map((stage, index) => { const complete = currentStage > index || ["REVIEWED", "REPORT_READY"].includes(currentStatus ?? ""); const active = currentStatus === stage.status || (currentStatus === "UPLOADED" && index === 0); return <li key={stage.status} className={`flex gap-3 rounded-xl border p-3 ${complete ? "border-emerald-200 bg-emerald-50" : active ? "border-slate-300 bg-slate-50" : "border-slate-200"}`}><span aria-hidden="true" className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${complete ? "bg-emerald-700 text-white" : active ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-600"}`}>{complete ? "✓" : index + 1}</span><span><span className="block font-semibold text-slate-950">{stage.label}</span><span className="block text-sm text-slate-600">{active || complete ? stage.detail : "Up next when the previous stage is complete."}</span></span></li>; })}</ol>}
        <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-4">{currentStatus === "REPORT_READY" && status.report && <Link href={`/reports/${status.report.id}` as never} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">View report</Link>}{currentStatus === "REVIEWED" && review && review.remainingDrafts === 0 && !reportReady && (review.observations.some((observation) => observation.reviewState === "CONFIRMED" || observation.reviewState === "EDITED") ? <button type="button" disabled={generatingReport} onClick={() => void generateReport()} className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{generatingReport ? "Preparing reviewed record…" : "Generate report"}</button> : <span className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">No findings selected for report.</span>)}</div>
      </section>}
      {review && status?.run && isReviewStatus(status.run.status) && <FindingReviewPanel review={review} readOnly={reportReady} onReview={reviewObservation} />}
    </main>
  );
}
