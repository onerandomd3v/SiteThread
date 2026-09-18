import type { ObservationReasoningOutput } from "@/lib/schemas/observation-reasoning";
import type { ProviderResult } from "@/lib/livepeer/types";

export interface ObservationReasoningEvidence {
  ref: string;
  kind: "transcript" | "visual";
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface ObservationReasoningInput {
  runId: string;
  walkthroughId: string;
  pipelineVersion: string;
  retryCount: number;
  reasoningVersion: string;
  evidenceFingerprint: string;
  evidence: ObservationReasoningEvidence[];
}

export interface ObservationReasoner {
  extract(input: ObservationReasoningInput): Promise<ProviderResult<ObservationReasoningOutput>>;
}
