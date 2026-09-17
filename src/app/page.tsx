import { WalkthroughUploadPanel } from "@/components/walkthrough-upload-panel";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-600">SiteThread</p>
      <h1 className="max-w-3xl text-4xl font-semibold tracking-tight">Turn a site walk into a trusted project record.</h1>
      <p className="max-w-2xl text-lg leading-8 text-slate-700">
        Start with a private walkthrough upload. SiteThread keeps the project context and processing run visible while later stages prepare evidence-backed findings.
      </p>
      <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
        AI prepares. Human confirms.
      </p>
      <WalkthroughUploadPanel />
    </main>
  );
}
