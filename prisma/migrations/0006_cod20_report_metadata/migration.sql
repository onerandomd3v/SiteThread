-- Preserve all report-rendered wording and context independently of mutable source records.
ALTER TABLE "Report" ADD COLUMN "projectName" TEXT;
ALTER TABLE "Report" ADD COLUMN "walkthroughTitle" TEXT;
ALTER TABLE "Report" ADD COLUMN "walkthroughCapturedAt" TIMESTAMP(3);
ALTER TABLE "Report" ADD COLUMN "walkthroughCreatedAt" TIMESTAMP(3);
ALTER TABLE "Report" ADD COLUMN "walkthroughDurationSeconds" DOUBLE PRECISION;

UPDATE "Report" AS report
SET "projectName" = project."name",
    "walkthroughTitle" = walkthrough."title",
    "walkthroughCapturedAt" = walkthrough."capturedAt",
    "walkthroughCreatedAt" = walkthrough."createdAt",
    "walkthroughDurationSeconds" = walkthrough."durationSeconds"
FROM "Walkthrough" AS walkthrough
JOIN "Project" AS project ON project."id" = walkthrough."projectId"
WHERE report."walkthroughId" = walkthrough."id";

ALTER TABLE "Report" ALTER COLUMN "projectName" SET NOT NULL;
ALTER TABLE "Report" ALTER COLUMN "walkthroughCreatedAt" SET NOT NULL;

ALTER TABLE "ReportObservation" ADD COLUMN "sourceBasis" "ObservationSourceBasis";
ALTER TABLE "ReportObservation" ADD COLUMN "suggestedAction" TEXT;
ALTER TABLE "ReportObservation" ADD COLUMN "location" TEXT;
ALTER TABLE "ReportObservation" ADD COLUMN "trade" TEXT;

UPDATE "ReportObservation" AS report_item
SET "sourceBasis" = observation."sourceBasis",
    "suggestedAction" = observation."suggestedAction",
    "location" = observation."location",
    "trade" = observation."trade"
FROM "Observation" AS observation
WHERE report_item."observationId" = observation."id";

ALTER TABLE "ReportObservation" ALTER COLUMN "sourceBasis" SET NOT NULL;
ALTER TABLE "ReportObservationEvidence" ADD COLUMN "transcriptText" TEXT;

UPDATE "ReportObservationEvidence" AS report_evidence
SET "transcriptText" = transcript."text"
FROM "ObservationEvidence" AS evidence
JOIN "TranscriptSegment" AS transcript ON transcript."id" = evidence."transcriptSegmentId"
WHERE report_evidence."sourceEvidenceId" = evidence."id";
