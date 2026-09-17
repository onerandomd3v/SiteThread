import { z } from "zod";

export const SUPPORTED_WALKTHROUGH_MIME_TYPE = "video/mp4";
export const MAX_WALKTHROUGH_UPLOAD_BYTES = 100 * 1024 * 1024;

export const UploadIntentRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(200).refine((value) => value.toLowerCase().endsWith(".mp4"), "Filename must end in .mp4."),
  mimeType: z.literal(SUPPORTED_WALKTHROUGH_MIME_TYPE),
  byteSize: z.number().int().positive().max(MAX_WALKTHROUGH_UPLOAD_BYTES),
  idempotencyKey: z.string().uuid(),
});

export type UploadIntentRequest = z.infer<typeof UploadIntentRequestSchema>;

export function isSupportedWalkthroughFile(file: Pick<File, "name" | "type" | "size">): boolean {
  return file.type === SUPPORTED_WALKTHROUGH_MIME_TYPE
    && file.name.toLowerCase().endsWith(".mp4")
    && file.size > 0
    && file.size <= MAX_WALKTHROUGH_UPLOAD_BYTES;
}

export function fileValidationMessage(file: Pick<File, "name" | "type" | "size">): string | undefined {
  if (!file.name.toLowerCase().endsWith(".mp4") || file.type !== SUPPORTED_WALKTHROUGH_MIME_TYPE) {
    return "Choose an MP4 video file. The upload boundary currently accepts video/mp4 only.";
  }
  if (file.size <= 0) return "The selected video is empty.";
  if (file.size > MAX_WALKTHROUGH_UPLOAD_BYTES) {
    return "The selected video is larger than the 100 MiB MVP upload limit.";
  }
  return undefined;
}
