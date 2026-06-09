import { NextResponse } from "next/server";
import type { AgentEvent } from "@company-brain/shared";
import { connectMongo } from "../../../lib/mongodb";
import { ConversationModel, MessageModel } from "../../../lib/models";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    conversationId?: string;
    message?: string;
  };
  const rawMessage = body.message?.trim() ?? "";
  if (!rawMessage) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  await connectMongo();

  const conversationId = body.conversationId ?? `conversation-${Date.now()}`;
  const existingConversation = await ConversationModel.findOne({ conversationId });
  const conversation =
    existingConversation ??
    (await ConversationModel.create({
      conversationId,
      title: titleFromMessage(rawMessage),
      summary: "Company Brain is gathering source-aware context for this request.",
      updatedLabel: "Just now",
      order: 0,
    }));

  const lastMessage = await MessageModel.findOne({ conversationId })
    .sort({ order: -1 })
    .select({ order: 1 })
    .lean();
  let nextOrder = Number(lastMessage?.order ?? 0) + 1;

  await MessageModel.create({
    messageId: `${conversationId}-user-${Date.now()}`,
    conversationId,
    role: "user",
    content: rawMessage,
    order: nextOrder++,
  });

  const message = body.message?.toLowerCase() ?? "";

  const shouldUseExa = /exa|verify|external|docs|vulnerability|public|block/i.test(message);
  const shouldUpdate = /move|update|send|assign|change|post/i.test(message);

  const events: AgentEvent[] = [
    { type: "tool_call", tool: message.includes("ticket") || message.includes("web-112") ? "queryNotionSprintBoard" : "queryNotionKB" },
    { type: "tool_call", tool: "querySlack" },
  ];

  if (message.includes("github") || message.includes("code")) {
    events.push({ type: "tool_call", tool: "queryGithub" });
  }

  if (shouldUseExa) {
    events.push(
      { type: "tool_call", tool: "queryExa" },
      {
        type: "exa_results",
        results: [
          {
            title: "Next.js Forms and Server Actions",
            url: "https://nextjs.org/docs/app/guides/forms",
            publishedDate: "2026-05-21",
            summary: "Official docs covering form submissions, validation, and server-side handlers.",
          },
          {
            title: "Vercel Guide: Handling Form Submissions",
            url: "https://vercel.com/guides",
            publishedDate: "2026-04-18",
            summary: "Implementation patterns for contact forms, redirects, and deployment behavior.",
          },
        ],
      },
    );
  }

  if (shouldUpdate) {
    events.push({ type: "tool_call", tool: "updateNotionSprintBoard" }, { type: "tool_call", tool: "updateSlack" });
  }

  events.push({
    type: "assistant_message",
    content: shouldUpdate
      ? "I found the matching source context, prepared the update, and logged the simulated action to #company-brain-actions."
      : "I checked the relevant company context and returned the most relevant current answer with source-aware routing.",
  });

  events.push({ type: "done" });

  await persistAgentEvents(conversationId, nextOrder, events);

  conversation.summary = summarizeRequest(rawMessage, shouldUpdate, shouldUseExa);
  conversation.updatedLabel = "Just now";
  await conversation.save();

  return NextResponse.json({ conversationId, events });
}

async function persistAgentEvents(
  conversationId: string,
  startingOrder: number,
  events: AgentEvent[],
) {
  let order = startingOrder;
  const timestamp = Date.now();
  const documents = events.flatMap((event, index) => {
    if (event.type === "tool_call") {
      return [
        {
          messageId: `${conversationId}-tool-${timestamp}-${index}`,
          conversationId,
          role: "tool",
          content: `Tool called: ${event.tool}`,
          toolName: event.tool,
          order: order++,
        },
      ];
    }

    if (event.type === "exa_results") {
      return [
        {
          messageId: `${conversationId}-exa-${timestamp}-${index}`,
          conversationId,
          role: "tool",
          content: "Exa search results",
          toolName: "queryExa",
          exaResults: event.results,
          order: order++,
        },
      ];
    }

    if (event.type === "assistant_message") {
      return [
        {
          messageId: `${conversationId}-assistant-${timestamp}-${index}`,
          conversationId,
          role: "assistant",
          content: event.content,
          order: order++,
        },
      ];
    }

    return [];
  });

  if (documents.length) {
    await MessageModel.insertMany(documents);
  }
}

function titleFromMessage(message: string) {
  const title = message.replace(/\s+/g, " ").trim();
  return title.length > 52 ? `${title.slice(0, 49)}...` : title;
}

function summarizeRequest(message: string, didUpdate: boolean, usedExa: boolean) {
  if (didUpdate && usedExa) {
    return `Updated external source after checking company context and Exa evidence: ${titleFromMessage(message)}`;
  }

  if (didUpdate) {
    return `Updated an external source and logged the action: ${titleFromMessage(message)}`;
  }

  if (usedExa) {
    return `Answered with company context plus Exa verification: ${titleFromMessage(message)}`;
  }

  return `Answered from routed company context: ${titleFromMessage(message)}`;
}
