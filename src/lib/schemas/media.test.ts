import { describe, expect, it } from "vitest";
import { EvidenceReferenceSchema, ObservationDraftSchema, ReportObservationSnapshotSchema } from "./media";

describe("SiteThread media contracts", () => {
  it("requires a source reference for evidence", () => {
    const result = EvidenceReferenceSchema.safeParse({ evidenceId: "e1", walkthroughId: "w1" });
    expect(result.success).toBe(false);
  });

  it("accepts a grounded draft with valid evidence", () => {
    const result = ObservationDraftSchema.safeParse({
      type: "POTENTIAL_ISSUE",
      sourceBasis: "VISUAL",
      description: "A visible condition requires professional review.",
      evidence: [{ evidenceId: "e1", walkthroughId: "w1", mediaAssetId: "asset1", startSeconds: 2, endSeconds: 4 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an immutable report snapshot with reviewer metadata", () => {
    const result = ReportObservationSnapshotSchema.safeParse({
      id: "report-item-1",
      text: "The narrated condition requires professional review.",
      type: "POTENTIAL_ISSUE",
      reviewState: "EDITED",
      reviewerId: "reviewer-1",
      reviewedAt: "2026-09-18T00:00:00.000Z",
      evidence: [{
        sourceWalkthroughId: "walkthrough-1",
        sourceEvidenceId: "evidence-1",
        transcriptSegmentId: "segment-1",
        startSeconds: 12,
        endSeconds: 16,
        label: "Narration at 00:12",
      }],
    });
    expect(result.success).toBe(true);
  });
});
