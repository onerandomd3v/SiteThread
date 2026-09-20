import { createHash } from "node:crypto";
import { z } from "zod";
import { parseServerEnv } from "@/lib/config/env";
import { SiteThreadError } from "@/lib/errors";
import { ObservationReasoningOutputSchema } from "@/lib/schemas/observation-reasoning";
import { ProviderCallError, RawMcpTransport, validateLivepeerEndpoint } from "@/lib/livepeer/provider";
import { sanitizeProviderResponse, sanitizeResultText } from "@/lib/livepeer/sanitize";
import type { SafeJson } from "@/lib/livepeer/types";
import type { ObservationReasoner, ObservationReasoningInput } from "./types";

const GEMINI_CAPABILITY = "gemini-text";
const GEMINI_TIMEOUT_SECONDS = 36;
const REASONING_PROMPT = `You prepare construction observation drafts for a human site supervisor. Use only the labeled transcript and visual evidence supplied below. Return exactly one JSON object with an observations array. Each observation must use type progress, potential_issue, action, or note; a concise description; and one or more evidenceRefs copied exactly from the supplied T0/V0 labels. Location, trade, confidence (0 to 1), and suggestedAction are optional. Never invent locations, trades, quantities, completion percentages, causes, deadlines, code violations, safety conclusions, inspection approvals, engineering acceptance, or financial claims. Do not add timestamps or database IDs. Narration is not visual confirmation. An action is only a proposed professional follow-up. If no grounded finding is supported, return {"observations":[]}.`;

const toolEnvelope = z.object({ isError: z.boolean().optional(), structuredContent: z.unknown().optional() }).passthrough();

function hashKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function allStringValues(input: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof input === "string") return [input];
  if (Array.isArray(input)) return input.flatMap((value) => allStringValues(value, depth + 1));
  if (input && typeof input === "object") return Object.values(input).flatMap((value) => allStringValues(value, depth + 1));
  return [];
}

function providerResultContent(raw: unknown): Record<string, unknown> {
  const envelope = toolEnvelope.safeParse(raw);
  if (!envelope.success || envelope.data.isError) throw new ProviderCallError("Livepeer returned an invalid reasoning result.", "PROVIDER_RESULT_INVALID", false, raw);
  const content = envelope.data.structuredContent;
  return content && typeof content === "object" ? content as Record<string, unknown> : {};
}

function parseReasoningOutput(text: string, raw: unknown) {
  try {
    return ObservationReasoningOutputSchema.parse(JSON.parse(text) as unknown);
  } catch {
    throw new ProviderCallError("Livepeer returned malformed observation drafts.", "PROVIDER_RESULT_INVALID", false, raw);
  }
}

export class FixtureObservationReasoner implements ObservationReasoner {
  async extract(input: ObservationReasoningInput) {
    const observations = [];
    for (let index = 0; index < input.evidence.length && observations.length < 20; index += 12) {
      const chunk = input.evidence.slice(index, index + 12);
      if (chunk.length === 0) continue;
      observations.push({
        type: "note" as const,
        description: chunk[0].text,
        evidenceRefs: chunk.map((evidence) => evidence.ref),
      });
    }
    return {
      value: ObservationReasoningOutputSchema.parse({ observations }),
      diagnostic: { provider: "fixture", capability: GEMINI_CAPABILITY, idempotencyKey: input.idempotencyKey, rawResponse: { fixture: true } as SafeJson, latencyMs: 0 },
    };
  }
}

export class LivepeerObservationReasoner implements ObservationReasoner {
  private readonly transport: RawMcpTransport;
  private initialized = false;

  constructor(endpoint: string, bearer?: string, fetcher: typeof fetch = fetch) {
    validateLivepeerEndpoint(endpoint);
    this.transport = new RawMcpTransport(endpoint, bearer, fetcher);
  }

