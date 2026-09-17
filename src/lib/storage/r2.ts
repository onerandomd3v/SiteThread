import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { parseServerEnv } from "@/lib/config/env";
import { SiteThreadError } from "@/lib/errors";
import type { MediaStorage, MediaObject, UploadIntent } from "./types";

const UPLOAD_URL_TTL_SECONDS = 15 * 60;

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
    }),
  };
}

export class R2MediaStorage implements MediaStorage {
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

  async verifyUpload(input: { objectKey: string; expectedByteSize: number; expectedMimeType: string }): Promise<{ byteSize: number; mimeType?: string }> {
    const { client, bucket } = createR2Client();
    try {
      const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: input.objectKey }));
      const byteSize = result.ContentLength ?? 0;
      const mimeType = result.ContentType;
      if (byteSize !== input.expectedByteSize || (mimeType && mimeType !== input.expectedMimeType)) {
        throw new SiteThreadError("The uploaded media did not match the declared file.", "MEDIA_UNAVAILABLE", true);
      }
      return { byteSize, mimeType };
    } catch (error) {
      if (error instanceof SiteThreadError) throw error;
      throw new SiteThreadError("The uploaded media could not be verified yet.", "MEDIA_UNAVAILABLE", true, { cause: error });
    }
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
}

export const r2MediaStorage = new R2MediaStorage();
