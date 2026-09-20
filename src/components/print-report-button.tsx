"use client";

export function PrintReportButton() {
  return <button type="button" onClick={() => window.print()} className="report-print-controls rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Print / Save PDF</button>;
}
