import { createHash } from "node:crypto";

type SafeLogValue = boolean | number | string | null;

const SAFE_FIELDS = new Set([
  "walkthroughId",
  "processingRunId",
  "pipelineVersion",
  "stage",
  "capability",
  "provider",
  "retryCount",
  "errorCode",
  "retryable",
  "latencyMs",
  "status",
  "outcome",
  "reportId",
  "keyHash",
  "phase",
  "errorName",
  "errorCategory",
  "validationIssues",
  "candidateCount",
  "groundedCount",
  "httpStatus",
  "providerErrorCode",
]);

export function safeIdHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function logEvent(event: string, fields: Record<string, SafeLogValue> = {}): void {
  const safeFields = Object.fromEntries(Object.entries(fields).filter(([key, value]) => SAFE_FIELDS.has(key) && (value === null || ["boolean", "number", "string"].includes(typeof value))));
  console.info(JSON.stringify({ event, ...safeFields }));
}
