import { NextResponse } from "next/server";
import { connectMongo } from "../../../../../lib/mongodb";
import { MessageModel } from "../../../../../lib/models";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;

  await connectMongo();

  const messages = await MessageModel.find({ conversationId })
    .sort({ order: 1 })
    .lean();

  return NextResponse.json({
    messages: messages.map((m) => ({
      messageId: m.messageId,
      role: m.role,
      content: m.content,
      toolName: m.toolName,
      exaResults: m.exaResults,
      repoMonitors: m.repoMonitors,
    })),
  });
}
