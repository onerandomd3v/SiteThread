import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/response";
import { getWalkthroughStatus } from "@/lib/walkthroughs/service";

export async function GET(_request: Request, { params }: { params: Promise<{ walkthroughId: string }> }) {
  try {
    const { walkthroughId } = await params;
    return NextResponse.json(await getWalkthroughStatus(walkthroughId));
  } catch (error) {
    return errorResponse(error);
  }
}
