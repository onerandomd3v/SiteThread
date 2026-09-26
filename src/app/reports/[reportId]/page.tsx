import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintReportButton } from "@/components/print-report-button";
import { ReportEvidenceFrame } from "@/components/report-evidence-frame";
import { SiteThreadError } from "@/lib/errors";
import { getReport } from "@/lib/reports/service";
import type { ReportFinding } from "@/lib/schemas/report";

const groups: Array<{ key: ReportFinding["type"]; label: string }> = [
  { key: "PROGRESS", label: "Progress" },
  { key: "POTENTIAL_ISSUE", label: "Potential issues / attention" },
  { key: "ACTION", label: "Actions" },
  { key: "NOTE", label: "Notes" },
];

function timeLabel(value: number | null): string {
  if (value === null) return "Time unavailable";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function dateLabel(value: Date | null): string {
  return value ? value.toLocaleString() : "Date unavailable";
}

function Finding({ finding }: { finding: ReportFinding }) {
  return <article className="report-finding break-inside-avoid space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{finding.type.replaceAll("_", " ")}</p>
        <p className="mt-1 text-xs font-semibold text-emerald-800">{finding.reviewState === "EDITED" ? "Human edited" : "Human confirmed"}</p>
      </div>
      <p className="text-xs text-slate-500">{finding.reviewerId ?? "Unknown reviewer"} · {dateLabel(finding.reviewedAt)}</p>
    </div>
    {(finding.location || finding.trade) && <p className="text-sm text-slate-600">{[finding.location, finding.trade].filter(Boolean).join(" · ")}</p>}
    <p className="text-base leading-7 text-slate-950">{finding.text}</p>
    {finding.suggestedAction && <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><span className="font-semibold">Suggested follow-up:</span> {finding.suggestedAction}</p>}
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-slate-900">Evidence</h4>
      {finding.evidence.map((evidence) => <div key={evidence.reportEvidenceId} className="space-y-2 rounded-xl border border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600"><span className="font-semibold">{evidence.label}</span><span>{timeLabel(evidence.sourceStartSeconds)}–{timeLabel(evidence.sourceEndSeconds)}</span></div>
        {evidence.transcriptText && <p className="text-sm leading-6 text-slate-800"><span className="font-semibold">Narration:</span> “{evidence.transcriptText}”</p>}
        {evidence.frameUrl && <ReportEvidenceFrame src={evidence.frameUrl} label={evidence.label} />}
        {evidence.mediaAvailability === "UNAVAILABLE" && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This evidence asset is unavailable right now.</p>}
        <Link href={evidence.applicationUrl as never} className="inline-block text-sm font-semibold text-slate-700 underline">Open source evidence</Link>
      </div>)}
    </div>
  </article>;
}

export default async function ReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  let report: Awaited<ReturnType<typeof getReport>>;
  try {
    report = await getReport(reportId);
  } catch (error) {
    if (error instanceof SiteThreadError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return <main className="report-page mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-10">
    <div className="report-print-controls flex items-center justify-between gap-4"><Link href={`/walkthroughs/${report.walkthrough.id}`} className="text-sm font-semibold text-slate-600 underline">← Back to walkthrough</Link><PrintReportButton /></div>
    <header className="space-y-4 border-b border-slate-300 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">SiteThread</p><h1 className="mt-2 text-4xl font-semibold text-slate-950">Reviewed site record</h1></div><p className="text-sm text-slate-600">Generated {dateLabel(report.generatedAt)}</p></div>
      <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2"><p><span className="font-semibold">Project:</span> {report.project.name}</p><p><span className="font-semibold">Walkthrough:</span> {report.walkthrough.title}</p><p><span className="font-semibold">Captured:</span> {dateLabel(report.walkthrough.capturedAt)}</p><p><span className="font-semibold">Reviewer:</span> {report.generatedBy ?? "Unknown reviewer"}</p></div>
    </header>
    <div className="space-y-8">{groups.map((group) => { const findings = report.findings.filter((finding) => finding.type === group.key); return findings.length > 0 ? <section key={group.key} className="space-y-3"><h2 className="text-2xl font-semibold text-slate-950">{group.label}</h2>{findings.map((finding) => <Finding key={finding.reportObservationId} finding={finding} />)}</section> : null; })}</div>
    <footer className="border-t border-slate-300 pt-5 text-sm leading-6 text-slate-600">This report records reviewed observations from the referenced walkthrough and supporting evidence. It is not an engineering approval, safety certification, or code-compliance determination.</footer>
  </main>;
}
