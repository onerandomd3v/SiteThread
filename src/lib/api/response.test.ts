import { describe, expect, it } from "vitest";
import { SiteThreadError } from "@/lib/errors";
import { errorResponse } from "./response";

describe("API error responses", () => {
  it("does not expose internal error details", async () => {
    const response = errorResponse(new SiteThreadError("R2 credentials are missing", "INTERNAL_ERROR"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: "INTERNAL_ERROR", message: "An internal error occurred.", retryable: false } });
  });
});
