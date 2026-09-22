import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MediaAssetKind, MediaAssetStatus, Prisma, type ProcessingStatus } from "@prisma/client";
import { db } from "@/lib/db/client";
import { SiteThreadError, serializeError } from "@/lib/errors";
import type { MediaIntelligenceProvider, ProviderDiagnostic, TranscriptionProvider, VisualSemanticProvider } from "@/lib/livepeer/types";
import { configuredCreativeTranscriptionProvider } from "@/lib/livepeer/creative";
import { configuredVisualSemanticProvider, ProviderCallError } from "@/lib/livepeer/provider";
import { sanitizeProviderResponse } from "@/lib/livepeer/sanitize";
import { extractAudioWindow, extractVisualClip, probeDuration } from "@/lib/media/ffmpeg";
import { r2MediaStorage } from "@/lib/storage/r2";
import type { ProcessingMediaStorage } from "@/lib/storage/types";
import { extractObservations } from "@/lib/reasoning/extract";
import type { ObservationReasoner } from "@/lib/reasoning/types";
import { providerEventSourceRange, audioWindows, visualClips, type SourceRange } from "./selection";
import { CREATIVE_TRANSCRIBE_CAPABILITY } from "@/lib/livepeer/creative";
import { failProcessingRunIfCurrent, transitionProcessingRun } from "./lifecycle";

const SIGNED_READ_SECONDS = 15 * 60;

export interface ProcessingMediaTools {
  probeDuration(filePath: string): Promise<number>;
  extractAudioWindow(sourcePath: string, outputPath: string, range: SourceRange): Promise<void>;
  extractVisualClip(sourcePath: string, outputPath: string, range: SourceRange): Promise<void>;
}

const ffmpegTools: ProcessingMediaTools = { probeDuration, extractAudioWindow, extractVisualClip };

function stableHash(...parts: Array<string | number>): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function providerInvocationKey(runId: string, version: string, stage: string, capability: string, range: SourceRange): string {
  return stableHash(runId, version, stage, capability, range.startSeconds, range.endSeconds);
}

async function saveInvocation(database: Prisma.TransactionClient | typeof db, runId: string, stage: string, range: SourceRange, diagnostic: ProviderDiagnostic): Promise<string> {
  const rawResponse = sanitizeProviderResponse(diagnostic.rawResponse) as Prisma.InputJsonValue;
  const invocation = await database.providerInvocation.upsert({
    where: { idempotencyKey: diagnostic.idempotencyKey },
    create: { processingRunId: runId, idempotencyKey: diagnostic.idempotencyKey, provider: diagnostic.provider, capability: diagnostic.capability, stage, sourceStartSeconds: range.startSeconds, sourceEndSeconds: range.endSeconds, status: "SUCCEEDED", rawResponse, latencyMs: diagnostic.latencyMs },
    update: { status: "SUCCEEDED", rawResponse, latencyMs: diagnostic.latencyMs, errorCode: null, retryable: null },
  });
  return invocation.id;
}

async function saveProviderFailure(database: typeof db, runId: string, stage: string, range: SourceRange, capability: string, idempotencyKey: string, error: ProviderCallError): Promise<void> {
  await database.providerInvocation.upsert({
    where: { idempotencyKey },
    create: { processingRunId: runId, idempotencyKey, provider: "livepeer", capability, stage, sourceStartSeconds: range.startSeconds, sourceEndSeconds: range.endSeconds, status: "FAILED", errorCode: error.code, retryable: error.retryable, rawResponse: (error.rawResponse ?? {}) as Prisma.InputJsonValue },
    update: { status: "FAILED", errorCode: error.code, retryable: error.retryable, rawResponse: (error.rawResponse ?? {}) as Prisma.InputJsonValue },
  });
}

