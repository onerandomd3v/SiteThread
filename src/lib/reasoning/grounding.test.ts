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
      { ref: "T0", kind: "transcript", text: "At the north doorway, the supervisor reports water and asks for waterproofing review." },
      { ref: "V0", kind: "visual", text: "Water is visible beside the north doorway." },
      { ref: "V1", kind: "visual", text: "Installed conduit is visible." },
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
    [["T0"], "NARRATION", "Water is reported at the north doorway and requires professional review."],
    [["V0"], "VISUAL", "Water is visible beside the north doorway."],
    [["T0", "V0"], "NARRATION_AND_VISUAL", "Water is visible beside the north doorway and reported at the north doorway."],
  ] as const)("derives source basis from cited references %j", (evidenceRefs, sourceBasis, description) => {
    const drafts = groundReasonedObservations(output([{
      type: "potential_issue",
      description,
      evidenceRefs: [...evidenceRefs],
    }]), context());
    expect(drafts[0].sourceBasis).toBe(sourceBasis);
  });

  it("uses real transcript identity and a validated visual event range", () => {
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "Water is visible beside the north doorway and reported at the north doorway.",
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
        description: "Water is visible beside the north doorway and reported at the north doorway and requires professional review.",
        location: "South tower",
        trade: "Waterproofing",
        evidenceRefs: ["T0", "V0"],
      },
    ]), context());
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).not.toHaveProperty("location");
    expect(drafts[0]).toMatchObject({ trade: "Waterproofing" });
  });

  it("rejects a claim that the cited water evidence supports a structural crack", () => {
    const drafts = groundReasonedObservations(output([{
      type: "potential_issue",
      description: "A structural crack is visible in the beam.",
      evidenceRefs: ["V0"],
    }]), context());
    expect(drafts).toEqual([]);
  });

  it("rejects a generic safety conclusion even when it cites real evidence", () => {
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "The area is safe to enter.",
      evidenceRefs: ["V0"],
    }]), context());
    expect(drafts).toEqual([]);
  });

  it("rejects a positive claim when cited evidence negates the condition", () => {
    const negatedContext = buildReasoningContext({
      transcriptSegments: [],
      visualCandidates: [{
        id: "visual-negative",
        mediaAssetId: "clip-negative",
        sourceStartSeconds: 0,
        sourceEndSeconds: 1,
        eventStartSeconds: 0,
        eventEndSeconds: 1,
        text: "No water is visible beside the doorway.",
      }],
    });
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "Water is visible beside the doorway.",
      evidenceRefs: ["V0"],
    }]), negatedContext);
    expect(drafts).toEqual([]);
  });

  it("retains an identical grounded negative visual observation", () => {
    const negativeContext = buildReasoningContext({
      transcriptSegments: [],
      visualCandidates: [{
        id: "visual-negative-guardrail",
        mediaAssetId: "clip-negative-guardrail",
        sourceStartSeconds: 0,
        sourceEndSeconds: 1,
        eventStartSeconds: 0,
        eventEndSeconds: 1,
        text: "No guardrail is visible beside the doorway.",
      }],
    });
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "No guardrail is visible beside the doorway.",
      evidenceRefs: ["V0"],
    }]), negativeContext);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].sourceBasis).toBe("VISUAL");
  });

  it("rejects a negative claim against positive evidence", () => {
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "No water is visible beside the north doorway.",
      evidenceRefs: ["V0"],
    }]), context());
    expect(drafts).toEqual([]);
  });

  it("does not move a negative condition between nouns or locations", () => {
    const negativeContext = buildReasoningContext({
      transcriptSegments: [],
      visualCandidates: [{
        id: "visual-negative-reversal",
        mediaAssetId: "clip-negative-reversal",
        sourceStartSeconds: 0,
        sourceEndSeconds: 1,
        eventStartSeconds: 0,
        eventEndSeconds: 1,
        text: "No water is visible beside the doorway.",
      }],
    });
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "No doorway is visible beside water.",
      evidenceRefs: ["V0"],
    }]), negativeContext);
    expect(drafts).toEqual([]);
  });

  it("does not reverse visual subject and location roles", () => {
    const visualContext = buildReasoningContext({
      transcriptSegments: [],
      visualCandidates: [{
        id: "visual-role-reversal",
        mediaAssetId: "clip-role-reversal",
        sourceStartSeconds: 0,
        sourceEndSeconds: 1,
        eventStartSeconds: 0,
        eventEndSeconds: 1,
        text: "A ladder is visible above the doorway.",
      }],
    });
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "The doorway is visible above the ladder.",
      evidenceRefs: ["V0"],
    }]), visualContext);
    expect(drafts).toEqual([]);
  });

  it("does not reverse subject and location roles for non-visible spatial predicates", () => {
    const pooledContext = buildReasoningContext({
      transcriptSegments: [],
      visualCandidates: [{
        id: "visual-pooled-role-reversal",
        mediaAssetId: "clip-pooled-role-reversal",
        sourceStartSeconds: 0,
        sourceEndSeconds: 1,
        eventStartSeconds: 0,
        eventEndSeconds: 1,
        text: "Water is pooled beside the doorway.",
      }],
    });
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "The doorway is pooled beside water.",
      evidenceRefs: ["V0"],
    }]), pooledContext);
    expect(drafts).toEqual([]);
  });

  it("preserves reporting subject and object roles", () => {
    const reportingContext = buildReasoningContext({
      transcriptSegments: [{
        id: "transcript-reporting-roles",
        sourceAssetId: null,
        sequence: 0,
        startSeconds: 0,
        endSeconds: 2,
        text: "The supervisor reports water.",
      }],
      visualCandidates: [],
    });
    expect(groundReasonedObservations(output([{
      type: "note",
      description: "The supervisor reports water.",
      evidenceRefs: ["T0"],
    }]), reportingContext)).toHaveLength(1);
    expect(groundReasonedObservations(output([{
      type: "note",
      description: "Water reports the supervisor.",
      evidenceRefs: ["T0"],
    }]), reportingContext)).toEqual([]);
  });

  it("matches reporting tense and safe active-to-passive narration", () => {
    const reportingContext = buildReasoningContext({
      transcriptSegments: [{
        id: "transcript-reported-water",
        sourceAssetId: null,
        sequence: 0,
        startSeconds: 0,
        endSeconds: 2,
        text: "The supervisor reported water at the doorway.",
      }],
      visualCandidates: [],
    });
    expect(groundReasonedObservations(output([{
      type: "note",
      description: "The supervisor reports water at the doorway.",
      evidenceRefs: ["T0"],
    }]), reportingContext)).toHaveLength(1);
    expect(groundReasonedObservations(output([{
      type: "note",
      description: "Water was reported at the doorway.",
      evidenceRefs: ["T0"],
    }]), reportingContext)).toHaveLength(1);

    const perfectContext = buildReasoningContext({
      transcriptSegments: [{
        id: "transcript-perfect-reported-water",
        sourceAssetId: null,
        sequence: 0,
        startSeconds: 0,
        endSeconds: 2,
        text: "The supervisor has reported water at the doorway.",
      }],
      visualCandidates: [],
    });
    expect(groundReasonedObservations(output([{
      type: "note",
      description: "Water has been reported at the doorway.",
      evidenceRefs: ["T0"],
    }]), perfectContext)).toHaveLength(1);
  });

  it("keeps all reporting forms transcript-bound", () => {
    const visualContext = buildReasoningContext({
      transcriptSegments: [],
      visualCandidates: [{
        id: "visual-reporting-form",
        mediaAssetId: "clip-reporting-form",
        sourceStartSeconds: 0,
        sourceEndSeconds: 1,
        eventStartSeconds: 0,
        eventEndSeconds: 1,
        text: "The supervisor says water.",
      }],
    });
    expect(groundReasonedObservations(output([{
      type: "note",
      description: "The supervisor says water.",
      evidenceRefs: ["V0"],
    }]), visualContext)).toEqual([]);

    const visualReportingContext = buildReasoningContext({
      transcriptSegments: [],
      visualCandidates: [{
        id: "visual-reporting-visible-form",
        mediaAssetId: "clip-reporting-visible-form",
        sourceStartSeconds: 0,
        sourceEndSeconds: 1,
        eventStartSeconds: 0,
        eventEndSeconds: 1,
        text: "The supervisor reports visible water.",
      }],
    });
    expect(groundReasonedObservations(output([{
      type: "note",
      description: "The supervisor reports visible water.",
      evidenceRefs: ["V0"],
    }]), visualReportingContext)).toEqual([]);
  });

  it("does not turn reported transcript content into an unqualified fact", () => {
    const reportingContext = buildReasoningContext({
      transcriptSegments: [{
        id: "transcript-unqualified-report",
        sourceAssetId: null,
        sequence: 0,
        startSeconds: 0,
        endSeconds: 2,
        text: "The supervisor reports water at the doorway.",
      }],
      visualCandidates: [],
    });
    expect(groundReasonedObservations(output([{
      type: "note",
      description: "Water is at the doorway.",
      evidenceRefs: ["T0"],
    }]), reportingContext)).toEqual([]);
  });

  it("preserves narrow possession roles", () => {
    const possessionContext = buildReasoningContext({
      transcriptSegments: [{
        id: "transcript-possession-roles",
        sourceAssetId: null,
        sequence: 0,
        startSeconds: 0,
        endSeconds: 2,
        text: "The room contains water.",
      }],
      visualCandidates: [],
    });
    expect(groundReasonedObservations(output([{
      type: "note",
      description: "The room contains water.",
      evidenceRefs: ["T0"],
    }]), possessionContext)).toHaveLength(1);
    expect(groundReasonedObservations(output([{
      type: "note",
      description: "Water contains the room.",
      evidenceRefs: ["T0"],
    }]), possessionContext)).toEqual([]);
  });

  it("retains a narration-backed negative claim without allowing a safety conclusion", () => {
    const negativeContext = buildReasoningContext({
      transcriptSegments: [{
        id: "negative-narration",
        sourceAssetId: null,
        sequence: 0,
        startSeconds: 0,
        endSeconds: 1,
        text: "The supervisor reports no water at the doorway.",
      }],
      visualCandidates: [],
    });
    const grounded = groundReasonedObservations(output([{
      type: "note",
      description: "No water is reported at the doorway.",
      evidenceRefs: ["T0"],
    }]), negativeContext);
    expect(grounded).toHaveLength(1);
    expect(grounded[0].sourceBasis).toBe("NARRATION");

    const unsafe = groundReasonedObservations(output([{
      type: "note",
      description: "The area is unsafe because no guardrail is visible.",
      evidenceRefs: ["T0"],
    }]), negativeContext);
    expect(unsafe).toEqual([]);
  });

  it("matches equivalent negative forms and coordinated negative subjects conservatively", () => {
    const equivalentContext = buildReasoningContext({
      transcriptSegments: [],
      visualCandidates: [{
        id: "visual-negative-equivalent",
        mediaAssetId: "clip-negative-equivalent",
        sourceStartSeconds: 0,
        sourceEndSeconds: 1,
        eventStartSeconds: 0,
        eventEndSeconds: 1,
        text: "Water is not visible beside the doorway.",
      }],
    });
    expect(groundReasonedObservations(output([{
      type: "note",
      description: "No water is visible beside the doorway.",
      evidenceRefs: ["V0"],
    }]), equivalentContext)).toHaveLength(1);

    const coordinatedContext = buildReasoningContext({
      transcriptSegments: [],
      visualCandidates: [{
        id: "visual-negative-coordinated",
        mediaAssetId: "clip-negative-coordinated",
        sourceStartSeconds: 0,
        sourceEndSeconds: 1,
        eventStartSeconds: 0,
        eventEndSeconds: 1,
        text: "No water and debris are visible beside the doorway.",
      }],
    });
    expect(groundReasonedObservations(output([{
      type: "note",
      description: "No water is visible beside the doorway.",
      evidenceRefs: ["V0"],
    }]), coordinatedContext)).toHaveLength(1);
  });

  it("does not discard unsupported claims appended after a review follow-up", () => {
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "Water is visible beside the north doorway and requires professional review. A gas leak is visible.",
      evidenceRefs: ["V0"],
    }]), context());
    expect(drafts).toEqual([]);
  });

  it("does not combine separate evidence clauses into one factual claim", () => {
    const splitContext = buildReasoningContext({
      transcriptSegments: [],
      visualCandidates: [{
        id: "visual-split",
        mediaAssetId: "clip-split",
        sourceStartSeconds: 0,
        sourceEndSeconds: 2,
        eventStartSeconds: 0,
        eventEndSeconds: 2,
        text: "A crack is visible above the window. Water is visible beside the doorway.",
      }],
    });
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "A crack is visible beside the doorway.",
      evidenceRefs: ["V0"],
    }]), splitContext);
    expect(drafts).toEqual([]);
  });

  it("supports coordinated noun phrases sharing a visual predicate", () => {
    const coordinatedContext = buildReasoningContext({
      transcriptSegments: [],
      visualCandidates: [{
        id: "visual-coordinated",
        mediaAssetId: "clip-coordinated",
        sourceStartSeconds: 0,
        sourceEndSeconds: 1,
        eventStartSeconds: 0,
        eventEndSeconds: 1,
        text: "Water and debris are visible beside the doorway.",
      }],
    });
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "Water is visible beside the doorway.",
      evidenceRefs: ["V0"],
    }]), coordinatedContext);
    expect(drafts).toHaveLength(1);
  });

  it("supports coordinated objects while keeping independent predicates isolated", () => {
    const coordinatedContext = buildReasoningContext({
      transcriptSegments: [{
        id: "coordinated-narration",
        sourceAssetId: null,
        sequence: 0,
        startSeconds: 0,
        endSeconds: 1,
        text: "The supervisor reports water and debris beside the doorway.",
      }],
      visualCandidates: [{
        id: "independent-visual",
        mediaAssetId: "clip-independent",
        sourceStartSeconds: 0,
        sourceEndSeconds: 1,
        eventStartSeconds: 0,
        eventEndSeconds: 1,
        text: "Water is visible beside the doorway and debris is visible near the window.",
      }],
    });
    const coordinated = groundReasonedObservations(output([{
      type: "note",
      description: "Water is reported beside the doorway.",
      evidenceRefs: ["T0"],
    }]), coordinatedContext);
    expect(coordinated).toHaveLength(1);

    const isolated = groundReasonedObservations(output([{
      type: "note",
      description: "Water is visible near the window.",
      evidenceRefs: ["V0"],
    }]), coordinatedContext);
    expect(isolated).toEqual([]);
  });

  it("splits clear independent predicates after coordinated evidence", () => {
    const independentContext = buildReasoningContext({
      transcriptSegments: [],
      visualCandidates: [{
        id: "visual-independent-predicate",
        mediaAssetId: "clip-independent-predicate",
        sourceStartSeconds: 0,
        sourceEndSeconds: 1,
        eventStartSeconds: 0,
        eventEndSeconds: 1,
        text: "Water is visible beside the doorway and debris covers the window.",
      }],
    });
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "Water is visible beside the window.",
      evidenceRefs: ["V0"],
    }]), independentContext);
    expect(drafts).toEqual([]);
  });

  it("splits an independent predicate after a long coordinated suffix", () => {
    const independentContext = buildReasoningContext({
      transcriptSegments: [],
      visualCandidates: [{
        id: "visual-long-independent-predicate",
        mediaAssetId: "clip-long-independent-predicate",
        sourceStartSeconds: 0,
        sourceEndSeconds: 1,
        eventStartSeconds: 0,
        eventEndSeconds: 1,
        text: "Water is visible beside the doorway and the large pile of debris covers the window.",
      }],
    });
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "Water is visible beside the window.",
      evidenceRefs: ["V0"],
    }]), independentContext);
    expect(drafts).toEqual([]);
  });

  it("rejects cross-source claims that only become true by combining unrelated evidence", () => {
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "Water is visible in the conduit.",
      evidenceRefs: ["V0", "V1"],
    }]), context());
    expect(drafts).toEqual([]);
  });

  it("rejects a changed spatial relationship", () => {
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "Water is visible in the north doorway.",
      evidenceRefs: ["V0"],
    }]), context());
    expect(drafts).toEqual([]);
  });

  it.each([
    "Water is visible above the north doorway.",
    "Damaged water is visible beside the north doorway.",
  ])("rejects unsupported factual qualifiers: %s", (description) => {
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description,
      evidenceRefs: ["V0"],
    }]), context());
    expect(drafts).toEqual([]);
  });

  it("matches modality wording against the evidence source that supports the clause", () => {
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "A crack is visible and reported beside the north doorway.",
      evidenceRefs: ["T0", "V1"],
    }]), context());
    expect(drafts).toEqual([]);
  });

  it("rejects an unrelated cited evidence item instead of upgrading source basis", () => {
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "Water is reported at the north doorway.",
      evidenceRefs: ["T0", "V1"],
    }]), context());
    expect(drafts).toEqual([]);
  });

  it("does not derive optional location from an unrelated evidence clause", () => {
    const unrelatedLocationContext = buildReasoningContext({
      transcriptSegments: [],
      visualCandidates: [{
        id: "visual-unrelated-location",
        mediaAssetId: "clip-unrelated-location",
        sourceStartSeconds: 0,
        sourceEndSeconds: 1,
        eventStartSeconds: 0,
        eventEndSeconds: 1,
        text: "Water is visible beside the north doorway and the South tower is nearby.",
      }],
    });
    const drafts = groundReasonedObservations(output([{
      type: "note",
      description: "Water is visible beside the north doorway.",
      location: "South tower",
      evidenceRefs: ["V0"],
    }]), unrelatedLocationContext);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).not.toHaveProperty("location");
  });

  it("allows a directly supported condition with a review-oriented follow-up", () => {
    const drafts = groundReasonedObservations(output([{
      type: "potential_issue",
      description: "Water is visible beside the north doorway.",
      suggestedAction: "Ask the site supervisor to review the visible condition.",
      evidenceRefs: ["V0"],
    }]), context());
    expect(drafts).toHaveLength(1);
  });

  it("rejects unrelated claims and remediation hidden inside a review action", () => {
    const drafts = groundReasonedObservations(output([{
      type: "potential_issue",
      description: "Water is visible beside the north doorway.",
      suggestedAction: "Ask the supervisor to review the gas leak and patch it.",
      evidenceRefs: ["V0"],
    }]), context());
    expect(drafts).toEqual([]);
  });

  it.each([
    "Water is visible because the membrane failed.",
    "Water is 80% complete.",
    "Water creates a payment entitlement.",
    "Repair the doorway immediately.",
    "The inspector signed off the work.",
    "Water led to the failure.",
  ])("rejects unsupported claim language: %s", (description) => {
    const drafts = groundReasonedObservations(output([{
      type: "action",
      description,
      evidenceRefs: ["V0"],
    }]), context());
    expect(drafts).toEqual([]);
  });

  it("removes provider time markers before model-facing evidence is built", () => {
    const built = buildReasoningContext({
      transcriptSegments: [],
      visualCandidates: [{
        id: "visual-marked",
        mediaAssetId: "clip-marked",
        sourceStartSeconds: 0,
        sourceEndSeconds: 6,
        eventStartSeconds: 0,
        eventEndSeconds: 3,
        text: "<0.0 - 3.0> 00:06 Water is visible beside the north doorway.",
      }],
    });
    expect(built.evidence[0].text).toBe("Water is visible beside the north doorway.");
  });
});
