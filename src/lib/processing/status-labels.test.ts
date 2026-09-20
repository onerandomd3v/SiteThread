import { describe, expect, it } from "vitest";
import { isActiveProcessingStatus, processingStatusLabel } from "./status-labels";

describe("processing status labels", () => {
  it("uses field-friendly labels instead of lifecycle enum names", () => {
    expect(processingStatusLabel("ANALYZING_MEDIA")).toBe("Reviewing visual evidence");
    expect(processingStatusLabel("NEEDS_REVIEW")).toBe("Ready for your review");
  });

  it("only treats in-flight processing stages as pollable", () => {
    expect(isActiveProcessingStatus("TRANSCRIBING")).toBe(true);
    expect(isActiveProcessingStatus("NEEDS_REVIEW")).toBe(false);
    expect(isActiveProcessingStatus("PROCESSING_FAILED")).toBe(false);
  });
});
