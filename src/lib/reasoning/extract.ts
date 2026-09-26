import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { db } from "@/lib/db/client";
import { SiteThreadError } from "@/lib/errors";
import { ProviderCallError } from "@/lib/livepeer/provider-errors";
import type { ProviderDiagnostic } from "@/lib/livepeer/types";
import { sanitizeProviderResponse } from "@/lib/livepeer/sanitize";
import { logEvent } from "@/lib/observability/log";
import { buildReasoningContext, groundReasonedObservations } from "./grounding";
import { configuredObservationReasoner } from "./reasoner";
import type { ObservationReasoner } from "./types";

export const OBSERVATION_REASONING_VERSION = "observation-v1";

type ExtractionPhase = "load_run" | "load_evidence" | "build_context" | "configure_reasoner" | "provider_reasoning" | "validate_result" | "ground_observations" | "prepare_persistence" | "persist_transaction";

const OBSERVATION_PATH_PARTS = new Set(["observations", "type", "description", "location", "trade", "confidence", "suggestedAction", "evidenceRefs"]);
const SITE_THREAD_ERROR_CODES = new Set([
  "INVALID_INPUT", "NOT_FOUND", "CONFLICT", "MEDIA_UNAVAILABLE", "PROCESSING_FAILED",
  "PROVIDER_CONTRACT_UNRESOLVED", "PROVIDER_AUTH", "PROVIDER_INVALID_INPUT", "PROVIDER_TIMEOUT",
  "PROVIDER_UNCERTAIN_DELIVERY", "PROVIDER_UNAVAILABLE", "PROVIDER_RESULT_INVALID", "INTERNAL_ERROR",
]);

function safeValidationIssues(error: ZodError): string {
  return error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.map((part) => {
      if (typeof part === "number") return String(part);
      if (typeof part !== "string") return "other";
      return OBSERVATION_PATH_PARTS.has(part) ? part : "other";
    }).join(".");
    return `${issue.code}${path ? `@${path}` : ""}`;
  }).join(";");
}

function safeFailureDetails(error: unknown): Record<string, string | number> {
  const details: Record<string, string | number> = {
    errorName: error instanceof Error && ["TypeError", "RangeError", "SyntaxError", "AggregateError"].includes(error.name)
      ? error.name
      : error instanceof ProviderCallError ? "ProviderCallError"
        : error instanceof Prisma.PrismaClientKnownRequestError ? "PrismaClientKnownRequestError"
          : error instanceof Prisma.PrismaClientValidationError ? "PrismaClientValidationError"
            : error instanceof ZodError ? "ZodError"
              : error instanceof SiteThreadError ? "SiteThreadError"
                : error instanceof Error ? "Error" : "NonError",
    errorCategory: error instanceof ProviderCallError ? "provider"
      : error instanceof Prisma.PrismaClientKnownRequestError ? "prisma_request"
        : error instanceof Prisma.PrismaClientValidationError ? "prisma_validation"
          : error instanceof ZodError ? "validation"
            : error instanceof SiteThreadError ? "site_thread"
              : error instanceof Error ? "unclassified_exception" : "non_error_throw",
  };

  if (error instanceof SiteThreadError && SITE_THREAD_ERROR_CODES.has(error.code)) details.errorCode = error.code;
  if (error instanceof Prisma.PrismaClientKnownRequestError && /^P\d{4}$/.test(error.code)) details.errorCode = error.code;
  if (error instanceof ProviderCallError && error.attribution) {
    if (["livepeer", "google-gemini", "groq", "fixture"].includes(error.attribution.provider)) details.provider = error.attribution.provider;
    if (/^[a-z0-9/_-]{1,100}$/i.test(error.attribution.capability)) details.capability = error.attribution.capability;
    const raw = error.rawResponse;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      if (typeof raw.httpStatus === "number" && raw.httpStatus >= 100 && raw.httpStatus <= 599) details.httpStatus = raw.httpStatus;
      if (typeof raw.providerCode === "string" && /^[A-Z0-9_-]{1,80}$/i.test(raw.providerCode)) details.providerErrorCode = raw.providerCode;
    }
  }
  if (error instanceof ZodError) details.validationIssues = safeValidationIssues(error);
  return details;
}

function observationId(runId: string, fingerprint: string, sequence: number): string {
  return `obs_${createHash("sha256").update(`${runId}|${OBSERVATION_REASONING_VERSION}|${fingerprint}|${sequence}`).digest("hex").slice(0, 32)}`;
}

function invocationRange(context: ReturnType<typeof buildReasoningContext>): { startSeconds: number; endSeconds: number } {
  const ranges = [...context.references.values()];
  if (ranges.length === 0) return { startSeconds: 0, endSeconds: 0 };
  return {
    startSeconds: Math.min(...ranges.map((evidence) => evidence.sourceStartSeconds)),
    endSeconds: Math.max(...ranges.map((evidence) => evidence.sourceEndSeconds)),
  };
}

