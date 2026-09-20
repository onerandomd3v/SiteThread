"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FindingReviewPanel } from "@/components/finding-review-panel";
import { SiteReportSchema } from "@/lib/schemas/report";
import { WalkthroughReviewSchema, type WalkthroughReview } from "@/lib/schemas/review";
import { saveReviewDecision } from "@/lib/observations/review-client";

type StatusResponse = {
  walkthrough: { id: string; title: string | null; project: { id: string; name: string } };
  asset: { status: string; byteSize: number | null; mimeType: string };
  run: { status: string; retryCount: number; failedStep: string | null; errorMessage: string | null; retryable: boolean | null } | null;
  report: { id: string } | null;
};

export function WalkthroughStatusCard({ walkthroughId }: { walkthroughId: string }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [review, setReview] = useState<WalkthroughReview | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const router = useRouter();

  const refresh = useCallback(async () => {
    setError(null);
    const response = await fetch(`/api/walkthroughs/${walkthroughId}/status`, { cache: "no-store" });
    const body = await response.json() as StatusResponse & { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? "The walkthrough status could not be loaded.");
    setStatus(body);
    if (body.run && ["NEEDS_REVIEW", "REVIEWED", "REPORT_READY"].includes(body.run.status)) {
      const reviewResponse = await fetch(`/api/walkthroughs/${walkthroughId}/observations`, { cache: "no-store" });
      const reviewPayload = await reviewResponse.json() as unknown;
      if (!reviewResponse.ok) {
        const errorBody = reviewPayload as { error?: { message?: string } };
        throw new Error(errorBody.error?.message ?? "The findings could not be loaded.");
      }
      const reviewBody = WalkthroughReviewSchema.parse(reviewPayload);
      if (reviewBody.totalCount === 0 && body.run.status === "NEEDS_REVIEW") {
        const completeResponse = await fetch(`/api/walkthroughs/${walkthroughId}/observations`, { method: "POST" });
        const completePayload = await completeResponse.json() as unknown;
        if (!completeResponse.ok) {
          const errorBody = completePayload as { error?: { message?: string } };
          throw new Error(errorBody.error?.message ?? "The empty review could not be completed.");
        }
        const completeBody = WalkthroughReviewSchema.parse(completePayload);
        setReview(completeBody);
        setStatus({ ...body, run: body.run ? { ...body.run, status: "REVIEWED" } : body.run });
      } else setReview(reviewBody);
    } else {
      setReview(null);
    }
  }, [walkthroughId]);

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      const response = await fetch(`/api/walkthroughs/${walkthroughId}/retry`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json() as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Processing could not be retried.");
      }
      await refresh();
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
      const response = await fetch(`/api/walkthroughs/${walkthroughId}/report`, { method: "POST" });
      const payload = await response.json() as unknown;
      if (!response.ok) {
        const errorBody = payload as { error?: { message?: string } };
        throw new Error(errorBody.error?.message ?? "The report could not be generated.");
      }
      const report = SiteReportSchema.parse(payload);
      router.push(`/reports/${report.reportId}` as never);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The report could not be generated.");
    } finally {
      setGeneratingReport(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/walkthroughs/${walkthroughId}/status`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as StatusResponse & { error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message ?? "The walkthrough status could not be loaded.");
        return body;
      })
      .then(async (body) => {
        if (cancelled) return;
        setStatus(body);
        if (body.run && ["NEEDS_REVIEW", "REVIEWED", "REPORT_READY"].includes(body.run.status)) {
          const reviewResponse = await fetch(`/api/walkthroughs/${walkthroughId}/observations`, { cache: "no-store" });
          const reviewPayload = await reviewResponse.json() as unknown;
          if (!reviewResponse.ok) {
            const errorBody = reviewPayload as { error?: { message?: string } };
            throw new Error(errorBody.error?.message ?? "The findings could not be loaded.");
          }
          const reviewBody = WalkthroughReviewSchema.parse(reviewPayload);
          if (reviewBody.totalCount === 0 && body.run.status === "NEEDS_REVIEW") {
            const completeResponse = await fetch(`/api/walkthroughs/${walkthroughId}/observations`, { method: "POST" });
            const completePayload = await completeResponse.json() as unknown;
            if (!completeResponse.ok) {
              const errorBody = completePayload as { error?: { message?: string } };
              throw new Error(errorBody.error?.message ?? "The empty review could not be completed.");
            }
            const completeBody = WalkthroughReviewSchema.parse(completePayload);
            if (!cancelled) {
              setReview(completeBody);
              setStatus({ ...body, run: body.run ? { ...body.run, status: "REVIEWED" } : body.run });
            }
          } else if (!cancelled) setReview(reviewBody);
        }
      })
      .catch((caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "The walkthrough status could not be loaded."); });
    return () => { cancelled = true; };
  }, [walkthroughId]);

  const reportReady = status?.run?.status === "REPORT_READY" || review?.runStatus === "REPORT_READY";

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <Link href="/" className="text-sm font-semibold text-slate-600 underline">← Back to upload</Link>
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Walkthrough status</p>
        <h1 className="mt-1 text-3xl font-semibold">{status?.walkthrough.title ?? "Loading walkthrough…"}</h1>
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {status && <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">Project: <span className="font-medium text-slate-900">{status.walkthrough.project.name}</span></p>
        <p className="text-sm text-slate-600">Upload: <span className="font-mono text-slate-900">{status.asset.status}</span></p>
        <p className="text-sm text-slate-600">Processing: <span className="font-mono text-slate-900">{status.run?.status ?? "UPLOAD_PENDING"}</span></p>
        {status.run?.errorMessage && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{status.run.errorMessage}</p>}
        {status.run?.failedStep && <p className="text-sm text-slate-600">Failed stage: {status.run.failedStep}</p>}
        <button type="button" onClick={() => void refresh().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "The walkthrough status could not be loaded."))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Refresh status</button>
        {status.run?.status === "REPORT_READY" && status.report && <Link href={`/reports/${status.report.id}` as never} className="inline-block rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">View report</Link>}
        {status.run?.status === "PROCESSING_FAILED" && <>
          {status.run.retryable === false && <p className="text-sm text-slate-600">Correct the underlying media or deployment configuration before retrying.</p>}
          <button type="button" disabled={retrying} onClick={() => void retry()} className="ml-3 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{retrying ? "Retrying…" : "Retry processing"}</button>
        </>}
      </section>}
      {review && status?.run && ["NEEDS_REVIEW", "REVIEWED", "REPORT_READY"].includes(status.run.status) && <FindingReviewPanel review={review} readOnly={reportReady} onReview={reviewObservation} />}
      {review && status?.run?.status === "REVIEWED" && review.runStatus === "REVIEWED" && !reportReady && review.remainingDrafts === 0 && (
        review.observations.some((observation) => observation.reviewState === "CONFIRMED" || observation.reviewState === "EDITED")
          ? <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-sm text-emerald-900">The review is complete. Generate a reviewed site record from the selected findings.</p><button type="button" disabled={generatingReport} onClick={() => void generateReport()} className="mt-3 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{generatingReport ? "Generating report…" : "Generate report"}</button></section>
          : <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No findings selected for report.</p>
      )}
    </main>
  );
}
