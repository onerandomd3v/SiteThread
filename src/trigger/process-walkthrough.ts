import { task } from "@trigger.dev/sdk";
import { processWalkthrough } from "@/lib/processing/pipeline";

export const processWalkthroughTask = task({
  id: "process-walkthrough",
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 1 },
  maxDuration: 7200,
  run: async (payload: { processingRunId: string }) => {
    await processWalkthrough(payload.processingRunId);
  },
});
