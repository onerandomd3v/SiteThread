import { z } from "zod";
import { parseServerEnv } from "@/lib/config/env";
import { SiteThreadError, type SiteThreadErrorCode } from "@/lib/errors";
import { ProviderTranscriptResultSchema, ProviderVisionResultSchema } from "@/lib/schemas/provider";
import { FixtureMediaIntelligenceProvider } from "./fixture";
import { sanitizeProviderResponse, sanitizeResultText } from "./sanitize";
import type { MediaCapabilities, MediaIntelligenceProvider, ProviderResult, SafeJson, TranscriptionInput, VisualAnalysisInput } from "./types";

const PROTOCOL = "2024-11-05";
const LIVEPEER_MCP_ORIGIN = "https://agent.livepeer.org";
const CAPABILITIES = { TRANSCRIPTION: "nemotron-asr", VISION: "marlin-video" } as const;
const MODELS = { "nemotron-asr": "nvidia/nemotron-asr-multilingual/asr", "marlin-video": "fal-ai/marlin" } as const;
const VISUAL_PROMPT = "Describe visible conditions and list time-ranged events. Do not make safety, code-compliance, completion, or approval claims.";

const rpcEnvelope = z.object({ jsonrpc: z.literal("2.0"), result: z.unknown().optional(), error: z.unknown().optional() }).passthrough();
const toolEnvelope = z.object({ isError: z.boolean().optional(), structuredContent: z.unknown().optional() }).passthrough();
const capabilityOutput = z.object({ ok: z.literal(true), capability: z.string(), output_kind: z.literal("text"), result: z.object({ text: z.string().trim().min(1) }).passthrough(), status: z.string().optional() }).passthrough();

export class ProviderCallError extends SiteThreadError {
  readonly rawResponse: SafeJson;
  constructor(message: string, code: SiteThreadErrorCode, retryable: boolean, rawResponse: unknown = null) {
    super(message, code, retryable);
    this.rawResponse = sanitizeProviderResponse(rawResponse);
  }
}

function classifyProviderFailure(payload: unknown): ProviderCallError {
  const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const code = String(value.code ?? value.error_code ?? "").toLowerCase();
  const explicitRetryable = typeof value.retryable === "boolean" ? value.retryable : false;
  if (/auth|unauthorized|forbidden|credit|payment/.test(code)) return new ProviderCallError("Livepeer authorization is unavailable.", "PROVIDER_AUTH", false, payload);
  if (/media|not_found|inaccessible/.test(code)) return new ProviderCallError("Livepeer could not access the private media.", "MEDIA_UNAVAILABLE", false, payload);
  if (/invalid|param|schema|capability/.test(code)) return new ProviderCallError("Livepeer rejected the media request.", "PROVIDER_INVALID_INPUT", false, payload);
  return new ProviderCallError("Livepeer media processing failed.", "PROVIDER_UNAVAILABLE", explicitRetryable, payload);
}

function allStringValues(input: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof input === "string") {
    if (input.startsWith("{") || input.startsWith("[")) {
      try { return allStringValues(JSON.parse(input) as unknown, depth + 1); } catch { return [input]; }
    }
    return [input];
  }
  if (Array.isArray(input)) return input.flatMap((value) => allStringValues(value, depth + 1));
  if (input && typeof input === "object") return Object.values(input).flatMap((value) => allStringValues(value, depth + 1));
  return [];
}

class RawMcpTransport {
  private nextId = 1;
  private sessionId: string | undefined;
  constructor(private readonly endpoint: string, private readonly bearer: string | undefined, private readonly fetcher: typeof fetch) {}

