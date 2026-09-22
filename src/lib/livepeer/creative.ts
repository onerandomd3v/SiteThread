import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { parseServerEnv } from "@/lib/config/env";
import { SiteThreadError } from "@/lib/errors";
import { ProviderTranscriptResultSchema } from "@/lib/schemas/provider";
import { sanitizeProviderResponse } from "./sanitize";
import type { MediaCapabilities, ProviderResult, SafeJson, TranscriptionInput, TranscriptionProvider } from "./types";
import { ProviderCallError, withProviderAttribution } from "./provider-errors";

export const CREATIVE_MCP_ENDPOINT = "https://agent.livepeer.org/api/mcp/creative";
export const CREATIVE_TRANSCRIBE_CAPABILITY = "creative/transcribe";
const CREATIVE_TOOLS = ["transcribe", "get_pricing", "spend_cap"] as const;

const transcribeResultSchema = z.object({
  text: z.string().trim().min(1),
  cues: z.array(z.unknown()).optional(),
  srt: z.string().optional(),
  language: z.string().nullable().optional(),
}).passthrough();

const pricingSchema = z.object({
  capabilities: z.array(z.object({
    name: z.string(),
    display_price_usd: z.number().nullable().optional(),
    display_unit: z.string().nullable().optional(),
    price_source: z.string().optional(),
  }).passthrough()).optional(),
}).passthrough();

const balanceSchema = z.object({
  remaining_usd: z.number().finite().nonnegative(),
  allowance_usd: z.number().finite().nonnegative().optional(),
}).passthrough();

export interface CreativeMcpSession {
  listTools(): Promise<ListToolsResult>;
  callTool(name: string, args: Record<string, unknown>, options?: { timeout?: number; maxTotalTimeout?: number }): Promise<CallToolResult>;
  close(): Promise<void>;
}

export type CreativeMcpSessionFactory = (endpoint: string) => Promise<CreativeMcpSession>;

function toolResultContent(result: CallToolResult, operation: string): Record<string, unknown> {
  if (result.isError) throw classifyCreativeError(result, operation);
  if (!result.structuredContent || typeof result.structuredContent !== "object") {
    throw new ProviderCallError(`Livepeer creative ${operation} returned no structured result.`, "PROVIDER_RESULT_INVALID", false, result);
  }
  return result.structuredContent as Record<string, unknown>;
}

function classifyCreativeError(error: unknown, operation: string): ProviderCallError {
  if (error instanceof ProviderCallError) return error;
  const message = error instanceof Error ? error.message : "";
  if (/timeout|timed out|abort/i.test(message)) return new ProviderCallError(`Livepeer creative ${operation} timed out before a response was confirmed.`, "PROVIDER_UNCERTAIN_DELIVERY", false, { message });
  const detail = `${message} ${JSON.stringify(error)}`;
  if (/401|403|unauthori[sz]ed|forbidden|credit|payment|balance|billing/i.test(detail)) return new ProviderCallError(`Livepeer creative ${operation} authorization or billing failed.`, "PROVIDER_AUTH", false, { message: detail.slice(0, 500) });
  return new ProviderCallError(`Livepeer creative ${operation} failed.`, "PROVIDER_UNAVAILABLE", true, { message });
}

export async function createCreativeMcpSession(endpoint: string, fetcher: typeof fetch = fetch): Promise<CreativeMcpSession> {
  let client: Client | undefined;
  let transport: StreamableHTTPClientTransport | undefined;
  try {
    client = new Client({ name: "sitethread", version: "1.0.0" });
    transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      // No authProvider or Authorization header: the hackathon creative session is keyless.
      fetch: fetcher,
      reconnectionOptions: { maxReconnectionDelay: 250, initialReconnectionDelay: 100, reconnectionDelayGrowFactor: 1, maxRetries: 0 },
    });
    await client.connect(transport, { timeout: 30_000, maxTotalTimeout: 30_000, signal: AbortSignal.timeout(30_000) });
    return {
      listTools: () => client!.listTools({ cursor: undefined }, { timeout: 30_000, maxTotalTimeout: 30_000 }),
      callTool: async (name, args, options) => {
        const result = await client!.callTool({ name, arguments: args }, undefined, { timeout: options?.timeout ?? 90_000, maxTotalTimeout: options?.maxTotalTimeout ?? 90_000 });
        if ("toolResult" in result) throw new ProviderCallError("Livepeer returned an unsupported task result for creative transcription.", "PROVIDER_RESULT_INVALID", false, result);
        return result;
      },
      close: async () => {
        await client?.close().catch(() => undefined);
        await transport?.close().catch(() => undefined);
      },
    };
  } catch (error) {
    await client?.close().catch(() => undefined);
    await transport?.close().catch(() => undefined);
    throw classifyCreativeError(error, "connection");
  }
}

function validateEndpoint(endpoint: string): void {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new SiteThreadError("The selected Livepeer creative endpoint is not configured.", "PROVIDER_CONTRACT_UNRESOLVED"); }
  if (url.origin !== "https://agent.livepeer.org" || url.pathname !== "/api/mcp/creative" || url.search || url.hash || url.username || url.password || url.port) {
    throw new SiteThreadError("The selected Livepeer creative endpoint is not configured.", "PROVIDER_CONTRACT_UNRESOLVED");
  }
}

