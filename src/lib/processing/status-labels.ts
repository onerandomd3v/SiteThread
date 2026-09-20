import type { ProcessingStatus } from "@/lib/schemas/processing";

export const ACTIVE_PROCESSING_STATUSES = [
  "UPLOADED",
  "QUEUED",
  "TRANSCRIBING",
  "ANALYZING_MEDIA",
  "EXTRACTING_OBSERVATIONS",
] as const satisfies readonly ProcessingStatus[];

export const REVIEW_STATUSES = ["NEEDS_REVIEW", "REVIEWED", "REPORT_READY"] as const satisfies readonly ProcessingStatus[];

export function isActiveProcessingStatus(status: string | null | undefined): boolean {
  return ACTIVE_PROCESSING_STATUSES.includes(status as (typeof ACTIVE_PROCESSING_STATUSES)[number]);
}

export function isReviewStatus(status: string | null | undefined): boolean {
  return REVIEW_STATUSES.includes(status as (typeof REVIEW_STATUSES)[number]);
}

export function processingStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "UPLOAD_PENDING": return "Upload pending";
    case "UPLOADING": return "Uploading walkthrough";
    case "UPLOADED": return "Upload complete";
    case "QUEUED": return "Queued for processing";
    case "TRANSCRIBING": return "Reading narration";
    case "ANALYZING_MEDIA": return "Reviewing visual evidence";
    case "EXTRACTING_OBSERVATIONS": return "Preparing findings";
    case "NEEDS_REVIEW": return "Ready for your review";
    case "REVIEWED": return "Review complete";
    case "REPORT_READY": return "Report ready";
    case "PROCESSING_FAILED": return "Processing needs attention";
    default: return "Preparing walkthrough";
  }
}

export const processingStages = [
  { status: "QUEUED", label: "Queued", detail: "Your walkthrough is next in line." },
  { status: "TRANSCRIBING", label: "Reading narration", detail: "Finding the moments you described." },
  { status: "ANALYZING_MEDIA", label: "Reviewing visual evidence", detail: "Connecting media to the walkthrough." },
  { status: "EXTRACTING_OBSERVATIONS", label: "Preparing findings", detail: "Turning evidence into reviewable drafts." },
  { status: "NEEDS_REVIEW", label: "Ready for your review", detail: "You decide what belongs in the record." },
] as const;
