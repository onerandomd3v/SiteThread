import { randomUUID } from "node:crypto";
import { MediaAssetKind, MediaAssetStatus, Prisma, ProcessingStatus } from "@prisma/client";
import { db } from "@/lib/db/client";
import { SiteThreadError } from "@/lib/errors";
import { enqueueProcessingRun, retryProcessingRun, UPLOAD_PIPELINE_VERSION } from "@/lib/processing/lifecycle";
import type { MediaStorage } from "@/lib/storage/types";
import { r2MediaStorage } from "@/lib/storage/r2";
import { MAX_WALKTHROUGH_UPLOAD_BYTES, UploadIntentRequestSchema, type UploadIntentRequest } from "./upload-policy";

function durableObjectKey(walkthroughId: string, assetId: string): string {
  return `walkthroughs/${walkthroughId}/source/${assetId}.mp4`;
}

function stagingObjectKey(walkthroughId: string, assetId: string): string {
  return `walkthroughs/${walkthroughId}/staging/${assetId}.mp4`;
}

function publicRun(run: { id: string; walkthroughId: string; status: ProcessingStatus; retryCount: number; failedStep: string | null; errorCode: string | null; errorMessage: string | null; updatedAt: Date }) {
  return {
    id: run.id,
    walkthroughId: run.walkthroughId,
    status: run.status,
    retryCount: run.retryCount,
    failedStep: run.failedStep,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    updatedAt: run.updatedAt,
  };
}

export async function createUploadIntent(
  projectId: string,
  input: UploadIntentRequest,
  storage: MediaStorage = r2MediaStorage,
  database: typeof db = db,
) {
  const parsed = UploadIntentRequestSchema.parse(input);
  const project = await database.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new SiteThreadError("Project was not found.", "NOT_FOUND");

  const existing = await database.walkthrough.findUnique({ where: { uploadIntentKey: parsed.idempotencyKey }, include: { mediaAssets: true, processingRuns: true } });
  if (existing) {
    if (existing.projectId !== projectId) throw new SiteThreadError("This upload intent belongs to another project.", "INVALID_INPUT");
    const asset = existing.mediaAssets.find((item) => item.kind === MediaAssetKind.SOURCE_VIDEO);
    const run = existing.processingRuns.find((item) => item.pipelineVersion === UPLOAD_PIPELINE_VERSION);
    if (!asset || asset.byteSize !== parsed.byteSize || asset.mimeType !== parsed.mimeType) {
      throw new SiteThreadError("The upload intent does not match the original file.", "INVALID_INPUT");
    }
    if (asset.status === MediaAssetStatus.AVAILABLE) {
      return { walkthroughId: existing.id, assetId: asset.id, runId: run?.id, objectKey: asset.objectKey, uploadUrl: null, expiresAt: null, requiredHeaders: {} };
    }
    if (!asset.stagingObjectKey) throw new SiteThreadError("The upload staging record is incomplete.", "INTERNAL_ERROR");
    const signed = await storage.createUploadIntent({ objectKey: asset.stagingObjectKey, mimeType: asset.mimeType });
    return { walkthroughId: existing.id, assetId: asset.id, runId: run?.id, objectKey: asset.objectKey, uploadUrl: signed.uploadUrl, expiresAt: signed.expiresAt, requiredHeaders: signed.requiredHeaders };
  }

  const walkthroughId = randomUUID();
  const assetId = randomUUID();
  const stagingKey = stagingObjectKey(walkthroughId, assetId);
  try {
    await database.$transaction([
      database.walkthrough.create({ data: { id: walkthroughId, projectId, uploadIntentKey: parsed.idempotencyKey, title: parsed.fileName } }),
      database.mediaAsset.create({ data: { id: assetId, walkthroughId, kind: MediaAssetKind.SOURCE_VIDEO, status: MediaAssetStatus.PENDING, objectKey: stagingKey, stagingObjectKey: stagingKey, mimeType: parsed.mimeType, byteSize: parsed.byteSize } }),
    ]);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return createUploadIntent(projectId, parsed, storage, database);
    }
    throw error;
  }

  const signed = await storage.createUploadIntent({ objectKey: stagingKey, mimeType: parsed.mimeType });
  return { walkthroughId, assetId, objectKey: stagingKey, uploadUrl: signed.uploadUrl, expiresAt: signed.expiresAt, requiredHeaders: signed.requiredHeaders };
}

