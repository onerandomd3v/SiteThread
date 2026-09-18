export interface MediaObject {
  assetId: string;
  objectKey: string;
  mimeType: string;
  byteSize?: number;
}

export interface UploadIntent {
  objectKey: string;
  uploadUrl: string;
  expiresAt: Date;
  requiredHeaders: Record<string, string>;
}

export interface MediaStorage {
  createUploadIntent(input: { objectKey: string; mimeType: string }): Promise<UploadIntent>;
  verifyUpload(input: { objectKey: string; expectedByteSize: number; expectedMimeType: string }): Promise<{ byteSize: number; mimeType?: string; etag: string }>;
  promoteUpload(input: { sourceObjectKey: string; destinationObjectKey: string; sourceETag: string; mimeType: string }): Promise<void>;
  deleteObject(input: { objectKey: string }): Promise<void>;
  createReadUrl(input: { assetId: string; expiresInSeconds: number }): Promise<string>;
  getObject(input: { assetId: string }): Promise<MediaObject>;
}

export interface ProcessingMediaStorage extends MediaStorage {
  downloadToFile(input: { objectKey: string; filePath: string }): Promise<void>;
  putFile(input: { objectKey: string; filePath: string; mimeType: string }): Promise<{ byteSize: number }>;
}
