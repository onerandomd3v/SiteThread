"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { processingStatusLabel } from "@/lib/processing/status-labels";

type RecentWalkthrough = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  run: { status: string; updatedAt: string } | null;
  report: { id: string } | null;
};

async function getWalkthroughs(projectId: string): Promise<RecentWalkthrough[]> {
  const response = await fetch(`/api/projects/${projectId}/walkthroughs`, { cache: "no-store" });
  const payload = await response.json() as { walkthroughs?: RecentWalkthrough[]; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? "Recent walkthroughs could not be loaded.");
  return payload.walkthroughs ?? [];
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RecentWalkthroughs({ projectId }: { projectId: string }) {
  const [walkthroughs, setWalkthroughs] = useState<RecentWalkthrough[]>([]);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [errorProjectId, setErrorProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void getWalkthroughs(projectId)
      .then((items) => { if (!cancelled) { setWalkthroughs(items); setError(null); setErrorProjectId(null); setLoadedProjectId(projectId); } })
      .catch((caught: unknown) => { if (!cancelled) { setError(caught instanceof Error ? caught.message : "Recent walkthroughs could not be loaded."); setErrorProjectId(projectId); setLoadedProjectId(projectId); } });
    return () => { cancelled = true; };
  }, [projectId, retryNonce]);

  const loading = loadedProjectId !== projectId;
  const visibleError = errorProjectId === projectId ? error : null;

  return (
    <section className="space-y-4" aria-labelledby="recent-walkthroughs-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Continue a record</p>
          <h2 id="recent-walkthroughs-heading" className="mt-1 text-2xl font-semibold text-slate-950">Recent walkthroughs</h2>
        </div>
        <p className="text-sm text-slate-500">Latest five for this project</p>
      </div>
      {loading && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600" role="status">Loading recent walkthroughs…</p>}
      {visibleError && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert"><p>{visibleError}</p><button type="button" onClick={() => setRetryNonce((current) => current + 1)} className="mt-2 font-semibold underline">Try again</button></div>}
      {!loading && !visibleError && walkthroughs.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">No walkthroughs yet for this project. Upload one to start the record.</p>}
      {!loading && !visibleError && walkthroughs.length > 0 && <div className="grid gap-3">{walkthroughs.map((walkthrough) => {
        const status = walkthrough.run?.status ?? "UPLOADED";
        return <article key={walkthrough.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><p className="truncate font-semibold text-slate-950">{walkthrough.title ?? "Untitled walkthrough"}</p><p className="mt-1 text-sm text-slate-500">Updated {dateLabel(walkthrough.updatedAt)}</p></div>
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{processingStatusLabel(status)}</span><Link href={`/walkthroughs/${walkthrough.id}`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Open walkthrough</Link>{walkthrough.report && <Link href={`/reports/${walkthrough.report.id}`} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">View report</Link>}</div>
        </article>;
      })}</div>}
    </section>
  );
}
