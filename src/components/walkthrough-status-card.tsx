"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FindingReviewPanel } from "@/components/finding-review-panel";
import type { WalkthroughReview } from "@/lib/schemas/review";

type StatusResponse = {
  walkthrough: { id: string; title: string | null; project: { id: string; name: string } };
  asset: { status: string; byteSize: number | null; mimeType: string };
  run: { status: string; retryCount: number; failedStep: string | null; errorMessage: string | null; retryable: boolean | null } | null;
};

export function WalkthroughStatusCard({ walkthroughId }: { walkthroughId: string }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [review, setReview] = useState<WalkthroughReview | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const response = await fetch(`/api/walkthroughs/${walkthroughId}/status`, { cache: "no-store" });
    const body = await response.json() as StatusResponse & { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? "The walkthrough status could not be loaded.");
    setStatus(body);
    if (body.run && ["NEEDS_REVIEW", "REVIEWED"].includes(body.run.status)) {
      const reviewResponse = await fetch(`/api/walkthroughs/${walkthroughId}/observations`, { cache: "no-store" });
      const reviewBody = await reviewResponse.json() as WalkthroughReview & { error?: { message?: string } };
      if (!reviewResponse.ok) throw new Error(reviewBody.error?.message ?? "The findings could not be loaded.");
      if (reviewBody.totalCount === 0 && body.run.status === "NEEDS_REVIEW") {
        const completeResponse = await fetch(`/api/walkthroughs/${walkthroughId}/observations`, { method: "POST" });
        const completeBody = await completeResponse.json() as WalkthroughReview & { error?: { message?: string } };
        if (!completeResponse.ok) throw new Error(completeBody.error?.message ?? "The empty review could not be completed.");
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
    const response = await fetch(`/api/walkthroughs/${walkthroughId}/observations/${observationId}/review`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(decision) });
    const body = await response.json() as { review?: WalkthroughReview; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? "The review decision could not be saved.");
    if (body.review) setReview(body.review);
    await refresh();
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
        if (body.run && ["NEEDS_REVIEW", "REVIEWED"].includes(body.run.status)) {
          const reviewResponse = await fetch(`/api/walkthroughs/${walkthroughId}/observations`, { cache: "no-store" });
          const reviewBody = await reviewResponse.json() as WalkthroughReview & { error?: { message?: string } };
          if (!reviewResponse.ok) throw new Error(reviewBody.error?.message ?? "The findings could not be loaded.");
          if (reviewBody.totalCount === 0 && body.run.status === "NEEDS_REVIEW") {
            const completeResponse = await fetch(`/api/walkthroughs/${walkthroughId}/observations`, { method: "POST" });
            const completeBody = await completeResponse.json() as WalkthroughReview & { error?: { message?: string } };
            if (!completeResponse.ok) throw new Error(completeBody.error?.message ?? "The empty review could not be completed.");
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
        {status.run?.status === "PROCESSING_FAILED" && <>
          {status.run.retryable === false && <p className="text-sm text-slate-600">Correct the underlying media or deployment configuration before retrying.</p>}
          <button type="button" disabled={retrying} onClick={() => void retry()} className="ml-3 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{retrying ? "Retrying…" : "Retry processing"}</button>
        </>}
      </section>}
      {review && status?.run && ["NEEDS_REVIEW", "REVIEWED"].includes(status.run.status) && <FindingReviewPanel review={review} onReview={reviewObservation} />}
    </main>
  );
}
