import { randomUUID } from "node:crypto";
import { MediaAssetKind, MediaAssetStatus, Prisma, ProcessingStatus } from "@prisma/client";
import { db } from "@/lib/db/client";
import { SiteThreadError } from "@/lib/errors";
import { enqueueProcessingRun, retryProcessingRun, PIPELINE_VERSION } from "@/lib/processing/lifecycle";
import type { MediaStorage } from "@/lib/storage/types";
import { r2MediaStorage } from "@/lib/storage/r2";
import { MAX_WALKTHROUGH_UPLOAD_BYTES, UploadIntentRequestSchema, type UploadIntentRequest } from "./upload-policy";

function durableObjectKey(walkthroughId: string, assetId: string): string {
  return `walkthroughs/${walkthroughId}/source/${assetId}.mp4`;
}

function stagingObjectKey(walkthroughId: string, assetId: string): string {
  return `walkthroughs/${walkthroughId}/staging/${assetId}.mp4`;
}

function publicRun(run: { id: string; walkthroughId: string; status: ProcessingStatus; retryCount: number; failedStep: string | null; errorCode: string | null; errorMessage: string | null; retryable?: boolean | null; updatedAt: Date }) {
  return {
    id: run.id,
    walkthroughId: run.walkthroughId,
    status: run.status,
    retryCount: run.retryCount,
    failedStep: run.failedStep,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    retryable: run.retryable ?? null,
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
    const run = existing.processingRuns.find((item) => item.pipelineVersion === PIPELINE_VERSION);
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
  const run = record.processingRuns.find((item) => item.pipelineVersion === PIPELINE_VERSION);
  if (!asset) throw new SiteThreadError("The upload record is incomplete.", "INTERNAL_ERROR");
  if (asset.status === MediaAssetStatus.AVAILABLE && run) return publicRun(run);
  if (asset.status === MediaAssetStatus.AVAILABLE && !run) {
    const queued = await database.$transaction(async (tx) => {
      const persistedRun = await tx.processingRun.upsert({
        where: { idempotencyKey: `${walkthroughId}:${PIPELINE_VERSION}` },
        create: { id: randomUUID(), walkthroughId, pipelineVersion: PIPELINE_VERSION, idempotencyKey: `${walkthroughId}:${PIPELINE_VERSION}`, status: "UPLOADED" },
        update: {},
      });
      return enqueueProcessingRun(persistedRun.id, tx);
    });
    return publicRun(await database.processingRun.findUniqueOrThrow({ where: { id: queued.id } }));
  }
  const destinationKey = durableObjectKey(walkthroughId, asset.id);
  const finalized = await database.$transaction(async (tx) => {
    await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "MediaAsset" WHERE "id" = ${asset.id} FOR UPDATE`;
    const currentAsset = await tx.mediaAsset.findUnique({ where: { id: asset.id } });
    if (!currentAsset) throw new SiteThreadError("The upload record is incomplete.", "INTERNAL_ERROR");
    const idempotencyKey = `${walkthroughId}:${PIPELINE_VERSION}`;
    const currentRun = await tx.processingRun.findUnique({ where: { idempotencyKey } });
    if (currentAsset.status === MediaAssetStatus.AVAILABLE) {
      const persistedRun = currentRun ?? await tx.processingRun.upsert({
        where: { idempotencyKey },
        create: { id: randomUUID(), walkthroughId, pipelineVersion: PIPELINE_VERSION, idempotencyKey, status: "UPLOADED" },
        update: {},
      });
      const queued = currentRun ? { id: persistedRun.id, walkthroughId: persistedRun.walkthroughId, status: persistedRun.status } : await enqueueProcessingRun(persistedRun.id, tx);
      return { queued, cleanupObjectKey: null };
    }
    if (currentAsset.status !== MediaAssetStatus.PENDING) throw new SiteThreadError("The upload is not ready to be finalized.", "MEDIA_UNAVAILABLE", true);
    if (!currentAsset.stagingObjectKey) throw new SiteThreadError("The upload staging record is incomplete.", "INTERNAL_ERROR");
    if (!currentAsset.byteSize) throw new SiteThreadError("The upload size is missing.", "INVALID_INPUT");
    const verified = await storage.verifyUpload({ objectKey: currentAsset.stagingObjectKey, expectedByteSize: currentAsset.byteSize, expectedMimeType: currentAsset.mimeType });
    if (!verified.etag) throw new SiteThreadError("The uploaded media could not be verified yet.", "MEDIA_UNAVAILABLE", true);
    await storage.promoteUpload({ sourceObjectKey: currentAsset.stagingObjectKey, destinationObjectKey: destinationKey, sourceETag: verified.etag, mimeType: currentAsset.mimeType });
    await tx.mediaAsset.update({ where: { id: currentAsset.id }, data: { status: MediaAssetStatus.AVAILABLE, objectKey: destinationKey, stagingObjectKey: null, byteSize: verified.byteSize } });
    const persistedRun = await tx.processingRun.upsert({
      where: { idempotencyKey },
      create: { id: randomUUID(), walkthroughId, pipelineVersion: PIPELINE_VERSION, idempotencyKey, status: "UPLOADED" },
      update: {},
    });
    if (currentRun) await tx.processingRun.update({ where: { id: currentRun.id }, data: { status: "UPLOADED", errorCode: null, errorMessage: null, failedStep: null } });
    return { queued: await enqueueProcessingRun(persistedRun.id, tx), cleanupObjectKey: currentAsset.stagingObjectKey };
  });
  if (finalized.cleanupObjectKey) {
    try {
      await storage.deleteObject({ objectKey: finalized.cleanupObjectKey });
    } catch {
      // The finalized object is already durable; staging cleanup can be retried separately.
    }
  }
  return publicRun(await database.processingRun.findUniqueOrThrow({ where: { id: finalized.queued.id } }));
}

export async function getWalkthroughStatus(walkthroughId: string, database: typeof db = db) {
  const record = await database.walkthrough.findUnique({ where: { id: walkthroughId }, include: { mediaAssets: true, processingRuns: true, project: { select: { id: true, name: true } } } });
  if (!record) throw new SiteThreadError("Walkthrough was not found.", "NOT_FOUND");
  const asset = record.mediaAssets.find((item) => item.kind === MediaAssetKind.SOURCE_VIDEO);
  const run = record.processingRuns.find((item) => item.pipelineVersion === PIPELINE_VERSION);
  if (!asset) throw new SiteThreadError("The upload record is incomplete.", "INTERNAL_ERROR");
  const report = run ? await database.report.findFirst({ where: { walkthroughId, observations: { some: { observation: { processingRunId: run.id } } } }, select: { id: true }, orderBy: { generatedAt: "desc" } }) : null;
  return { walkthrough: { id: record.id, title: record.title, project: record.project }, asset: { id: asset.id, status: asset.status, mimeType: asset.mimeType, byteSize: asset.byteSize }, run: run ? publicRun(run) : null, report };
}

export async function listRecentWalkthroughs(projectId: string, database: typeof db = db) {
  const project = await database.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new SiteThreadError("Project was not found.", "NOT_FOUND");

  const walkthroughs = await database.walkthrough.findMany({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      processingRuns: {
        where: { pipelineVersion: PIPELINE_VERSION },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { id: true, status: true, updatedAt: true },
      },
    },
  });

  const currentRuns = walkthroughs.flatMap((walkthrough) => walkthrough.processingRuns[0] ? [{ walkthroughId: walkthrough.id, runId: walkthrough.processingRuns[0].id }] : []);
  const reports = currentRuns.length === 0
    ? []
    : await database.report.findMany({
      where: { OR: currentRuns.map(({ walkthroughId, runId }) => ({ walkthroughId, observations: { some: { observation: { processingRunId: runId } } } })) },
      orderBy: { generatedAt: "desc" },
      select: { id: true, walkthroughId: true },
    });
  const latestReportByWalkthrough = new Map<string, { id: string }>();
  for (const report of reports) if (!latestReportByWalkthrough.has(report.walkthroughId)) latestReportByWalkthrough.set(report.walkthroughId, { id: report.id });

  return walkthroughs.map((walkthrough) => {
    const run = walkthrough.processingRuns[0] ?? null;
    return {
      id: walkthrough.id,
      title: walkthrough.title,
      createdAt: walkthrough.createdAt,
      updatedAt: walkthrough.updatedAt,
      run: run ? { status: run.status, updatedAt: run.updatedAt } : { status: "UPLOAD_PENDING", updatedAt: walkthrough.updatedAt },
      report: run?.status === "REPORT_READY" ? latestReportByWalkthrough.get(walkthrough.id) ?? null : null,
    };
  });
}

export async function retryWalkthrough(walkthroughId: string, database: typeof db = db) {
  const run = await database.processingRun.findFirst({ where: { walkthroughId, pipelineVersion: PIPELINE_VERSION }, include: { walkthrough: { include: { mediaAssets: true } } } });
  if (!run) throw new SiteThreadError("Walkthrough was not found.", "NOT_FOUND");
  const asset = run.walkthrough.mediaAssets.find((item) => item.kind === MediaAssetKind.SOURCE_VIDEO);
  if (!asset || asset.status !== MediaAssetStatus.AVAILABLE) throw new SiteThreadError("Upload the source media before retrying processing.", "MEDIA_UNAVAILABLE", true);
  const retried = await retryProcessingRun(run.id, database);
  return publicRun(await database.processingRun.findUniqueOrThrow({ where: { id: retried.id } }));
}

export function uploadLimitBytes(): number {
  return MAX_WALKTHROUGH_UPLOAD_BYTES;
}
