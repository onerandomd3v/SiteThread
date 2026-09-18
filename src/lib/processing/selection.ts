import { SiteThreadError } from "@/lib/errors";

export interface SourceRange {
  startSeconds: number;
  endSeconds: number;
}

export interface TranscriptWindow extends SourceRange {
  text: string;
}

const AUDIO_WINDOW_SECONDS = 6;
const VISUAL_BUCKET_SECONDS = 20;
const MAX_VISUAL_CALLS = 6;
const MAX_WALKTHROUGH_SECONDS = 120;

function validDuration(durationSeconds: number): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_WALKTHROUGH_SECONDS) {
    throw new SiteThreadError("The walkthrough duration is outside the supported processing range.", "INVALID_INPUT");
  }
}

export function audioWindows(durationSeconds: number): SourceRange[] {
  validDuration(durationSeconds);
  const result: SourceRange[] = [];
  for (let startSeconds = 0; startSeconds < durationSeconds; startSeconds += AUDIO_WINDOW_SECONDS) {
    result.push({ startSeconds, endSeconds: Math.min(startSeconds + AUDIO_WINDOW_SECONDS, durationSeconds) });
  }
  return result;
}

export function visualClips(durationSeconds: number, transcript: TranscriptWindow[]): SourceRange[] {
  validDuration(durationSeconds);
  const result: SourceRange[] = [];
  for (let bucketStart = 0; bucketStart < durationSeconds && result.length < MAX_VISUAL_CALLS; bucketStart += VISUAL_BUCKET_SECONDS) {
    const bucketEnd = Math.min(bucketStart + VISUAL_BUCKET_SECONDS, durationSeconds);
    const center = (bucketStart + bucketEnd) / 2;
    const narrated = transcript
      .filter((window) => window.text.trim() && window.startSeconds < bucketEnd && window.endSeconds > bucketStart)
      .sort((left, right) => Math.abs((left.startSeconds + left.endSeconds) / 2 - center) - Math.abs((right.startSeconds + right.endSeconds) / 2 - center) || left.startSeconds - right.startSeconds)[0];
    const desiredCenter = narrated ? (narrated.startSeconds + narrated.endSeconds) / 2 : center;
    const length = Math.min(AUDIO_WINDOW_SECONDS, durationSeconds);
    const startSeconds = Math.max(0, Math.min(desiredCenter - length / 2, durationSeconds - length));
    const clip = { startSeconds, endSeconds: Math.min(startSeconds + length, durationSeconds) };
    if (result.some((prior) => clip.startSeconds < prior.endSeconds && clip.endSeconds > prior.startSeconds)) continue;
    result.push(clip);
  }
  return result;
}

export function providerEventSourceRange(clip: SourceRange, local: unknown, sourceDuration: number, actualClipDuration = clip.endSeconds - clip.startSeconds): SourceRange {
  const fallback = { ...clip };
  if (!Number.isFinite(actualClipDuration) || actualClipDuration <= 0) return fallback;
  if (!local || typeof local !== "object") return fallback;
  const candidate = local as { startSeconds?: unknown; endSeconds?: unknown };
  const start = candidate.startSeconds;
  const end = candidate.endSeconds;
  const clipDuration = Math.min(clip.endSeconds - clip.startSeconds, actualClipDuration);
  if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || end > clipDuration) return fallback;
  const mapped = { startSeconds: clip.startSeconds + start, endSeconds: clip.startSeconds + end };
  return mapped.startSeconds >= clip.startSeconds && mapped.endSeconds <= clip.endSeconds && mapped.endSeconds <= sourceDuration ? mapped : fallback;
}
