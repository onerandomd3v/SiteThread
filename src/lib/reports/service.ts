import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db/client";
import { SiteThreadError } from "@/lib/errors";
import { extractVisualFrame } from "@/lib/media/ffmpeg";
import { PIPELINE_VERSION } from "@/lib/processing/lifecycle";
import { SiteReportSchema, type SiteReport } from "@/lib/schemas/report";
import { r2MediaStorage } from "@/lib/storage/r2";
import type { ProcessingMediaStorage } from "@/lib/storage/types";
import { MVP_REVIEWER_ID } from "@/lib/observations/review";
import { logEvent } from "@/lib/observability/log";

export const REPORT_VERSION = "cod20-v1";

const reportSourceInclude = {
  evidence: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    include: {
      mediaAsset: {
        select: {
          id: true,
          walkthroughId: true,
          status: true,
          kind: true,
          objectKey: true,
          mimeType: true,
          sourceStartSeconds: true,
          sourceEndSeconds: true,
          durationSeconds: true,
          visualCandidates: { select: { processingRunId: true, walkthroughId: true } },
        },
      },
      transcriptSegment: {
        select: {
          id: true,
          walkthroughId: true,
          processingRunId: true,
          sourceAssetId: true,
          text: true,
          startSeconds: true,
          endSeconds: true,
        },
      },
    },
  },
} satisfies Prisma.ObservationInclude;

const reportInclude = {
  walkthrough: { include: { project: { select: { id: true, name: true } } } },
  observations: {
    orderBy: { sortOrder: "asc" as const },
    include: { evidence: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] } },
  },
} satisfies Prisma.ReportInclude;

export type ReportSourceRecord = Prisma.ObservationGetPayload<{ include: typeof reportSourceInclude }>;
type PersistedReport = Prisma.ReportGetPayload<{ include: typeof reportInclude }>;

type ReportDependencies = {
  database?: typeof db;
  now?: () => Date;
};

type SnapshotEvidence = {
  sourceWalkthroughId: string;
  sourceEvidenceId: string;
  mediaAssetId: string | null;
  transcriptSegmentId: string | null;
  sourceStartSeconds: number | null;
  sourceEndSeconds: number | null;
  label: string;
  transcriptText: string | null;
};

type SnapshotFinding = {
  sourceObservationId: string;
  type: ReportSourceRecord["type"];
  sourceBasis: ReportSourceRecord["sourceBasis"];
  text: string;
  suggestedAction: string | null;
  location: string | null;
  trade: string | null;
  reviewState: "CONFIRMED" | "EDITED";
  reviewerId: string;
  reviewedAt: string;
  evidence: SnapshotEvidence[];
};

type ReportSnapshot = {
  walkthroughId: string;
  runId: string;
  findings: SnapshotFinding[];
};

export function reportIdForSnapshot(snapshot: ReportSnapshot): string {
  const digest = createHash("sha256").update(JSON.stringify({ version: REPORT_VERSION, ...snapshot })).digest("hex");
  return `report-${digest}`;
}

export function frameOffsetSeconds(
  sourceStartSeconds: number | null,
  sourceEndSeconds: number | null,
  mediaStartSeconds: number | null,
  mediaDurationSeconds: number | null,
): number {
  if (sourceStartSeconds === null || sourceEndSeconds === null) {
    throw new SiteThreadError("The visual evidence time range is unavailable.", "MEDIA_UNAVAILABLE");
  }
  const offset = ((sourceStartSeconds + sourceEndSeconds) / 2) - (mediaStartSeconds ?? 0);
  if (!Number.isFinite(offset) || offset < 0 || (mediaDurationSeconds !== null && offset > mediaDurationSeconds)) {
    throw new SiteThreadError("The visual evidence frame time is outside the cited media.", "MEDIA_UNAVAILABLE");
  }
  return offset;
}

async function lockRun(transaction: Prisma.TransactionClient, runId: string): Promise<void> {
  await transaction.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ProcessingRun" WHERE "id" = ${runId} FOR UPDATE`;
}

function currentRunWhere(walkthroughId: string) {
  return { walkthroughId, pipelineVersion: PIPELINE_VERSION };
}

function reportError(message: string): SiteThreadError {
  return new SiteThreadError(message, "CONFLICT");
}

