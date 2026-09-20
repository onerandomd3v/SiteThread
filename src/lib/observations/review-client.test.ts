import { describe, expect, it } from "vitest";
import { saveReviewDecision } from "./review-client";

const responsePayload = {
  observation: {
    observationId: "observation-1", sequence: 0, type: "NOTE", sourceBasis: "NARRATION", originalDraftText: "Water is visible.", editedText: null, finalDisplayText: "Water is visible.", suggestedAction: null, location: null, trade: null, confidence: null, reviewState: "CONFIRMED", reviewerId: "mvp-reviewer", reviewedAt: "2026-09-21T00:00:00.000Z", evidence: [{ evidenceId: "evidence-1", kind: "TRANSCRIPT", mediaAssetId: "asset-1", transcriptSegmentId: "segment-1", sourceStartSeconds: 1, sourceEndSeconds: 2, label: "Narration", transcriptText: "Water is visible.", mediaKind: "SOURCE_VIDEO", mediaMimeType: "video/mp4", mediaAvailability: "AVAILABLE", mediaUrl: "https://media.test/temporary" }],
  },
  review: { runStatus: "REVIEWED", observations: [], totalCount: 1, reviewedCount: 1, remainingDrafts: 0, complete: true },
};

describe("review mutation client", () => {
  it("keeps a successful save authoritative without attempting a refresh", async () => {
    let requests = 0;
    const fetcher: typeof fetch = async () => {
      requests += 1;
      if (requests > 1) throw new Error("status refresh failed");
      return new Response(JSON.stringify(responsePayload), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await saveReviewDecision(fetcher, "walk-1", "observation-1", { state: "CONFIRMED" });

    expect(requests).toBe(1);
    expect(result.review.observations).toHaveLength(0);
    expect(result.observation.reviewedAt).toBeInstanceOf(Date);
  });
});
