import { describe, expect, it, vi } from "vitest";
import { SiteThreadError } from "@/lib/errors";
import { LivepeerMediaIntelligenceProvider, ProviderCallError } from "./provider";
import { sanitizeProviderResponse } from "./sanitize";

const endpoint = "https://agent.livepeer.org/api/mcp/raw";
const signedUrl = "https://private.example/audio.wav?X-Amz-Signature=secret";

function rpc(result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: 1, result });
}

function success(capability: string, text: string): unknown {
  return { structuredContent: { ok: true, capability, output_kind: "text", result: { text, source_url: signedUrl } } };
}

function providerWithRun(run: (request: Record<string, unknown>, call: number) => Promise<Response> | Response) {
  const requests: Record<string, unknown>[] = [];
  let runCalls = 0;
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(request);
    if (request.method === "initialize") return rpc({ protocolVersion: "2024-11-05" });
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (request.method === "tools/list") return rpc({ tools: [{ name: "run_capability" }, { name: "list_capabilities" }] });
    const params = request.params as { name: string };
    if (params.name === "list_capabilities") return rpc({ structuredContent: { capabilities: [{ name: "nemotron-asr" }, { name: "marlin-video" }] } });
    runCalls += 1;
    return run(request, runCalls);
  }) as typeof fetch;
  return { provider: new LivepeerMediaIntelligenceProvider(endpoint, undefined, fetcher), requests, get runCalls() { return runCalls; } };
}

describe("Livepeer raw MCP adapter", () => {
  it("accepts the selected HTTPS endpoint and rejects HTTP before making a request", () => {
    const fetcher = vi.fn(async () => rpc({})) as unknown as typeof fetch;
    expect(() => new LivepeerMediaIntelligenceProvider(endpoint, "test-placeholder", fetcher)).not.toThrow();
    expect(() => new LivepeerMediaIntelligenceProvider("http://agent.livepeer.org/api/mcp/raw", "test-placeholder", fetcher)).toThrowError(SiteThreadError);
    try {
      new LivepeerMediaIntelligenceProvider("http://agent.livepeer.org/api/mcp/raw", "test-placeholder", fetcher);
    } catch (error) {
      expect(error).toMatchObject({ code: "PROVIDER_CONTRACT_UNRESOLVED" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts selected ASR and Marlin text while redacting echoed private URLs", async () => {
    const client = providerWithRun((request) => {
      const capability = ((request.params as { arguments: { capability: string } }).arguments.capability);
      return rpc(success(capability, capability === "nemotron-asr" ? "Spoken site note" : "Visible condition <1.0 - 3.0>"));
    });
    const transcript = await client.provider.transcribe({ walkthroughId: "walk", audioUrl: signedUrl, idempotencyKey: "same-key" });
    const visual = await client.provider.analyzeVisual({ walkthroughId: "walk", mediaUrl: signedUrl, idempotencyKey: "visual-key" });
    expect(transcript.value.text).toBe("Spoken site note");
    expect(visual.value.eventRange).toEqual({ startSeconds: 1, endSeconds: 3 });
    expect(JSON.stringify(transcript.diagnostic.rawResponse)).not.toContain("X-Amz-Signature");
    expect(JSON.stringify(visual.diagnostic.rawResponse)).not.toContain(signedUrl);
    expect(client.requests.filter((request) => request.method === "tools/call")).toHaveLength(3);
  });

  it.each([
    ["JSON-RPC error", Response.json({ jsonrpc: "2.0", id: 1, error: { code: "param_reject", retryable: false } })],
    ["MCP isError", rpc({ isError: true, structuredContent: { code: "param_reject", retryable: false } })],
    ["provider ok false", rpc({ structuredContent: { ok: false, code: "param_reject", retryable: false } })],
    ["wrong output kind", rpc({ structuredContent: { ok: true, capability: "nemotron-asr", output_kind: "image", result: { text: "wrong" } } })],
    ["empty result", rpc(success("nemotron-asr", ""))],
    ["terminal failure", rpc({ structuredContent: { ok: true, capability: "nemotron-asr", output_kind: "text", status: "failed", result: { text: "failed" } } })],
    ["unfinished synchronous result", rpc({ structuredContent: { ok: true, capability: "nemotron-asr", output_kind: "text", status: "submitted", result: { text: "processing" } } })],
    ["auth failure", new Response(null, { status: 401 })],
    ["missing media", new Response(null, { status: 404 })],
    ["invalid JSON", new Response("not-json", { status: 200 })],
  ])("rejects %s even when transport may succeed", async (_label, response) => {
    const client = providerWithRun(() => response);
    await expect(client.provider.transcribe({ walkthroughId: "walk", audioUrl: signedUrl, idempotencyKey: "key" })).rejects.toBeInstanceOf(ProviderCallError);
    expect(client.runCalls).toBe(1);
  });

  it("reuses the same key on one uncertain transport retry", async () => {
    const client = providerWithRun((_request, call) => {
      if (call === 1) throw new DOMException("timed out", "TimeoutError");
      return rpc(success("nemotron-asr", "Recovered text"));
    });
    const result = await client.provider.transcribe({ walkthroughId: "walk", audioUrl: signedUrl, idempotencyKey: "stable-key" });
    expect(result.value.text).toBe("Recovered text");
    const calls = client.requests.filter((request) => (request.params as { name?: string } | undefined)?.name === "run_capability");
    expect(calls).toHaveLength(2);
    expect(calls.map((request) => ((request.params as { arguments: { idempotency_key: string } }).arguments.idempotency_key))).toEqual(["stable-key", "stable-key"]);
  });

  it("fails with a safe timeout after the bounded retry", async () => {
    const client = providerWithRun(() => { throw new DOMException("timed out", "TimeoutError"); });
    await expect(client.provider.transcribe({ walkthroughId: "walk", audioUrl: signedUrl, idempotencyKey: "stable-key" })).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT", retryable: true });
    expect(client.runCalls).toBe(2);
  });

  it("redacts provider echoes and credentials in diagnostic payloads", () => {
    const sanitized = sanitizeProviderResponse({ source_url: signedUrl, authorization: "Bearer secret", result: { text: `See ${signedUrl} and Bearer abc`, nested: { request_headers: { Authorization: "Bearer nested-secret" }, url: signedUrl, useful: "retained" } } });
    const text = JSON.stringify(sanitized);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("private.example");
    expect(text).not.toContain("Bearer abc");
    expect(text).not.toContain("nested-secret");
    expect(text).not.toContain("request_headers");
    expect(text).toContain("retained");
    expect(sanitizeProviderResponse({ text: `encoded https%3A%2F%2Fprivate.example%2Fmedia%3FX-Amz%2DSignature%3Dtoken` })).toEqual({ text: "[redacted media reference]" });
  });
});
