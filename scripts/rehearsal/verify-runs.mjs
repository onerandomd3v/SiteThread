import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const artifactDir = `${process.cwd()}/.rehearsal`;
const input = JSON.parse(await readFile(`${artifactDir}/live-runs.json`, "utf8"));
const requiredCapabilities = ["nemotron-asr", "marlin-video", "gemini-text"];

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
  if (invocations.some((invocation) => invocation.provider !== "livepeer")) fail(`${walkthrough.id} contains a non-Livepeer provider invocation`);
  const required = requiredCapabilities.map((capability) => invocations.find((invocation) => invocation.capability === capability && invocation.status === "SUCCEEDED" && invocation.provider === "livepeer"));
  if (required.some((invocation) => !invocation)) fail(`${walkthrough.id} is missing a successful livepeer provider invocation`);
  unique(invocations.map((invocation) => invocation.idempotencyKey), "provider invocation key");
  const segments = walkthrough.transcriptSegments.filter((segment) => segment.processingRunId === run.id);
  const candidates = walkthrough.visualCandidates.filter((candidate) => candidate.processingRunId === run.id);
  const observations = walkthrough.observations.filter((observation) => observation.processingRunId === run.id);
  unique(segments.map((segment) => `${segment.sourceAssetId}|${segment.startSeconds}|${segment.endSeconds}`), "transcript range");
  unique(candidates.map((candidate) => `${candidate.processingRunId}|${candidate.mediaAssetId}`), "visual candidate");
  unique(observations.map((observation) => String(observation.sequence)), "observation sequence");
  if (observations.length < 3) fail(`${walkthrough.id} has fewer than three observations`);
  const reports = walkthrough.reports.filter((report) => report.observations.length > 0);
  if (reports.length !== 1) fail(`${walkthrough.id} has ${reports.length} logical reports`);
  const report = reports[0];
  for (const observation of report.observations) {
    if (!observations.some((candidate) => candidate.id === observation.observationId)) fail("report observation is not from the current run");
    if (!["CONFIRMED", "EDITED"].includes(observation.reviewState)) fail("report contains an ineligible review state");
    if (observation.evidence.length === 0) fail("report finding has no evidence");
    for (const evidence of observation.evidence) {
      if (evidence.sourceWalkthroughId !== walkthrough.id) fail("report evidence points to another walkthrough");
      if (evidence.sourceStartSeconds !== null && evidence.sourceEndSeconds !== null && evidence.sourceEndSeconds < evidence.sourceStartSeconds) fail("report evidence range is reversed");
      if (evidence.transcriptSegmentId && !segments.some((segment) => segment.id === evidence.transcriptSegmentId)) fail("report transcript evidence is from another run");
    }
  }
  verified.push({ walkthroughId: walkthrough.id, processingRunId: run.id, reportId: report.id, mode: "live", providerCapabilities: requiredCapabilities, finalStatus: run.status, findingCount: observations.length, reportFindingCount: report.observations.length, providerInvocationCount: invocations.length });
}
if (new Set(verified.map((record) => record.walkthroughId)).size !== 2) fail("two fresh walkthrough IDs were not verified");
await mkdir(artifactDir, { recursive: true });
await writeFile(`${artifactDir}/verified-runs.json`, JSON.stringify({ verifiedAt: new Date().toISOString(), referenceFingerprint: process.env.REHEARSAL_REFERENCE_FINGERPRINT, runs: verified }, null, 2));
console.info(JSON.stringify({ event: "rehearsal.provenance_verified", runCount: verified.length, mode: "live" }));
await prisma.$disconnect();
