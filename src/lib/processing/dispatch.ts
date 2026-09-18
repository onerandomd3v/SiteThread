import { createHash } from "node:crypto";
import { tasks } from "@trigger.dev/sdk";
import { db } from "@/lib/db/client";
import { SiteThreadError } from "@/lib/errors";

export async function dispatchProcessingRun(runId: string): Promise<void> {
  const run = await db.processingRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "QUEUED") return;
  if (!process.env.TRIGGER_SECRET_KEY) {
    await db.processingRun.updateMany({ where: { id: runId, status: "QUEUED" }, data: { status: "PROCESSING_FAILED", failedStep: "DISPATCH", errorCode: "INTERNAL_ERROR", errorMessage: "Background processing is not configured.", retryable: false } });
    throw new SiteThreadError("Background processing is not configured.", "INTERNAL_ERROR");
  }
  const idempotencyKey = createHash("sha256").update(`${run.id}|${run.pipelineVersion}|${run.retryCount}`).digest("hex");
  try {
    try {
      await tasks.trigger("process-walkthrough", { processingRunId: runId }, { idempotencyKey });
    } catch {
      await tasks.trigger("process-walkthrough", { processingRunId: runId }, { idempotencyKey });
    }
  } catch {
    const failed = await db.processingRun.updateMany({ where: { id: runId, status: "QUEUED" }, data: { status: "PROCESSING_FAILED", failedStep: "DISPATCH", errorCode: "PROCESSING_FAILED", errorMessage: "Background processing could not be started.", retryable: true } });
    if (failed.count === 0) {
      const current = await db.processingRun.findUnique({ where: { id: runId } });
      if (current && ["TRANSCRIBING", "ANALYZING_MEDIA", "EXTRACTING_OBSERVATIONS"].includes(current.status)) return;
    }
    throw new SiteThreadError("Background processing could not be started.", "PROCESSING_FAILED", true);
  }
}
