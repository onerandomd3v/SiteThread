import { describe, expect, it } from "vitest";
import { validateReportArtifactBinding, validateReportObservationEvidence, validateRunProviderInvocations } from "./provenance.mjs";

const walkthrough = { id: "walk-1", durationSeconds: 60 };
const sourceObservation = { evidence: [{ id: "evidence-1", mediaAssetId: "source-1", transcriptSegmentId: "segment-1" }] };
const baseObservation = { reviewState: "CONFIRMED", evidence: [{ sourceWalkthroughId: "walk-1", sourceEvidenceId: "evidence-1", mediaAssetId: "source-1", transcriptSegmentId: "segment-1", sourceStartSeconds: 10, sourceEndSeconds: 20 }] };
const currentRunInvocations = [
  { processingRunId: "run-1", provider: "livepeer", capability: "creative/transcribe", status: "SUCCEEDED", sourceStartSeconds: 0, sourceEndSeconds: 6 },
  { processingRunId: "run-1", provider: "google-gemini", capability: "gemini-video-understanding", status: "SUCCEEDED", sourceStartSeconds: 0, sourceEndSeconds: 6 },
  { processingRunId: "run-1", provider: "google-gemini", capability: "observation-reasoning", status: "SUCCEEDED", sourceStartSeconds: 0, sourceEndSeconds: 6 },
];

