import { describe, expect, it } from "vitest";
import { SiteThreadError } from "@/lib/errors";
import type { ObservationReasoningOutput } from "@/lib/schemas/observation-reasoning";
import { buildReasoningContext, groundReasonedObservations } from "./grounding";

function context() {
  return buildReasoningContext({
    transcriptSegments: [{
      id: "segment-db-id",
      sourceAssetId: "source-video",
      sequence: 0,
      startSeconds: 6,
      endSeconds: 12,
      text: "At the north doorway, the supervisor reports water and asks for waterproofing review.",
    }],
    visualCandidates: [{
      id: "visual-db-id",
      mediaAssetId: "clip-db-id",
      sourceStartSeconds: 6,
      sourceEndSeconds: 12,
      eventStartSeconds: 7,
      eventEndSeconds: 9,
      text: "Water is visible beside the north doorway.",
    }, {
      id: "visual-fallback-id",
      mediaAssetId: "clip-fallback-id",
      sourceStartSeconds: 18,
      sourceEndSeconds: 24,
      eventStartSeconds: 2,
      eventEndSeconds: 30,
      text: "Installed conduit is visible.",
    }],
  });
}

function output(observations: ObservationReasoningOutput["observations"]): ObservationReasoningOutput {
  return { observations };
}

describe("observation evidence grounding", () => {
  it("gives the reasoner only labeled normalized text evidence", () => {
    const built = context();
    expect(built.evidence).toEqual([
      { ref: "T0", kind: "transcript", startSeconds: 6, endSeconds: 12, text: "At the north doorway, the supervisor reports water and asks for waterproofing review." },
      { ref: "V0", kind: "visual", startSeconds: 7, endSeconds: 9, text: "Water is visible beside the north doorway." },
      { ref: "V1", kind: "visual", startSeconds: 18, endSeconds: 24, text: "Installed conduit is visible." },
    ]);
    expect(JSON.stringify(built.evidence)).not.toContain("db-id");
  });

  it("keeps evidence labels contiguous when an empty source item is skipped", () => {
    const built = buildReasoningContext({
      transcriptSegments: [
        { id: "empty", sourceAssetId: null, sequence: 0, startSeconds: 0, endSeconds: 1, text: "  " },
        { id: "real", sourceAssetId: null, sequence: 1, startSeconds: 1, endSeconds: 2, text: "A real narration." },
      ],
      visualCandidates: [],
    });
    expect(built.evidence[0].ref).toBe("T0");
  });

  it.each([
    [["T0"], "NARRATION"],
    [["V0"], "VISUAL"],
    [["T0", "V0"], "NARRATION_AND_VISUAL"],
  ] as const)("derives source basis from cited references %j", (evidenceRefs, sourceBasis) => {
    const drafts = groundReasonedObservations(output([{
      type: "potential_issue",
      description: "Water is reported beside the north doorway and requires professional review.",
      evidenceRefs: [...evidenceRefs],
    }]), context());
    expect(drafts[0].sourceBasis).toBe(sourceBasis);
  });

  it("uses real transcript identity and a validated visual event range", () => {
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "Water is visible and reported beside the north doorway.",
      evidenceRefs: ["T0", "V0"],
    }]), context());
    expect(drafts[0].evidence).toEqual([
      { transcriptSegmentId: "segment-db-id", mediaAssetId: "source-video", sourceStartSeconds: 6, sourceEndSeconds: 12, label: "Narration 00:06–00:12" },
      { mediaAssetId: "clip-db-id", sourceStartSeconds: 7, sourceEndSeconds: 9, label: "Visual evidence 00:07–00:09" },
    ]);
  });

  it("falls back to the full SiteThread visual clip range when an event range is invalid", () => {
    const drafts = groundReasonedObservations(output([{
      type: "progress",
      description: "Installed conduit is visible.",
      evidenceRefs: ["V1"],
    }]), context());
    expect(drafts[0].evidence[0]).toMatchObject({ mediaAssetId: "clip-fallback-id", sourceStartSeconds: 18, sourceEndSeconds: 24 });
  });

  it("rejects the whole result when any evidence reference is unknown", () => {
    expect(() => groundReasonedObservations(output([{
      type: "note",
      description: "Unknown source.",
      evidenceRefs: ["T99"],
    }]), context())).toThrowError(SiteThreadError);
  });

  it("omits unsafe claims and removes optional fields not found in cited evidence", () => {
    const drafts = groundReasonedObservations(output([
      {
        type: "potential_issue",
        description: "The doorway is structurally unsafe and violates code.",
        evidenceRefs: ["V0"],
      },
      {
        type: "potential_issue",
        description: "Water is visible beside the north doorway and requires professional review.",
        location: "South tower",
        trade: "Waterproofing",
        evidenceRefs: ["T0", "V0"],
      },
    ]), context());
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).not.toHaveProperty("location");
    expect(drafts[0]).toMatchObject({ trade: "Waterproofing" });
  });
});