export async function extractObservations(
  runId: string,
  dependencies: { database?: typeof db; reasoner?: ObservationReasoner } = {},
): Promise<void> {
  const database = dependencies.database ?? db;
  let phase: ExtractionPhase = "load_run";
  let provider: string | undefined;
  let capability: string | undefined;
  try {
  const run = await database.processingRun.findUnique({ where: { id: runId } });
  if (!run) throw new SiteThreadError("The processing run was not found.", "NOT_FOUND");
  if (run.status !== "EXTRACTING_OBSERVATIONS") return;

  phase = "load_evidence";
  const [transcriptSegments, visualCandidates] = await Promise.all([
    database.transcriptSegment.findMany({ where: { walkthroughId: run.walkthroughId, processingRunId: runId }, orderBy: { sequence: "asc" } }),
    database.visualCandidate.findMany({ where: { walkthroughId: run.walkthroughId, processingRunId: runId }, orderBy: { sourceStartSeconds: "asc" } }),
  ]);
  phase = "build_context";
  const context = buildReasoningContext({ transcriptSegments, visualCandidates });
  phase = "configure_reasoner";
  const reasoner = dependencies.reasoner ?? configuredObservationReasoner();
  const idempotencyKey = createHash("sha256").update(`${run.id}|${run.pipelineVersion}|${OBSERVATION_REASONING_VERSION}|${context.evidenceFingerprint}`).digest("hex");
  phase = "provider_reasoning";
  logEvent("observation.reasoning.invocation_started", { processingRunId: runId, stage: "EXTRACTING_OBSERVATIONS" });
  const result = await reasoner.extract({
    idempotencyKey,
    evidence: context.evidence,
  });
  provider = result.diagnostic.provider;
  capability = result.diagnostic.capability;
  logEvent("observation.reasoning.provider_completed", { processingRunId: runId, stage: "EXTRACTING_OBSERVATIONS", provider, capability, latencyMs: result.diagnostic.latencyMs });
  phase = "validate_result";
  if (result.diagnostic.idempotencyKey !== idempotencyKey) {
    throw new SiteThreadError("The observation reasoner returned a mismatched idempotency key.", "PROVIDER_RESULT_INVALID");
  }
  logEvent("observation.reasoning.provider_response_validated", { processingRunId: runId, stage: "EXTRACTING_OBSERVATIONS", provider, capability });
  phase = "ground_observations";
  logEvent("observation.reasoning.grounding_started", { processingRunId: runId, stage: "EXTRACTING_OBSERVATIONS" });
  const grounded = groundReasonedObservations(result.value, context, () => {
    logEvent("observation.reasoning.evidence_references_validated", { processingRunId: runId, stage: "EXTRACTING_OBSERVATIONS" });
  });
  logEvent("observation.reasoning.grounding_completed", { processingRunId: runId, stage: "EXTRACTING_OBSERVATIONS", candidateCount: result.value.observations.length, groundedCount: grounded.length });
  phase = "prepare_persistence";
  const range = invocationRange(context);
  const diagnostic: ProviderDiagnostic = result.diagnostic;
  const diagnosticFields = diagnostic.rawResponse !== null
    && typeof diagnostic.rawResponse === "object"
    && !Array.isArray(diagnostic.rawResponse)
    ? diagnostic.rawResponse
    : { providerResponse: diagnostic.rawResponse };
  const diagnosticWithGroundingCounts = {
    ...diagnosticFields,
    siteThreadReasoning: {
      candidateCount: result.value.observations.length,
      groundedCount: grounded.length,
    },
  };

  phase = "persist_transaction";
  logEvent("observation.reasoning.persistence_started", { processingRunId: runId, stage: "EXTRACTING_OBSERVATIONS" });
  await database.$transaction(async (transaction) => {
    const claimed = await transaction.processingRun.updateMany({
      where: { id: runId, status: "EXTRACTING_OBSERVATIONS" },
      data: {
        status: "NEEDS_REVIEW",
        failedStep: null,
        errorCode: null,
        errorMessage: null,
        retryable: null,
        completedAt: new Date(),
      },
    });
    if (claimed.count !== 1) return;
    const rawResponse = sanitizeProviderResponse(diagnosticWithGroundingCounts) as Prisma.InputJsonValue;
    await transaction.providerInvocation.upsert({
      where: { idempotencyKey },
      create: {
        processingRunId: runId,
        idempotencyKey,
        provider: diagnostic.provider,
        capability: diagnostic.capability,
        stage: "EXTRACTING_OBSERVATIONS",
        sourceStartSeconds: range.startSeconds,
        sourceEndSeconds: range.endSeconds,
        status: "SUCCEEDED",
        rawResponse,
        latencyMs: diagnostic.latencyMs,
      },
      update: { status: "SUCCEEDED", rawResponse, latencyMs: diagnostic.latencyMs, errorCode: null, retryable: null },
    });
    await transaction.observation.deleteMany({ where: { processingRunId: runId, reviewState: "DRAFT" } });
    for (const [sequence, observation] of grounded.entries()) {
      await transaction.observation.create({
        data: {
          id: observationId(runId, context.evidenceFingerprint, sequence),
          walkthroughId: run.walkthroughId,
          processingRunId: runId,
          sequence,
          type: observation.type,
          sourceBasis: observation.sourceBasis,
          originalDraftText: observation.description,
          suggestedAction: observation.suggestedAction,
          location: observation.location,
          trade: observation.trade,
          confidence: observation.confidence,
          reviewState: "DRAFT",
          evidence: { create: observation.evidence },
        },
      });
    }
  }, { maxWait: 5000, timeout: 15000 });
  logEvent("observation.reasoning.persistence_completed", { processingRunId: runId, stage: "EXTRACTING_OBSERVATIONS" });
  } catch (error) {
    logEvent("observation.reasoning.failed", {
      processingRunId: runId,
      stage: "EXTRACTING_OBSERVATIONS",
      phase,
      ...safeFailureDetails(error),
      ...(provider ? { provider } : {}),
      ...(capability ? { capability } : {}),
    });
    throw error;
  }
}