describe("live rehearsal provenance assertions", () => {
  it("binds the persisted report to the browser artifact", () => {
    expect(() => validateReportArtifactBinding("report-1", "report-1")).not.toThrow();
    expect(() => validateReportArtifactBinding("report-1", "report-2")).toThrow(/report ID/);
  });

  it("accepts current-run transcript evidence and rejects stale transcript evidence", () => {
    const segments = [{ id: "segment-1", walkthroughId: "walk-1", processingRunId: "run-1", startSeconds: 10, endSeconds: 20 }];
    expect(() => validateReportObservationEvidence({ observation: baseObservation, sourceObservation, segments, mediaById: new Map(), walkthrough, processingRunId: "run-1" })).not.toThrow();
    for (const evidence of [
      { ...baseObservation.evidence[0], sourceStartSeconds: 9, sourceEndSeconds: 11 },
      { ...baseObservation.evidence[0], sourceStartSeconds: 19, sourceEndSeconds: 21 },
      { ...baseObservation.evidence[0], sourceStartSeconds: 12, sourceEndSeconds: 12 },
      { ...baseObservation.evidence[0], sourceStartSeconds: Number.NaN },
    ]) {
      expect(() => validateReportObservationEvidence({ observation: { ...baseObservation, evidence: [evidence] }, sourceObservation, segments, mediaById: new Map(), walkthrough, processingRunId: "run-1" })).toThrow(/outside its source segment/);
    }
    expect(() => validateReportObservationEvidence({ observation: baseObservation, sourceObservation, segments: [{ ...segments[0], processingRunId: "run-old" }], mediaById: new Map(), walkthrough, processingRunId: "run-1" })).toThrow(/another run/);
  });

  it("requires pure visual evidence to use an available current-run Gemini candidate and invocation", () => {
    const visualObservation = { reviewState: "EDITED", evidence: [{ ...baseObservation.evidence[0], mediaAssetId: "clip-1", transcriptSegmentId: null, sourceStartSeconds: 12, sourceEndSeconds: 18 }] };
    const visualSource = { evidence: [{ id: "evidence-1", mediaAssetId: "clip-1", transcriptSegmentId: null }] };
    const candidate = { processingRunId: "run-1", walkthroughId: "walk-1", sourceStartSeconds: 10, sourceEndSeconds: 20, provider: "google-gemini", capability: "gemini-video-understanding", providerInvocation: { processingRunId: "run-1", provider: "google-gemini", capability: "gemini-video-understanding", status: "SUCCEEDED" } };
    const asset = { walkthroughId: "walk-1", kind: "EVIDENCE_CLIP", status: "AVAILABLE", visualCandidates: [candidate] };
    expect(() => validateReportObservationEvidence({ observation: visualObservation, sourceObservation: visualSource, segments: [], mediaById: new Map([["clip-1", asset]]), walkthrough, processingRunId: "run-1" })).not.toThrow();
    expect(() => validateReportObservationEvidence({ observation: visualObservation, sourceObservation: visualSource, segments: [], mediaById: new Map([["clip-1", { ...asset, visualCandidates: [{ ...candidate, provider: "livepeer", capability: "marlin-video", providerInvocation: { ...candidate.providerInvocation, provider: "livepeer", capability: "marlin-video" } }] }]]), walkthrough, processingRunId: "run-1" })).toThrow(/Gemini visual provenance/);
    expect(() => validateReportObservationEvidence({ observation: visualObservation, sourceObservation: visualSource, segments: [], mediaById: new Map([["clip-1", { ...asset, visualCandidates: [{ ...candidate, providerInvocation: { ...candidate.providerInvocation, processingRunId: "run-old" } }] }]]), walkthrough, processingRunId: "run-1" })).toThrow(/Gemini visual provenance/);
    expect(() => validateReportObservationEvidence({ observation: { ...visualObservation, evidence: [{ ...visualObservation.evidence[0], sourceStartSeconds: null, sourceEndSeconds: null }] }, sourceObservation: visualSource, segments: [], mediaById: new Map([["clip-1", asset]]), walkthrough, processingRunId: "run-1" })).toThrow(/valid source range/);
    expect(() => validateReportObservationEvidence({ observation: { ...visualObservation, evidence: [{ ...visualObservation.evidence[0], sourceStartSeconds: 12, sourceEndSeconds: 12 }] }, sourceObservation: visualSource, segments: [], mediaById: new Map([["clip-1", asset]]), walkthrough, processingRunId: "run-1" })).toThrow(/valid source range/);
  });

  it("requires current-run provider-specific provenance without a blanket Livepeer assertion", () => {
    const segments = [{ processingRunId: "run-1", startSeconds: 0, endSeconds: 6 }];
    expect(validateRunProviderInvocations({ invocations: currentRunInvocations, transcriptSegments: segments, processingRunId: "run-1" })).toEqual([
      { capability: "creative/transcribe", provider: "livepeer" },
      { capability: "gemini-video-understanding", provider: "google-gemini" },
      { capability: "observation-reasoning", provider: "google-gemini" },
    ]);
    expect(() => validateRunProviderInvocations({ invocations: currentRunInvocations.map((item, index) => index === 1 ? { ...item, processingRunId: "run-old" } : item), transcriptSegments: segments, processingRunId: "run-1" })).toThrow(/another processing run/);
    expect(() => validateRunProviderInvocations({ invocations: currentRunInvocations.map((item, index) => index === 1 ? { ...item, capability: "marlin-video", provider: "livepeer" } : item), transcriptSegments: segments, processingRunId: "run-1" })).toThrow(/superseded capability marlin-video/);
    expect(() => validateRunProviderInvocations({ invocations: currentRunInvocations.map((item, index) => index === 2 ? { ...item, capability: "gemini-text", provider: "livepeer" } : item), transcriptSegments: segments, processingRunId: "run-1" })).toThrow(/superseded capability gemini-text/);
    expect(() => validateRunProviderInvocations({ invocations: currentRunInvocations.map((item, index) => index === 0 ? { ...item, provider: "google-gemini" } : item), transcriptSegments: segments, processingRunId: "run-1" })).toThrow(/must use livepeer/);
    expect(() => validateRunProviderInvocations({ invocations: currentRunInvocations, transcriptSegments: [{ ...segments[0], endSeconds: 12 }], processingRunId: "run-1" })).toThrow(/source-window/);
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
