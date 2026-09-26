import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import type { db } from "@/lib/db/client";
import { FixtureObservationReasoner } from "./reasoner";
import type { ObservationReasoner } from "./types";
import { extractObservations } from "./extract";

afterEach(() => vi.restoreAllMocks());

function scenario() {
  const run = { id: "run-1", walkthroughId: "walk-1", pipelineVersion: "mvp-upload-v1", retryCount: 0, status: "EXTRACTING_OBSERVATIONS" };
  const created: Record<string, unknown>[] = [];
  const evidence: Record<string, unknown>[] = [];
  const invocations: Record<string, unknown>[] = [];
  const reasonerInputs: unknown[] = [];
  const transactionOptions: unknown[] = [];
  const transactionalWrites: boolean[] = [];
  let inTransaction = false;
  const database = {
    processingRun: {
      findUnique: async () => ({ ...run }),
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(run, data),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        transactionalWrites.push(inTransaction);
        if (run.id !== where.id || run.status !== where.status) return { count: 0 };
        Object.assign(run, data);
        return { count: 1 };
      },
    },
    transcriptSegment: {
      findMany: async () => [{ id: "segment-1", sourceAssetId: "source-1", sequence: 0, startSeconds: 0, endSeconds: 6, text: "The supervisor reports water at the doorway." }],
    },
    visualCandidate: {
      findMany: async () => [{ id: "visual-1", mediaAssetId: "clip-1", sourceStartSeconds: 0, sourceEndSeconds: 6, eventStartSeconds: 1, eventEndSeconds: 3, text: "Water is visible beside the doorway." }],
    },
    $transaction: async (work: unknown, options?: unknown) => {
      transactionOptions.push(options);
      if (typeof work !== "function") return Promise.all(work as Promise<unknown>[]);
      inTransaction = true;
      try {
        return await (work as (tx: typeof database) => Promise<unknown>)(database);
      } finally {
        inTransaction = false;
      }
    },
    providerInvocation: { upsert: async ({ create }: { create: Record<string, unknown> }) => { transactionalWrites.push(inTransaction); invocations.push(create); return { id: "inv-1" }; } },
    observation: {
      deleteMany: async () => { transactionalWrites.push(inTransaction); created.splice(0); },
      create: async ({ data }: { data: Record<string, unknown> }) => { transactionalWrites.push(inTransaction); created.push(data); return data; },
    },
  } as unknown as typeof db;
  const reasoner: ObservationReasoner = {
    extract: async (input) => {
      reasonerInputs.push(input);
      return {
      value: { observations: [{ type: "potential_issue", description: "Water is visible and reported at the doorway.", suggestedAction: "Ask the site supervisor to review the visible condition.", evidenceRefs: ["T0", "V0"] }] },
      diagnostic: { provider: "fixture", capability: "observation-reasoning", idempotencyKey: input.idempotencyKey, rawResponse: { fixture: true }, latencyMs: 0 },
      };
    },
  };
  return { database, reasoner, run, created, evidence, invocations, reasonerInputs, transactionOptions, transactionalWrites };
}

