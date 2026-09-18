import { describe, expect, it } from "vitest";
import type { db } from "@/lib/db/client";
import { ProviderCallError } from "@/lib/livepeer/provider";
import type { MediaIntelligenceProvider } from "@/lib/livepeer/types";
import type { ProcessingMediaStorage } from "@/lib/storage/types";
import { retryProcessingRun } from "./lifecycle";
import { processWalkthrough, providerInvocationKey, type ProcessingMediaTools } from "./pipeline";

function scenario(failVisualOnce = false) {
  const source = { id: "source", walkthroughId: "walk", kind: "SOURCE_VIDEO", status: "AVAILABLE", objectKey: "private/source.mp4", mimeType: "video/mp4", byteSize: 1000, durationSeconds: null as number | null };
  const assets = new Map<string, Record<string, unknown>>([[source.id, source]]);
  const run = { id: "run", walkthroughId: "walk", pipelineVersion: "mvp-upload-v1", status: "QUEUED", retryCount: 0, failedStep: null as string | null, errorCode: null as string | null, errorMessage: null as string | null };
  const segments = new Map<number, Record<string, unknown>>();
  const candidates = new Map<string, Record<string, unknown>>();
  const invocations = new Map<string, Record<string, unknown>>();
  const transitions: string[] = [];
  const providerKeys: string[] = [];
  let visualCalls = 0;
  const database = {
    processingRun: {
      findUnique: async () => ({ ...run, walkthrough: { mediaAssets: [...assets.values()] } }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        if (data.retryCount && typeof data.retryCount === "object") run.retryCount += 1;
        Object.assign(run, { ...data, retryCount: run.retryCount });
        transitions.push(run.status);
        return { ...run };
      },
    },
    walkthrough: { update: async () => ({}) },
    mediaAsset: {
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { const asset = assets.get(where.id)!; Object.assign(asset, data); return { ...asset }; },
      upsert: async ({ where, create }: { where: { id: string }; create: Record<string, unknown> }) => { if (!assets.has(where.id)) assets.set(where.id, { ...create }); return { ...assets.get(where.id)! }; },
    },
    transcriptSegment: {
      findUnique: async ({ where }: { where: { walkthroughId_sequence: { sequence: number } } }) => segments.get(where.walkthroughId_sequence.sequence) ?? null,
      upsert: async ({ where, create, update }: { where: { walkthroughId_sequence: { sequence: number } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const sequence = where.walkthroughId_sequence.sequence;
        segments.set(sequence, { ...(segments.get(sequence) ?? create), ...update });
        return segments.get(sequence);
      },
      findMany: async () => [...segments.values()].sort((left, right) => Number(left.sequence) - Number(right.sequence)),
    },
    providerInvocation: {
      upsert: async ({ where, create, update }: { where: { idempotencyKey: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = where.idempotencyKey;
        invocations.set(key, { ...(invocations.get(key) ?? { id: `inv-${invocations.size}`, ...create }), ...update });
        return invocations.get(key);
      },
    },
    visualCandidate: {
      findUnique: async ({ where }: { where: { processingRunId_mediaAssetId: { mediaAssetId: string } } }) => candidates.get(where.processingRunId_mediaAssetId.mediaAssetId) ?? null,
      upsert: async ({ where, create, update }: { where: { processingRunId_mediaAssetId: { mediaAssetId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = where.processingRunId_mediaAssetId.mediaAssetId;
        candidates.set(key, { ...(candidates.get(key) ?? create), ...update });
        return candidates.get(key);
      },
    },
    $transaction: async (work: unknown) => typeof work === "function" ? (work as (tx: typeof database) => Promise<unknown>)(database) : Promise.all(work as Promise<unknown>[]),
  } as unknown as typeof db;
  const storage = {
    downloadToFile: async () => undefined,
    putFile: async () => ({ byteSize: 200 }),
    createReadUrl: async () => "https://private.example/media?X-Amz-Signature=secret",
    deleteObject: async () => undefined,
  } as unknown as ProcessingMediaStorage;
  const media: ProcessingMediaTools = { probeDuration: async (filePath) => filePath.endsWith(".mp4") && filePath.includes("visual-") ? 6 : 12, extractAudioWindow: async () => undefined, extractVisualClip: async () => undefined };
  const provider: MediaIntelligenceProvider = {
    discoverCapabilities: async () => ({ discoveredAt: new Date(), requirements: { TRANSCRIPTION: { capabilityId: "nemotron-asr", modelId: "fixture" }, VISION: { capabilityId: "marlin-video", modelId: "fixture" } } }),
    transcribe: async ({ idempotencyKey }) => {
      providerKeys.push(idempotencyKey);
      return { value: { text: `Narration ${providerKeys.length}` }, diagnostic: { provider: "fixture", capability: "nemotron-asr", idempotencyKey, rawResponse: { source_url: "https://private.example/secret", text: "spoken" }, latencyMs: 1 } };
    },
    analyzeVisual: async ({ idempotencyKey }) => {
      providerKeys.push(idempotencyKey);
      visualCalls += 1;
      if (failVisualOnce && visualCalls === 1) throw new ProviderCallError("Provider unavailable.", "PROVIDER_UNAVAILABLE", true, { source_url: "https://private.example/secret" });
      return { value: { text: "Visible condition", eventRange: { startSeconds: 1, endSeconds: 3 } }, diagnostic: { provider: "fixture", capability: "marlin-video", idempotencyKey, rawResponse: { video_url: "https://private.example/secret", text: "visible" }, latencyMs: 2 } };
    },
  };
  return { database, storage, media, provider, run, segments, candidates, invocations, transitions, providerKeys, get visualCalls() { return visualCalls; } };
}

describe("COD-17 processing pipeline", () => {
  it("persists source-aligned transcript and visual evidence, then stops at observation handoff", async () => {
    const state = scenario();
    await processWalkthrough("run", state);
    expect(state.transitions).toEqual(["TRANSCRIBING", "ANALYZING_MEDIA", "EXTRACTING_OBSERVATIONS"]);
    expect([...state.segments.values()].map((segment) => [segment.startSeconds, segment.endSeconds])).toEqual([[0, 6], [6, 12]]);
    expect(state.candidates.size).toBe(1);
    expect([...state.candidates.values()][0]).toMatchObject({ sourceStartSeconds: 0, sourceEndSeconds: 6, eventStartSeconds: 1, eventEndSeconds: 3, provider: "fixture" });
    expect(JSON.stringify([...state.invocations.values()])).not.toContain("private.example");
    await processWalkthrough("run", state);
    expect(state.segments.size).toBe(2);
    expect(state.candidates.size).toBe(1);
    expect(state.providerKeys).toHaveLength(3);
  });

  it("keeps completed transcription after a visual failure and reuses stable invocation keys on retry", async () => {
    const state = scenario(true);
    await expect(processWalkthrough("run", state)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(state.run.status).toBe("PROCESSING_FAILED");
    expect(state.run.failedStep).toBe("ANALYZING_MEDIA");
    expect((state.run as typeof state.run & { retryable: boolean }).retryable).toBe(true);
    expect(state.segments.size).toBe(2);
    await retryProcessingRun("run", state.database);
    await processWalkthrough("run", state);
    expect(state.run.status).toBe("EXTRACTING_OBSERVATIONS");
    expect(state.run.retryCount).toBe(1);
    expect(state.segments.size).toBe(2);
    expect(state.candidates.size).toBe(1);
    expect(state.providerKeys).toHaveLength(4);
    expect(state.providerKeys[2]).toBe(state.providerKeys[3]);
    expect(providerInvocationKey("run", "mvp-upload-v1", "ANALYZING_MEDIA", "marlin-video", { startSeconds: 0, endSeconds: 6 })).toBe(state.providerKeys[2]);
  });
});
