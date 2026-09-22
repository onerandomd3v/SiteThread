import type { ObservationReasoningOutput } from "@/lib/schemas/observation-reasoning";
import type { ProviderResult } from "@/lib/livepeer/types";

export const OBSERVATION_REASONING_CAPABILITY = "observation-reasoning";

export interface ObservationReasoningEvidence {
  ref: string;
  kind: "transcript" | "visual";
  text: string;
}

export interface ObservationReasoningInput {
  idempotencyKey: string;
  evidence: ObservationReasoningEvidence[];
}

export interface ObservationReasoner {
  extract(input: ObservationReasoningInput): Promise<ProviderResult<ObservationReasoningOutput>>;
}
