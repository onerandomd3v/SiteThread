import { SiteThreadError, type SiteThreadErrorCode } from "@/lib/errors";
import type { SafeJson } from "./types";
import { sanitizeProviderResponse } from "./sanitize";

export class ProviderCallError extends SiteThreadError {
  readonly rawResponse: SafeJson;

  constructor(message: string, code: SiteThreadErrorCode, retryable: boolean, rawResponse: unknown = null) {
    super(message, code, retryable);
    this.rawResponse = sanitizeProviderResponse(rawResponse);
  }
}