function validateEvidence(observation: ReportSourceRecord, runId: string): SnapshotEvidence[] {
  return observation.evidence.map((item) => {
    const media = item.mediaAsset;
    const transcript = item.transcriptSegment;
    if (!media && !transcript) throw reportError("Every report finding needs valid source evidence.");
    if (media && media.walkthroughId !== observation.walkthroughId) {
      throw reportError("A report finding references unavailable or unrelated media evidence.");
    }
    if (transcript && (transcript.walkthroughId !== observation.walkthroughId || transcript.processingRunId !== runId)) {
      throw reportError("A report finding references evidence from another walkthrough run.");
    }
    if (media && transcript && item.mediaAssetId !== transcript.sourceAssetId) {
      throw reportError("A report finding has mismatched transcript and media evidence.");
    }
    if (media && !transcript && (media.status !== "AVAILABLE" || media.kind !== "EVIDENCE_CLIP" || !media.visualCandidates.some((candidate) => candidate.processingRunId === runId && candidate.walkthroughId === observation.walkthroughId))) {
      throw reportError("A visual report finding is not backed by the current processing run.");
    }
    const sourceStartSeconds = item.sourceStartSeconds ?? transcript?.startSeconds ?? media?.sourceStartSeconds ?? null;
    const sourceEndSeconds = item.sourceEndSeconds ?? transcript?.endSeconds ?? media?.sourceEndSeconds ?? null;
    if (sourceStartSeconds !== null && sourceEndSeconds !== null && sourceEndSeconds < sourceStartSeconds) {
      throw reportError("A report finding has an invalid evidence range.");
    }
    return {
      sourceWalkthroughId: observation.walkthroughId,
      sourceEvidenceId: item.id,
      mediaAssetId: item.mediaAssetId,
      transcriptSegmentId: item.transcriptSegmentId,
      sourceStartSeconds,
      sourceEndSeconds,
      label: item.label ?? (transcript ? "Narration evidence" : "Visual evidence"),
      transcriptText: transcript?.text ?? null,
    };
  });
}

export function buildReportSnapshot(observations: ReportSourceRecord[], runId: string, walkthroughId: string): ReportSnapshot {
  const drafts = observations.filter((observation) => observation.reviewState === "DRAFT");
  if (drafts.length > 0) throw reportError("Complete every finding review before generating the report.");
  const eligible = observations.filter((observation) => observation.reviewState === "CONFIRMED" || observation.reviewState === "EDITED");
  if (eligible.length === 0) throw reportError("No findings selected for report.");

  const findings = eligible.map((observation): SnapshotFinding => {
    if (!observation.reviewerId || !observation.reviewedAt) throw reportError("A reviewed finding is missing reviewer metadata.");
    if (observation.reviewState === "EDITED" && !observation.editedText) throw reportError("An edited finding is missing its saved wording.");
    return {
      sourceObservationId: observation.id,
      type: observation.type,
      sourceBasis: observation.sourceBasis,
      text: observation.reviewState === "EDITED" ? observation.editedText as string : observation.originalDraftText,
      suggestedAction: observation.suggestedAction,
      location: observation.location,
      trade: observation.trade,
      reviewState: observation.reviewState as "CONFIRMED" | "EDITED",
      reviewerId: observation.reviewerId,
      reviewedAt: observation.reviewedAt.toISOString(),
      evidence: validateEvidence(observation, runId),
    };
  });
  if (findings.some((finding) => finding.evidence.length === 0)) throw reportError("Every report finding needs valid source evidence.");
  return { walkthroughId, runId, findings };
}