export async function finalizeUpload(walkthroughId: string, storage: MediaStorage = r2MediaStorage, database: typeof db = db) {
  const record = await database.walkthrough.findUnique({ where: { id: walkthroughId }, include: { mediaAssets: true, processingRuns: true } });
  if (!record) throw new SiteThreadError("Walkthrough was not found.", "NOT_FOUND");
  const asset = record.mediaAssets.find((item) => item.kind === MediaAssetKind.SOURCE_VIDEO);
  const run = record.processingRuns.find((item) => item.pipelineVersion === UPLOAD_PIPELINE_VERSION);
  if (!asset) throw new SiteThreadError("The upload record is incomplete.", "INTERNAL_ERROR");
  if (asset.status === MediaAssetStatus.AVAILABLE && run) return publicRun(run);
  if (asset.status === MediaAssetStatus.AVAILABLE && !run) {
    const queued = await database.$transaction(async (tx) => {
      const persistedRun = await tx.processingRun.upsert({
        where: { idempotencyKey: `${walkthroughId}:${UPLOAD_PIPELINE_VERSION}` },
        create: { id: randomUUID(), walkthroughId, pipelineVersion: UPLOAD_PIPELINE_VERSION, idempotencyKey: `${walkthroughId}:${UPLOAD_PIPELINE_VERSION}`, status: "UPLOADED" },
        update: {},
      });
      return enqueueProcessingRun(persistedRun.id, tx);
    });
    return publicRun(await database.processingRun.findUniqueOrThrow({ where: { id: queued.id } }));
  }
  if (!asset.stagingObjectKey) throw new SiteThreadError("The upload staging record is incomplete.", "INTERNAL_ERROR");
  if (!asset.byteSize) throw new SiteThreadError("The upload size is missing.", "INVALID_INPUT");
  const destinationKey = durableObjectKey(walkthroughId, asset.id);
  const verified = await storage.verifyUpload({ objectKey: asset.stagingObjectKey, expectedByteSize: asset.byteSize, expectedMimeType: asset.mimeType });
  if (!verified.etag) throw new SiteThreadError("The uploaded media could not be verified yet.", "MEDIA_UNAVAILABLE", true);
  await storage.promoteUpload({ sourceObjectKey: asset.stagingObjectKey, destinationObjectKey: destinationKey, sourceETag: verified.etag, mimeType: asset.mimeType });
  const queued = await database.$transaction(async (tx) => {
    await tx.mediaAsset.update({ where: { id: asset.id }, data: { status: MediaAssetStatus.AVAILABLE, objectKey: destinationKey, stagingObjectKey: null, byteSize: verified.byteSize } });
    const persistedRun = await tx.processingRun.upsert({
      where: { idempotencyKey: `${walkthroughId}:${UPLOAD_PIPELINE_VERSION}` },
      create: { id: randomUUID(), walkthroughId, pipelineVersion: UPLOAD_PIPELINE_VERSION, idempotencyKey: `${walkthroughId}:${UPLOAD_PIPELINE_VERSION}`, status: "UPLOADED" },
      update: {},
    });
    if (run) await tx.processingRun.update({ where: { id: run.id }, data: { status: "UPLOADED", errorCode: null, errorMessage: null, failedStep: null } });
    return enqueueProcessingRun(persistedRun.id, tx);
  });
  try {
    await storage.deleteObject({ objectKey: asset.stagingObjectKey });
  } catch {
    // The finalized object is already durable; staging cleanup can be retried separately.
  }
  return publicRun(await database.processingRun.findUniqueOrThrow({ where: { id: queued.id } }));
}

export async function getWalkthroughStatus(walkthroughId: string, database: typeof db = db) {
  const record = await database.walkthrough.findUnique({ where: { id: walkthroughId }, include: { mediaAssets: true, processingRuns: true, project: { select: { id: true, name: true } } } });
  if (!record) throw new SiteThreadError("Walkthrough was not found.", "NOT_FOUND");
  const asset = record.mediaAssets.find((item) => item.kind === MediaAssetKind.SOURCE_VIDEO);
  const run = record.processingRuns.find((item) => item.pipelineVersion === UPLOAD_PIPELINE_VERSION);
  if (!asset) throw new SiteThreadError("The upload record is incomplete.", "INTERNAL_ERROR");
  return { walkthrough: { id: record.id, title: record.title, project: record.project }, asset: { id: asset.id, status: asset.status, mimeType: asset.mimeType, byteSize: asset.byteSize }, run: run ? publicRun(run) : null };
}

export async function retryWalkthrough(walkthroughId: string, database: typeof db = db) {
  const run = await database.processingRun.findFirst({ where: { walkthroughId, pipelineVersion: UPLOAD_PIPELINE_VERSION }, include: { walkthrough: { include: { mediaAssets: true } } } });
  if (!run) throw new SiteThreadError("Walkthrough was not found.", "NOT_FOUND");
  const asset = run.walkthrough.mediaAssets.find((item) => item.kind === MediaAssetKind.SOURCE_VIDEO);
  if (!asset || asset.status !== MediaAssetStatus.AVAILABLE) throw new SiteThreadError("Upload the source media before retrying processing.", "MEDIA_UNAVAILABLE", true);
  const retried = await retryProcessingRun(run.id, database);
  return publicRun(await database.processingRun.findUniqueOrThrow({ where: { id: retried.id } }));
}

export function uploadLimitBytes(): number {
  return MAX_WALKTHROUGH_UPLOAD_BYTES;
}
