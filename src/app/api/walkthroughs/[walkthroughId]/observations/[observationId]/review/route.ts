import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/response";
import { SiteThreadError } from "@/lib/errors";
import { reviewObservation } from "@/lib/observations/review";

export async function PATCH(request: Request, { params }: { params: Promise<{ walkthroughId: string; observationId: string }> }) {
  try {
    const { walkthroughId, observationId } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(new SiteThreadError("The review decision could not be read.", "INVALID_INPUT"));
    }
    return NextResponse.json(await reviewObservation(walkthroughId, observationId, body));
  } catch (error) {
    return errorResponse(error);
  }
}
