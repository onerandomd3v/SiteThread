import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/response";
import { listRecentWalkthroughs } from "@/lib/walkthroughs/service";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    return NextResponse.json({ walkthroughs: await listRecentWalkthroughs(projectId) });
  } catch (error) {
    return errorResponse(error);
  }
}
