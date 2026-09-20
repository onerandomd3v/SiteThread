import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/response";
import { getReport } from "@/lib/reports/service";

export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  try {
    const { reportId } = await params;
    return NextResponse.json(await getReport(reportId));
  } catch (error) {
    return errorResponse(error);
  }
}
