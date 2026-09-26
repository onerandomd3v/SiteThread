import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { MAX_WALKTHROUGH_UPLOAD_BYTES } from "../walkthroughs/upload-policy.ts";

const exec = promisify(execFile);

export type ReferenceMediaMetadata = {
  durationSeconds: number;
  streams: Array<{ codecType: string; codecName: string }>;
  byteSize: number;
  sha256: string;
};

export function validateReferenceMedia(metadata: ReferenceMediaMetadata): ReferenceMediaMetadata {
  if (metadata.byteSize <= 0 || metadata.byteSize > MAX_WALKTHROUGH_UPLOAD_BYTES) throw new Error("The reference media exceeds the current upload policy.");
  if (!Number.isFinite(metadata.durationSeconds) || metadata.durationSeconds < 60 || metadata.durationSeconds > 120) throw new Error("The reference media must be between 60 and 120 seconds.");
  if (!metadata.streams.some((stream) => stream.codecType === "video" && stream.codecName === "h264")) throw new Error("The reference media must contain H.264 video.");
  if (!metadata.streams.some((stream) => stream.codecType === "audio" && stream.codecName === "aac")) throw new Error("The reference media must contain AAC audio.");
  return metadata;
}

export async function probeReferenceMedia(filePath: string, ffprobePath = process.env.FFPROBE_PATH ?? "ffprobe"): Promise<ReferenceMediaMetadata> {
  const [file, bytes] = await Promise.all([stat(filePath), readFile(filePath)]);
  let stdout: string;
  try {
    ({ stdout } = await exec(ffprobePath, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name", "-of", "json", filePath], { timeout: 30_000, windowsHide: true }));
  } catch {
    throw new Error("FFprobe could not inspect the reference media.");
  }
  const parsed = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; codec_name?: string }> };
  const metadata = {
    durationSeconds: Number(parsed.format?.duration),
    streams: (parsed.streams ?? []).flatMap((stream) => stream.codec_type && stream.codec_name ? [{ codecType: stream.codec_type, codecName: stream.codec_name }] : []),
    byteSize: file.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  return validateReferenceMedia(metadata);
}
