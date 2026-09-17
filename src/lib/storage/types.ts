export interface MediaObject {
  assetId: string;
  objectKey: string;
  mimeType: string;
  byteSize?: number;
}

export interface UploadIntent {
  assetId: string;
  objectKey: string;
  uploadUrl: string;
  expiresAt: Date;
}

export interface MediaStorage {
  createUploadIntent(input: { walkthroughId: string; fileName: string; mimeType: string }): Promise<UploadIntent>;
  createReadUrl(input: { assetId: string; expiresInSeconds: number }): Promise<string>;
  getObject(input: { assetId: string }): Promise<MediaObject>;
}
