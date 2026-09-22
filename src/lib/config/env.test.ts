import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const requiredValues = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/sitethread",
  R2_BUCKET_NAME: "sitethread-media",
};

describe("server environment contract", () => {
  it("normalizes blank optional values to undefined", () => {
    const env = parseServerEnv({ ...requiredValues, R2_ACCOUNT_ID: "", LIVEPEER_MCP_BEARER: "   ", LIVEPEER_MCP_URL: " ", LIVEPEER_CREATIVE_MCP_URL: "   " });
    expect(env.R2_ACCOUNT_ID).toBeUndefined();
    expect(env.LIVEPEER_MCP_BEARER).toBeUndefined();
    expect(env.LIVEPEER_MCP_URL).toBeUndefined();
    expect(env.LIVEPEER_CREATIVE_MCP_URL).toBeUndefined();
  });

  it("preserves populated optional values", () => {
    const env = parseServerEnv({ ...requiredValues, R2_ACCOUNT_ID: "account-1", TRIGGER_SECRET_KEY: "secret-1" });
    expect(env.R2_ACCOUNT_ID).toBe("account-1");
    expect(env.TRIGGER_SECRET_KEY).toBe("secret-1");
  });

  it("rejects missing or invalid required values", () => {
    expect(() => parseServerEnv({ ...requiredValues, DATABASE_URL: undefined })).toThrow();
    expect(() => parseServerEnv({ ...requiredValues, LIVEPEER_MCP_URL: "not-a-url" })).toThrow();
    expect(() => parseServerEnv({ ...requiredValues, R2_BUCKET_NAME: "" })).toThrow();
  });
});
