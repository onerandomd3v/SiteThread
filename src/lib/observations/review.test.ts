import { describe, expect, it } from "vitest";
import type { db } from "@/lib/db/client";
import type { MediaStorage } from "@/lib/storage/types";
import { ReportEligibleFindingSchema } from "@/lib/schemas/media";
import { completeEmptyReview, reviewObservation, getWalkthroughReview, MVP_REVIEWER_ID } from "./review";

function fixture() {
  const reviewedAt = new Date("2026-01-01T00:00:00.000Z");
  const run = { id: "run-current", walkthroughId: "walk-1", pipelineVersion: "mvp-upload-v1", status: "NEEDS_REVIEW", createdAt: reviewedAt, completedAt: null as Date | null };
  const transcript = { id: "segment-1", walkthroughId: "walk-1", processingRunId: "run-current", sourceAssetId: "asset-1", text: "Water is visible beside the doorway.", startSeconds: 12, endSeconds: 18 };
  const visualCandidates: Array<{ processingRunId: string }> = [];
  const evidence = { id: "evidence-1", observationId: "observation-1", mediaAssetId: "asset-1", transcriptSegmentId: "segment-1", sourceStartSeconds: 12, sourceEndSeconds: 18, label: "Narration 0:12–0:18", mediaAsset: { id: "asset-1", walkthroughId: "walk-1", kind: "SOURCE_VIDEO", status: "AVAILABLE", objectKey: "walkthroughs/walk-1/source.mp4", mimeType: "video/mp4", sourceStartSeconds: null, sourceEndSeconds: null, visualCandidates }, transcriptSegment: transcript as typeof transcript | null, createdAt: reviewedAt };
  const observations = [{ id: "observation-1", walkthroughId: "walk-1", processingRunId: "run-current", sequence: 0, type: "POTENTIAL_ISSUE", sourceBasis: "NARRATION", originalDraftText: "Water is visible beside the doorway.", suggestedAction: "Ask the site supervisor to review the visible condition.", editedText: null as string | null, location: null, trade: null, confidence: 0.8, reviewState: "DRAFT", reviewerId: null as string | null, reviewedAt: null as Date | null, evidence: [evidence] }];
  const signedUrls: string[] = [];
  const storage = { createReadUrl: async ({ assetId }: { assetId: string }) => { signedUrls.push(assetId); return "https://media.test/temporary"; } } as unknown as MediaStorage;
  const database = {
    processingRun: {
      findFirst: async () => ({ ...run }),
      findUnique: async () => ({ ...run }),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        if (run.id !== where.id || run.status !== where.status) return { count: 0 };
        Object.assign(run, data);
        return { count: 1 };
      },
    },
    observation: {
      findUnique: async ({ where }: { where: { id: string } }) => observations.find((observation) => observation.id === where.id) ?? null,
      findMany: async () => observations.filter((observation) => observation.processingRunId === run.id),
      updateMany: async ({ where, data }: { where: { id: string; walkthroughId: string; processingRunId: string; reviewState: string }; data: Record<string, unknown> }) => {
        const observation = observations.find((item) => item.id === where.id && item.walkthroughId === where.walkthroughId && item.processingRunId === where.processingRunId && item.reviewState === where.reviewState);
        if (!observation) return { count: 0 };
        Object.assign(observation, data);
        return { count: 1 };
      },
      count: async ({ where }: { where: { processingRunId: string; reviewState: string } }) => observations.filter((observation) => observation.processingRunId === where.processingRunId && observation.reviewState === where.reviewState).length,
    },
    walkthrough: { findUnique: async () => ({ id: "walk-1" }) },
    $queryRaw: async () => [],
    $transaction: async (callback: unknown) => (callback as (transaction: typeof database) => Promise<unknown>)(database),
  } as unknown as typeof db;
  return { database, storage, observations, run, signedUrls, reviewedAt };
}

