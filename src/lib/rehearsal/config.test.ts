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
  GEMINI_API_KEY: "gemini-key",
  GEMINI_MODEL: "gemini-3.8-flash",
  REASONER_PROVIDER: "groq",
  REASONER_MODEL: "openai/gpt-oss-20b",
  GROQ_API_KEY: "groq-key",
  MEDIA_PROVIDER_MODE: "live",
  LIVE_REHEARSAL: "true",
  REHEARSAL_REFERENCE_VIDEO: "C:/media/reference.mp4",
  REHEARSAL_MEDIA_CONSENT: "confirmed",
  REHEARSAL_DATABASE_CONSENT: "disposable",
} as const;

describe("live rehearsal configuration", () => {
  it("fails closed when live mode or required private services are missing", () => {
    expect(() => parseLiveRehearsalConfig({ ...configured, MEDIA_PROVIDER_MODE: "fixture" })).toThrow("refusing to run");
    expect(() => parseLiveRehearsalConfig({ ...configured, GEMINI_API_KEY: undefined })).toThrow("GEMINI_API_KEY");
    expect(() => parseLiveRehearsalConfig({ ...configured, GEMINI_MODEL: undefined })).toThrow("GEMINI_MODEL");
    expect(() => parseLiveRehearsalConfig({ ...configured, GROQ_API_KEY: undefined })).toThrow("GROQ_API_KEY");
    expect(() => parseLiveRehearsalConfig({ ...configured, REASONER_PROVIDER: undefined })).toThrow("REASONER_PROVIDER");
    expect(() => parseLiveRehearsalConfig({ ...configured, REASONER_MODEL: undefined })).toThrow("REASONER_MODEL");
    expect(() => parseLiveRehearsalConfig({ ...configured, REASONER_PROVIDER: "google-gemini" })).toThrow("REASONER_PROVIDER");
    expect(() => parseLiveRehearsalConfig({ ...configured, REASONER_MODEL: "openai/gpt-oss-120b" })).toThrow("REASONER_MODEL");
  });

  it("requires an explicit consented reference and returns the rehearsal base URL", () => {
    expect(parseLiveRehearsalConfig(configured).REHEARSAL_BASE_URL).toBe("http://localhost:3002");
    expect(parseLiveRehearsalConfig(configured).GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(parseLiveRehearsalConfig(configured).REASONER_PROVIDER).toBe("groq");
    expect(parseLiveRehearsalConfig(configured).REASONER_MODEL).toBe("openai/gpt-oss-20b");
    expect(() => parseLiveRehearsalConfig({ ...configured, REHEARSAL_MEDIA_CONSENT: "unknown" })).toThrow("REHEARSAL_MEDIA_CONSENT");
    expect(() => parseLiveRehearsalConfig({ ...configured, REHEARSAL_DATABASE_CONSENT: "shared" })).toThrow("REHEARSAL_DATABASE_CONSENT");
  });
});
