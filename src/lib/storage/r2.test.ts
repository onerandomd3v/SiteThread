import { afterEach, describe, expect, it, vi } from "vitest";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

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

  it("reopens a bounded upload stream when a transient R2 failure is retried", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
    vi.stubEnv("R2_ACCOUNT_ID", "test-account");
    vi.stubEnv("R2_BUCKET_NAME", "test-bucket");
    vi.stubEnv("R2_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret-key");
    const streams: Readable[] = [];
    const payloads: Buffer[] = [];
    const send = vi.spyOn(S3Client.prototype, "send").mockImplementation((async (command: unknown) => {
      if (!(command instanceof PutObjectCommand)) throw new Error("Expected a put command.");
      if (!(command.input.Body instanceof Readable)) throw new Error("Expected a streaming upload body.");
      streams.push(command.input.Body);
      const chunks: Buffer[] = [];
      for await (const chunk of command.input.Body) chunks.push(Buffer.from(chunk));
      payloads.push(Buffer.concat(chunks));
      if (streams.length === 1) throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
      return {};
    }) as S3Client["send"]);

    const result = await r2MediaStorage.putFile({ objectKey: "temporary/audio.wav", filePath: "package.json", mimeType: "audio/wav" });

    expect(result.byteSize).toBeGreaterThan(0);
    expect(captureClientConfig).toHaveBeenCalledWith(expect.objectContaining({
      maxAttempts: 1,
      requestHandler: expect.objectContaining({ requestTimeout: 20_000, throwOnRequestTimeout: true }),
    }));
    expect(send).toHaveBeenCalledTimes(2);
    expect(streams[0]).not.toBe(streams[1]);
    expect(payloads[1]).toEqual(payloads[0]);
  });

  it("does not retry a non-transient R2 upload rejection", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
    vi.stubEnv("R2_ACCOUNT_ID", "test-account");
    vi.stubEnv("R2_BUCKET_NAME", "test-bucket");
    vi.stubEnv("R2_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret-key");
    const send = vi.spyOn(S3Client.prototype, "send").mockRejectedValue(Object.assign(new Error("forbidden"), { $metadata: { httpStatusCode: 403 } }));

    await expect(r2MediaStorage.putFile({ objectKey: "temporary/audio.wav", filePath: "package.json", mimeType: "audio/wav" })).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });

    expect(send).toHaveBeenCalledTimes(1);
  });
});
