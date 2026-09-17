import { describe, expect, it } from "vitest";
import { EvidenceReferenceSchema, ObservationDraftSchema } from "./media";

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
});