  private async discover(): Promise<void> {
    if (this.initialized) return;
    await this.transport.initialize();
    const tools = await this.transport.request("tools/list", {});
    const names = allStringValues(tools);
    if (!names.includes("run_capability") || !names.includes("list_capabilities") || !names.includes("describe_capability")) {
      throw new ProviderCallError("Livepeer reasoning tools are unavailable.", "PROVIDER_CONTRACT_UNRESOLVED", false);
    }
    const listed = providerResultContent(await this.transport.request("tools/call", { name: "list_capabilities", arguments: {} }));
    if (!allStringValues(listed).includes(GEMINI_CAPABILITY)) throw new ProviderCallError("Livepeer text reasoning is unavailable.", "PROVIDER_CONTRACT_UNRESOLVED", false);
    const described = providerResultContent(await this.transport.request("tools/call", { name: "describe_capability", arguments: { name: GEMINI_CAPABILITY } }));
    if (described.name !== GEMINI_CAPABILITY || described.found !== true || described.modality !== "text" || described.output_kind !== "text" || described.invoke_via !== "run_capability") {
      throw new ProviderCallError("Livepeer text reasoning contract is unresolved.", "PROVIDER_CONTRACT_UNRESOLVED", false, described);
    }
    this.initialized = true;
  }

  async extract(input: ObservationReasoningInput) {
    await this.discover();
    const idempotencyKey = input.idempotencyKey;
    const started = Date.now();
    const promptEvidence = input.evidence.map(({ ref, kind, text }) => ({ ref, kind, text: sanitizeResultText(text) }));
    let raw: unknown;
    try {
      raw = await this.transport.request("tools/call", {
        name: "run_capability",
        arguments: {
          capability: GEMINI_CAPABILITY,
          prompt: `${REASONING_PROMPT}\n\nEvidence:\n${JSON.stringify(promptEvidence)}`,
          inputs: { temperature: 0, max_tokens: 2000 },
          async: false,
          timeout: GEMINI_TIMEOUT_SECONDS,
          persist: false,
          session_id: hashKey("session", idempotencyKey),
          idempotency_key: idempotencyKey,
        },
      }, 60_000);
    } catch (error) {
      if (error instanceof ProviderCallError) throw error;
      throw new ProviderCallError("Livepeer observation reasoning failed.", "PROVIDER_UNAVAILABLE", true);
    }
    const content = providerResultContent(raw);
    if (content.ok !== true || content.capability !== GEMINI_CAPABILITY || content.output_kind !== "text") throw new ProviderCallError("Livepeer returned an unexpected reasoning result.", "PROVIDER_RESULT_INVALID", false, raw);
    const result = content.result && typeof content.result === "object" ? content.result as Record<string, unknown> : {};
    const explicitStatuses = [content.status, result.status].filter((status) => status !== undefined);
    const terminalStatuses = new Set(["success", "succeeded", "complete", "completed", "done", "ok"]);
    if (explicitStatuses.some((status) => typeof status !== "string" || !terminalStatuses.has(status.toLowerCase()))) throw new ProviderCallError("Livepeer returned a nonterminal reasoning result.", "PROVIDER_RESULT_INVALID", false, raw);
    if (typeof result.text !== "string" || !result.text.trim()) throw new ProviderCallError("Livepeer returned no observation drafts.", "PROVIDER_RESULT_INVALID", false, raw);
    const value = parseReasoningOutput(result.text.trim(), raw);
    return { value, diagnostic: { provider: "livepeer", capability: GEMINI_CAPABILITY, idempotencyKey, rawResponse: sanitizeProviderResponse(raw), latencyMs: Date.now() - started } };
  }
}

export function configuredObservationReasoner(): ObservationReasoner {
  const env = parseServerEnv();
  if (env.MEDIA_PROVIDER_MODE === "fixture") return new FixtureObservationReasoner();
  if (process.env.NODE_ENV === "production" && !env.LIVEPEER_MCP_BEARER) throw new SiteThreadError("Livepeer production credentials are not configured.", "PROVIDER_AUTH");
  return new LivepeerObservationReasoner(env.LIVEPEER_MCP_URL, env.LIVEPEER_MCP_BEARER);
}
