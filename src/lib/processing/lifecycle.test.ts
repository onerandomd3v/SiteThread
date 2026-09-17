import { describe, expect, it } from "vitest";
import { canTransitionProcessingStatus } from "./lifecycle";

describe("processing lifecycle", () => {
  it("allows the upload and durable queue transitions", () => {
    expect(canTransitionProcessingStatus("UPLOADING", "UPLOADED")).toBe(true);
    expect(canTransitionProcessingStatus("UPLOADED", "QUEUED")).toBe(true);
    expect(canTransitionProcessingStatus("QUEUED", "TRANSCRIBING")).toBe(true);
  });

  it("allows retry from a failed run and rejects skipping stages", () => {
    expect(canTransitionProcessingStatus("PROCESSING_FAILED", "QUEUED")).toBe(true);
    expect(canTransitionProcessingStatus("UPLOADING", "NEEDS_REVIEW")).toBe(false);
    expect(canTransitionProcessingStatus("REPORT_READY", "QUEUED")).toBe(false);
  });
});
