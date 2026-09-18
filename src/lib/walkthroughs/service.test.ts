import { describe, expect, it } from "vitest";
import { SiteThreadError } from "@/lib/errors";
import type { MediaStorage } from "@/lib/storage/types";
import { createUploadIntent, finalizeUpload, retryWalkthrough } from "./service";
import type { db } from "@/lib/db/client";
import { PIPELINE_VERSION } from "@/lib/processing/lifecycle";

const input = { fileName: "walk.mp4", mimeType: "video/mp4" as const, byteSize: 1024, idempotencyKey: "00000000-0000-4000-8000-000000000001" };

function storageFake(overrides: Partial<MediaStorage> = {}): MediaStorage {
  return {
    createUploadIntent: async ({ objectKey }) => ({ objectKey, uploadUrl: `https://upload.test/${objectKey}`, expiresAt: new Date(), requiredHeaders: { "content-type": "video/mp4" } }),
    verifyUpload: async () => ({ byteSize: 1024, mimeType: "video/mp4", etag: "\"etag-1\"" }),
    promoteUpload: async () => undefined,
    deleteObject: async () => undefined,
    createReadUrl: async () => "https://read.test",
    getObject: async ({ assetId }) => ({ assetId, objectKey: assetId, mimeType: "video/mp4", byteSize: 1024 }),
    ...overrides,
  };
}

