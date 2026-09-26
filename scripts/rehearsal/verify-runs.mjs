import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { validateReportArtifactBinding, validateReportObservationEvidence, validateRunProviderInvocations } from "./provenance.mjs";

const prisma = new PrismaClient();
const artifactDir = `${process.cwd()}/.rehearsal`;
const input = JSON.parse(await readFile(`${artifactDir}/live-runs.json`, "utf8"));
function fail(message) { throw new Error(`Live provenance verification failed: ${message}`); }
function unique(values, label) {
  if (new Set(values).size !== values.length) fail(`duplicate ${label}`);
}

const verified = [];
for (const runRecord of input.runs) {
  const walkthrough = await prisma.walkthrough.findUnique({
    where: { id: runRecord.walkthroughId },
    include: {
      processingRuns: { where: { pipelineVersion: "mvp-upload-v1" }, orderBy: { createdAt: "desc" } },
      transcriptSegments: true,
      visualCandidates: true,
      observations: { include: { evidence: true } },
      reports: { include: { observations: { include: { evidence: true } } } },
    },
  });
  if (!walkthrough) fail(`walkthrough ${runRecord.walkthroughId} was not found`);
  const currentRuns = walkthrough.processingRuns.filter((run) => run.walkthroughId === walkthrough.id);
  if (currentRuns.length !== 1) fail(`expected one current processing run for ${walkthrough.id}`);
  const run = currentRuns[0];
  if (run.status !== "REPORT_READY") fail(`${walkthrough.id} ended in ${run.status}`);
  const invocations = await prisma.providerInvocation.findMany({ where: { processingRunId: run.id }, orderBy: { createdAt: "asc" } });
  const segments = walkthrough.transcriptSegments.filter((segment) => segment.processingRunId === run.id);
  let providerCapabilities;
  try { providerCapabilities = validateRunProviderInvocations({ invocations, transcriptSegments: segments, processingRunId: run.id }); } catch (error) { fail(`${walkthrough.id} ${error instanceof Error ? error.message : String(error)}`); }
  unique(invocations.map((invocation) => invocation.idempotencyKey), "provider invocation key");
  const candidates = walkthrough.visualCandidates.filter((candidate) => candidate.processingRunId === run.id);
  const observations = walkthrough.observations.filter((observation) => observation.processingRunId === run.id);
  unique(segments.map((segment) => `${segment.sourceAssetId}|${segment.startSeconds}|${segment.endSeconds}`), "transcript range");
  unique(candidates.map((candidate) => `${candidate.processingRunId}|${candidate.mediaAssetId}`), "visual candidate");
  unique(observations.map((observation) => String(observation.sequence)), "observation sequence");
  if (observations.length < 3) fail(`${walkthrough.id} has fewer than three observations`);
  const reports = walkthrough.reports.filter((report) => report.observations.length > 0);
  if (reports.length !== 1) fail(`${walkthrough.id} has ${reports.length} logical reports`);
  const report = reports[0];
  try { validateReportArtifactBinding(report.id, runRecord.reportId); } catch (error) { fail(`${walkthrough.id} ${error instanceof Error ? error.message : String(error)}`); }
  const sourceObservations = new Map(observations.map((observation) => [observation.id, observation]));
  const mediaIds = report.observations.flatMap((observation) => observation.evidence.map((evidence) => evidence.mediaAssetId).filter(Boolean));
  const mediaAssets = await prisma.mediaAsset.findMany({
    where: { id: { in: mediaIds } },
    include: {
      visualCandidates: {
        where: { processingRunId: run.id },
        select: {
          processingRunId: true,
          walkthroughId: true,
          sourceStartSeconds: true,
          sourceEndSeconds: true,
          provider: true,
          capability: true,
          providerInvocation: { select: { processingRunId: true, provider: true, capability: true, status: true } },
        },
      },
    },
  });
  const mediaById = new Map(mediaAssets.map((asset) => [asset.id, asset]));
  for (const observation of report.observations) {
    const sourceObservation = sourceObservations.get(observation.observationId);
    try { validateReportObservationEvidence({ observation, sourceObservation, segments, mediaById, walkthrough, processingRunId: run.id }); } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
  }
  verified.push({ walkthroughId: walkthrough.id, processingRunId: run.id, reportId: report.id, mode: "live", providerCapabilities, finalStatus: run.status, findingCount: observations.length, reportFindingCount: report.observations.length, providerInvocationCount: invocations.length });
}
if (new Set(verified.map((record) => record.walkthroughId)).size !== 2) fail("two fresh walkthrough IDs were not verified");
await mkdir(artifactDir, { recursive: true });
await writeFile(`${artifactDir}/verified-runs.json`, JSON.stringify({ verifiedAt: new Date().toISOString(), referenceFingerprint: process.env.REHEARSAL_REFERENCE_FINGERPRINT, runs: verified }, null, 2));
console.info(JSON.stringify({ event: "rehearsal.provenance_verified", runCount: verified.length, mode: "live" }));
await prisma.$disconnect();
