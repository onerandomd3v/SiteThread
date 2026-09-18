-- DropIndex
DROP INDEX "TranscriptSegment_walkthroughId_sequence_key";

-- AlterTable
ALTER TABLE "ProcessingRun" ADD COLUMN     "retryable" BOOLEAN;

-- AlterTable
ALTER TABLE "TranscriptSegment" ADD COLUMN     "processingRunId" TEXT;

-- CreateTable
CREATE TABLE "ProviderInvocation" (
    "id" TEXT NOT NULL,
    "processingRunId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "sourceStartSeconds" DOUBLE PRECISION NOT NULL,
    "sourceEndSeconds" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "rawResponse" JSONB,
    "errorCode" TEXT,
    "retryable" BOOLEAN,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualCandidate" (
    "id" TEXT NOT NULL,
    "processingRunId" TEXT NOT NULL,
    "walkthroughId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "providerInvocationId" TEXT NOT NULL,
    "clipStartSeconds" DOUBLE PRECISION NOT NULL,
    "clipEndSeconds" DOUBLE PRECISION NOT NULL,
    "sourceStartSeconds" DOUBLE PRECISION NOT NULL,
    "sourceEndSeconds" DOUBLE PRECISION NOT NULL,
    "eventStartSeconds" DOUBLE PRECISION,
    "eventEndSeconds" DOUBLE PRECISION,
    "text" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisualCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderInvocation_idempotencyKey_key" ON "ProviderInvocation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProviderInvocation_processingRunId_stage_idx" ON "ProviderInvocation"("processingRunId", "stage");

-- CreateIndex
CREATE INDEX "VisualCandidate_walkthroughId_sourceStartSeconds_idx" ON "VisualCandidate"("walkthroughId", "sourceStartSeconds");

-- CreateIndex
CREATE UNIQUE INDEX "VisualCandidate_processingRunId_mediaAssetId_key" ON "VisualCandidate"("processingRunId", "mediaAssetId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_walkthroughId_sequence_idx" ON "TranscriptSegment"("walkthroughId", "sequence");

-- CreateIndex
CREATE INDEX "TranscriptSegment_processingRunId_sequence_idx" ON "TranscriptSegment"("processingRunId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptSegment_processingRunId_sourceAssetId_startSecond_key" ON "TranscriptSegment"("processingRunId", "sourceAssetId", "startSeconds", "endSeconds");

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_processingRunId_fkey" FOREIGN KEY ("processingRunId") REFERENCES "ProcessingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvocation" ADD CONSTRAINT "ProviderInvocation_processingRunId_fkey" FOREIGN KEY ("processingRunId") REFERENCES "ProcessingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualCandidate" ADD CONSTRAINT "VisualCandidate_processingRunId_fkey" FOREIGN KEY ("processingRunId") REFERENCES "ProcessingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualCandidate" ADD CONSTRAINT "VisualCandidate_walkthroughId_fkey" FOREIGN KEY ("walkthroughId") REFERENCES "Walkthrough"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualCandidate" ADD CONSTRAINT "VisualCandidate_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualCandidate" ADD CONSTRAINT "VisualCandidate_providerInvocationId_fkey" FOREIGN KEY ("providerInvocationId") REFERENCES "ProviderInvocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