async function loadSnapshot(transaction: Prisma.TransactionClient, run: { id: string; walkthroughId: string; status: string }): Promise<ReportSnapshot> {
  const observations = await transaction.observation.findMany({
    where: { walkthroughId: run.walkthroughId, processingRunId: run.id },
    orderBy: [{ sequence: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: reportSourceInclude,
  });
  return buildReportSnapshot(observations, run.id, run.walkthroughId);
}

function reportCreateData(
  reportId: string,
  snapshot: ReportSnapshot,
  walkthrough: { projectName: string; title: string | null; capturedAt: Date | null; createdAt: Date; durationSeconds: number | null },
  generatedAt: Date,
) {
  return {
    id: reportId,
    walkthroughId: snapshot.walkthroughId,
    projectName: walkthrough.projectName,
    walkthroughTitle: walkthrough.title ?? "Untitled walkthrough",
    walkthroughCapturedAt: walkthrough.capturedAt,
    walkthroughCreatedAt: walkthrough.createdAt,
    walkthroughDurationSeconds: walkthrough.durationSeconds,
    generatedBy: MVP_REVIEWER_ID,
    generatedAt,
    observations: {
      create: snapshot.findings.map((finding, index) => ({
        id: `${reportId}-observation-${index + 1}`,
        observationId: finding.sourceObservationId,
        text: finding.text,
        type: finding.type,
        sourceBasis: finding.sourceBasis,
        suggestedAction: finding.suggestedAction,
        location: finding.location,
        trade: finding.trade,
        reviewState: finding.reviewState,
        reviewerId: finding.reviewerId,
        reviewedAt: new Date(finding.reviewedAt),
        sortOrder: index,
        evidence: {
          create: finding.evidence.map((evidence) => ({
            id: `${reportId}-observation-${index + 1}-evidence-${evidence.sourceEvidenceId}`,
            sourceWalkthroughId: evidence.sourceWalkthroughId,
            sourceEvidenceId: evidence.sourceEvidenceId,
            mediaAssetId: evidence.mediaAssetId,
            transcriptSegmentId: evidence.transcriptSegmentId,
            sourceStartSeconds: evidence.sourceStartSeconds,
            sourceEndSeconds: evidence.sourceEndSeconds,
            label: evidence.label,
            transcriptText: evidence.transcriptText,
          })),
        },
      })),
    },
  };
}

async function mapReport(report: PersistedReport, database: typeof db): Promise<SiteReport> {
  const mediaIds = report.observations.flatMap((observation) => observation.evidence.map((evidence) => evidence.mediaAssetId).filter((id): id is string => Boolean(id)));
  const media = mediaIds.length === 0 ? [] : await database.mediaAsset.findMany({ where: { id: { in: mediaIds } }, select: { id: true, walkthroughId: true, status: true, kind: true, objectKey: true } });
  const mediaById = new Map(media.map((asset) => [asset.id, asset]));
  return SiteReportSchema.parse({
    reportId: report.id,
    generatedAt: report.generatedAt,
    generatedBy: report.generatedBy,
    project: { id: report.walkthrough.project.id, name: report.projectName },
    walkthrough: {
      id: report.walkthroughId,
      title: report.walkthroughTitle ?? "Untitled walkthrough",
      capturedAt: report.walkthroughCapturedAt,
      createdAt: report.walkthroughCreatedAt,
      durationSeconds: report.walkthroughDurationSeconds,
    },
    findings: await Promise.all(report.observations.map(async (observation) => ({
      reportObservationId: observation.id,
      sourceObservationId: observation.observationId,
      type: observation.type,
      sourceBasis: observation.sourceBasis,
      text: observation.text,
      suggestedAction: observation.suggestedAction,
      location: observation.location,
      trade: observation.trade,
      reviewState: observation.reviewState,
      reviewerId: observation.reviewerId,
      reviewedAt: observation.reviewedAt,
      evidence: await Promise.all(observation.evidence.map(async (evidence) => {
        const asset = evidence.mediaAssetId ? mediaById.get(evidence.mediaAssetId) : undefined;
        const validAsset = asset && asset.walkthroughId === report.walkthroughId && asset.status === "AVAILABLE";
        const isVisual = Boolean(evidence.mediaAssetId && !evidence.transcriptSegmentId);
        return {
          reportEvidenceId: evidence.id,
          sourceWalkthroughId: evidence.sourceWalkthroughId,
          sourceEvidenceId: evidence.sourceEvidenceId,
          mediaAssetId: evidence.mediaAssetId,
          transcriptSegmentId: evidence.transcriptSegmentId,
          sourceStartSeconds: evidence.sourceStartSeconds,
          sourceEndSeconds: evidence.sourceEndSeconds,
          label: evidence.label ?? (evidence.transcriptSegmentId ? "Narration evidence" : "Visual evidence"),
          transcriptText: evidence.transcriptText,
          frameUrl: validAsset && isVisual && asset.kind === "EVIDENCE_CLIP" ? `/api/reports/${report.id}/evidence/${evidence.sourceEvidenceId}/frame` : null,
          mediaAvailability: evidence.mediaAssetId ? validAsset ? "AVAILABLE" : "UNAVAILABLE" : "NOT_APPLICABLE",
          applicationUrl: `/walkthroughs/${report.walkthroughId}#finding-${observation.observationId}-evidence-${evidence.sourceEvidenceId}`,
        };
      })),
    }))),
  });
}

export async function generateReport(walkthroughId: string, dependencies: ReportDependencies = {}): Promise<SiteReport> {
  const database = dependencies.database ?? db;
  const now = dependencies.now ?? (() => new Date());
  return database.$transaction(async (transaction) => {
    const initialRun = await transaction.processingRun.findFirst({ where: currentRunWhere(walkthroughId), orderBy: { createdAt: "desc" } });
    if (!initialRun) throw new SiteThreadError("The walkthrough processing run was not found.", "NOT_FOUND");
    await lockRun(transaction, initialRun.id);
    const run = await transaction.processingRun.findUnique({ where: { id: initialRun.id } });
    if (!run) throw new SiteThreadError("The walkthrough processing run was not found.", "NOT_FOUND");
    if (run.status !== "REVIEWED" && run.status !== "REPORT_READY") throw reportError("Complete the walkthrough review before generating the report.");
    const walkthrough = await transaction.walkthrough.findUnique({ where: { id: walkthroughId }, include: { project: { select: { id: true, name: true } } } });
    if (!walkthrough) throw new SiteThreadError("The walkthrough was not found.", "NOT_FOUND");
    const snapshot = await loadSnapshot(transaction, run);
    const reportId = reportIdForSnapshot(snapshot);
    const existing = await transaction.report.findUnique({ where: { id: reportId }, include: reportInclude });
    if (existing) {
      logEvent("report.generated", { walkthroughId, processingRunId: run.id, reportId: existing.id, outcome: "reused" });
      return mapReport(existing, database);
    }
    if (run.status === "REPORT_READY") throw new SiteThreadError("The persisted report does not match the reviewed snapshot.", "CONFLICT");
    const generatedAt = now();
    const created = await transaction.report.create({ data: reportCreateData(reportId, snapshot, { projectName: walkthrough.project.name, title: walkthrough.title, capturedAt: walkthrough.capturedAt, createdAt: walkthrough.createdAt, durationSeconds: walkthrough.durationSeconds }, generatedAt), include: reportInclude });
    const transitioned = await transaction.processingRun.updateMany({ where: { id: run.id, status: "REVIEWED" }, data: { status: "REPORT_READY", completedAt: generatedAt } });
    if (transitioned.count !== 1) throw new SiteThreadError("The walkthrough changed while the report was being generated.", "CONFLICT");
    logEvent("report.generated", { walkthroughId, processingRunId: run.id, reportId, outcome: "created" });
    return mapReport(created, database);
  });
}

export async function getReport(reportId: string, dependencies: ReportDependencies = {}): Promise<SiteReport> {
  const database = dependencies.database ?? db;
  const report = await database.report.findUnique({ where: { id: reportId }, include: reportInclude });
  if (!report) throw new SiteThreadError("The report was not found.", "NOT_FOUND");
  return mapReport(report, database);
}

type ReportFrameStorage = Pick<ProcessingMediaStorage, "downloadToFile">;

export async function getReportEvidenceFrame(
  reportId: string,
  sourceEvidenceId: string,
  database: typeof db = db,
  storage: ReportFrameStorage = r2MediaStorage,
): Promise<Buffer> {
  const evidence = await database.reportObservationEvidence.findFirst({
    where: { sourceEvidenceId, reportObservation: { reportId } },
    include: { reportObservation: { include: { report: true } } },
  });
  if (!evidence || evidence.sourceWalkthroughId !== evidence.reportObservation.report.walkthroughId || !evidence.mediaAssetId) {
    throw new SiteThreadError("The report evidence was not found.", "NOT_FOUND");
  }
  const asset = await database.mediaAsset.findUnique({ where: { id: evidence.mediaAssetId } });
  if (!asset || asset.walkthroughId !== evidence.sourceWalkthroughId || asset.status !== "AVAILABLE" || asset.kind !== "EVIDENCE_CLIP") {
    throw new SiteThreadError("The visual report evidence is unavailable.", "MEDIA_UNAVAILABLE");
  }
  const offset = frameOffsetSeconds(evidence.sourceStartSeconds, evidence.sourceEndSeconds, asset.sourceStartSeconds, asset.durationSeconds);
  const directory = await mkdtemp(join(tmpdir(), "sitethread-report-"));
  const inputPath = join(directory, "evidence.mp4");
  const outputPath = join(directory, "frame.jpg");
  try {
    await storage.downloadToFile({ objectKey: asset.objectKey, filePath: inputPath });
    await extractVisualFrame(inputPath, outputPath, offset);
    return await readFile(outputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
