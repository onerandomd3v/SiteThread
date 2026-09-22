import { z } from "zod";
import { ProviderVisionResultSchema } from "@/lib/schemas/provider";
import { ProviderCallError } from "./provider-errors";
import { sanitizeProviderResponse } from "./sanitize";
import type { ProviderResult, VisualAnalysisInput, VisualSemanticProvider } from "./types";

export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";
// Keep the complete inline JSON request below Google's 20 MB inline guidance.
export const GEMINI_MAX_INLINE_VIDEO_BYTES = 14 * 1024 * 1024;
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_TIMEOUT_MS = 60_000;
const VISUAL_PROMPT = [
  "Describe only visible, construction-relevant conditions in this six-second video clip.",
  "Return concise prose grounded in what is visibly present, such as materials, workers, progress, or a visible condition.",
  "Do not make safety, code-compliance, inspection-approval, engineering-acceptance, or certification claims.",
  "Do not provide completion percentages, measurements, causes, responsibility, or conclusions that are not visibly supported.",
  "Do not invent timestamps, locations, trades, or actions. SiteThread supplies the authoritative source range.",
].join(" ");

const candidateSchema = z.object({
  content: z.object({
    parts: z.array(z.object({ text: z.string().optional() }).passthrough()).optional(),
  }).passthrough().optional(),
  finishReason: z.string().optional(),
}).passthrough();

const geminiResponseSchema = z.object({
  candidates: z.array(candidateSchema).optional(),
  modelVersion: z.string().optional(),
  responseId: z.string().optional(),
  usageMetadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

type Fetcher = typeof fetch;

function providerError(message: string, code: ConstructorParameters<typeof ProviderCallError>[1], retryable: boolean, response?: unknown): ProviderCallError {
  return new ProviderCallError(message, code, retryable, response);
}

async function readBoundedBytes(response: Response): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number.isFinite(Number(contentLength)) && Number(contentLength) > GEMINI_MAX_INLINE_VIDEO_BYTES) {
    throw providerError("The visual evidence clip exceeds the inline Gemini media limit.", "PROVIDER_INVALID_INPUT", false, { contentLength });
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > GEMINI_MAX_INLINE_VIDEO_BYTES) throw providerError("The visual evidence clip exceeds the inline Gemini media limit.", "PROVIDER_INVALID_INPUT", false);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > GEMINI_MAX_INLINE_VIDEO_BYTES) {
        await reader.cancel();
        throw providerError("The visual evidence clip exceeds the inline Gemini media limit.", "PROVIDER_INVALID_INPUT", false);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw providerError("Gemini returned an invalid result.", "PROVIDER_RESULT_INVALID", false);
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export class GeminiVisualSemanticProvider implements VisualSemanticProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = GEMINI_DEFAULT_MODEL,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async analyzeVisual(input: VisualAnalysisInput): Promise<ProviderResult<z.infer<typeof ProviderVisionResultSchema>>> {
    const started = Date.now();
    let mediaResponse: Response;
    try {
      mediaResponse = await this.fetcher(input.mediaUrl, { signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS) });
    } catch (error) {
      if (error instanceof ProviderCallError) throw error;
      throw providerError("The private visual evidence clip could not be fetched.", "MEDIA_UNAVAILABLE", true);
    }
    if (!mediaResponse.ok) {
      throw providerError("The private visual evidence clip could not be fetched.", "MEDIA_UNAVAILABLE", mediaResponse.status === 429 || mediaResponse.status >= 500, { httpStatus: mediaResponse.status });
    }
    let bytes: Uint8Array;
    try {
      bytes = await readBoundedBytes(mediaResponse);
    } catch (error) {
      if (error instanceof ProviderCallError) throw error;
      throw providerError("The private visual evidence clip could not be read.", "MEDIA_UNAVAILABLE", true);
    }
    if (bytes.byteLength === 0) throw providerError("The visual evidence clip is empty.", "PROVIDER_INVALID_INPUT", false);

    const endpoint = `${GEMINI_ENDPOINT}/${encodeURIComponent(this.model)}:generateContent`;
    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: "video/mp4", data: Buffer.from(bytes).toString("base64") } },
            { text: VISUAL_PROMPT },
          ] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
        }),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof ProviderCallError) throw error;
      throw providerError(isTimeout(error) ? "Gemini timed out while analyzing the visual clip." : "Gemini could not be reached.", isTimeout(error) ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE", true);
    }
    let raw: unknown;
    try {
      raw = await readJson(response);
    } catch (error) {
      if (response.ok) throw error;
      raw = { httpStatus: response.status };
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw providerError("Gemini authorization is unavailable.", "PROVIDER_AUTH", false, { httpStatus: response.status, response: raw });
      throw providerError("Gemini visual analysis is temporarily unavailable.", "PROVIDER_UNAVAILABLE", response.status === 429 || response.status >= 500, { httpStatus: response.status, response: raw });
    }
    const parsed = geminiResponseSchema.safeParse(raw);
    if (!parsed.success) throw providerError("Gemini returned an invalid visual result.", "PROVIDER_RESULT_INVALID", false, raw);
    const text = parsed.data.candidates?.flatMap((candidate) => candidate.content?.parts?.map((part) => part.text ?? []) ?? []).join(" ").trim() ?? "";
    if (!text) throw providerError("Gemini returned no usable visual result.", "PROVIDER_RESULT_INVALID", false, raw);
    const value = ProviderVisionResultSchema.parse({ text });
    return {
      value,
      diagnostic: {
        provider: "google-gemini",
        capability: "gemini-video-understanding",
        idempotencyKey: input.idempotencyKey,
        rawResponse: sanitizeProviderResponse({ model: this.model, modelVersion: parsed.data.modelVersion, responseId: parsed.data.responseId, usageMetadata: parsed.data.usageMetadata, finishReasons: parsed.data.candidates?.map((candidate) => candidate.finishReason).filter(Boolean), response: { text } }),
        latencyMs: Date.now() - started,
      },
    };
  }
}
