import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/response";
import { completeEmptyReview, getWalkthroughReview } from "@/lib/observations/review";

export async function GET(_request: Request, { params }: { params: Promise<{ walkthroughId: string }> }) {
  try {
    const { walkthroughId } = await params;
    return NextResponse.json(await getWalkthroughReview(walkthroughId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ walkthroughId: string }> }) {
  try {
    const { walkthroughId } = await params;
    return NextResponse.json(await completeEmptyReview(walkthroughId));
  } catch (error) {
    return errorResponse(error);
  }
}
