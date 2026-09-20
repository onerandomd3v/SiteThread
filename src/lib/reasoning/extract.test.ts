import { describe, expect, it } from "vitest";
import type { db } from "@/lib/db/client";
import { FixtureObservationReasoner } from "./reasoner";
import type { ObservationReasoner } from "./types";
import { extractObservations } from "./extract";

function scenario() {
  const run = { id: "run-1", walkthroughId: "walk-1", pipelineVersion: "mvp-upload-v1", retryCount: 0, status: "EXTRACTING_OBSERVATIONS" };
  const created: Record<string, unknown>[] = [];
  const evidence: Record<string, unknown>[] = [];
  const invocations: Record<string, unknown>[] = [];
  const reasonerInputs: unknown[] = [];
  const database = {
    processingRun: {
      findUnique: async () => ({ ...run }),
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(run, data),
    },
    transcriptSegment: {
      findMany: async () => [{ id: "segment-1", sourceAssetId: "source-1", sequence: 0, startSeconds: 0, endSeconds: 6, text: "The supervisor reports water at the doorway." }],
    },
    visualCandidate: {
      findMany: async () => [{ id: "visual-1", mediaAssetId: "clip-1", sourceStartSeconds: 0, sourceEndSeconds: 6, eventStartSeconds: 1, eventEndSeconds: 3, text: "Water is visible beside the doorway." }],
    },
    $transaction: async (work: unknown) => typeof work === "function" ? (work as (tx: typeof database) => Promise<unknown>)(database) : Promise.all(work as Promise<unknown>[]),
    providerInvocation: { upsert: async ({ create }: { create: Record<string, unknown> }) => { invocations.push(create); return { id: "inv-1" }; } },
    observation: {
      deleteMany: async () => { created.splice(0); },
      create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return data; },
    },
  } as unknown as typeof db;
  const reasoner: ObservationReasoner = {
    extract: async (input) => {
      reasonerInputs.push(input);
      return {
      value: { observations: [{ type: "potential_issue", description: "Water is visible and reported at the doorway.", suggestedAction: "Ask the site supervisor to review the visible condition.", evidenceRefs: ["T0", "V0"] }] },
      diagnostic: { provider: "fixture", capability: "gemini-text", idempotencyKey: input.idempotencyKey, rawResponse: { fixture: true }, latencyMs: 0 },
      };
    },
  };
  return { database, reasoner, run, created, evidence, invocations, reasonerInputs };
}