function requiredTools(listed: ListToolsResult): void {
  const names = new Set(listed.tools.map((tool) => tool.name));
  if (CREATIVE_TOOLS.some((tool) => !names.has(tool))) throw new ProviderCallError("Livepeer creative transcription tools are unavailable.", "PROVIDER_CONTRACT_UNRESOLVED", false, { tools: [...names] });
}

function resultMetadata(result: Record<string, unknown>): SafeJson {
  return sanitizeProviderResponse(result);
}

async function readPricingAndBalance(session: CreativeMcpSession): Promise<{ pricing: SafeJson; balance: SafeJson }> {
  let pricingResult: CallToolResult;
  let balanceResult: CallToolResult;
  try {
    [pricingResult, balanceResult] = await Promise.all([
      session.callTool("get_pricing", { name: "wizper", bypass_cache: true }, { timeout: 30_000, maxTotalTimeout: 30_000 }),
      session.callTool("spend_cap", { action: "read" }, { timeout: 30_000, maxTotalTimeout: 30_000 }),
    ]);
  } catch (error) {
    throw classifyCreativeError(error, "pricing preflight");
  }
  const pricing = toolResultContent(pricingResult, "pricing");
  const balance = toolResultContent(balanceResult, "balance");
  const parsedBalance = balanceSchema.safeParse(balance);
  if (!parsedBalance.success || parsedBalance.data.remaining_usd <= 0) throw new ProviderCallError("Livepeer creative demo balance is unavailable.", "PROVIDER_AUTH", false, balance);
  const parsedPricing = pricingSchema.safeParse(pricing);
  return { pricing: resultMetadata(parsedPricing.success ? parsedPricing.data : pricing), balance: resultMetadata(balance) };
}

export class CreativeTranscriptionProvider implements TranscriptionProvider {
  constructor(private readonly endpoint: string, private readonly sessionFactory: CreativeMcpSessionFactory = createCreativeMcpSession) {
    validateEndpoint(endpoint);
  }

  async discoverCapabilities(): Promise<MediaCapabilities> {
    let session: CreativeMcpSession | undefined;
    try {
      session = await this.sessionFactory(this.endpoint);
      const listed = await session.listTools();
      requiredTools(listed);
      return { discoveredAt: new Date(), requirements: { TRANSCRIPTION: { capabilityId: CREATIVE_TRANSCRIBE_CAPABILITY, modelId: "creative-mcp" } } };
    } catch (error) {
      throw classifyCreativeError(error, "capability discovery");
    } finally {
      await session?.close().catch(() => undefined);
    }
  }

  async transcribe(input: TranscriptionInput): Promise<ProviderResult<z.infer<typeof ProviderTranscriptResultSchema>>> {
    let session: CreativeMcpSession | undefined;
    let transcribeDispatched = false;
    const started = Date.now();
    try {
      session = await this.sessionFactory(this.endpoint);
      const listed = await session.listTools();
      requiredTools(listed);
      const preflight = await readPricingAndBalance(session);
      transcribeDispatched = true;
      const response = await session.callTool("transcribe", { source_url: input.audioUrl, granularity: "segment", burn: false }, { timeout: 90_000, maxTotalTimeout: 90_000 });
      const content = toolResultContent(response, "transcription");
      const parsed = transcribeResultSchema.safeParse(content);
      if (!parsed.success) throw new ProviderCallError("Livepeer creative transcription returned an invalid result.", "PROVIDER_RESULT_INVALID", false, content);
      return {
        value: ProviderTranscriptResultSchema.parse({ text: parsed.data.text }),
        diagnostic: {
          provider: "livepeer",
          capability: CREATIVE_TRANSCRIBE_CAPABILITY,
          idempotencyKey: input.idempotencyKey,
          rawResponse: sanitizeProviderResponse({ operation: "creative/transcribe", result: content, pricing: preflight.pricing, balance: preflight.balance }),
          latencyMs: Date.now() - started,
        },
      };
    } catch (error) {
      const classified = classifyCreativeError(error, "transcription");
      if (transcribeDispatched && classified.code !== "PROVIDER_RESULT_INVALID") {
        throw new ProviderCallError("Livepeer creative transcription delivery is uncertain; no automatic paid retry was attempted.", "PROVIDER_UNCERTAIN_DELIVERY", false, classified.rawResponse);
      }
      throw withProviderAttribution(classified, { provider: "livepeer", capability: CREATIVE_TRANSCRIBE_CAPABILITY });
    } finally {
      await session?.close().catch(() => undefined);
    }
  }
}

export function configuredCreativeTranscriptionProvider(): CreativeTranscriptionProvider {
  const env = parseServerEnv();
  return new CreativeTranscriptionProvider(env.LIVEPEER_CREATIVE_MCP_URL ?? CREATIVE_MCP_ENDPOINT);
}