export async function processWalkthrough(
  runId: string,
  dependencies: { database?: typeof db; storage?: ProcessingMediaStorage; provider?: MediaIntelligenceProvider; transcriptionProvider?: TranscriptionProvider; visualProvider?: VisualSemanticProvider; media?: ProcessingMediaTools; reasoner?: ObservationReasoner } = {},
): Promise<void> {
  const database = dependencies.database ?? db;
  const storage = dependencies.storage ?? r2MediaStorage;
  const media = dependencies.media ?? ffmpegTools;
  const run = await database.processingRun.findUnique({ where: { id: runId }, include: { walkthrough: { include: { mediaAssets: true } } } });
  if (!run) throw new SiteThreadError("The processing run was not found.", "NOT_FOUND");
  if (run.status === "EXTRACTING_OBSERVATIONS") {
    try {
      await extractObservations(runId, { database, reasoner: dependencies.reasoner });
      return;
    } catch (error) {
      const safe = serializeError(error);
      await failProcessingRunIfCurrent(runId, "EXTRACTING_OBSERVATIONS", { failedStep: "EXTRACTING_OBSERVATIONS", errorCode: safe.code, errorMessage: safe.message, retryable: safe.retryable }, database);
      throw new SiteThreadError(safe.message, safe.code, safe.retryable);
    }
  }
  if (!["QUEUED", "TRANSCRIBING", "ANALYZING_MEDIA"].includes(run.status)) return;
  if (run.status === "QUEUED") {
    const claimed = await database.processingRun.updateMany({
      where: { id: runId, status: "QUEUED" },
      data: { status: "TRANSCRIBING", startedAt: new Date(), failedStep: null, errorCode: null, errorMessage: null, retryable: null },
    });
    if (claimed.count !== 1) return;
  }
  const source = run.walkthrough.mediaAssets.find((asset) => asset.kind === MediaAssetKind.SOURCE_VIDEO && asset.status === MediaAssetStatus.AVAILABLE);
  let directory: string | undefined;
  let stage: ProcessingStatus = run.status === "ANALYZING_MEDIA" ? "ANALYZING_MEDIA" : "TRANSCRIBING";
  try {
    if (!source) throw new SiteThreadError("The private source walkthrough is unavailable.", "MEDIA_UNAVAILABLE");
    const legacyProvider = dependencies.provider;
    const transcriptionProvider = dependencies.transcriptionProvider ?? legacyProvider ?? configuredCreativeTranscriptionProvider();
    directory = await mkdtemp(join(tmpdir(), "sitethread-media-"));
    const sourcePath = join(directory, "source.mp4");
    await storage.downloadToFile({ objectKey: source.objectKey, filePath: sourcePath });
    const duration = await media.probeDuration(sourcePath);
    await database.$transaction([
      database.walkthrough.update({ where: { id: run.walkthroughId }, data: { durationSeconds: duration } }),
      database.mediaAsset.update({ where: { id: source.id }, data: { durationSeconds: duration } }),
    ]);
    const windows = audioWindows(duration);
    await transcriptionProvider.discoverCapabilities();

    for (const [sequence, range] of (run.status === "ANALYZING_MEDIA" ? [] : windows).entries()) {
      const identity = { processingRunId: runId, sourceAssetId: source.id, startSeconds: range.startSeconds, endSeconds: range.endSeconds };
      const existing = await database.transcriptSegment.findUnique({ where: { processingRunId_sourceAssetId_startSeconds_endSeconds: identity } });
      if (existing?.processingRunId === runId && existing.sourceAssetId === source.id && existing.startSeconds === range.startSeconds && existing.endSeconds === range.endSeconds && existing.text.trim()) continue;
      const audioPath = join(directory, `audio-${sequence}.wav`);
      const objectKey = `walkthroughs/${run.walkthroughId}/temporary/${runId}/audio-${sequence}.wav`;
      const idempotencyKey = providerInvocationKey(runId, run.pipelineVersion, stage, CREATIVE_TRANSCRIBE_CAPABILITY, range);
      try {
        await media.extractAudioWindow(sourcePath, audioPath, range);
        await storage.putFile({ objectKey, filePath: audioPath, mimeType: "audio/wav" });
        const audioUrl = await storage.createReadUrl({ assetId: objectKey, expiresInSeconds: SIGNED_READ_SECONDS });
        let result;
        try {
          result = await transcriptionProvider.transcribe({ walkthroughId: run.walkthroughId, audioUrl, idempotencyKey });
        } catch (error) {
          if (error instanceof ProviderCallError) await saveProviderFailure(database, runId, stage, range, CREATIVE_TRANSCRIBE_CAPABILITY, idempotencyKey, error);
          throw error;
        }
        await database.$transaction(async (tx) => {
          await saveInvocation(tx, runId, stage, range, result.diagnostic);
          await tx.transcriptSegment.upsert({
            where: { processingRunId_sourceAssetId_startSeconds_endSeconds: identity },
            create: { walkthroughId: run.walkthroughId, processingRunId: runId, sourceAssetId: source.id, sequence, startSeconds: range.startSeconds, endSeconds: range.endSeconds, text: result.value.text },
            update: { processingRunId: runId, sourceAssetId: source.id, startSeconds: range.startSeconds, endSeconds: range.endSeconds, text: result.value.text },
          });
        });
      } finally {
        await storage.deleteObject({ objectKey }).catch(() => undefined);
        await rm(audioPath, { force: true });
      }
    }

    stage = "ANALYZING_MEDIA";
    if (run.status !== "ANALYZING_MEDIA") await transitionProcessingRun(runId, "ANALYZING_MEDIA", {}, database);
    const visualProvider = dependencies.visualProvider ?? legacyProvider ?? configuredVisualSemanticProvider();
    const transcript = await database.transcriptSegment.findMany({ where: { walkthroughId: run.walkthroughId, processingRunId: runId }, orderBy: { sequence: "asc" } });
    const clips = visualClips(duration, transcript.map(({ startSeconds, endSeconds, text }) => ({ startSeconds, endSeconds, text })));
    for (const [index, range] of clips.entries()) {
      const clipId = `clip_${stableHash(runId, range.startSeconds, range.endSeconds)}`;
      const objectKey = `walkthroughs/${run.walkthroughId}/evidence/${clipId}.mp4`;
      const existingCandidate = await database.visualCandidate.findUnique({ where: { processingRunId_mediaAssetId: { processingRunId: runId, mediaAssetId: clipId } } });
      if (existingCandidate) continue;
      let clipAsset = await database.mediaAsset.upsert({
        where: { id: clipId },
        create: { id: clipId, walkthroughId: run.walkthroughId, kind: MediaAssetKind.EVIDENCE_CLIP, status: MediaAssetStatus.PENDING, objectKey, mimeType: "video/mp4", sourceStartSeconds: range.startSeconds, sourceEndSeconds: range.endSeconds },
        update: {},
      });
      if (clipAsset.status !== MediaAssetStatus.AVAILABLE) {
        const clipPath = join(directory, `visual-${index}.mp4`);
        try {
          await media.extractVisualClip(sourcePath, clipPath, range);
          const clipDuration = await media.probeDuration(clipPath);
          if (!Number.isFinite(clipDuration) || clipDuration <= 0) throw new SiteThreadError("The visual clip could not be verified.", "MEDIA_UNAVAILABLE");
          const uploaded = await storage.putFile({ objectKey, filePath: clipPath, mimeType: "video/mp4" });
          clipAsset = await database.mediaAsset.update({ where: { id: clipId }, data: { status: MediaAssetStatus.AVAILABLE, byteSize: uploaded.byteSize, durationSeconds: clipDuration } });
        } finally {
          await rm(clipPath, { force: true });
        }
      }
      if (!clipAsset.durationSeconds || !Number.isFinite(clipAsset.durationSeconds)) throw new SiteThreadError("The visual clip duration is unavailable.", "MEDIA_UNAVAILABLE");
      const idempotencyKey = providerInvocationKey(runId, run.pipelineVersion, stage, "marlin-video", range);
      const mediaUrl = await storage.createReadUrl({ assetId: clipAsset.objectKey, expiresInSeconds: SIGNED_READ_SECONDS });
      let result;
      try {
        result = await visualProvider.analyzeVisual({ walkthroughId: run.walkthroughId, mediaUrl, sourceStartSeconds: range.startSeconds, sourceEndSeconds: range.endSeconds, idempotencyKey });
      } catch (error) {
        if (error instanceof ProviderCallError) await saveProviderFailure(database, runId, stage, range, "marlin-video", idempotencyKey, error);
        throw error;
      }
      const eventRange = providerEventSourceRange(range, result.value.eventRange, duration, clipAsset.durationSeconds);
      const hasSpecificEvent = eventRange.startSeconds !== range.startSeconds || eventRange.endSeconds !== range.endSeconds;
      await database.$transaction(async (tx) => {
        const invocationId = await saveInvocation(tx, runId, stage, range, result.diagnostic);
        await tx.visualCandidate.upsert({
          where: { processingRunId_mediaAssetId: { processingRunId: runId, mediaAssetId: clipId } },
          create: { processingRunId: runId, walkthroughId: run.walkthroughId, mediaAssetId: clipId, providerInvocationId: invocationId, clipStartSeconds: range.startSeconds, clipEndSeconds: range.endSeconds, sourceStartSeconds: range.startSeconds, sourceEndSeconds: range.endSeconds, eventStartSeconds: hasSpecificEvent ? eventRange.startSeconds : null, eventEndSeconds: hasSpecificEvent ? eventRange.endSeconds : null, text: result.value.text, provider: result.diagnostic.provider, capability: result.diagnostic.capability },
          update: { providerInvocationId: invocationId, sourceStartSeconds: range.startSeconds, sourceEndSeconds: range.endSeconds, eventStartSeconds: hasSpecificEvent ? eventRange.startSeconds : null, eventEndSeconds: hasSpecificEvent ? eventRange.endSeconds : null, text: result.value.text },
        });
      });
    }
    stage = "EXTRACTING_OBSERVATIONS";
    await transitionProcessingRun(runId, "EXTRACTING_OBSERVATIONS", {}, database);
    await extractObservations(runId, { database, reasoner: dependencies.reasoner });
  } catch (error) {
    const safe = serializeError(error);
    await failProcessingRunIfCurrent(runId, stage, { failedStep: stage, errorCode: safe.code, errorMessage: safe.message, retryable: safe.retryable }, database);
    throw new SiteThreadError(safe.message, safe.code, safe.retryable);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
