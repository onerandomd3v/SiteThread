-- CreateEnum
CREATE TYPE "MediaAssetKind" AS ENUM ('SOURCE_VIDEO', 'SOURCE_AUDIO', 'SOURCE_IMAGE', 'EXTRACTED_FRAME', 'EVIDENCE_CLIP', 'THUMBNAIL');
CREATE TYPE "MediaAssetStatus" AS ENUM ('PENDING', 'AVAILABLE', 'FAILED');
CREATE TYPE "ProcessingStatus" AS ENUM ('UPLOADING', 'UPLOADED', 'QUEUED', 'TRANSCRIBING', 'ANALYZING_MEDIA', 'EXTRACTING_OBSERVATIONS', 'NEEDS_REVIEW', 'REVIEWED', 'REPORT_READY', 'PROCESSING_FAILED');
CREATE TYPE "ObservationType" AS ENUM ('PROGRESS', 'POTENTIAL_ISSUE', 'ACTION', 'NOTE');
CREATE TYPE "ObservationSourceBasis" AS ENUM ('NARRATION', 'VISUAL', 'NARRATION_AND_VISUAL');
CREATE TYPE "ReviewState" AS ENUM ('DRAFT', 'CONFIRMED', 'EDITED', 'DISMISSED');

CREATE TABLE "Project" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Walkthrough" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "title" TEXT, "capturedAt" TIMESTAMP(3), "durationSeconds" DOUBLE PRECISION, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Walkthrough_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL, "walkthroughId" TEXT NOT NULL, "kind" "MediaAssetKind" NOT NULL, "status" "MediaAssetStatus" NOT NULL DEFAULT 'PENDING', "objectKey" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "byteSize" INTEGER, "durationSeconds" DOUBLE PRECISION, "sourceStartSeconds" DOUBLE PRECISION, "sourceEndSeconds" DOUBLE PRECISION, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProcessingRun" (
  "id" TEXT NOT NULL, "walkthroughId" TEXT NOT NULL, "pipelineVersion" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "status" "ProcessingStatus" NOT NULL DEFAULT 'UPLOADING', "failedStep" TEXT, "errorCode" TEXT, "errorMessage" TEXT, "retryCount" INTEGER NOT NULL DEFAULT 0, "providerJobIds" JSONB, "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProcessingRun_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TranscriptSegment" (
  "id" TEXT NOT NULL, "walkthroughId" TEXT NOT NULL, "sourceAssetId" TEXT, "sequence" INTEGER NOT NULL, "startSeconds" DOUBLE PRECISION NOT NULL, "endSeconds" DOUBLE PRECISION NOT NULL, "text" TEXT NOT NULL, "speaker" TEXT, "language" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Observation" (
  "id" TEXT NOT NULL, "walkthroughId" TEXT NOT NULL, "type" "ObservationType" NOT NULL, "sourceBasis" "ObservationSourceBasis" NOT NULL, "originalDraftText" TEXT NOT NULL, "editedText" TEXT, "location" TEXT, "trade" TEXT, "confidence" DOUBLE PRECISION, "reviewState" "ReviewState" NOT NULL DEFAULT 'DRAFT', "reviewerId" TEXT, "reviewedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ObservationEvidence" (
  "id" TEXT NOT NULL, "observationId" TEXT NOT NULL, "mediaAssetId" TEXT, "transcriptSegmentId" TEXT, "sourceStartSeconds" DOUBLE PRECISION, "sourceEndSeconds" DOUBLE PRECISION, "label" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ObservationEvidence_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Report" (
  "id" TEXT NOT NULL, "walkthroughId" TEXT NOT NULL, "generatedBy" TEXT, "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ReportObservation" (
  "id" TEXT NOT NULL, "reportId" TEXT NOT NULL, "observationId" TEXT NOT NULL, "text" TEXT NOT NULL, "type" "ObservationType" NOT NULL, "sortOrder" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportObservation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MediaAsset_walkthroughId_objectKey_key" ON "MediaAsset"("walkthroughId", "objectKey");
CREATE UNIQUE INDEX "ProcessingRun_idempotencyKey_key" ON "ProcessingRun"("idempotencyKey");
CREATE UNIQUE INDEX "ProcessingRun_walkthroughId_pipelineVersion_key" ON "ProcessingRun"("walkthroughId", "pipelineVersion");
CREATE UNIQUE INDEX "TranscriptSegment_walkthroughId_sequence_key" ON "TranscriptSegment"("walkthroughId", "sequence");
CREATE UNIQUE INDEX "ReportObservation_reportId_observationId_key" ON "ReportObservation"("reportId", "observationId");
CREATE INDEX "Walkthrough_projectId_createdAt_idx" ON "Walkthrough"("projectId", "createdAt");
CREATE INDEX "MediaAsset_walkthroughId_kind_idx" ON "MediaAsset"("walkthroughId", "kind");
CREATE INDEX "ProcessingRun_walkthroughId_status_idx" ON "ProcessingRun"("walkthroughId", "status");
CREATE INDEX "TranscriptSegment_walkthroughId_startSeconds_idx" ON "TranscriptSegment"("walkthroughId", "startSeconds");
CREATE INDEX "Observation_walkthroughId_reviewState_idx" ON "Observation"("walkthroughId", "reviewState");
CREATE INDEX "ObservationEvidence_observationId_idx" ON "ObservationEvidence"("observationId");
CREATE INDEX "Report_walkthroughId_generatedAt_idx" ON "Report"("walkthroughId", "generatedAt");
CREATE INDEX "ReportObservation_reportId_sortOrder_idx" ON "ReportObservation"("reportId", "sortOrder");
ALTER TABLE "Walkthrough" ADD CONSTRAINT "Walkthrough_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_walkthroughId_fkey" FOREIGN KEY ("walkthroughId") REFERENCES "Walkthrough"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessingRun" ADD CONSTRAINT "ProcessingRun_walkthroughId_fkey" FOREIGN KEY ("walkthroughId") REFERENCES "Walkthrough"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_walkthroughId_fkey" FOREIGN KEY ("walkthroughId") REFERENCES "Walkthrough"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_walkthroughId_fkey" FOREIGN KEY ("walkthroughId") REFERENCES "Walkthrough"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ObservationEvidence" ADD CONSTRAINT "ObservationEvidence_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ObservationEvidence" ADD CONSTRAINT "ObservationEvidence_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ObservationEvidence" ADD CONSTRAINT "ObservationEvidence_transcriptSegmentId_fkey" FOREIGN KEY ("transcriptSegmentId") REFERENCES "TranscriptSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_walkthroughId_fkey" FOREIGN KEY ("walkthroughId") REFERENCES "Walkthrough"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportObservation" ADD CONSTRAINT "ReportObservation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportObservation" ADD CONSTRAINT "ReportObservation_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
