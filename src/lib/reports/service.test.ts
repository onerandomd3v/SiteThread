import { describe, expect, it } from "vitest";
import { SiteThreadError } from "@/lib/errors";
import { ReportObservationSnapshotSchema } from "@/lib/schemas/media";
import { SiteReportSchema } from "@/lib/schemas/report";
import { buildReportSnapshot, frameOffsetSeconds, reportIdForSnapshot, type ReportSourceRecord } from "./service";

function sourceObservation(overrides: Partial<ReportSourceRecord> = {}): ReportSourceRecord {
  return {
    id: "observation-1",
    walkthroughId: "walkthrough-1",
    processingRunId: "run-1",
    sequence: 0,
    type: "POTENTIAL_ISSUE",
    sourceBasis: "NARRATION",
    originalDraftText: "Water is visible beside the doorway.",
    suggestedAction: "Ask the site supervisor to review the visible condition.",
    editedText: null,
    location: "North doorway",
    trade: "General",
    confidence: 0.8,
    reviewState: "CONFIRMED",
    reviewerId: "mvp-reviewer",
    reviewedAt: new Date("2026-09-20T10:00:00.000Z"),
    createdAt: new Date("2026-09-20T09:00:00.000Z"),
    updatedAt: new Date("2026-09-20T10:00:00.000Z"),
    evidence: [{
      id: "evidence-1",
      observationId: "observation-1",
      mediaAssetId: "source-1",
      transcriptSegmentId: "segment-1",
      sourceStartSeconds: 1,
      sourceEndSeconds: 3,
      label: "Narration 00:01–00:03",
      createdAt: new Date("2026-09-20T09:00:00.000Z"),
      mediaAsset: {
        id: "source-1",
        walkthroughId: "walkthrough-1",
        status: "AVAILABLE",
        kind: "SOURCE_VIDEO",
        objectKey: "walkthroughs/walkthrough-1/source/source-1.mp4",
        mimeType: "video/mp4",
        sourceStartSeconds: null,
        sourceEndSeconds: null,
        durationSeconds: 30,
        visualCandidates: [],
      },
      transcriptSegment: {
        id: "segment-1",
        walkthroughId: "walkthrough-1",
        processingRunId: "run-1",
        sourceAssetId: "source-1",
        text: "Water is visible beside the doorway.",
        startSeconds: 1,
        endSeconds: 3,
      },
    }],
    ...overrides,
  } as ReportSourceRecord;
}

describe("COD-20 report service", () => {
  it("uses edited wording and preserves evidence/reviewer snapshot metadata", () => {
    const observation = sourceObservation({ reviewState: "EDITED", editedText: "Edited reviewed wording." });
    const snapshot = buildReportSnapshot([observation], "run-1", "walkthrough-1");
    expect(snapshot.findings[0]).toMatchObject({ text: "Edited reviewed wording.", reviewState: "EDITED", reviewerId: "mvp-reviewer", evidence: [{ sourceEvidenceId: "evidence-1", transcriptText: "Water is visible beside the doorway." }] });
  });

  it("blocks drafts and all-dismissed or empty snapshots", () => {
    expect(() => buildReportSnapshot([sourceObservation({ reviewState: "DRAFT" })], "run-1", "walkthrough-1")).toThrow("Complete every finding review");
    expect(() => buildReportSnapshot([sourceObservation({ reviewState: "DISMISSED" })], "run-1", "walkthrough-1")).toThrow("No findings selected");
    expect(() => buildReportSnapshot([], "run-1", "walkthrough-1")).toThrow("No findings selected");
  });

  it("rejects missing edited wording and invalid evidence provenance", () => {
    expect(() => buildReportSnapshot([sourceObservation({ reviewState: "EDITED", editedText: null })], "run-1", "walkthrough-1")).toThrow("missing its saved wording");
    expect(() => buildReportSnapshot([sourceObservation({ evidence: [] })], "run-1", "walkthrough-1")).toThrow("valid source evidence");
    expect(() => buildReportSnapshot([sourceObservation({ evidence: [sourceObservation().evidence[0] as never], walkthroughId: "other-walkthrough" })], "run-1", "walkthrough-1")).toThrow("unrelated");
    const originalEvidence = sourceObservation().evidence[0];
    const visualEvidence = { ...originalEvidence, transcriptSegment: null, mediaAsset: { ...originalEvidence.mediaAsset!, kind: "SOURCE_VIDEO", visualCandidates: [{ processingRunId: "run-1", walkthroughId: "walkthrough-1" }] } } as ReportSourceRecord["evidence"][number];
    expect(() => buildReportSnapshot([sourceObservation({ evidence: [visualEvidence] })], "run-1", "walkthrough-1")).toThrow("visual report finding");
  });

  it("produces a stable identity for the same reviewed snapshot and changes when wording changes", () => {
    const first = buildReportSnapshot([sourceObservation()], "run-1", "walkthrough-1");
    const second = buildReportSnapshot([sourceObservation()], "run-1", "walkthrough-1");
    const changed = buildReportSnapshot([sourceObservation({ originalDraftText: "A different reviewed wording." })], "run-1", "walkthrough-1");
    expect(reportIdForSnapshot(first)).toBe(reportIdForSnapshot(second));
    expect(reportIdForSnapshot(first)).not.toBe(reportIdForSnapshot(changed));
  });

  it("maps a cited visual clip midpoint to a deterministic frame offset", () => {
    expect(frameOffsetSeconds(12, 16, 10, 20)).toBe(4);
    expect(() => frameOffsetSeconds(2, 4, 10, 20)).toThrow(SiteThreadError);
  });

  it("keeps report DTOs limited to confirmed and edited findings and round-trips dates", () => {
    expect(ReportObservationSnapshotSchema.safeParse({ id: "draft", text: "draft", type: "NOTE", reviewState: "DRAFT", evidence: [] }).success).toBe(false);
    expect(ReportObservationSnapshotSchema.safeParse({ id: "dismissed", text: "dismissed", type: "NOTE", reviewState: "DISMISSED", evidence: [] }).success).toBe(false);
    const result = SiteReportSchema.safeParse({
      reportId: "report-1", generatedAt: "2026-09-20T10:00:00.000Z", generatedBy: "mvp-reviewer",
      project: { id: "project-1", name: "Site" },
      walkthrough: { id: "walkthrough-1", title: "Walk", capturedAt: null, createdAt: "2026-09-20T09:00:00.000Z", durationSeconds: 30 },
      findings: [{ reportObservationId: "item-1", sourceObservationId: "observation-1", type: "NOTE", sourceBasis: "NARRATION", text: "Reviewed", suggestedAction: null, location: null, trade: null, reviewState: "CONFIRMED", reviewerId: "mvp-reviewer", reviewedAt: "2026-09-20T10:00:00.000Z", evidence: [{ reportEvidenceId: "report-evidence-1", sourceWalkthroughId: "walkthrough-1", sourceEvidenceId: "evidence-1", mediaAssetId: null, transcriptSegmentId: "segment-1", sourceStartSeconds: 1, sourceEndSeconds: 2, label: "Narration", transcriptText: "Reviewed", frameUrl: null, mediaAvailability: "NOT_APPLICABLE", applicationUrl: "/walkthroughs/walkthrough-1" }] }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.generatedAt).toBeInstanceOf(Date);
  });
});
