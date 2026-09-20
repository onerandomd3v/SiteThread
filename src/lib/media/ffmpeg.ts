import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { SiteThreadError } from "@/lib/errors";
import type { SourceRange } from "@/lib/processing/selection";

const run = promisify(execFile);
const probeSchema = z.object({ format: z.object({ duration: z.string() }) });

async function mediaCommand(binary: string, args: string[], timeout: number): Promise<string> {
  try {
    const { stdout } = await run(binary, args, { timeout, maxBuffer: 1024 * 1024, windowsHide: true });
    return stdout;
  } catch {
    throw new SiteThreadError("The walkthrough media could not be processed.", "MEDIA_UNAVAILABLE");
  }
}

export async function probeDuration(filePath: string): Promise<number> {
  const output = await mediaCommand(process.env.FFPROBE_PATH ?? "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", filePath], 30_000);
  try {
    const parsed = probeSchema.parse(JSON.parse(output));
    const seconds = Number(parsed.format.duration);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  } catch {
    // A malformed probe is handled as unsupported media below.
  }
  throw new SiteThreadError("The walkthrough duration could not be determined.", "MEDIA_UNAVAILABLE");
}

export async function extractAudioWindow(sourcePath: string, outputPath: string, range: SourceRange): Promise<void> {
  await mediaCommand(process.env.FFMPEG_PATH ?? "ffmpeg", ["-v", "error", "-y", "-ss", String(range.startSeconds), "-i", sourcePath, "-t", String(range.endSeconds - range.startSeconds), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", outputPath], 90_000);
}

export async function extractVisualClip(sourcePath: string, outputPath: string, range: SourceRange): Promise<void> {
  await mediaCommand(process.env.FFMPEG_PATH ?? "ffmpeg", ["-v", "error", "-y", "-ss", String(range.startSeconds), "-i", sourcePath, "-t", String(range.endSeconds - range.startSeconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", outputPath], 120_000);
}

export async function extractVisualFrame(sourcePath: string, outputPath: string, offsetSeconds: number): Promise<void> {
  if (!Number.isFinite(offsetSeconds) || offsetSeconds < 0) throw new SiteThreadError("The evidence frame time is invalid.", "MEDIA_UNAVAILABLE");
  await mediaCommand(process.env.FFMPEG_PATH ?? "ffmpeg", ["-v", "error", "-y", "-ss", String(offsetSeconds), "-i", sourcePath, "-frames:v", "1", "-q:v", "2", "-f", "image2", outputPath], 90_000);
}
