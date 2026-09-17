import { describe, expect, it } from "vitest";
import { fileValidationMessage, isSupportedWalkthroughFile, MAX_WALKTHROUGH_UPLOAD_BYTES, UploadIntentRequestSchema } from "./upload-policy";

describe("walkthrough upload policy", () => {
  it("accepts an MP4 within the shared MVP limit", () => {
    expect(isSupportedWalkthroughFile({ name: "walk.mp4", type: "video/mp4", size: 1024 })).toBe(true);
  });

  it("rejects unsupported type, extension, empty, and oversized files", () => {
    expect(fileValidationMessage({ name: "walk.mov", type: "video/quicktime", size: 1024 })).toMatch(/MP4/);
    expect(fileValidationMessage({ name: "walk.mp4", type: "video/mp4", size: 0 })).toMatch(/empty/);
    expect(fileValidationMessage({ name: "walk.mp4", type: "video/mp4", size: MAX_WALKTHROUGH_UPLOAD_BYTES + 1 })).toMatch(/100 MiB/);
  });

  it("enforces the MP4 extension at the API boundary", () => {
    expect(UploadIntentRequestSchema.safeParse({ fileName: "walk.mov", mimeType: "video/mp4", byteSize: 1024, idempotencyKey: "00000000-0000-4000-8000-000000000001" }).success).toBe(false);
    expect(UploadIntentRequestSchema.safeParse({ fileName: "WALK.MP4", mimeType: "video/mp4", byteSize: 1024, idempotencyKey: "00000000-0000-4000-8000-000000000001" }).success).toBe(true);
  });
});