  private async post(body: unknown, timeoutMs: number): Promise<unknown> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", "MCP-Protocol-Version": PROTOCOL };
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new ProviderCallError("Livepeer timed out while processing media.", "PROVIDER_TIMEOUT", true);
      throw new ProviderCallError("Livepeer could not be reached.", "PROVIDER_UNAVAILABLE", true);
    }
    const sessionId = response.headers.get("Mcp-Session-Id");
    if (sessionId) this.sessionId = sessionId;
    if (!response.ok) {
      const safeStatus = { httpStatus: response.status };
      if (response.status === 401 || response.status === 403) throw new ProviderCallError("Livepeer authorization is unavailable.", "PROVIDER_AUTH", false, safeStatus);
      if (response.status === 404) throw new ProviderCallError("Livepeer media or capability is unavailable.", "MEDIA_UNAVAILABLE", false, safeStatus);
      if (response.status === 400 || response.status === 422) throw new ProviderCallError("Livepeer rejected the media request.", "PROVIDER_INVALID_INPUT", false, safeStatus);
      throw new ProviderCallError("Livepeer is temporarily unavailable.", "PROVIDER_UNAVAILABLE", response.status === 429 || response.status >= 500, safeStatus);
    }
    if (response.status === 202 || response.status === 204) return null;
    let bodyText: string;
    try { bodyText = await response.text(); } catch { throw new ProviderCallError("Livepeer returned an unreadable result.", "PROVIDER_RESULT_INVALID", false); }
    try { return JSON.parse(bodyText) as unknown; } catch { throw new ProviderCallError("Livepeer returned an invalid result.", "PROVIDER_RESULT_INVALID", false); }
  }

  async request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    const envelope = rpcEnvelope.safeParse(await this.post({ jsonrpc: "2.0", id: this.nextId++, method, params }, timeoutMs));
    if (!envelope.success) throw new ProviderCallError("Livepeer returned an invalid protocol result.", "PROVIDER_RESULT_INVALID", false);
    if (envelope.data.error) throw classifyProviderFailure(envelope.data.error);
    if (envelope.data.result === undefined) throw new ProviderCallError("Livepeer returned no protocol result.", "PROVIDER_RESULT_INVALID", false);
    return envelope.data.result;
  }

  async initialize(): Promise<void> {
    await this.request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "sitethread", version: "1.0.0" } });
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, 30_000);
  }
}

