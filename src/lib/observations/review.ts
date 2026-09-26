import { Prisma } from "@prisma/client";
import { db } from "@/lib/db/client";
import { SiteThreadError } from "@/lib/errors";
import { PIPELINE_VERSION } from "@/lib/processing/lifecycle";
import { ReviewDecisionSchema, type ReviewDecision } from "@/lib/schemas/media";
import { WalkthroughReviewSchema, type ReviewObservation, type WalkthroughReview } from "@/lib/schemas/review";
import { r2MediaStorage } from "@/lib/storage/r2";
import type { MediaStorage } from "@/lib/storage/types";

const MEDIA_URL_TTL_SECONDS = 5 * 60;
export const MVP_REVIEWER_ID = "mvp-reviewer";
export const MVP_REVIEWER_LABEL = "MVP reviewer";

const observationInclude = {
  evidence: {
    orderBy: { createdAt: "asc" as const },
    include: {
      mediaAsset: { select: { id: true, walkthroughId: true, kind: true, status: true, objectKey: true, mimeType: true, sourceStartSeconds: true, sourceEndSeconds: true, visualCandidates: { select: { processingRunId: true } } } },
      transcriptSegment: { select: { id: true, walkthroughId: true, processingRunId: true, sourceAssetId: true, text: true, startSeconds: true, endSeconds: true } },
    },
  },
} satisfies Prisma.ObservationInclude;

type ReviewObservationRecord = Prisma.ObservationGetPayload<{ include: typeof observationInclude }>;

type ReviewDependencies = {
  database?: typeof db;
  storage?: MediaStorage;
  now?: () => Date;
};

function reviewDatabase(dependencies: ReviewDependencies): typeof db {
  return dependencies.database ?? db;
}

function sameDecision(observation: ReviewObservationRecord, decision: ReviewDecision): boolean {
  if (observation.reviewState !== decision.state) return false;
  return decision.state !== "EDITED" || observation.editedText === decision.editedText;
}

async function lockRun(transaction: Prisma.TransactionClient, runId: string): Promise<void> {
  await transaction.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ProcessingRun" WHERE "id" = ${runId} FOR UPDATE`;
}

function currentRunWhere(walkthroughId: string) {
  return { walkthroughId, pipelineVersion: PIPELINE_VERSION };
}

async function mapObservation(
  observation: ReviewObservationRecord,
  storage: MediaStorage,
  expectedRunId: string,
): Promise<ReviewObservation> {
  const evidence = await Promise.all(observation.evidence.map(async (item) => {
    const transcript = item.transcriptSegment;
    const media = item.mediaAsset;
    const isTranscript = Boolean(transcript);
    if (media && media.walkthroughId !== observation.walkthroughId) {
      throw new SiteThreadError("The observation evidence could not be verified.", "INTERNAL_ERROR");
    }
    if (media && !isTranscript && !media.visualCandidates.some((candidate) => candidate.processingRunId === expectedRunId)) {
      throw new SiteThreadError("The observation evidence could not be verified.", "INTERNAL_ERROR");
    }
    if (transcript && (transcript.walkthroughId !== observation.walkthroughId || transcript.processingRunId !== expectedRunId)) {
      throw new SiteThreadError("The observation evidence could not be verified.", "INTERNAL_ERROR");
    }
    if (transcript && item.mediaAssetId && (!transcript.sourceAssetId || item.mediaAssetId !== transcript.sourceAssetId || !media)) {
      throw new SiteThreadError("The observation evidence could not be verified.", "INTERNAL_ERROR");
    }
    let mediaAvailability: "AVAILABLE" | "UNAVAILABLE" | "NOT_APPLICABLE" = "NOT_APPLICABLE";
    let mediaUrl: string | null = null;

    if (media) {
      if (media.status === "AVAILABLE") {
        try {
          mediaUrl = await storage.createReadUrl({ assetId: media.objectKey, expiresInSeconds: MEDIA_URL_TTL_SECONDS });
          mediaAvailability = "AVAILABLE";
        } catch {
          mediaAvailability = "UNAVAILABLE";
        }
      } else {
        mediaAvailability = "UNAVAILABLE";
      }
    }

    return {
      evidenceId: item.id,
      kind: isTranscript ? "TRANSCRIPT" as const : "MEDIA" as const,
      mediaAssetId: item.mediaAssetId,
      transcriptSegmentId: item.transcriptSegmentId,
      sourceStartSeconds: item.sourceStartSeconds ?? transcript?.startSeconds ?? media?.sourceStartSeconds ?? null,
      sourceEndSeconds: item.sourceEndSeconds ?? transcript?.endSeconds ?? media?.sourceEndSeconds ?? null,
      label: item.label ?? (isTranscript ? "Narration evidence" : "Visual evidence"),
      transcriptText: transcript?.text ?? null,
      mediaKind: media?.kind ?? null,
      mediaMimeType: media?.mimeType ?? null,
      mediaAvailability,
      mediaUrl,
    };
  }));

  return {
    observationId: observation.id,
    sequence: observation.sequence,
    type: observation.type,
    sourceBasis: observation.sourceBasis,
    originalDraftText: observation.originalDraftText,
    editedText: observation.editedText,
    finalDisplayText: observation.editedText ?? observation.originalDraftText,
    suggestedAction: observation.suggestedAction,
    location: observation.location,
    trade: observation.trade,
    confidence: observation.confidence,
    reviewState: observation.reviewState,
    reviewerId: observation.reviewerId,
    reviewedAt: observation.reviewedAt,
    evidence,
  };
}

