import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { errorResponse } from "@/lib/api/response";

const CreateProjectSchema = z.object({ name: z.string().trim().min(1).max(120) });

export async function GET() {
  try {
    const projects = await db.project.findMany({ orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, name: true, updatedAt: true } });
    return NextResponse.json({ projects });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = CreateProjectSchema.parse(await request.json());
    const project = await db.project.create({ data: { name: input.name }, select: { id: true, name: true, updatedAt: true } });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
