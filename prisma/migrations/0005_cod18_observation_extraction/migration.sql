-- AlterTable
ALTER TABLE "Observation" ADD COLUMN "processingRunId" TEXT;
ALTER TABLE "Observation" ADD COLUMN "sequence" INTEGER;
ALTER TABLE "Observation" ADD COLUMN "suggestedAction" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Observation_processingRunId_sequence_key" ON "Observation"("processingRunId", "sequence");

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_processingRunId_fkey" FOREIGN KEY ("processingRunId") REFERENCES "ProcessingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
