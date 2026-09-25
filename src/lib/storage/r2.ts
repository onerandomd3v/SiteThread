import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseServerEnv } from "@/lib/config/env";
import { SiteThreadError } from "@/lib/errors";
import { logEvent } from "@/lib/observability/log";
import type { ProcessingMediaStorage, MediaObject, UploadIntent } from "./types";

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const SIGNATURE_RANGE = "bytes=0-63";
const R2_REQUEST_TIMEOUT_MS = 20_000;

export function hasMp4Ftyp(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 12, 32);
  for (let offset = 0; offset <= limit; offset += 1) {
    if (bytes[offset + 4] !== 0x66 || bytes[offset + 5] !== 0x74 || bytes[offset + 6] !== 0x79 || bytes[offset + 7] !== 0x70) continue;
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    return boxSize >= 16 && offset + 12 <= bytes.length;
  }
  return false;
}

function createR2Client(): { client: S3Client; bucket: string } {
  const env = parseServerEnv();
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new SiteThreadError("Private media storage is not configured.", "INTERNAL_ERROR", false);
  }
  return {
    bucket: env.R2_BUCKET_NAME,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
      maxAttempts: 1,
      requestHandler: {
        connectionTimeout: 5_000,
        requestTimeout: R2_REQUEST_TIMEOUT_MS,
        throwOnRequestTimeout: true,
        socketTimeout: R2_REQUEST_TIMEOUT_MS,
      },
    }),
  };
}

function isRetryableR2RequestError(error: unknown): boolean {
  const retryableCodes = new Set([
    "ECONNABORTED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "EPIPE",
    "ETIMEDOUT",
    "ERR_STREAM_DESTROYED",
    "ERR_STREAM_PREMATURE_CLOSE",
    "ENETUNREACH",
    "EAI_AGAIN",
  ]);
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const record = current as { code?: unknown; $metadata?: { httpStatusCode?: unknown }; cause?: unknown; name?: unknown };
    const status = record.$metadata?.httpStatusCode;
    if (status === 408 || status === 429 || (typeof status === "number" && status >= 500)) return true;
    if (typeof record.code === "string" && retryableCodes.has(record.code)) return true;
    if (record.name === "TimeoutError" || record.name === "AbortError") return true;
    current = record.cause;
  }
  return false;
}

function logR2Failure(operation: "download" | "upload", error: unknown, retryable: boolean): void {
  let current: unknown = error;
  let errorCode: string | undefined;
  let status: number | undefined;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const record = current as { code?: unknown; Code?: unknown; name?: unknown; $metadata?: { httpStatusCode?: unknown }; cause?: unknown };
    const candidate = record.Code ?? record.code;
    if (typeof candidate === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(candidate) && (!errorCode || record.name === "SiteThreadError")) errorCode = candidate;
    if (typeof record.$metadata?.httpStatusCode === "number" && record.$metadata.httpStatusCode >= 100 && record.$metadata.httpStatusCode <= 599) status = record.$metadata.httpStatusCode;
    current = record.cause;
  }
  logEvent(`storage.r2.${operation}.failed`, { errorCode: errorCode ?? "UNKNOWN", status: status ?? null, retryable });
}

