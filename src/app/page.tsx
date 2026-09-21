"use client";

import { useState } from "react";
import { WalkthroughUploadPanel } from "@/components/walkthrough-upload-panel";
import { RecentWalkthroughs } from "@/components/recent-walkthroughs";

export default function HomePage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-5 py-8 sm:px-8 sm:py-12">
      <header className="grid gap-6 border-b border-slate-200 pb-10 lg:grid-cols-[1.5fr_1fr] lg:items-end">
        <div className="space-y-4"><p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">SiteThread</p><h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">Turn a site walk into a trusted project record.</h1><p className="max-w-2xl text-lg leading-8 text-slate-700">Capture what happened on site once. SiteThread keeps the project context, source evidence, and human review together.</p></div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-sm font-semibold text-emerald-950">AI prepares. Human confirms.</p><p className="mt-2 text-sm leading-6 text-emerald-900">Every finding remains reviewable before it becomes part of a trusted project record.</p></div>
      </header>
      <section className="grid gap-3 sm:grid-cols-3" aria-label="SiteThread workflow"><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">01</p><p className="mt-2 font-semibold text-slate-950">Capture a walkthrough</p><p className="mt-1 text-sm text-slate-600">Upload the site walk your team already records.</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">02</p><p className="mt-2 font-semibold text-slate-950">Review evidence-backed findings</p><p className="mt-1 text-sm text-slate-600">Check narration, visual evidence, and source timing.</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">03</p><p className="mt-2 font-semibold text-slate-950">Keep the record</p><p className="mt-1 text-sm text-slate-600">Confirm or edit what belongs in the reviewed site record.</p></div></section>
      <WalkthroughUploadPanel onProjectSelected={setProjectId} />
      {projectId ? <RecentWalkthroughs projectId={projectId} /> : <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6"><h2 className="text-xl font-semibold text-slate-950">Choose a project to continue</h2><p className="mt-2 text-sm leading-6 text-slate-600">Your recent walkthroughs will appear here after a project is selected. Create a project above if this is your first site record.</p></section>}
    </main>
  );
}
