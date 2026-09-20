import { describe, expect, it } from "vitest";
import { FixtureObservationReasoner, LivepeerObservationReasoner } from "./reasoner";
import type { ObservationReasoningInput } from "./types";

const input: ObservationReasoningInput = {
  idempotencyKey: "observation-key-1",
  evidence: [
    { ref: "T0", kind: "transcript", text: "The supervisor reports water at the north doorway." },
    { ref: "V0", kind: "visual", text: "Water is visible beside the north doorway." },
  ],
};

function rpc(result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: 1, result });
}

function liveReasoner(responseText: string, capture: string[]) {
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    capture.push(JSON.stringify(request));
    if (request.method === "initialize") return rpc({ protocolVersion: "2024-11-05" });
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (request.method === "tools/list") return rpc({ tools: [{ name: "run_capability" }, { name: "list_capabilities" }, { name: "describe_capability" }] });
    if (request.params?.name === "list_capabilities") return rpc({ structuredContent: { capabilities: [{ name: "gemini-text" }] } });
    if (request.params?.name === "describe_capability") return rpc({ structuredContent: { name: "gemini-text", found: true, modality: "text", output_kind: "text", invoke_via: "run_capability" } });
    return rpc({ structuredContent: { ok: true, capability: "gemini-text", output_kind: "text", result: { text: responseText } } });
  }) as typeof fetch;
  return new LivepeerObservationReasoner("https://agent.livepeer.org/api/mcp/raw", undefined, fetcher);
}

describe("observation reasoner", () => {
  it("uses a deterministic fixture without making a network request", async () => {
    const result = await new FixtureObservationReasoner().extract(input);
    expect(result.value.observations).toEqual([{
      type: "note",
      description: "The supervisor reports water at the north doorway.",
      evidenceRefs: ["T0", "V0"],
    }]);
    expect(result.diagnostic.provider).toBe("fixture");
  });

  it("discovers gemini-text, sends text-only labeled evidence, and parses strict output", async () => {
    const capture: string[] = [];
    const reasoner = liveReasoner(JSON.stringify({ observations: [{ type: "note", description: "Water is visible and reported at the north doorway.", evidenceRefs: ["T0", "V0"] }] }), capture);
    const result = await reasoner.extract(input);
    const runRequest = capture.map((value) => JSON.parse(value)).find((request) => request.params?.name === "run_capability");
    const args = runRequest.params.arguments;
    expect(result.value.observations[0]).toMatchObject({ type: "note", evidenceRefs: ["T0", "V0"] });
    expect(args).toMatchObject({ capability: "gemini-text", async: false, timeout: 36, persist: false });
    expect(args.idempotency_key).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    expect(JSON.stringify(args)).not.toContain("http");
    expect(JSON.stringify(args)).not.toContain("run-1");
    expect(JSON.stringify(args)).not.toContain("walk-1");
    expect(JSON.stringify(args)).not.toContain("source-asset");
    expect(JSON.stringify(args)).not.toContain("00:00");
    expect(JSON.stringify(args)).toContain("T0");
    expect(JSON.stringify(args)).toContain("V0");
  });

  it("keeps fixture output valid when evidence exceeds the per-observation reference cap", async () => {
    const result = await new FixtureObservationReasoner().extract({
      idempotencyKey: "fixture-key",
      evidence: Array.from({ length: 13 }, (_, index) => ({
        ref: `V${index}`,
        kind: "visual" as const,
        text: `Condition ${index} is visible.`,
      })),
    });
    expect(result.value.observations.length).toBeGreaterThan(1);
    expect(result.value.observations.every((observation) => observation.evidenceRefs.length <= 12)).toBe(true);
  });

  it.each(["failed", "submitted", "running", "queued", "pending"])("rejects a top-level %s provider status", async (status) => {
    const reasoner = liveReasonerWithStatus(JSON.stringify({ observations: [] }), { status });
    await expect(reasoner.extract(input)).rejects.toMatchObject({ code: "PROVIDER_RESULT_INVALID" });
  });

  it.each(["failed", "submitted", "running", "queued", "pending"])("rejects a nested %s provider status", async (status) => {
    const reasoner = liveReasonerWithStatus(JSON.stringify({ observations: [] }), { result: { status } });
    await expect(reasoner.extract(input)).rejects.toMatchObject({ code: "PROVIDER_RESULT_INVALID" });
  });

  it("rejects malformed explicit provider status types", async () => {
    await expect(liveReasonerWithStatus(JSON.stringify({ observations: [] }), { status: 0 }).extract(input)).rejects.toMatchObject({ code: "PROVIDER_RESULT_INVALID" });
    await expect(liveReasonerWithStatus(JSON.stringify({ observations: [] }), { result: { status: null } }).extract(input)).rejects.toMatchObject({ code: "PROVIDER_RESULT_INVALID" });
  });

  it("reuses the same provider-safe key for an uncertain retry identity", async () => {
    const firstCapture: string[] = [];
    const secondCapture: string[] = [];
    await liveReasoner(JSON.stringify({ observations: [] }), firstCapture).extract(input);
    await liveReasoner(JSON.stringify({ observations: [] }), secondCapture).extract(input);
    const key = (capture: string[]) => JSON.parse(capture.find((value) => JSON.parse(value).params?.name === "run_capability")!).params.arguments.idempotency_key;
    expect(key(firstCapture)).toBe(key(secondCapture));
  });

  it("rejects malformed model JSON before it can be persisted", async () => {
    const reasoner = liveReasoner("not-json", []);
    await expect(reasoner.extract(input)).rejects.toMatchObject({ code: "PROVIDER_RESULT_INVALID" });
  });
});

function liveReasonerWithStatus(responseText: string, status: Record<string, unknown>) {
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { method: string; params?: { name?: string } };
    if (request.method === "initialize") return rpc({ protocolVersion: "2024-11-05" });
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (request.method === "tools/list") return rpc({ tools: [{ name: "run_capability" }, { name: "list_capabilities" }, { name: "describe_capability" }] });
    if (request.params?.name === "list_capabilities") return rpc({ structuredContent: { capabilities: [{ name: "gemini-text" }] } });
    if (request.params?.name === "describe_capability") return rpc({ structuredContent: { name: "gemini-text", found: true, modality: "text", output_kind: "text", invoke_via: "run_capability" } });
    return rpc({ structuredContent: { ok: true, capability: "gemini-text", output_kind: "text", ...status, result: { text: responseText, ...(status.result && typeof status.result === "object" ? status.result : {}) } } });
  }) as typeof fetch;
  return new LivepeerObservationReasoner("https://agent.livepeer.org/api/mcp/raw", undefined, fetcher);
}
