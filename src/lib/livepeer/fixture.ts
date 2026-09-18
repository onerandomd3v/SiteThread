import type { MediaIntelligenceProvider, MediaCapabilities, ProviderResult, TranscriptionInput, VisualAnalysisInput } from "./types";
import type { ProviderTranscriptResult, ProviderVisionResult } from "@/lib/schemas/provider";

const capabilities: MediaCapabilities = {
  discoveredAt: new Date(0),
  requirements: {
    TRANSCRIPTION: { capabilityId: "nemotron-asr", modelId: "fixture" },
    VISION: { capabilityId: "marlin-video", modelId: "fixture" },
  },
};

export class FixtureMediaIntelligenceProvider implements MediaIntelligenceProvider {
  async discoverCapabilities(): Promise<MediaCapabilities> { return capabilities; }

  async transcribe(input: TranscriptionInput): Promise<ProviderResult<ProviderTranscriptResult>> {
    return {
      value: { text: "Fixture narration for processing tests." },
      diagnostic: { provider: "fixture", capability: "nemotron-asr", idempotencyKey: input.idempotencyKey, rawResponse: { fixture: true }, latencyMs: 0 },
    };
  }

  async analyzeVisual(input: VisualAnalysisInput): Promise<ProviderResult<ProviderVisionResult>> {
    return {
      value: { text: "Fixture visual description for processing tests." },
      diagnostic: { provider: "fixture", capability: "marlin-video", idempotencyKey: input.idempotencyKey, rawResponse: { fixture: true }, latencyMs: 0 },
    };
  }
}
