import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trigger: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger: mocks.trigger } }));
vi.mock("@/lib/db/client", () => ({ db: { processingRun: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } } }));

import { dispatchProcessingRun } from "./dispatch";
import { PIPELINE_VERSION } from "./lifecycle";

const queuedRun = { id: "run-1", pipelineVersion: PIPELINE_VERSION, retryCount: 2, status: "QUEUED" };

describe("Trigger dispatch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("TRIGGER_SECRET_KEY", "test-placeholder");
    mocks.findUnique.mockResolvedValue(queuedRun);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.trigger.mockResolvedValue({ id: "task" });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("uses the same ProcessingRun attempt key for duplicate finalize or retry requests", async () => {
    await dispatchProcessingRun("run-1");
    await dispatchProcessingRun("run-1");
    const keys = mocks.trigger.mock.calls.map((call) => call[2].idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reuses the same key after a lost Trigger response", async () => {
    mocks.trigger.mockRejectedValueOnce(new Error("response lost"));
    await dispatchProcessingRun("run-1");
    const keys = mocks.trigger.mock.calls.map((call) => call[2].idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("records a retryable failure when dispatch cannot be confirmed", async () => {
    mocks.trigger.mockRejectedValue(new Error("unreachable"));
    await expect(dispatchProcessingRun("run-1")).rejects.toMatchObject({ code: "PROCESSING_FAILED", retryable: true });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "run-1", status: "QUEUED" }, data: expect.objectContaining({ status: "PROCESSING_FAILED", failedStep: "DISPATCH" }) }));
  });

  it("accepts a worker claim when both Trigger acknowledgements are lost", async () => {
    mocks.trigger.mockRejectedValue(new Error("response lost"));
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValueOnce(queuedRun).mockResolvedValueOnce({ ...queuedRun, status: "TRANSCRIBING" });
    await expect(dispatchProcessingRun("run-1")).resolves.toBeUndefined();
    expect(mocks.trigger).toHaveBeenCalledTimes(2);
    expect(mocks.trigger.mock.calls[1][2].idempotencyKey).toBe(mocks.trigger.mock.calls[0][2].idempotencyKey);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "run-1", status: "QUEUED" } }));
  });
});
