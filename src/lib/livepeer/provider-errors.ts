import { SiteThreadError, type SiteThreadErrorCode } from "@/lib/errors";
import type { ProviderAttribution, SafeJson } from "./types";
import { sanitizeProviderResponse } from "./sanitize";

export class ProviderCallError extends SiteThreadError {
  readonly rawResponse: SafeJson;
  readonly attribution?: ProviderAttribution;

  constructor(message: string, code: SiteThreadErrorCode, retryable: boolean, rawResponse: unknown = null, attribution?: ProviderAttribution) {
    super(message, code, retryable);
    this.rawResponse = sanitizeProviderResponse(rawResponse);
    this.attribution = attribution;
  }
}

export function withProviderAttribution(error: unknown, attribution: ProviderAttribution): ProviderCallError {
  if (error instanceof ProviderCallError) {
    if (error.attribution?.provider === attribution.provider && error.attribution.capability === attribution.capability) return error;
    return new ProviderCallError(error.message, error.code, error.retryable, error.rawResponse, attribution);
  }
  return new ProviderCallError("The provider call failed.", "PROVIDER_UNAVAILABLE", true, null, attribution);
}
