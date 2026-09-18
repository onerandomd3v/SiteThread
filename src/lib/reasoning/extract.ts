import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db/client";
import { SiteThreadError } from "@/lib/errors";
import type { ProviderDiagnostic } from "@/lib/livepeer/types";
import { sanitizeProviderResponse } from "@/lib/livepeer/sanitize";
import { transitionProcessingRun } from "@/lib/processing/lifecycle";
import { buildReasoningContext, groundReasonedObservations } from "./grounding";
import { configuredObservationReasoner } from "./reasoner";
import type { ObservationReasoner } from "./types";

export const OBSERVATION_REASONING_VERSION = "observation-v1";

function observationId(runId: string, fingerprint: string, sequence: number): string {
  return `obs_${createHash("sha256").update(`${runId}|${OBSERVATION_REASONING_VERSION}|${fingerprint}|${sequence}`).digest("hex").slice(0, 32)}`;
}

function invocationRange(context: ReturnType<typeof buildReasoningContext>): { startSeconds: number; endSeconds: number } {
  if (context.evidence.length === 0) return { startSeconds: 0, endSeconds: 0 };
  return {
    startSeconds: Math.min(...context.evidence.map((evidence) => evidence.startSeconds)),
    endSeconds: Math.max(...context.evidence.map((evidence) => evidence.endSeconds)),
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
  const result = await reasoner.extract({
    runId,
    walkthroughId: run.walkthroughId,
    pipelineVersion: run.pipelineVersion,
    retryCount: run.retryCount,
    reasoningVersion: OBSERVATION_REASONING_VERSION,
    evidenceFingerprint: context.evidenceFingerprint,
    evidence: context.evidence,
  });
  const grounded = groundReasonedObservations(result.value, context);
  const range = invocationRange(context);
  const diagnostic: ProviderDiagnostic = result.diagnostic;

  await database.$transaction(async (transaction) => {
    const current = await transaction.processingRun.findUnique({ where: { id: runId } });
    if (!current || current.status !== "EXTRACTING_OBSERVATIONS") return;
    const rawResponse = sanitizeProviderResponse(diagnostic.rawResponse) as Prisma.InputJsonValue;
    await transaction.providerInvocation.upsert({
      where: { idempotencyKey: diagnostic.idempotencyKey },
      create: {
        processingRunId: runId,
        idempotencyKey: diagnostic.idempotencyKey,
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
    await transitionProcessingRun(runId, "NEEDS_REVIEW", {}, transaction);
  });
}
