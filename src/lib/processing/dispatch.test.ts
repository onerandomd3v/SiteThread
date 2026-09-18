import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trigger: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger: mocks.trigger } }));
vi.mock("@/lib/db/client", () => ({ db: { processingRun: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } } }));

import { dispatchProcessingRun } from "./dispatch";

const queuedRun = { id: "run-1", pipelineVersion: "mvp-upload-v1", retryCount: 2, status: "QUEUED" };

describe("Trigger dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TRIGGER_SECRET_KEY", "test-placeholder");
    mocks.findUnique.mockResolvedValue(queuedRun);
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
});
