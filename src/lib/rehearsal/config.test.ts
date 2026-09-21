import { describe, expect, it } from "vitest";
import { parseLiveRehearsalConfig } from "./config";

const configured = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/sitethread",
  R2_ACCOUNT_ID: "account",
  R2_BUCKET_NAME: "bucket",
  R2_ACCESS_KEY_ID: "access",
  R2_SECRET_ACCESS_KEY: "secret",
  TRIGGER_SECRET_KEY: "trigger",
  TRIGGER_PROJECT_REF: "project",
  LIVEPEER_MCP_URL: "https://agent.livepeer.org/api/mcp/raw",
  LIVEPEER_MCP_BEARER: "bearer",
  MEDIA_PROVIDER_MODE: "live",
  LIVE_REHEARSAL: "true",
  REHEARSAL_REFERENCE_VIDEO: "C:/media/reference.mp4",
  REHEARSAL_MEDIA_CONSENT: "confirmed",
  REHEARSAL_DATABASE_CONSENT: "disposable",
} as const;

describe("live rehearsal configuration", () => {
  it("fails closed when live mode or required private services are missing", () => {
    expect(() => parseLiveRehearsalConfig({ ...configured, MEDIA_PROVIDER_MODE: "fixture" })).toThrow("refusing to run");
    expect(() => parseLiveRehearsalConfig({ ...configured, LIVEPEER_MCP_BEARER: undefined })).toThrow("LIVEPEER_MCP_BEARER");
  });

  it("requires an explicit consented reference and returns the rehearsal base URL", () => {
    expect(parseLiveRehearsalConfig(configured).REHEARSAL_BASE_URL).toBe("http://localhost:3002");
    expect(() => parseLiveRehearsalConfig({ ...configured, REHEARSAL_MEDIA_CONSENT: "unknown" })).toThrow("REHEARSAL_MEDIA_CONSENT");
    expect(() => parseLiveRehearsalConfig({ ...configured, REHEARSAL_DATABASE_CONSENT: "shared" })).toThrow("REHEARSAL_DATABASE_CONSENT");
  });
});