export class R2MediaStorage implements ProcessingMediaStorage {
  async createUploadIntent(input: { objectKey: string; mimeType: string }): Promise<UploadIntent> {
    const { client, bucket } = createR2Client();
    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000);
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: input.objectKey, ContentType: input.mimeType }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
    return {
      objectKey: input.objectKey,
      uploadUrl,
      expiresAt,
      requiredHeaders: { "content-type": input.mimeType },
    };
  }

  async verifyUpload(input: { objectKey: string; expectedByteSize: number; expectedMimeType: string }): Promise<{ byteSize: number; mimeType?: string; etag: string }> {
    const { client, bucket } = createR2Client();
    try {
      const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: input.objectKey }));
      const byteSize = result.ContentLength ?? 0;
      const mimeType = result.ContentType;
      if (byteSize !== input.expectedByteSize || mimeType !== input.expectedMimeType) {
        throw new SiteThreadError("The uploaded media did not match the declared file.", "MEDIA_UNAVAILABLE", true);
      }
      const ranged = await client.send(new GetObjectCommand({ Bucket: bucket, Key: input.objectKey, Range: SIGNATURE_RANGE }));
      const signatureBytes = ranged.Body ? await ranged.Body.transformToByteArray() : new Uint8Array();
      if (!hasMp4Ftyp(signatureBytes)) {
        throw new SiteThreadError("The uploaded media is not a valid MP4 container.", "MEDIA_UNAVAILABLE");
      }
      if (!result.ETag) {
        throw new SiteThreadError("The uploaded media could not be verified yet.", "MEDIA_UNAVAILABLE", true);
      }
      return { byteSize, mimeType, etag: result.ETag };
    } catch (error) {
      if (error instanceof SiteThreadError) throw error;
      throw new SiteThreadError("The uploaded media could not be verified yet.", "MEDIA_UNAVAILABLE", true, { cause: error });
    }
  }

  async promoteUpload(input: { sourceObjectKey: string; destinationObjectKey: string; sourceETag: string; mimeType: string }): Promise<void> {
    const { client, bucket } = createR2Client();
    try {
      await client.send(new CopyObjectCommand({
        Bucket: bucket,
        Key: input.destinationObjectKey,
        CopySource: encodeURIComponent(`${bucket}/${input.sourceObjectKey}`),
        CopySourceIfMatch: input.sourceETag,
        ContentType: input.mimeType,
        MetadataDirective: "REPLACE",
      }));
    } catch (error) {
      throw new SiteThreadError("The verified media could not be finalized.", "MEDIA_UNAVAILABLE", true, { cause: error });
    }
  }

  async deleteObject(input: { objectKey: string }): Promise<void> {
    const { client, bucket } = createR2Client();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: input.objectKey }));
  }

  async createReadUrl(input: { assetId: string; expiresInSeconds: number }): Promise<string> {
    const { client, bucket } = createR2Client();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: input.assetId }), { expiresIn: input.expiresInSeconds });
  }

  async getObject(input: { assetId: string }): Promise<MediaObject> {
    const { client, bucket } = createR2Client();
    const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: input.assetId }));
    return { assetId: input.assetId, objectKey: input.assetId, mimeType: result.ContentType ?? "application/octet-stream", byteSize: result.ContentLength };
  }

  async downloadToFile(input: { objectKey: string; filePath: string }): Promise<void> {
    const { client, bucket } = createR2Client();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: input.objectKey }));
        if (!(result.Body instanceof Readable)) throw new SiteThreadError("The source media is unavailable.", "MEDIA_UNAVAILABLE");
        await pipeline(result.Body, createWriteStream(input.filePath));
        return;
      } catch (error) {
        if (attempt === 0 && isRetryableR2RequestError(error)) continue;
        const retryable = error instanceof SiteThreadError ? error.retryable : isRetryableR2RequestError(error);
        logR2Failure("download", error, retryable);
        if (error instanceof SiteThreadError) throw error;
        throw new SiteThreadError("The private source media could not be read.", "MEDIA_UNAVAILABLE", retryable, { cause: error });
      }
    }
  }

  async putFile(input: { objectKey: string; filePath: string; mimeType: string }): Promise<{ byteSize: number }> {
    const { client, bucket } = createR2Client();
    try {
      const file = await stat(input.filePath);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await client.send(new PutObjectCommand({ Bucket: bucket, Key: input.objectKey, Body: createReadStream(input.filePath), ContentLength: file.size, ContentType: input.mimeType }));
          return { byteSize: file.size };
        } catch (error) {
          if (attempt === 0 && isRetryableR2RequestError(error)) continue;
          throw error;
        }
      }
      throw new Error("The bounded R2 upload retry limit was exceeded.");
    } catch (error) {
      const retryable = isRetryableR2RequestError(error);
      logR2Failure("upload", error, retryable);
      throw new SiteThreadError("A private media derivative could not be stored.", "MEDIA_UNAVAILABLE", retryable, { cause: error });
    }
  }
}

export const r2MediaStorage = new R2MediaStorage();
