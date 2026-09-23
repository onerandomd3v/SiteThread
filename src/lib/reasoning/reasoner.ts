import { parseServerEnv } from "@/lib/config/env";
import { ProviderCallError, withProviderAttribution } from "@/lib/livepeer/provider-errors";
import { ObservationReasoningOutputSchema } from "@/lib/schemas/observation-reasoning";
import type { SafeJson } from "@/lib/livepeer/types";
import { GeminiObservationReasoner, GEMINI_REASONING_ATTRIBUTION } from "./gemini";
import { GroqObservationReasoner, GROQ_REASONING_ATTRIBUTION } from "./groq";
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

function unresolvedConfiguration(
  message: string,
  attribution?: typeof GROQ_REASONING_ATTRIBUTION | typeof GEMINI_REASONING_ATTRIBUTION,
): ProviderCallError {
  const error = new ProviderCallError(message, "PROVIDER_CONTRACT_UNRESOLVED", false);
  return attribution ? withProviderAttribution(error, attribution) : error;
}

export function configuredObservationReasoner(): ObservationReasoner {
  const env = parseServerEnv();
  if (env.MEDIA_PROVIDER_MODE === "fixture") return new FixtureObservationReasoner();

  if (!env.REASONER_PROVIDER) throw unresolvedConfiguration("Live observation reasoning requires REASONER_PROVIDER.");
  if (!env.REASONER_MODEL) throw unresolvedConfiguration("Live observation reasoning requires REASONER_MODEL.");

  switch (env.REASONER_PROVIDER) {
    case "groq":
      if (!env.GROQ_API_KEY) throw unresolvedConfiguration("Groq observation reasoning requires GROQ_API_KEY.", GROQ_REASONING_ATTRIBUTION);
      return new GroqObservationReasoner(env.GROQ_API_KEY, env.REASONER_MODEL);
    case "google-gemini":
      if (!env.GEMINI_API_KEY) throw unresolvedConfiguration("Google Gemini observation reasoning requires GEMINI_API_KEY.", GEMINI_REASONING_ATTRIBUTION);
      return new GeminiObservationReasoner(env.GEMINI_API_KEY, env.REASONER_MODEL);
    default:
      throw unresolvedConfiguration(`Unsupported observation reasoner provider: ${env.REASONER_PROVIDER}.`);
  }
}
