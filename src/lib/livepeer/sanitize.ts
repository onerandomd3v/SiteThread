import type { SafeJson } from "./types";

const PRIVATE_KEY = /authorization|token|secret|password|source_url|audio_url|video_url|signed.?url|access.?key|(^|_)url$/i;
const URL = /https?:\/\/[^\s"'<>]+/gi;
const BEARER = /Bearer\s+[^\s"']+/gi;
const LOCAL_PATH = /(?:[A-Za-z]:\\|\/Users\/|\/home\/)[^\s"'<>]+/gi;

export function sanitizeResultText(input: string): string {
  if (/X-Amz(?:-|%2D)(?:Signature|Credential|Algorithm)|AWSAccessKeyId/i.test(input)) return "[redacted media reference]";
  return input.slice(0, 10_000).replace(URL, "[redacted URL]").replace(BEARER, "[redacted credential]").replace(LOCAL_PATH, "[redacted path]");
}

export function sanitizeProviderResponse(input: unknown, depth = 0): SafeJson {
  if (depth > 8) return "[truncated]";
  if (input === null || typeof input === "boolean") return input;
  if (typeof input === "number") return Number.isFinite(input) ? input : "[invalid number]";
  if (typeof input === "string") return sanitizeResultText(input);
  if (Array.isArray(input)) return input.slice(0, 100).map((value) => sanitizeProviderResponse(value, depth + 1));
  if (typeof input !== "object") return "[unsupported]";
  const result: { [key: string]: SafeJson } = {};
  for (const [key, value] of Object.entries(input).slice(0, 100)) {
    if (!PRIVATE_KEY.test(key)) result[key] = sanitizeProviderResponse(value, depth + 1);
  }
  return result;
}
