export type SiteThreadErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "MEDIA_UNAVAILABLE"
  | "PROCESSING_FAILED"
  | "PROVIDER_CONTRACT_UNRESOLVED"
  | "INTERNAL_ERROR";

export class SiteThreadError extends Error {
  constructor(
    message: string,
    public readonly code: SiteThreadErrorCode,
    public readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SiteThreadError";
  }
}

export function serializeError(error: unknown): { code: SiteThreadErrorCode; message: string; retryable: boolean } {
  if (error instanceof SiteThreadError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", retryable: false };
}
