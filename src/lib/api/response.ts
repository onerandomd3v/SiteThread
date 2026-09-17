import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { serializeError, SiteThreadError } from "@/lib/errors";

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "The request could not be validated.", retryable: false } }, { status: 400 });
  }
  const serialized = serializeError(error);
  const safeError = serialized.code === "INTERNAL_ERROR"
    ? { ...serialized, message: "An internal error occurred." }
    : serialized;
  const status = error instanceof SiteThreadError
    ? safeError.code === "NOT_FOUND" ? 404 : safeError.code === "INVALID_INPUT" ? 400 : safeError.code === "MEDIA_UNAVAILABLE" ? 409 : 500
    : 500;
  return NextResponse.json({ error: safeError }, { status });
}
