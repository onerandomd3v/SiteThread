import { ProcessingStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db/client";
import type { ProcessingJob } from "./types";

export const PIPELINE_VERSION = "mvp-upload-v1";

const transitions: Record<ProcessingStatus, ProcessingStatus[]> = {
  UPLOADING: ["UPLOADED", "PROCESSING_FAILED"],
  UPLOADED: ["QUEUED", "PROCESSING_FAILED"],
  QUEUED: ["TRANSCRIBING", "PROCESSING_FAILED"],
  TRANSCRIBING: ["ANALYZING_MEDIA", "PROCESSING_FAILED"],
  ANALYZING_MEDIA: ["EXTRACTING_OBSERVATIONS", "PROCESSING_FAILED"],
  EXTRACTING_OBSERVATIONS: ["NEEDS_REVIEW", "PROCESSING_FAILED"],
  NEEDS_REVIEW: ["REVIEWED", "PROCESSING_FAILED"],
  REVIEWED: ["REPORT_READY", "PROCESSING_FAILED"],
  REPORT_READY: [],
  PROCESSING_FAILED: ["QUEUED", "UPLOADING"],
};

export function canTransitionProcessingStatus(from: ProcessingStatus, to: ProcessingStatus): boolean {
  return from === to || transitions[from].includes(to);
}

export async function transitionProcessingRun(
  runId: string,
  to: ProcessingStatus,
  details: { failedStep?: string; errorCode?: string; errorMessage?: string; retryable?: boolean } = {},
  database: Prisma.TransactionClient | typeof db = db,
): Promise<ProcessingJob> {
  const current = await database.processingRun.findUnique({ where: { id: runId } });
  if (!current) throw new Error("Processing run not found.");
  if (!canTransitionProcessingStatus(current.status, to)) {
    throw new Error(`Cannot transition processing run from ${current.status} to ${to}.`);
  }
  const updated = await database.processingRun.update({
    where: { id: runId },
    data: {
      status: to,
      failedStep: to === "PROCESSING_FAILED" ? details.failedStep : null,
      errorCode: to === "PROCESSING_FAILED" ? details.errorCode : null,
      errorMessage: to === "PROCESSING_FAILED" ? details.errorMessage : null,
      retryable: to === "PROCESSING_FAILED" ? details.retryable : null,
      startedAt: to === "TRANSCRIBING" ? new Date() : to === "QUEUED" ? null : undefined,
      completedAt: ["NEEDS_REVIEW", "REVIEWED", "REPORT_READY"].includes(to) ? new Date() : undefined,
    },
  });
  return { id: updated.id, walkthroughId: updated.walkthroughId, status: updated.status };
}

export async function enqueueProcessingRun(runId: string, database: Prisma.TransactionClient | typeof db = db): Promise<ProcessingJob> {
  return transitionProcessingRun(runId, "QUEUED", {}, database);
}

export async function retryProcessingRun(runId: string, database: Prisma.TransactionClient | typeof db = db): Promise<ProcessingJob> {
  const current = await database.processingRun.findUnique({ where: { id: runId } });
  if (!current) throw new Error("Processing run not found.");
  if (current.status !== "PROCESSING_FAILED") return { id: current.id, walkthroughId: current.walkthroughId, status: current.status };
  await database.processingRun.updateMany({
    where: { id: runId, status: "PROCESSING_FAILED" },
    data: { status: "QUEUED", retryCount: { increment: 1 }, failedStep: null, errorCode: null, errorMessage: null, retryable: null },
  });
  const updated = await database.processingRun.findUniqueOrThrow({ where: { id: runId } });
  return { id: updated.id, walkthroughId: updated.walkthroughId, status: updated.status };
}

export async function failProcessingRunIfCurrent(
  runId: string,
  expectedStatus: ProcessingStatus,
  details: { failedStep?: string; errorCode?: string; errorMessage?: string; retryable?: boolean },
  database: Prisma.TransactionClient | typeof db = db,
): Promise<boolean> {
  const updated = await database.processingRun.updateMany({
    where: { id: runId, status: expectedStatus },
    data: {
      status: "PROCESSING_FAILED",
      failedStep: details.failedStep,
      errorCode: details.errorCode,
      errorMessage: details.errorMessage,
      retryable: details.retryable,
    },
  });
  return updated.count === 1;
}
