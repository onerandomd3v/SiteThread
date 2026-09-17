import type { ProcessingStatus } from "@/lib/schemas/processing";

export interface ProcessingJobRequest {
  walkthroughId: string;
  pipelineVersion: string;
  idempotencyKey: string;
}

export interface ProcessingJob {
  id: string;
  walkthroughId: string;
  status: ProcessingStatus;
}

export interface ProcessingJobDispatcher {
  enqueue(input: ProcessingJobRequest): Promise<ProcessingJob>;
}

export interface ProcessingLogEvent {
  runId: string;
  walkthroughId: string;
  status: ProcessingStatus;
  occurredAt: Date;
  errorCode?: string;
}
