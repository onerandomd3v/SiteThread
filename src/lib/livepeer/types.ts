import type { ProviderTranscriptResult, ProviderVisionResult } from "@/lib/schemas/provider";

export type CapabilityRequirement = "TRANSCRIPTION" | "VISION";

export interface MediaCapabilities {
  discoveredAt: Date;
  requirements: Record<CapabilityRequirement, { capabilityId: string; modelId: string; schemaVersion?: string }>;
}

export interface TranscriptionInput {
  walkthroughId: string;
  audioUrl: string;
  idempotencyKey: string;
}

export interface VisualAnalysisInput {
  walkthroughId: string;
  mediaUrl: string;
  sourceStartSeconds?: number;
  sourceEndSeconds?: number;
  idempotencyKey: string;
}

export interface MediaIntelligenceProvider {
  discoverCapabilities(): Promise<MediaCapabilities>;
  transcribe(input: TranscriptionInput): Promise<ProviderTranscriptResult>;
  analyzeVisual(input: VisualAnalysisInput): Promise<ProviderVisionResult>;
}

/** COD-14/COD-32 keep transport and exact provider payloads behind this boundary. */
