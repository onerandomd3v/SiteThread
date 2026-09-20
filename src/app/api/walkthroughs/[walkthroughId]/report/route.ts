import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/response";
import { generateReport } from "@/lib/reports/service";

export async function POST(_request: Request, { params }: { params: Promise<{ walkthroughId: string }> }) {
  try {
    const { walkthroughId } = await params;
    return NextResponse.json(await generateReport(walkthroughId));
  } catch (error) {
    return errorResponse(error);
  }
}
