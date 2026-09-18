import { NextResponse } from "next/server";
import { finalizeUpload } from "@/lib/walkthroughs/service";
import { errorResponse } from "@/lib/api/response";
import { dispatchProcessingRun } from "@/lib/processing/dispatch";

export async function POST(_request: Request, { params }: { params: Promise<{ walkthroughId: string }> }) {
  try {
    const { walkthroughId } = await params;
    const run = await finalizeUpload(walkthroughId);
    if (run.status === "QUEUED") await dispatchProcessingRun(run.id);
    return NextResponse.json({ run });
  } catch (error) {
    return errorResponse(error);
  }
}
