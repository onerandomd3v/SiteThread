import { describe, expect, it } from "vitest";
import { createCreativeMcpSession, CreativeTranscriptionProvider, CREATIVE_TRANSCRIBE_CAPABILITY, type CreativeMcpSession } from "./creative";

const endpoint = "https://agent.livepeer.org/api/mcp/creative";
const signedUrl = "https://private.example/audio.wav?X-Amz-Signature=secret";

function fakeSession(calls: Array<{ name: string; args: Record<string, unknown> }>): CreativeMcpSession {
  return {
    listTools: async () => ({ tools: [{ name: "transcribe", inputSchema: { type: "object" } }, { name: "get_pricing", inputSchema: { type: "object" } }, { name: "spend_cap", inputSchema: { type: "object" } }, { name: "find_moments", inputSchema: { type: "object" } }] }),
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === "get_pricing") return { content: [{ type: "text", text: "wizper n/a" }], structuredContent: { capabilities: [{ name: "wizper", display_price_usd: null }] } };
      if (name === "spend_cap") return { content: [{ type: "text", text: "Demo allowance left: $99.90" }], structuredContent: { demo: true, remaining_usd: 99.9, allowance_usd: 100 } };
      return { content: [{ type: "text", text: "Transcribed 0 caption cues." }], structuredContent: { text: "Spoken site note", cues: [], srt: "", source_url: signedUrl } };
    },
    close: async () => undefined,
  };
}

describe("Livepeer creative transcription adapter", () => {
  it("uses the creative tool, accepts missing timing metadata, and preserves truthful provenance", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const provider = new CreativeTranscriptionProvider(endpoint, async () => fakeSession(calls));
    const result = await provider.transcribe({ walkthroughId: "walk", audioUrl: signedUrl, idempotencyKey: "window-key" });

    expect(result.value).toEqual({ text: "Spoken site note" });
    expect(result.diagnostic).toMatchObject({ provider: "livepeer", capability: CREATIVE_TRANSCRIBE_CAPABILITY, idempotencyKey: "window-key" });
    expect(JSON.stringify(result.diagnostic.rawResponse)).not.toContain("X-Amz-Signature");
    expect(calls.map(({ name }) => name)).toEqual(["get_pricing", "spend_cap", "transcribe"]);
    expect(calls.at(-1)?.args).toMatchObject({ source_url: signedUrl, granularity: "segment", burn: false });
    expect(calls.map(({ name }) => name)).not.toContain("find_moments");
  });

  it("rejects an unavailable demo balance without calling transcription", async () => {
    const calls: string[] = [];
    const session: CreativeMcpSession = {
      listTools: async () => ({ tools: [{ name: "transcribe", inputSchema: { type: "object" } }, { name: "get_pricing", inputSchema: { type: "object" } }, { name: "spend_cap", inputSchema: { type: "object" } }] }),
      callTool: async (name) => {
        calls.push(name);
        if (name === "get_pricing") return { content: [], structuredContent: { capabilities: [{ name: "wizper", display_price_usd: null }] } };
        if (name === "spend_cap") return { content: [], structuredContent: { demo: true, remaining_usd: 0 } };
        return { content: [], structuredContent: { text: "must not run" } };
      },
      close: async () => undefined,
    };
    const provider = new CreativeTranscriptionProvider(endpoint, async () => session);
    await expect(provider.transcribe({ walkthroughId: "walk", audioUrl: signedUrl, idempotencyKey: "window-key" })).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
    expect(calls).not.toContain("transcribe");
  });

  it("does not add an Authorization header to the SDK transport", async () => {
    const requests: RequestInit[] = [];
    const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      const body = JSON.parse(String(init?.body));
      if (body.method === "initialize") return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "creative", version: "1" } } });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "transcribe", inputSchema: { type: "object" } }, { name: "get_pricing", inputSchema: { type: "object" } }, { name: "spend_cap", inputSchema: { type: "object" } }] } });
    }) as typeof fetch;
    const session = await createCreativeMcpSession(endpoint, fetcher);
    await session.listTools();
    await session.close();
    expect(requests.every((request) => !Object.keys(request.headers ?? {}).some((key) => key.toLowerCase() === "authorization"))).toBe(true);
  });
});
