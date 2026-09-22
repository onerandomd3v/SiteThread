import { parseServerEnv } from "@/lib/config/env";
import { ProviderCallError, withProviderAttribution } from "@/lib/livepeer/provider-errors";
import { ObservationReasoningOutputSchema } from "@/lib/schemas/observation-reasoning";
import type { SafeJson } from "@/lib/livepeer/types";
import { GeminiObservationReasoner, GEMINI_REASONING_ATTRIBUTION } from "./gemini";
import { OBSERVATION_REASONING_CAPABILITY, type ObservationReasoner, type ObservationReasoningInput } from "./types";

export class FixtureObservationReasoner implements ObservationReasoner {
  async extract(input: ObservationReasoningInput) {
    const observations = input.evidence.slice(0, 20).map((evidence) => ({
      type: "note" as const,
      description: evidence.text,
      evidenceRefs: [evidence.ref],
    }));
    return {
      value: ObservationReasoningOutputSchema.parse({ observations }),
      diagnostic: {
        provider: "fixture",
        capability: OBSERVATION_REASONING_CAPABILITY,
        idempotencyKey: input.idempotencyKey,
        rawResponse: { fixture: true } as SafeJson,
        latencyMs: 0,
      },
    };
  }
}

export function configuredObservationReasoner(): ObservationReasoner {
  const env = parseServerEnv();
  if (env.MEDIA_PROVIDER_MODE === "fixture") return new FixtureObservationReasoner();
  if (!env.GEMINI_API_KEY) {
    throw withProviderAttribution(
      new ProviderCallError("Google Gemini observation reasoning is not configured.", "PROVIDER_CONTRACT_UNRESOLVED", false),
      GEMINI_REASONING_ATTRIBUTION,
    );
  }
  return new GeminiObservationReasoner(env.GEMINI_API_KEY, env.GEMINI_MODEL);
}