async function reviewSnapshot(
  transaction: Prisma.TransactionClient | typeof db,
  run: { id: string; walkthroughId: string; status: string },
  storage: MediaStorage,
): Promise<WalkthroughReview> {
  const observations = await transaction.observation.findMany({
    where: { walkthroughId: run.walkthroughId, processingRunId: run.id },
    orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
    include: observationInclude,
  });
  const mapped = await Promise.all(observations.map((item) => mapObservation(item, storage, run.id)));
  const remainingDrafts = mapped.filter((item) => item.reviewState === "DRAFT").length;
  return WalkthroughReviewSchema.parse({
    runStatus: run.status,
    observations: mapped,
    totalCount: mapped.length,
    reviewedCount: mapped.length - remainingDrafts,
    remainingDrafts,
    complete: (run.status === "REVIEWED" || run.status === "REPORT_READY") && remainingDrafts === 0,
  });
}

export async function getWalkthroughReview(
  walkthroughId: string,
  dependencies: ReviewDependencies = {},
): Promise<WalkthroughReview> {
  const database = reviewDatabase(dependencies);
  const run = await database.processingRun.findFirst({ where: currentRunWhere(walkthroughId), orderBy: { createdAt: "desc" } });
  const walkthrough = await database.walkthrough.findUnique({ where: { id: walkthroughId }, select: { id: true } });
  if (!walkthrough) throw new SiteThreadError("The walkthrough was not found.", "NOT_FOUND");
  if (!run) throw new SiteThreadError("The walkthrough processing run was not found.", "NOT_FOUND");
  if (run.status !== "NEEDS_REVIEW" && run.status !== "REVIEWED" && run.status !== "REPORT_READY") throw new SiteThreadError("Findings are not ready for review.", "CONFLICT");
  const storage = dependencies.storage ?? r2MediaStorage;
  return reviewSnapshot(database, run, storage);
}