describe("observation extraction persistence", () => {
  it("logs safe phase and exception metadata without logging private error content", async () => {
    const state = scenario();
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    state.reasoner.extract = async () => { throw new TypeError("private transcript, signed URL, and provider payload"); };

    await expect(extractObservations("run-1", { database: state.database, reasoner: state.reasoner })).rejects.toThrow("private transcript, signed URL, and provider payload");

    const logged = output.mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).toContain('"event":"observation.reasoning.failed"');
    expect(logged).toContain('"phase":"provider_reasoning"');
    expect(logged).toContain('"errorName":"TypeError"');
    expect(logged).toContain('"errorCategory":"unclassified_exception"');
    expect(logged).not.toContain("private transcript");
    expect(logged).not.toContain("signed URL");
    expect(logged).not.toContain("provider payload");
  });

  it("logs validation codes with allowlisted paths only", async () => {
    const state = scenario();
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    state.reasoner.extract = async () => {
      throw new ZodError([{ code: "custom", path: ["observations", 0, "private transcript key"], message: "private transcript value" }]);
    };

    await expect(extractObservations("run-1", { database: state.database, reasoner: state.reasoner })).rejects.toBeInstanceOf(ZodError);

    const logged = output.mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).toContain('"errorCategory":"validation"');
    expect(logged).toContain('"validationIssues":"custom@observations.0.other"');
    expect(logged).not.toContain("private transcript");
    expect(logged).not.toContain("private transcript key");
  });

  it("keeps persistence error diagnostics safe and identifies only the transaction phase and code", async () => {
    const state = scenario();
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const database = state.database as unknown as { $transaction: (work: unknown, options?: unknown) => Promise<unknown> };
    database.$transaction = async (_work, options) => {
      state.transactionOptions.push(options);
      throw new Prisma.PrismaClientKnownRequestError("private transaction metadata", {
        code: "P2028",
        clientVersion: "test",
        meta: { error: "private transaction metadata" },
      });
    };

    await expect(extractObservations("run-1", { database: state.database, reasoner: state.reasoner })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    const logged = output.mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).toContain('"phase":"persist_transaction"');
    expect(logged).toContain('"errorName":"PrismaClientKnownRequestError"');
    expect(logged).toContain('"errorCategory":"prisma_request"');
    expect(logged).toContain('"errorCode":"P2028"');
    expect(logged).not.toContain("private transaction metadata");
    expect(state.transactionOptions).toEqual([{ maxWait: 5000, timeout: 15000 }]);
  });

  it("persists only draft, run-scoped, evidence-linked observations and ends at review", async () => {
    const state = scenario();
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
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
    expect(state.invocations[0]).toMatchObject({ stage: "EXTRACTING_OBSERVATIONS", capability: "observation-reasoning", status: "SUCCEEDED", sourceStartSeconds: 0, sourceEndSeconds: 6 });
    expect(state.invocations[0].rawResponse).toMatchObject({
      fixture: true,
      siteThreadReasoning: { candidateCount: 1, groundedCount: 1 },
    });
    expect(state.reasonerInputs[0]).toEqual({
      idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      evidence: [
        { ref: "T0", kind: "transcript", text: "The supervisor reports water at the doorway." },
        { ref: "V0", kind: "visual", text: "Water is visible beside the doorway." },
      ],
    });
    const events = output.mock.calls.map(([line]) => JSON.parse(String(line)).event);
    expect(events).toEqual(expect.arrayContaining([
      "observation.reasoning.invocation_started",
      "observation.reasoning.provider_completed",
      "observation.reasoning.provider_response_validated",
      "observation.reasoning.evidence_references_validated",
      "observation.reasoning.grounding_started",
      "observation.reasoning.grounding_completed",
      "observation.reasoning.persistence_started",
      "observation.reasoning.persistence_completed",
    ]));
    expect(state.reasonerInputs).toHaveLength(1);
    expect(state.transactionOptions).toEqual([{ maxWait: 5000, timeout: 15000 }]);
    expect(state.transactionalWrites.length).toBeGreaterThan(0);
    expect(state.transactionalWrites.every(Boolean)).toBe(true);
  });

  it("does not persist when the reasoner returns an unknown evidence reference", async () => {
    const state = scenario();
    state.reasoner.extract = async (input) => ({ value: { observations: [{ type: "note", description: "Untrusted", evidenceRefs: ["T99"] }] }, diagnostic: { provider: "fixture", capability: "observation-reasoning", idempotencyKey: input.idempotencyKey, rawResponse: {}, latencyMs: 0 } });
    await expect(extractObservations("run-1", { database: state.database, reasoner: state.reasoner })).rejects.toMatchObject({ code: "PROVIDER_RESULT_INVALID" });
    expect(state.created).toHaveLength(0);
    expect(state.run.status).toBe("EXTRACTING_OBSERVATIONS");
  });

  it("persists no unsupported drafts but still reaches review", async () => {
    const state = scenario();
    state.reasoner.extract = async (input) => ({
      value: { observations: [{ type: "potential_issue", description: "A structural crack is visible in the beam.", evidenceRefs: ["V0"] }] },
      diagnostic: { provider: "fixture", capability: "observation-reasoning", idempotencyKey: input.idempotencyKey, rawResponse: {}, latencyMs: 0 },
    });
    await extractObservations("run-1", { database: state.database, reasoner: state.reasoner });
    expect(state.created).toHaveLength(0);
    expect(state.run.status).toBe("NEEDS_REVIEW");
    expect(state.invocations[0].rawResponse).toMatchObject({
      siteThreadReasoning: { candidateCount: 1, groundedCount: 0 },
    });
  });

  it("rejects a reasoner diagnostic that changes the caller-derived idempotency key", async () => {
    const state = scenario();
    state.reasoner.extract = async () => ({
      value: { observations: [] },
      diagnostic: { provider: "fixture", capability: "observation-reasoning", idempotencyKey: "wrong-key", rawResponse: {}, latencyMs: 0 },
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
    expect(state.reasonerInputs).toHaveLength(0);
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

  it("allows only one concurrent worker to claim observation persistence", async () => {
    const state = scenario();
    await Promise.all([
      extractObservations("run-1", { database: state.database, reasoner: state.reasoner }),
      extractObservations("run-1", { database: state.database, reasoner: state.reasoner }),
    ]);
    expect(state.created).toHaveLength(1);
    expect(state.run.status).toBe("NEEDS_REVIEW");
  });
});
