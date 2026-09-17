-- Preserve report-time review and evidence values independently of mutable source records.
ALTER TABLE "ReportObservation" ADD COLUMN "reviewState" "ReviewState";
ALTER TABLE "ReportObservation" ADD COLUMN "reviewerId" TEXT;
ALTER TABLE "ReportObservation" ADD COLUMN "reviewedAt" TIMESTAMP(3);

UPDATE "ReportObservation" AS report_item
SET "reviewState" = observation."reviewState",
    "reviewerId" = observation."reviewerId",
    "reviewedAt" = observation."reviewedAt"
FROM "Observation" AS observation
WHERE report_item."observationId" = observation."id";

ALTER TABLE "ReportObservation" ALTER COLUMN "reviewState" SET NOT NULL;

CREATE TABLE "ReportObservationEvidence" (
  "id" TEXT NOT NULL,
  "reportObservationId" TEXT NOT NULL,
  "sourceWalkthroughId" TEXT NOT NULL,
  "sourceEvidenceId" TEXT NOT NULL,
  "mediaAssetId" TEXT,
  "transcriptSegmentId" TEXT,
  "sourceStartSeconds" DOUBLE PRECISION,
  "sourceEndSeconds" DOUBLE PRECISION,
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportObservationEvidence_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ReportObservationEvidence" (
  "id", "reportObservationId", "sourceWalkthroughId", "sourceEvidenceId",
  "mediaAssetId", "transcriptSegmentId", "sourceStartSeconds", "sourceEndSeconds", "label"
)
SELECT
  concat('report-evidence-', report_item."id", '-', evidence."id"),
  report_item."id",
  observation."walkthroughId",
  evidence."id",
  evidence."mediaAssetId",
  evidence."transcriptSegmentId",
  evidence."sourceStartSeconds",
  evidence."sourceEndSeconds",
  evidence."label"
FROM "ReportObservation" AS report_item
JOIN "Observation" AS observation ON observation."id" = report_item."observationId"
JOIN "ObservationEvidence" AS evidence ON evidence."observationId" = observation."id";

CREATE INDEX "ReportObservationEvidence_reportObservationId_idx" ON "ReportObservationEvidence"("reportObservationId");
ALTER TABLE "ReportObservationEvidence"
  ADD CONSTRAINT "ReportObservationEvidence_reportObservationId_fkey"
  FOREIGN KEY ("reportObservationId") REFERENCES "ReportObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
