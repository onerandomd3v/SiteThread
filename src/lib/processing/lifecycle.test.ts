import { describe, expect, it } from "vitest";
import type { db } from "@/lib/db/client";
import { canTransitionProcessingStatus, failProcessingRunIfCurrent, retryProcessingRun } from "./lifecycle";

describe("processing lifecycle", () => {
  it("allows the upload and durable queue transitions", () => {
    expect(canTransitionProcessingStatus("UPLOADING", "UPLOADED")).toBe(true);
    expect(canTransitionProcessingStatus("UPLOADED", "QUEUED")).toBe(true);
    expect(canTransitionProcessingStatus("QUEUED", "TRANSCRIBING")).toBe(true);
  });

  it("allows retry from a failed run and rejects skipping stages", () => {
    expect(canTransitionProcessingStatus("PROCESSING_FAILED", "QUEUED")).toBe(true);
    expect(canTransitionProcessingStatus("UPLOADING", "NEEDS_REVIEW")).toBe(false);
    expect(canTransitionProcessingStatus("REPORT_READY", "QUEUED")).toBe(false);
  });

  it("increments the retry count once when two requests race to retry the same run", async () => {
    const run = { id: "run", walkthroughId: "walk", status: "PROCESSING_FAILED", retryCount: 0 };
    const database = {
      processingRun: {
        findUnique: async () => ({ ...run }),
        findUniqueOrThrow: async () => ({ ...run }),
        updateMany: async ({ where }: { where: { status: string } }) => {
          if (run.status !== where.status) return { count: 0 };
          run.status = "QUEUED";
          run.retryCount += 1;
          return { count: 1 };
        },
      },
    } as unknown as typeof db;
    await Promise.all([retryProcessingRun("run", database), retryProcessingRun("run", database)]);
    expect(run.retryCount).toBe(1);
    expect(run.status).toBe("QUEUED");
  });

  it("does not replace a completed extraction with a late failure", async () => {
    const run = {
      id: "run",
      status: "NEEDS_REVIEW",
      failedStep: null as string | null,
      errorCode: null as string | null,
      errorMessage: null as string | null,
      retryable: null as boolean | null,
    };
    const database = {
      processingRun: {
        updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
          if (run.id !== where.id || run.status !== where.status) return { count: 0 };
          Object.assign(run, data);
          return { count: 1 };
        },
      },
    } as unknown as typeof db;
    await expect(failProcessingRunIfCurrent("run", "EXTRACTING_OBSERVATIONS", { failedStep: "EXTRACTING_OBSERVATIONS" }, database)).resolves.toBe(false);
    expect(run).toEqual({ id: "run", status: "NEEDS_REVIEW", failedStep: null, errorCode: null, errorMessage: null, retryable: null });
  });
});