export class LivepeerMediaIntelligenceProvider implements MediaIntelligenceProvider {
  private transport: RawMcpTransport;
  private initialized = false;
  constructor(endpoint: string, bearer?: string, fetcher: typeof fetch = fetch) {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new SiteThreadError("The selected Livepeer endpoint is not configured.", "PROVIDER_CONTRACT_UNRESOLVED");
    }
    if (
      url.origin !== LIVEPEER_MCP_ORIGIN
      || url.port
      || url.username
      || url.password
      || url.pathname !== "/api/mcp/raw"
      || url.search
      || url.hash
    ) throw new SiteThreadError("The selected Livepeer endpoint is not configured.", "PROVIDER_CONTRACT_UNRESOLVED");
    this.transport = new RawMcpTransport(endpoint, bearer, fetcher);
  }

  async discoverCapabilities(): Promise<MediaCapabilities> {
    if (!this.initialized) {
      await this.transport.initialize();
      this.initialized = true;
    }
    const tools = await this.transport.request("tools/list", {});
    const toolNames = allStringValues(tools);
    if (!toolNames.includes("run_capability") || !toolNames.includes("list_capabilities")) throw new ProviderCallError("Livepeer required tools are unavailable.", "PROVIDER_CONTRACT_UNRESOLVED", false);
    const listed = await this.transport.request("tools/call", { name: "list_capabilities", arguments: {} });
    const listing = toolEnvelope.safeParse(listed);
    if (!listing.success || listing.data.isError) throw new ProviderCallError("Livepeer capability discovery failed.", "PROVIDER_CONTRACT_UNRESOLVED", false, listed);
    const names = allStringValues(listed);
    if (!names.includes(CAPABILITIES.TRANSCRIPTION) || !names.includes(CAPABILITIES.VISION)) throw new ProviderCallError("Livepeer required capabilities are unavailable.", "PROVIDER_CONTRACT_UNRESOLVED", false);
    return { discoveredAt: new Date(), requirements: {
      TRANSCRIPTION: { capabilityId: CAPABILITIES.TRANSCRIPTION, modelId: MODELS[CAPABILITIES.TRANSCRIPTION] },
      VISION: { capabilityId: CAPABILITIES.VISION, modelId: MODELS[CAPABILITIES.VISION] },
    } };
  }

  private async runCapability(capability: "nemotron-asr" | "marlin-video", args: Record<string, unknown>, idempotencyKey: string, deadlineMs: number, attempt = 0): Promise<ProviderResult<{ text: string; eventRange?: { startSeconds: number; endSeconds: number } }>> {
    if (!this.initialized) await this.discoverCapabilities();
    const started = Date.now();
    let raw: unknown;
    try {
      raw = await this.transport.request("tools/call", { name: "run_capability", arguments: args }, deadlineMs);
    } catch (error) {
      if (error instanceof ProviderCallError && error.retryable && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return this.runCapability(capability, args, idempotencyKey, deadlineMs, 1);
      }
      throw error;
    }
    const tool = toolEnvelope.safeParse(raw);
    if (!tool.success) throw new ProviderCallError("Livepeer returned an invalid tool result.", "PROVIDER_RESULT_INVALID", false, raw);
    if (tool.data.isError) throw classifyProviderFailure(tool.data.structuredContent ?? raw);
    const content = tool.data.structuredContent;
    const contentObject = content && typeof content === "object" ? content as Record<string, unknown> : {};
    if (contentObject.ok !== true) throw classifyProviderFailure(content);
    const status = typeof contentObject.status === "string" ? contentObject.status.toLowerCase() : undefined;
    const resultStatus = contentObject.result && typeof contentObject.result === "object" && typeof (contentObject.result as Record<string, unknown>).status === "string"
      ? String((contentObject.result as Record<string, unknown>).status).toLowerCase() : undefined;
    if (status === "failed" || resultStatus === "failed") throw classifyProviderFailure(content);
    if (["submitted", "running", "queued", "pending"].includes(status ?? "") || ["submitted", "running", "queued", "pending"].includes(resultStatus ?? "")) {
      throw new ProviderCallError("Livepeer did not return a completed synchronous media result.", "PROVIDER_RESULT_INVALID", false, content);
    }
    const parsed = capabilityOutput.safeParse(content);
    if (!parsed.success || parsed.data.capability !== capability) throw new ProviderCallError("Livepeer returned an unexpected media result.", "PROVIDER_RESULT_INVALID", false, content);
    const text = sanitizeResultText(parsed.data.result.text).trim();
    if (text.startsWith("[redacted ") || !text) throw new ProviderCallError("Livepeer returned no usable media result.", "PROVIDER_RESULT_INVALID", false, content);
    const match = /<\s*([+-]?\d+(?:\.\d+)?)\s*-\s*([+-]?\d+(?:\.\d+)?)\s*>/.exec(text);
    const eventRange = match ? { startSeconds: Number(match[1]), endSeconds: Number(match[2]) } : undefined;
    return { value: { text, eventRange }, diagnostic: { provider: "livepeer", capability, idempotencyKey, rawResponse: sanitizeProviderResponse(raw), latencyMs: Date.now() - started } };
  }

  async transcribe(input: TranscriptionInput) {
    const result = await this.runCapability("nemotron-asr", { capability: "nemotron-asr", source_url: input.audioUrl, inputs: { audio_url: input.audioUrl, language: "en-US" }, async: false, timeout: 60, persist: false, session_id: input.walkthroughId, idempotency_key: input.idempotencyKey }, input.idempotencyKey, 90_000);
    return { ...result, value: ProviderTranscriptResultSchema.parse({ text: result.value.text }) };
  }

  async analyzeVisual(input: VisualAnalysisInput) {
    const result = await this.runCapability("marlin-video", { capability: "marlin-video", prompt: VISUAL_PROMPT, inputs: { video_url: input.mediaUrl, do_sample: false, max_tokens: 250 }, async: false, timeout: 260, persist: false, session_id: input.walkthroughId, idempotency_key: input.idempotencyKey }, input.idempotencyKey, 300_000);
    return { ...result, value: ProviderVisionResultSchema.parse({ text: result.value.text, eventRange: result.value.eventRange }) };
  }
}

export function configuredMediaProvider(): MediaIntelligenceProvider {
  const env = parseServerEnv();
  if (env.MEDIA_PROVIDER_MODE === "fixture") return new FixtureMediaIntelligenceProvider();
  if (process.env.NODE_ENV === "production" && !env.LIVEPEER_MCP_BEARER) throw new SiteThreadError("Livepeer production credentials are not configured.", "PROVIDER_AUTH");
  return new LivepeerMediaIntelligenceProvider(env.LIVEPEER_MCP_URL, env.LIVEPEER_MCP_BEARER);
}
