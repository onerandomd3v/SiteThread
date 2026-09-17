import { describe, expect, it } from "vitest";
import { fileValidationMessage, isSupportedWalkthroughFile, MAX_WALKTHROUGH_UPLOAD_BYTES } from "./upload-policy";

describe("walkthrough upload policy", () => {
  it("accepts an MP4 within the shared MVP limit", () => {
    expect(isSupportedWalkthroughFile({ name: "walk.mp4", type: "video/mp4", size: 1024 })).toBe(true);
  });

  it("rejects unsupported type, extension, empty, and oversized files", () => {
    expect(fileValidationMessage({ name: "walk.mov", type: "video/quicktime", size: 1024 })).toMatch(/MP4/);
    expect(fileValidationMessage({ name: "walk.mp4", type: "video/mp4", size: 0 })).toMatch(/empty/);
    expect(fileValidationMessage({ name: "walk.mp4", type: "video/mp4", size: MAX_WALKTHROUGH_UPLOAD_BYTES + 1 })).toMatch(/100 MiB/);
  });
});
