import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db/client";
import { SiteThreadError } from "@/lib/errors";
import type { ProviderDiagnostic } from "@/lib/livepeer/types";
import { sanitizeProviderResponse } from "@/lib/livepeer/sanitize";
import { buildReasoningContext, groundReasonedObservations } from "./grounding";
import { configuredObservationReasoner } from "./reasoner";
import type { ObservationReasoner } from "./types";

export const OBSERVATION_REASONING_VERSION = "observation-v1";

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
  const run = await database.processingRun.findUnique({ where: { id: runId } });
  if (!run) throw new SiteThreadError("The processing run was not found.", "NOT_FOUND");
  if (run.status !== "EXTRACTING_OBSERVATIONS") return;

  const [transcriptSegments, visualCandidates] = await Promise.all([
    database.transcriptSegment.findMany({ where: { walkthroughId: run.walkthroughId, processingRunId: runId }, orderBy: { sequence: "asc" } }),
    database.visualCandidate.findMany({ where: { walkthroughId: run.walkthroughId, processingRunId: runId }, orderBy: { sourceStartSeconds: "asc" } }),
  ]);
  const context = buildReasoningContext({ transcriptSegments, visualCandidates });
  const reasoner = dependencies.reasoner ?? configuredObservationReasoner();
  const idempotencyKey = createHash("sha256").update(`${run.id}|${run.pipelineVersion}|${OBSERVATION_REASONING_VERSION}|${context.evidenceFingerprint}`).digest("hex");
  const result = await reasoner.extract({
    idempotencyKey,
    evidence: context.evidence,
  });
  if (result.diagnostic.idempotencyKey !== idempotencyKey) {
    throw new SiteThreadError("The observation reasoner returned a mismatched idempotency key.", "PROVIDER_RESULT_INVALID");
  }
  const grounded = groundReasonedObservations(result.value, context);
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
  });
}