describe("COD-19 finding review", () => {
  it("confirms the current-run draft without changing original text or evidence", async () => {
    const state = fixture();
    const result = await reviewObservation("walk-1", "observation-1", { state: "CONFIRMED" }, { database: state.database, storage: state.storage, now: () => state.reviewedAt });

    expect(state.observations[0]).toMatchObject({ reviewState: "CONFIRMED", originalDraftText: "Water is visible beside the doorway.", editedText: null, reviewerId: MVP_REVIEWER_ID, reviewedAt: state.reviewedAt });
    expect(state.observations[0].evidence).toHaveLength(1);
    expect(result.observation.evidence[0]).toMatchObject({ mediaAvailability: "AVAILABLE", mediaUrl: "https://media.test/temporary" });
    expect(state.signedUrls).toContain("walkthroughs/walk-1/source.mp4");
    expect(result.review).toMatchObject({ reviewedCount: 1, remainingDrafts: 0, complete: true, runStatus: "REVIEWED" });
  });

  it("edits only on explicit save and keeps the original draft", async () => {
    const state = fixture();
    const result = await reviewObservation("walk-1", "observation-1", { state: "EDITED", editedText: "Water is visible beside the doorway and should be reviewed." }, { database: state.database, storage: state.storage, now: () => state.reviewedAt });

    expect(result.observation).toMatchObject({ reviewState: "EDITED", originalDraftText: "Water is visible beside the doorway.", editedText: "Water is visible beside the doorway and should be reviewed.", finalDisplayText: "Water is visible beside the doorway and should be reviewed.", reviewerId: MVP_REVIEWER_ID });
    expect(state.observations[0].evidence[0].id).toBe("evidence-1");
  });

  it("dismisses without deleting the observation or its evidence", async () => {
    const state = fixture();
    await reviewObservation("walk-1", "observation-1", { state: "DISMISSED" }, { database: state.database, storage: state.storage, now: () => state.reviewedAt });

    expect(state.observations[0]).toMatchObject({ reviewState: "DISMISSED", reviewerId: MVP_REVIEWER_ID, reviewedAt: state.reviewedAt });
    expect(state.observations[0].evidence[0].id).toBe("evidence-1");
  });

  it("returns the same result for an identical retry and rejects a conflicting decision", async () => {
    const state = fixture();
    const first = await reviewObservation("walk-1", "observation-1", { state: "CONFIRMED" }, { database: state.database, storage: state.storage, now: () => state.reviewedAt });
    const retry = await reviewObservation("walk-1", "observation-1", { state: "CONFIRMED" }, { database: state.database, storage: state.storage, now: () => new Date("2026-02-01T00:00:00.000Z") });

    expect(retry.observation.reviewedAt).toEqual(first.observation.reviewedAt);
    await expect(reviewObservation("walk-1", "observation-1", { state: "DISMISSED" }, { database: state.database, storage: state.storage })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects unknown, cross-walkthrough, and older-run observations", async () => {
    const state = fixture();
    await expect(reviewObservation("walk-1", "unknown", { state: "CONFIRMED" }, { database: state.database })).rejects.toMatchObject({ code: "NOT_FOUND" });
    state.observations[0].walkthroughId = "walk-other";
    await expect(reviewObservation("walk-1", "observation-1", { state: "CONFIRMED" }, { database: state.database })).rejects.toMatchObject({ code: "NOT_FOUND" });
    state.observations[0].walkthroughId = "walk-1";
    state.observations[0].processingRunId = "run-old";
    await expect(reviewObservation("walk-1", "observation-1", { state: "CONFIRMED" }, { database: state.database })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects evidence linked to another walkthrough or processing run", async () => {
    const state = fixture();
    state.observations[0].evidence[0].mediaAsset.walkthroughId = "walk-other";
    await expect(getWalkthroughReview("walk-1", { database: state.database, storage: state.storage })).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    state.observations[0].evidence[0].mediaAsset.walkthroughId = "walk-1";
    state.observations[0].evidence[0].transcriptSegment!.processingRunId = "run-old";
    await expect(getWalkthroughReview("walk-1", { database: state.database, storage: state.storage })).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    state.observations[0].evidence[0].transcriptSegment!.processingRunId = "run-current";
    state.observations[0].evidence[0].transcriptSegment = null;
    state.observations[0].evidence[0].mediaAsset.visualCandidates = [{ processingRunId: "run-old" }];
    await expect(getWalkthroughReview("walk-1", { database: state.database, storage: state.storage })).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("rejects transcript evidence paired with a same-walkthrough but unrelated media asset", async () => {
    const state = fixture();
    state.observations[0].evidence[0].mediaAsset = { ...state.observations[0].evidence[0].mediaAsset, id: "asset-unrelated", objectKey: "walkthroughs/walk-1/unrelated.mp4" };
    state.observations[0].evidence[0].mediaAssetId = "asset-unrelated";
    await expect(getWalkthroughReview("walk-1", { database: state.database, storage: state.storage })).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(state.signedUrls).toEqual([]);
  });

  it("allows current-run visual evidence and rejects old-run visual evidence", async () => {
    const state = fixture();
    state.observations[0].evidence[0].transcriptSegment = null;
    state.observations[0].evidence[0].mediaAsset.visualCandidates = [{ processingRunId: "run-current" }];
    const visualReview = await getWalkthroughReview("walk-1", { database: state.database, storage: state.storage });
    expect(visualReview.observations[0].evidence[0].mediaAvailability).toBe("AVAILABLE");
    state.observations[0].evidence[0].mediaAsset.visualCandidates = [{ processingRunId: "run-old" }];
    await expect(getWalkthroughReview("walk-1", { database: state.database, storage: state.storage })).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(state.signedUrls).toHaveLength(1);
  });

  it("does not return a review DTO for a nonexistent walkthrough", async () => {
    const state = fixture();
    const missingDatabase = { ...state.database, walkthrough: { findUnique: async () => null } } as unknown as typeof db;
    await expect(getWalkthroughReview("missing", { database: missingDatabase, storage: state.storage })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not expose a media URL when the cited asset is unavailable", async () => {
    const state = fixture();
    state.observations[0].evidence[0].transcriptSegment = null;
    state.observations[0].evidence[0].mediaAsset.visualCandidates = [{ processingRunId: "run-current" }];
    state.observations[0].evidence[0].mediaAsset.status = "FAILED";
    const review = await getWalkthroughReview("walk-1", { database: state.database, storage: state.storage });

    expect(review.observations[0].evidence[0]).toMatchObject({ mediaAvailability: "UNAVAILABLE", mediaUrl: null });
    expect(state.signedUrls).toEqual([]);
  });

  it("completes an empty current run without inventing a finding", async () => {
    const state = fixture();
    state.observations.splice(0);
    const review = await completeEmptyReview("walk-1", { database: state.database, storage: state.storage });

    expect(review).toMatchObject({ totalCount: 0, remainingDrafts: 0, complete: true, runStatus: "REVIEWED" });
    expect(state.run.status).toBe("REVIEWED");
  });

  it("keeps a remaining draft from completing the run", async () => {
    const state = fixture();
    state.observations.push({ ...state.observations[0], id: "observation-2", sequence: 1, evidence: [{ ...state.observations[0].evidence[0], id: "evidence-2", observationId: "observation-2" }], reviewState: "DRAFT", reviewerId: null, reviewedAt: null, editedText: null });
    const result = await reviewObservation("walk-1", "observation-1", { state: "CONFIRMED" }, { database: state.database, storage: state.storage, now: () => state.reviewedAt });

    expect(result.review).toMatchObject({ reviewedCount: 1, remainingDrafts: 1, complete: false, runStatus: "NEEDS_REVIEW" });
    expect(state.run.status).toBe("NEEDS_REVIEW");
  });

  it("leaves a draft untouched when validation rejects the decision", async () => {
    const state = fixture();
    await expect(reviewObservation("walk-1", "observation-1", { state: "EDITED", editedText: "   " }, { database: state.database })).rejects.toThrow();
    expect(state.observations[0]).toMatchObject({ reviewState: "DRAFT", reviewerId: null, reviewedAt: null, editedText: null });
  });

  it("preserves report eligibility semantics without implementing report generation", () => {
    const evidence = [{ evidenceId: "evidence-1", walkthroughId: "walk-1", transcriptSegmentId: "segment-1" }];
    expect(ReportEligibleFindingSchema.safeParse({ id: "observation-1", type: "NOTE", text: "A note", reviewState: "CONFIRMED", evidence }).success).toBe(true);
    expect(ReportEligibleFindingSchema.safeParse({ id: "observation-1", type: "NOTE", text: "A note", reviewState: "EDITED", evidence }).success).toBe(true);
    expect(ReportEligibleFindingSchema.safeParse({ id: "observation-1", type: "NOTE", text: "A note", reviewState: "DRAFT", evidence }).success).toBe(false);
    expect(ReportEligibleFindingSchema.safeParse({ id: "observation-1", type: "NOTE", text: "A note", reviewState: "DISMISSED", evidence }).success).toBe(false);
  });
});
