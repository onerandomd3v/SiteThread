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
  verifyUpload(input: { objectKey: string; expectedByteSize: number; expectedMimeType: string }): Promise<{ byteSize: number; mimeType?: string }>;
  createReadUrl(input: { assetId: string; expiresInSeconds: number }): Promise<string>;
  getObject(input: { assetId: string }): Promise<MediaObject>;
}
