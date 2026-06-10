import { NextResponse } from "next/server";
import { connectMongo } from "../../../../../lib/mongodb";
import { ExaRunModel } from "../../../../../lib/models";

export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await connectMongo();

  const run = await ExaRunModel.findOne({ runId }).lean();
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const staleThresholdMs = 90_000;
  if (run.status === "pending" && Date.now() - new Date(run.createdAt).getTime() > staleThresholdMs) {
    await ExaRunModel.updateOne({ runId }, { status: "failed", error: "Timed out waiting for results." });
    return NextResponse.json({
      runId: run.runId,
      status: "failed",
      useCase: run.useCase,
      error: "Timed out waiting for results.",
    });
  }

  return NextResponse.json({
    runId: run.runId,
    status: run.status,
    useCase: run.useCase,
    result: run.status === "completed" ? run.result : undefined,
    error: run.status === "failed" ? run.error : undefined,
  });
}
