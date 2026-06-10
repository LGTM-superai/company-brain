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
    messages: messages.map((m) => JSON.parse(JSON.stringify({
      messageId: m.messageId,
      role: m.role,
      content: m.content,
      toolName: m.toolName,
      exaResults: m.exaResults?.map((r: Record<string, unknown>) => ({
        title: r.title,
        url: r.url,
        summary: r.summary,
        publishedDate: r.publishedDate,
      })),
      repoMonitors: m.repoMonitors?.map((r: Record<string, unknown>) => ({
        owner: r.owner,
        repo: r.repo,
        monitorId: r.monitorId,
        packages: r.packages,
        slackChannelId: r.slackChannelId,
        severityThreshold: r.severityThreshold,
        status: r.status,
        createdAt: r.createdAt,
      })),
      exaVerdict: m.exaVerdict,
      exaCVE: m.exaCVE,
      exaNews: m.exaNews,
    }))),
  });
}