describe("observation extraction persistence", () => {
  it("persists only draft, run-scoped, evidence-linked observations and ends at review", async () => {
    const state = scenario();
    await extractObservations("run-1", { database: state.database, reasoner: state.reasoner });
    expect(state.run.status).toBe("NEEDS_REVIEW");
    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({
      id: expect.stringMatching(/^obs_/),
      walkthroughId: "walk-1",
      processingRunId: "run-1",
      sequence: 0,
      type: "POTENTIAL_ISSUE",
      sourceBasis: "NARRATION_AND_VISUAL",
      reviewState: "DRAFT",
      suggestedAction: "Ask the site supervisor to review the visible condition.",
    });
    expect(state.created[0].evidence).toEqual({ create: [
      { transcriptSegmentId: "segment-1", mediaAssetId: "source-1", sourceStartSeconds: 0, sourceEndSeconds: 6, label: "Narration 00:00–00:06" },
      { mediaAssetId: "clip-1", sourceStartSeconds: 1, sourceEndSeconds: 3, label: "Visual evidence 00:01–00:03" },
    ] });
    expect(state.invocations[0]).toMatchObject({ stage: "EXTRACTING_OBSERVATIONS", capability: "gemini-text", status: "SUCCEEDED", sourceStartSeconds: 0, sourceEndSeconds: 6 });
    expect(state.reasonerInputs[0]).toEqual({
      idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      evidence: [
        { ref: "T0", kind: "transcript", text: "The supervisor reports water at the doorway." },
        { ref: "V0", kind: "visual", text: "Water is visible beside the doorway." },
      ],
    });
  });

  it("does not persist when the reasoner returns an unknown evidence reference", async () => {
    const state = scenario();
    state.reasoner.extract = async (input) => ({ value: { observations: [{ type: "note", description: "Untrusted", evidenceRefs: ["T99"] }] }, diagnostic: { provider: "fixture", capability: "gemini-text", idempotencyKey: input.idempotencyKey, rawResponse: {}, latencyMs: 0 } });
    await expect(extractObservations("run-1", { database: state.database, reasoner: state.reasoner })).rejects.toMatchObject({ code: "PROVIDER_RESULT_INVALID" });
    expect(state.created).toHaveLength(0);
    expect(state.run.status).toBe("EXTRACTING_OBSERVATIONS");
  });

  it("persists no unsupported drafts but still reaches review", async () => {
    const state = scenario();
    state.reasoner.extract = async (input) => ({
      value: { observations: [{ type: "potential_issue", description: "A structural crack is visible in the beam.", evidenceRefs: ["V0"] }] },
      diagnostic: { provider: "fixture", capability: "gemini-text", idempotencyKey: input.idempotencyKey, rawResponse: {}, latencyMs: 0 },
    });
    await extractObservations("run-1", { database: state.database, reasoner: state.reasoner });
    expect(state.created).toHaveLength(0);
    expect(state.run.status).toBe("NEEDS_REVIEW");
  });

  it("rejects a reasoner diagnostic that changes the caller-derived idempotency key", async () => {
    const state = scenario();
    state.reasoner.extract = async () => ({
      value: { observations: [] },
      diagnostic: { provider: "fixture", capability: "gemini-text", idempotencyKey: "wrong-key", rawResponse: {}, latencyMs: 0 },
    });
    await expect(extractObservations("run-1", { database: state.database, reasoner: state.reasoner })).rejects.toMatchObject({ code: "PROVIDER_RESULT_INVALID" });
    expect(state.invocations).toHaveLength(0);
    expect(state.created).toHaveLength(0);
    expect(state.run.status).toBe("EXTRACTING_OBSERVATIONS");
  });

  it("is a no-op after the run has reached review", async () => {
    const state = scenario();
    state.run.status = "NEEDS_REVIEW";
    await extractObservations("run-1", { database: state.database, reasoner: state.reasoner });
    expect(state.created).toHaveLength(0);
  });

  it("reuses the run-scoped observation set when extraction is redelivered", async () => {
    const state = scenario();
    await extractObservations("run-1", { database: state.database, reasoner: state.reasoner });
    state.run.status = "EXTRACTING_OBSERVATIONS";
    await extractObservations("run-1", { database: state.database, reasoner: state.reasoner });
    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({ processingRunId: "run-1", sequence: 0, reviewState: "DRAFT" });
    expect(state.reasonerInputs[1]).toMatchObject({ idempotencyKey: (state.reasonerInputs[0] as { idempotencyKey: string }).idempotencyKey });
  });

  it("persists individually grounded fixture observations beyond the 12-reference cap", async () => {
    const state = scenario();
    const mockDatabase = state.database as unknown as {
      transcriptSegment: { findMany: () => Promise<unknown[]> };
      visualCandidate: { findMany: () => Promise<unknown[]> };
    };
    mockDatabase.transcriptSegment.findMany = async () => [];
    mockDatabase.visualCandidate.findMany = async () => Array.from({ length: 13 }, (_, index) => ({
      id: `visual-${index}`,
      mediaAssetId: `clip-${index}`,
      sourceStartSeconds: index,
      sourceEndSeconds: index + 1,
      eventStartSeconds: index,
      eventEndSeconds: index + 1,
      text: `Condition ${index} is visible.`,
    }));
    await extractObservations("run-1", { database: state.database, reasoner: new FixtureObservationReasoner() });
    expect(state.created).toHaveLength(13);
    expect(state.created.every((observation) => (observation.evidence as { create: unknown[] }).create.length === 1)).toBe(true);
    expect(state.run.status).toBe("NEEDS_REVIEW");
  });
});
