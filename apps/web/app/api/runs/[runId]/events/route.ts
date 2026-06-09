import { NextResponse } from "next/server";

export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return NextResponse.json({
    runId,
    status: "scaffold",
    note: "Use this route for SSE/resumable run events if agent execution moves to a background worker.",
  });
}
