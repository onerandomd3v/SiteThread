import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent, safeIdHash } from "./log";

describe("structured operational logging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits only the allowlisted safe fields", () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logEvent("processing.stage.completed", { processingRunId: "run-1", stage: "TRANSCRIBING", transcript: "private text", signedUrl: "https://private.example" } as never);
    expect(output).toHaveBeenCalledWith(JSON.stringify({ event: "processing.stage.completed", processingRunId: "run-1", stage: "TRANSCRIBING" }));
  });

  it("hashes provider identities before logging them", () => {
    expect(safeIdHash("run-1|mvp-upload-v1|TRANSCRIBING")).toMatch(/^[a-f0-9]{16}$/);
  });
});
