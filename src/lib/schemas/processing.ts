import { z } from "zod";

export const ProcessingStatusSchema = z.enum([
  "UPLOADING", "UPLOADED", "QUEUED", "TRANSCRIBING", "ANALYZING_MEDIA",
  "EXTRACTING_OBSERVATIONS", "NEEDS_REVIEW", "REVIEWED", "REPORT_READY", "PROCESSING_FAILED",
]);
export type ProcessingStatus = z.infer<typeof ProcessingStatusSchema>;

export const ProcessingFailureSchema = z.object({
  status: z.literal("PROCESSING_FAILED"),
  failedStep: z.string().trim().min(1),
  errorCode: z.string().trim().min(1),
  errorMessage: z.string().trim().min(1),
  retryCount: z.number().int().nonnegative(),
});

export const ProcessingRunSchema = z.object({
  walkthroughId: z.string().min(1),
  pipelineVersion: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
  status: ProcessingStatusSchema,
  failedStep: z.string().trim().min(1).optional(),
  errorCode: z.string().trim().min(1).optional(),
  errorMessage: z.string().trim().min(1).optional(),
  retryCount: z.number().int().nonnegative(),
});
export type ProcessingRun = z.infer<typeof ProcessingRunSchema>;
