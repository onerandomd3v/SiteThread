import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/response";
import { getReportEvidenceFrame } from "@/lib/reports/service";

export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string; sourceEvidenceId: string }> }) {
  try {
    const { reportId, sourceEvidenceId } = await params;
    const frame = await getReportEvidenceFrame(reportId, sourceEvidenceId);
    return new NextResponse(new Uint8Array(frame), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
