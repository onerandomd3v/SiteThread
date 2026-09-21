import { describe, expect, it } from "vitest";
import { validateReportArtifactBinding, validateReportObservationEvidence } from "./provenance.mjs";

const walkthrough = { id: "walk-1", durationSeconds: 60 };
const sourceObservation = { evidence: [{ id: "evidence-1", mediaAssetId: "source-1", transcriptSegmentId: "segment-1" }] };
const baseObservation = { reviewState: "CONFIRMED", evidence: [{ sourceWalkthroughId: "walk-1", sourceEvidenceId: "evidence-1", mediaAssetId: "source-1", transcriptSegmentId: "segment-1", sourceStartSeconds: 10, sourceEndSeconds: 20 }] };

describe("live rehearsal provenance assertions", () => {
  it("binds the persisted report to the browser artifact", () => {
    expect(() => validateReportArtifactBinding("report-1", "report-1")).not.toThrow();
    expect(() => validateReportArtifactBinding("report-1", "report-2")).toThrow(/report ID/);
  });

  it("accepts current-run transcript evidence and rejects stale transcript evidence", () => {
    const segments = [{ id: "segment-1", walkthroughId: "walk-1", processingRunId: "run-1" }];
    expect(() => validateReportObservationEvidence({ observation: baseObservation, sourceObservation, segments, mediaById: new Map(), walkthrough, processingRunId: "run-1" })).not.toThrow();
    expect(() => validateReportObservationEvidence({ observation: baseObservation, sourceObservation, segments: [{ ...segments[0], processingRunId: "run-old" }], mediaById: new Map(), walkthrough, processingRunId: "run-1" })).toThrow(/another run/);
  });

  it("requires pure visual evidence to use a current-run successful Marlin candidate", () => {
    const visualObservation = { reviewState: "EDITED", evidence: [{ ...baseObservation.evidence[0], mediaAssetId: "clip-1", transcriptSegmentId: null, sourceStartSeconds: 10, sourceEndSeconds: 20 }] };
    const visualSource = { evidence: [{ id: "evidence-1", mediaAssetId: "clip-1", transcriptSegmentId: null }] };
    const asset = { walkthroughId: "walk-1", kind: "EVIDENCE_CLIP", status: "AVAILABLE", visualCandidates: [{ processingRunId: "run-1", walkthroughId: "walk-1", providerInvocation: { processingRunId: "run-1", provider: "livepeer", capability: "marlin-video", status: "SUCCEEDED" } }] };
    expect(() => validateReportObservationEvidence({ observation: visualObservation, sourceObservation: visualSource, segments: [], mediaById: new Map([["clip-1", asset]]), walkthrough, processingRunId: "run-1" })).not.toThrow();
    expect(() => validateReportObservationEvidence({ observation: visualObservation, sourceObservation: visualSource, segments: [], mediaById: new Map([["clip-1", { ...asset, visualCandidates: [] }]]), walkthrough, processingRunId: "run-1" })).toThrow(/Marlin provenance/);
  });

  it("rejects incomplete, reversed, and out-of-duration ranges", () => {
    for (const evidence of [
      { ...baseObservation.evidence[0], sourceEndSeconds: null },
      { ...baseObservation.evidence[0], sourceStartSeconds: 20, sourceEndSeconds: 10 },
      { ...baseObservation.evidence[0], sourceEndSeconds: 61 },
    ]) {
      expect(() => validateReportObservationEvidence({ observation: { ...baseObservation, evidence: [evidence] }, sourceObservation, segments: [{ id: "segment-1", walkthroughId: "walk-1", processingRunId: "run-1" }], mediaById: new Map(), walkthrough, processingRunId: "run-1" })).toThrow();
    }
  });
});
