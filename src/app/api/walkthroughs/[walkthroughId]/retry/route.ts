import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/response";
import { retryWalkthrough } from "@/lib/walkthroughs/service";

export async function POST(_request: Request, { params }: { params: Promise<{ walkthroughId: string }> }) {
  try {
    const { walkthroughId } = await params;
    return NextResponse.json({ run: await retryWalkthrough(walkthroughId) });
  } catch (error) {
    return errorResponse(error);
  }
}
