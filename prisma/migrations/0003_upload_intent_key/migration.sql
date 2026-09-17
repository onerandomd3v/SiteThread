ALTER TABLE "Walkthrough" ADD COLUMN "uploadIntentKey" TEXT;

CREATE UNIQUE INDEX "Walkthrough_uploadIntentKey_key" ON "Walkthrough"("uploadIntentKey");
