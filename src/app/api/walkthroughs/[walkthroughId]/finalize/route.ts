import { NextResponse } from "next/server";
import { finalizeUpload } from "@/lib/walkthroughs/service";
import { errorResponse } from "@/lib/api/response";

export async function POST(_request: Request, { params }: { params: Promise<{ walkthroughId: string }> }) {
  try {
    const { walkthroughId } = await params;
    return NextResponse.json({ run: await finalizeUpload(walkthroughId) });
  } catch (error) {
    return errorResponse(error);
  }
}