export async function completeEmptyReview(
  walkthroughId: string,
  dependencies: ReviewDependencies = {},
): Promise<WalkthroughReview> {
  const database = reviewDatabase(dependencies);
  const storage = dependencies.storage ?? r2MediaStorage;
  return database.$transaction(async (transaction) => {
    const initialRun = await transaction.processingRun.findFirst({ where: currentRunWhere(walkthroughId), orderBy: { createdAt: "desc" } });
    if (!initialRun) throw new SiteThreadError("The walkthrough processing run was not found.", "NOT_FOUND");
    await lockRun(transaction, initialRun.id);
    const run = await transaction.processingRun.findUnique({ where: { id: initialRun.id } });
    if (!run) throw new SiteThreadError("The walkthrough processing run was not found.", "NOT_FOUND");
    if (run.status !== "NEEDS_REVIEW" && run.status !== "REVIEWED") throw new SiteThreadError("Findings are not ready for review.", "CONFLICT");
    const observationCount = await transaction.observation.count({ where: { processingRunId: run.id } });
    if (observationCount !== 0) throw new SiteThreadError("This walkthrough has findings that require individual review.", "CONFLICT");
    await transaction.processingRun.updateMany({ where: { id: run.id, status: "NEEDS_REVIEW" }, data: { status: "REVIEWED", completedAt: new Date() } });
    const finalRun = await transaction.processingRun.findUnique({ where: { id: run.id } });
    if (!finalRun) throw new SiteThreadError("The walkthrough processing run was not found.", "NOT_FOUND");
    return reviewSnapshot(transaction, finalRun, storage);
  });
}

export async function reviewObservation(
  walkthroughId: string,
  observationId: string,
  input: unknown,
  dependencies: ReviewDependencies = {},
): Promise<{ observation: ReviewObservation; review: WalkthroughReview }> {
  const decision = ReviewDecisionSchema.parse(input);
  const database = reviewDatabase(dependencies);
  const storage = dependencies.storage ?? r2MediaStorage;
  const now = dependencies.now ?? (() => new Date());

  return database.$transaction(async (transaction) => {
    const initialRun = await transaction.processingRun.findFirst({ where: currentRunWhere(walkthroughId), orderBy: { createdAt: "desc" } });
    if (!initialRun) throw new SiteThreadError("The walkthrough processing run was not found.", "NOT_FOUND");
    await lockRun(transaction, initialRun.id);
    const run = await transaction.processingRun.findUnique({ where: { id: initialRun.id } });
    if (!run) throw new SiteThreadError("The walkthrough processing run was not found.", "NOT_FOUND");

    const existing = await transaction.observation.findUnique({ where: { id: observationId }, include: observationInclude });
    if (!existing || existing.walkthroughId !== walkthroughId || existing.processingRunId !== run.id) {
      throw new SiteThreadError("The observation was not found for this walkthrough run.", "NOT_FOUND");
    }

    if (run.status === "REPORT_READY") {
      throw new SiteThreadError("This walkthrough is not accepting review decisions.", "CONFLICT");
    }

    if (existing.reviewState !== "DRAFT") {
      if (!sameDecision(existing, decision)) {
        throw new SiteThreadError("This observation was already reviewed with a different decision.", "CONFLICT");
      }
    } else {
      if (run.status !== "NEEDS_REVIEW") {
        throw new SiteThreadError("This walkthrough is not accepting review decisions.", "CONFLICT");
      }
      const reviewedAt = now();
      const updated = await transaction.observation.updateMany({
        where: { id: observationId, walkthroughId, processingRunId: run.id, reviewState: "DRAFT" },
        data: {
          reviewState: decision.state,
          editedText: decision.state === "EDITED" ? decision.editedText : null,
          reviewerId: MVP_REVIEWER_ID,
          reviewedAt,
        },
      });
      if (updated.count !== 1) throw new SiteThreadError("This observation was reviewed by another request.", "CONFLICT");
    }

    const remaining = await transaction.observation.count({ where: { processingRunId: run.id, reviewState: "DRAFT" } });
    if (remaining === 0) {
      await transaction.processingRun.updateMany({ where: { id: run.id, status: "NEEDS_REVIEW" }, data: { status: "REVIEWED", completedAt: now() } });
    }
    const finalRun = await transaction.processingRun.findUnique({ where: { id: run.id } });
    if (!finalRun) throw new SiteThreadError("The walkthrough processing run was not found.", "NOT_FOUND");
    const finalObservation = await transaction.observation.findUnique({ where: { id: observationId }, include: observationInclude });
    if (!finalObservation) throw new SiteThreadError("The observation was not found for this walkthrough run.", "NOT_FOUND");
    const review = await reviewSnapshot(transaction, finalRun, storage);
    return { observation: await mapObservation(finalObservation, storage, finalRun.id), review };
  }, { maxWait: 5_000, timeout: 15_000 });
}
