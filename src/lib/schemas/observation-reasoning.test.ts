import { describe, expect, it } from "vitest";
import { ObservationReasoningOutputSchema } from "./observation-reasoning";

describe("observation reasoning output", () => {
  it("accepts the strict grounded draft contract and an empty result", () => {
    expect(ObservationReasoningOutputSchema.parse({ observations: [] })).toEqual({ observations: [] });
    expect(ObservationReasoningOutputSchema.parse({
      observations: [{
        type: "potential_issue",
        description: "Water is visible beside the doorway.",
        location: "Doorway",
        trade: "Waterproofing",
        confidence: 0.72,
        suggestedAction: "Ask the site supervisor to review the visible condition.",
        evidenceRefs: ["V0", "T0"],
      }],
    }).observations[0]).toMatchObject({ type: "potential_issue", evidenceRefs: ["V0", "T0"] });
  });

  it.each([
    { observations: [{ type: "issue", description: "Wrong type", evidenceRefs: ["T0"] }] },
    { observations: [{ type: "note", description: "No evidence", evidenceRefs: [] }] },
    { observations: [{ type: "note", description: "Bad confidence", confidence: 1.1, evidenceRefs: ["T0"] }] },
    { observations: [{ type: "note", description: "Extra field", evidenceRefs: ["T0"], startSeconds: 9 }] },
    { observations: Array.from({ length: 21 }, (_, index) => ({ type: "note", description: `Finding ${index}`, evidenceRefs: ["T0"] })) },
  ])("rejects malformed or unbounded provider output", (value) => {
    expect(ObservationReasoningOutputSchema.safeParse(value).success).toBe(false);
  });
});