describe("walkthrough upload service", () => {
  it("reuses one upload intent and staging key for a logical retry", async () => {
    let walkthrough: { id: string; projectId: string; uploadIntentKey: string; title: string } | null = null;
    let asset: { id: string; walkthroughId: string; kind: string; status: string; objectKey: string; stagingObjectKey: string; mimeType: string; byteSize: number } | null = null;
    const database = {
      project: { findUnique: async () => ({ id: "project-1" }) },
      walkthrough: {
        findUnique: async () => walkthrough ? { ...walkthrough, mediaAssets: asset ? [asset] : [], processingRuns: [] } : null,
        create: async ({ data }: { data: typeof walkthrough }) => { walkthrough = data as NonNullable<typeof walkthrough>; return walkthrough; },
      },
      mediaAsset: {
        create: async ({ data }: { data: typeof asset }) => { asset = data as NonNullable<typeof asset>; return asset; },
      },
      $transaction: async (operations: unknown) => Promise.all(operations as Promise<unknown>[]),
    } as unknown as typeof db;
    const storage = storageFake();

    const first = await createUploadIntent("project-1", input, storage, database);
    const second = await createUploadIntent("project-1", input, storage, database);

    expect(second.walkthroughId).toBe(first.walkthroughId);
    expect(second.assetId).toBe(first.assetId);
    expect(second.objectKey).toBe(first.objectKey);
    expect(second.uploadUrl).toContain("/staging/");

    asset!.status = "AVAILABLE";
    const finalized = await createUploadIntent("project-1", input, storage, database);
    expect(finalized.uploadUrl).toBeNull();
  });

  it("promotes before availability, deletes staging, and keeps finalization idempotent", async () => {
    const asset = { id: "asset-1", walkthroughId: "walk-1", kind: "SOURCE_VIDEO", status: "PENDING", objectKey: "walkthroughs/walk-1/source/asset-1.mp4", stagingObjectKey: "walkthroughs/walk-1/staging/asset-1.mp4", mimeType: "video/mp4", byteSize: 1024 };
    type FakeRun = { id: string; walkthroughId: string; pipelineVersion: string; idempotencyKey: string; status: string; retryCount: number; failedStep: null; errorCode: null; errorMessage: null; updatedAt: Date };
    let run: FakeRun | null = null;
    let promoteCount = 0;
    let deleteCount = 0;
    const database = {
      walkthrough: { findUnique: async () => ({ id: "walk-1", mediaAssets: [asset], processingRuns: run ? [run] : [] }) },
      mediaAsset: { update: async ({ data }: { data: Partial<typeof asset> }) => Object.assign(asset, data) },
      processingRun: {
        upsert: async ({ create }: { create: FakeRun }) => { if (!run) { const created = create; run = { id: created.id, walkthroughId: created.walkthroughId, pipelineVersion: created.pipelineVersion, idempotencyKey: created.idempotencyKey, status: created.status, retryCount: 0, failedStep: null, errorCode: null, errorMessage: null, updatedAt: new Date() }; } return run; },
        findUnique: async () => run,
        findUniqueOrThrow: async () => run,
        update: async ({ data }: { data: Partial<NonNullable<typeof run>> }) => { run = { ...run as NonNullable<typeof run>, ...data, updatedAt: new Date() }; return run; },
      },
      $transaction: async (callback: unknown) => (callback as (tx: typeof database) => Promise<unknown>)(database),
    } as unknown as typeof db;
    const storage = storageFake({
      promoteUpload: async () => { promoteCount += 1; },
      deleteObject: async () => { deleteCount += 1; },
    });

    const first = await finalizeUpload("walk-1", storage, database);
    const second = await finalizeUpload("walk-1", storage, database);

    expect(first.status).toBe("QUEUED");
    expect(second.id).toBe(first.id);
    expect(promoteCount).toBe(1);
    expect(deleteCount).toBe(1);
    expect(asset.status).toBe("AVAILABLE");
    expect(asset.objectKey).toContain("/source/");
    expect(asset.stagingObjectKey).toBeNull();
  });

  it("does not promote or queue when signature verification fails", async () => {
    const asset = { id: "asset-1", walkthroughId: "walk-1", kind: "SOURCE_VIDEO", status: "PENDING", objectKey: "final.mp4", stagingObjectKey: "staging.mp4", mimeType: "video/mp4", byteSize: 1024 };
    let promoted = false;
    const database = {
      walkthrough: { findUnique: async () => ({ id: "walk-1", mediaAssets: [asset], processingRuns: [] }) },
    } as unknown as typeof db;
    const storage = storageFake({
      verifyUpload: async () => { throw new SiteThreadError("invalid MP4", "MEDIA_UNAVAILABLE"); },
      promoteUpload: async () => { promoted = true; },
    });

    await expect(finalizeUpload("walk-1", storage, database)).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
    expect(promoted).toBe(false);
    expect(asset.status).toBe("PENDING");
  });

  it("does not promote when verification has no source ETag", async () => {
    const asset = { id: "asset-1", walkthroughId: "walk-1", kind: "SOURCE_VIDEO", status: "PENDING", objectKey: "final.mp4", stagingObjectKey: "staging.mp4", mimeType: "video/mp4", byteSize: 1024 };
    let promoted = false;
    const database = {
      walkthrough: { findUnique: async () => ({ id: "walk-1", mediaAssets: [asset], processingRuns: [] }) },
    } as unknown as typeof db;
    const storage = storageFake({
      verifyUpload: async () => ({ byteSize: 1024, mimeType: "video/mp4", etag: "" }),
      promoteUpload: async () => { promoted = true; },
    });

    await expect(finalizeUpload("walk-1", storage, database)).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
    expect(promoted).toBe(false);
    expect(asset.status).toBe("PENDING");
  });

  it("reuses a COD-16 queued run with the unchanged pipeline version", async () => {
    expect(PIPELINE_VERSION).toBe("mvp-upload-v1");
    const run = { id: "cod16-run", walkthroughId: "walk-1", pipelineVersion: PIPELINE_VERSION, status: "QUEUED", retryCount: 0, failedStep: null, errorCode: null, errorMessage: null, updatedAt: new Date() };
    const database = {
      walkthrough: { findUnique: async () => ({ id: "walk-1", mediaAssets: [{ kind: "SOURCE_VIDEO", status: "AVAILABLE" }], processingRuns: [run] }) },
    } as unknown as typeof db;
    const result = await finalizeUpload("walk-1", storageFake(), database);
    expect(result).toMatchObject({ id: "cod16-run", status: "QUEUED" });
  });

  it("allows an explicit whole-run retry after a nonretryable failure is corrected", async () => {
    const run = { id: "run", walkthroughId: "walk", status: "PROCESSING_FAILED", retryable: false as boolean | null, retryCount: 0, failedStep: "ANALYZING_MEDIA", errorCode: "PROVIDER_AUTH", errorMessage: "Provider authorization is unavailable.", updatedAt: new Date() };
    const database = {
      processingRun: {
        findFirst: async () => ({ ...run, walkthrough: { mediaAssets: [{ kind: "SOURCE_VIDEO", status: "AVAILABLE" }] } }),
        findUnique: async () => ({ ...run }),
        findUniqueOrThrow: async () => ({ ...run }),
        updateMany: async ({ where }: { where: { status: string } }) => {
          if (run.status !== where.status) return { count: 0 };
          run.status = "QUEUED";
          run.retryCount += 1;
          run.retryable = null;
          return { count: 1 };
        },
      },
    } as unknown as typeof db;
    const first = await retryWalkthrough("walk", database);
    const second = await retryWalkthrough("walk", database);
    expect(first).toMatchObject({ id: "run", status: "QUEUED", retryCount: 1 });
    expect(second.id).toBe(first.id);
    expect(run.retryCount).toBe(1);
  });
});
