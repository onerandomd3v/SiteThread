import { afterEach, describe, expect, it, vi } from "vitest";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

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
  vi.restoreAllMocks();
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

  it("uses a replayable bounded request for small temporary derivatives", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
    vi.stubEnv("R2_ACCOUNT_ID", "test-account");
    vi.stubEnv("R2_BUCKET_NAME", "test-bucket");
    vi.stubEnv("R2_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret-key");
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);

    const result = await r2MediaStorage.putFile({ objectKey: "temporary/audio.wav", filePath: "package.json", mimeType: "audio/wav" });

    expect(result.byteSize).toBeGreaterThan(0);
    expect(captureClientConfig).toHaveBeenCalledWith(expect.objectContaining({
      maxAttempts: 2,
      requestHandler: expect.objectContaining({ requestTimeout: 20_000, throwOnRequestTimeout: true }),
    }));
    const command = send.mock.calls[0]?.[0];
    if (!(command instanceof PutObjectCommand)) throw new Error("Expected one S3 put command.");
    expect(command.input.Body).toBeInstanceOf(Uint8Array);
  });
});
