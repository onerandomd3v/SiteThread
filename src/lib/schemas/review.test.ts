import { describe, expect, it } from "vitest";
import { ReviewMutationResponseSchema, WalkthroughReviewSchema } from "./review";

const evidence = { evidenceId: "evidence-1", kind: "TRANSCRIPT" as const, mediaAssetId: "asset-1", transcriptSegmentId: "segment-1", sourceStartSeconds: 1, sourceEndSeconds: 2, label: "Narration", transcriptText: "Water is visible.", mediaKind: "SOURCE_VIDEO", mediaMimeType: "video/mp4", mediaAvailability: "AVAILABLE" as const, mediaUrl: "https://media.test/temporary" };
const observation = { observationId: "observation-1", sequence: 0, type: "NOTE" as const, sourceBasis: "NARRATION" as const, originalDraftText: "Water is visible.", editedText: null, finalDisplayText: "Water is visible.", suggestedAction: null, location: null, trade: null, confidence: null, reviewState: "CONFIRMED" as const, reviewerId: "mvp-reviewer", reviewedAt: "2026-09-21T00:00:00.000Z", evidence: [evidence] };
const review = { runStatus: "REVIEWED", observations: [observation], totalCount: 1, reviewedCount: 1, remainingDrafts: 0, complete: true };

describe("review response schemas", () => {
  it("coerces serialized review timestamps to Date values", () => {
    const parsed = WalkthroughReviewSchema.parse(review);
    expect(parsed.observations[0].reviewedAt).toBeInstanceOf(Date);
    expect(parsed.observations[0].reviewedAt?.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  it("rejects malformed successful review payloads", () => {
    expect(() => WalkthroughReviewSchema.parse({ ...review, observations: [{ ...observation, evidence: [] }] })).toThrow();
    expect(() => ReviewMutationResponseSchema.parse({ observation, review: { ...review, remainingDrafts: "0" } })).toThrow();
  });
});
