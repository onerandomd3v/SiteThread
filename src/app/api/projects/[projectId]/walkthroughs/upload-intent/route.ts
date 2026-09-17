import { NextResponse } from "next/server";
import { UploadIntentRequestSchema } from "@/lib/walkthroughs/upload-policy";
import { createUploadIntent } from "@/lib/walkthroughs/service";
import { errorResponse } from "@/lib/api/response";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const input = UploadIntentRequestSchema.parse(await request.json());
    const result = await createUploadIntent(projectId, input);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
