import { afterEach, describe, expect, it, vi } from "vitest";

const { captureClientConfig } = vi.hoisted(() => ({ captureClientConfig: vi.fn() }));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: class extends actual.S3Client {
      constructor(config: ConstructorParameters<typeof actual.S3Client>[0]) {
        super(config ?? {});
        captureClientConfig(config);
      }
    },
  };
});

import { hasMp4Ftyp, r2MediaStorage } from "./r2";

afterEach(() => {
  vi.unstubAllEnvs();
  captureClientConfig.mockClear();
});

describe("R2 upload signature verification", () => {
  it("accepts an ISO Base Media ftyp header", () => {
    const header = new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
    expect(hasMp4Ftyp(header)).toBe(true);
  });

  it("rejects arbitrary bytes", () => {
    expect(hasMp4Ftyp(new Uint8Array(64))).toBe(false);
  });

  it("bounds R2 requests so upload finalization cannot wait on unbounded storage calls", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
    vi.stubEnv("R2_ACCOUNT_ID", "test-account");
    vi.stubEnv("R2_BUCKET_NAME", "test-bucket");
    vi.stubEnv("R2_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret-key");

    await r2MediaStorage.createUploadIntent({ objectKey: "test.mp4", mimeType: "video/mp4" });

    expect(captureClientConfig).toHaveBeenCalledWith(expect.objectContaining({
      maxAttempts: 1,
      requestHandler: {
        connectionTimeout: 5_000,
        requestTimeout: 20_000,
        throwOnRequestTimeout: true,
        socketTimeout: 20_000,
      },
    }));
  });
});
