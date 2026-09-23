import { describe, expect, it, vi } from "vitest";
import { SiteThreadError } from "@/lib/errors";
import { configuredVisualSemanticProvider } from "./provider";
import { GeminiVisualSemanticProvider, GEMINI_MAX_INLINE_VIDEO_BYTES } from "./gemini";

const signedUrl = "https://private.example/evidence.mp4?X-Amz-Signature=do-not-retain";
const apiKey = "gemini-test-key";

function fakeGeminiFetch() {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    if (String(url) === signedUrl) return new Response(new Uint8Array([0, 1, 2, 3]), { headers: { "content-type": "video/mp4" } });
    return Response.json({
      candidates: [{ content: { parts: [{ text: "Visible stacked materials are present near active construction work." }] }, finishReason: "STOP" }],
      modelVersion: "gemini-test-version",
      responseId: "response-1",
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 12 },
    });
  }) as typeof fetch;
  return { fetcher, requests };
}

describe("Gemini visual semantic provider", () => {
  it("fetches signed media privately, sends video/mp4 inline, and keeps SiteThread timing authoritative", async () => {
    const fake = fakeGeminiFetch();
    const result = await new GeminiVisualSemanticProvider(apiKey, "gemini-test-model", fake.fetcher).analyzeVisual({
      walkthroughId: "walk",
      mediaUrl: signedUrl,
      sourceStartSeconds: 24,
      sourceEndSeconds: 30,
      idempotencyKey: "visual-key",
    });
    const requestBody = JSON.parse(String(fake.requests[1].init?.body)) as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
    expect(requestBody.contents[0].parts[0].inline_data).toMatchObject({ mime_type: "video/mp4", data: "AAECAw==" });
    expect(String(requestBody.contents[0].parts[1].text)).toContain("Do not invent timestamps");
    expect(result.value).toEqual({ text: "Visible stacked materials are present near active construction work." });
    expect(result.diagnostic).toMatchObject({ provider: "google-gemini", capability: "gemini-video-understanding", idempotencyKey: "visual-key" });
    expect(JSON.stringify(result.diagnostic.rawResponse)).not.toContain("private.example");
    expect(JSON.stringify(result.diagnostic.rawResponse)).not.toContain("X-Amz-Signature");
    expect(JSON.stringify(result.diagnostic.rawResponse)).not.toContain(apiKey);
    expect(result.value).not.toHaveProperty("sourceStartSeconds");
    expect(result.value).not.toHaveProperty("sourceEndSeconds");
  });

  it("rejects oversized inline media before calling Gemini", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url) === signedUrl
      ? new Response(null, { headers: { "content-length": String(GEMINI_MAX_INLINE_VIDEO_BYTES + 1) } })
      : Response.json({})) as unknown as typeof fetch;
    await expect(new GeminiVisualSemanticProvider(apiKey, "gemini-test-model", fetcher).analyzeVisual({ walkthroughId: "walk", mediaUrl: signedUrl, idempotencyKey: "key" }))
      .rejects.toMatchObject({ code: "PROVIDER_INVALID_INPUT", retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("normalizes unreadable private media", async () => {
    const unreadable = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === signedUrl) {
        return new Response(new ReadableStream({ pull() { throw new Error("read failed"); } }));
      }
      return Response.json({});
    }) as unknown as typeof fetch;
    await expect(new GeminiVisualSemanticProvider(apiKey, "gemini-test-model", unreadable).analyzeVisual({ walkthroughId: "walk", mediaUrl: signedUrl, idempotencyKey: "key" }))
      .rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE", retryable: true });
  });

  it("classifies malformed and empty model output without fallback", async () => {
    const malformed = vi.fn(async (url: string | URL | Request) => String(url) === signedUrl
      ? new Response(new Uint8Array([1]))
      : Response.json({ candidates: [{ content: { parts: [{ text: "" }] } }] })) as unknown as typeof fetch;
    await expect(new GeminiVisualSemanticProvider(apiKey, "gemini-test-model", malformed).analyzeVisual({ walkthroughId: "walk", mediaUrl: signedUrl, idempotencyKey: "key" }))
      .rejects.toMatchObject({ code: "PROVIDER_RESULT_INVALID", retryable: false });
  });

  it("classifies transient provider responses and transport timeouts without redispatching", async () => {
    const unavailable = vi.fn(async (url: string | URL | Request) => String(url) === signedUrl
      ? new Response(new Uint8Array([1]))
      : new Response("temporarily unavailable", { status: 503 })) as unknown as typeof fetch;
    await expect(new GeminiVisualSemanticProvider(apiKey, "gemini-test-model", unavailable).analyzeVisual({ walkthroughId: "walk", mediaUrl: signedUrl, idempotencyKey: "key" }))
      .rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    expect(unavailable).toHaveBeenCalledTimes(2);

    const timedOut = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === signedUrl) return new Response(new Uint8Array([1]));
      throw new DOMException("timed out", "TimeoutError");
    }) as unknown as typeof fetch;
    await expect(new GeminiVisualSemanticProvider(apiKey, "gemini-test-model", timedOut).analyzeVisual({ walkthroughId: "walk", mediaUrl: signedUrl, idempotencyKey: "key" }))
      .rejects.toMatchObject({ code: "PROVIDER_TIMEOUT", retryable: true });
    expect(timedOut).toHaveBeenCalledTimes(2);
  });

  it("fails closed in live mode when the Gemini key is absent", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/sitethread");
    vi.stubEnv("R2_BUCKET_NAME", "sitethread-media");
    vi.stubEnv("MEDIA_PROVIDER_MODE", "live");
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(() => configuredVisualSemanticProvider()).toThrowError(SiteThreadError);
    try { configuredVisualSemanticProvider(); } catch (error) { expect(error).toMatchObject({ code: "PROVIDER_CONTRACT_UNRESOLVED" }); }
    vi.unstubAllEnvs();
  });

  it("keeps fixture mode independent of Gemini configuration", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/sitethread");
    vi.stubEnv("R2_BUCKET_NAME", "sitethread-media");
    vi.stubEnv("MEDIA_PROVIDER_MODE", "fixture");
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(configuredVisualSemanticProvider()).toBeDefined();
    vi.unstubAllEnvs();
  });
});
