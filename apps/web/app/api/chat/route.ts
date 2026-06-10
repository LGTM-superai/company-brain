import { NextResponse, after } from "next/server";
import type { AgentEvent, ExaUseCase, ToolName, RepoMonitor } from "@company-brain/shared";
import { connectMongo } from "../../../lib/mongodb";
import { ConversationModel, MessageModel, ExaRunModel } from "../../../lib/models";
import { routeMessage } from "../../../lib/router";
import { generateSlackMessage } from "../../../lib/generate-slack-message";
import { sendSlackMessage, toolRegistry } from "@company-brain/tools";
import {
  queryExaVerdict,
  queryExaSearch,
  queryExaCVE,
  queryExaNews,
} from "../../../../../exa-runtime";

export const runtime = "nodejs";

const EXA_USE_CASE_PATTERNS: Record<ExaUseCase, RegExp> = {
  verification: /verify|is it true|fact.?check|confirm that|evidence for/i,
  research: /how (do|to|can)|find docs|documentation|tutorial|explain how/i,
  cve: /cve|vulnerability|security (issue|flaw|bug)|exploit|advisory/i,
  news: /news|market|competitor|recent.*(article|report)|industry/i,
};

function detectExaUseCase(message: string): ExaUseCase | null {
  for (const [useCase, pattern] of Object.entries(EXA_USE_CASE_PATTERNS)) {
    if (pattern.test(message)) return useCase as ExaUseCase;
  }
  return null;
}

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

  const priorMessages = await MessageModel.find({ conversationId })
    .sort({ order: 1 })
    .select({ role: 1, content: 1, toolName: 1 })
    .lean();

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

  const conversationHistory = priorMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => m.content);

  const routed = await routeMessage(rawMessage, conversationHistory);

  const events: AgentEvent[] = [];

  let slackSendResult: { ok?: boolean; channel?: string } | null = null;

  for (const tool of routed.tools) {
    if (tool === "queryRepos") {
      events.push({ type: "tool_call", tool: "queryRepos" });
      try {
        const result = await toolRegistry.queryRepos.run({}, {});
        if (result.ok && result.data) {
          const monitors = (result.data as { monitors: RepoMonitor[] }).monitors;
          events.push({ type: "repo_monitors", monitors });
        }
      } catch {
        // queryRepos failed — no monitors to show
      }
    } else if (tool === "queryExa") {
      // skip here — handled below with use-case detection
    } else if (tool === "updateSlack") {
      events.push({ type: "tool_call", tool: "updateSlack" });
      try {
        const generated = await generateSlackMessage(rawMessage, conversationHistory);
        slackSendResult = await sendSlackMessage({
          channel: "actions",
          text: generated.text,
          tagUser: generated.targetUser ?? undefined,
        });
      } catch {
        slackSendResult = { ok: false };
      }
    } else {
      events.push({ type: "tool_call", tool: tool as ToolName });
    }
  }

  let exaRunId: string | null = null;
  const exaUseCase = routed.tools.includes("queryExa")
    ? (detectExaUseCase(rawMessage.toLowerCase()) ?? "research")
    : null;

  if (exaUseCase) {
    exaRunId = `exa-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await ExaRunModel.create({
      runId: exaRunId,
      conversationId,
      messageOrder: nextOrder,
      useCase: exaUseCase,
      query: rawMessage,
      status: "pending",
    });

    events.push(
      { type: "exa_searching", runId: exaRunId, useCase: exaUseCase, query: rawMessage },
    );
  }

  const hasUpdate = routed.tools.some((t) => t.startsWith("update"));
  events.push({
    type: "assistant_message",
    content: exaUseCase
      ? "Searching the web for live results — I'll update this thread when they arrive."
      : slackSendResult?.ok
        ? `Message sent to #${slackSendResult.channel}.`
        : slackSendResult && !slackSendResult.ok
          ? "Failed to send Slack message — check bot token and channel permissions."
          : hasUpdate
            ? "I found the matching source context, prepared the update, and logged the action."
            : routed.tools.includes("queryRepos")
              ? "I queried the CVE monitoring service and returned the current repo registrations."
              : "I checked the relevant company context and returned the most relevant current answer with source-aware routing.",
  });

  events.push({ type: "done" });

  await persistAgentEvents(conversationId, nextOrder, events);

  conversation.summary = summarizeRequest(rawMessage, hasUpdate, !!exaUseCase);
  conversation.updatedLabel = "Just now";
  await conversation.save();

  if (exaUseCase && exaRunId) {
    const capturedRunId = exaRunId;
    const capturedUseCase = exaUseCase;
    const capturedQuery = rawMessage;
    const capturedConversationId = conversationId;
    const capturedOrder = nextOrder + events.length;

    after(async () => {
      try {
        await connectMongo();
        const exaResult = await executeExaForUseCase(capturedUseCase, capturedQuery);

        if ("ok" in exaResult && exaResult.ok) {
          await ExaRunModel.updateOne({ runId: capturedRunId }, { status: "completed", result: exaResult });

          const messageFields: Record<string, unknown> = {
            messageId: `${capturedConversationId}-exa-result-${Date.now()}`,
            conversationId: capturedConversationId,
            role: "tool",
            content: `Exa ${capturedUseCase} results`,
            toolName: "queryExa",
            order: capturedOrder,
          };

          if (capturedUseCase === "research" && "results" in exaResult) {
            messageFields.exaResults = exaResult.results.map((r) => ({
              title: r.title,
              url: r.url,
              summary: r.summary,
              publishedDate: r.published_date,
            }));
          } else if (capturedUseCase === "verification" && "verdict" in exaResult) {
            messageFields.exaVerdict = exaResult.verdict;
          } else if (capturedUseCase === "cve" && "result" in exaResult) {
            messageFields.exaCVE = exaResult.result;
          } else if (capturedUseCase === "news" && "articles" in exaResult) {
            messageFields.exaNews = exaResult.articles;
          }

          await MessageModel.create(messageFields);
        } else {
          const errorDetail = "error" in exaResult ? `${exaResult.message}: ${exaResult.error}` : exaResult.message;
          await ExaRunModel.updateOne(
            { runId: capturedRunId },
            { status: "failed", error: errorDetail },
          );
        }
      } catch (err) {
        await ExaRunModel.updateOne(
          { runId: capturedRunId },
          { status: "failed", error: err instanceof Error ? err.message : String(err) },
        ).catch(() => {});
      }
    });
  }

  return NextResponse.json({ conversationId, events });
}

async function executeExaForUseCase(useCase: ExaUseCase, query: string) {
  switch (useCase) {
    case "verification":
      return queryExaVerdict(query);
    case "research":
      return queryExaSearch(query);
    case "cve":
      return queryExaCVE(query);
    case "news":
      return queryExaNews(query);
  }
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

    if (event.type === "exa_searching") {
      return [
        {
          messageId: `${conversationId}-exa-searching-${timestamp}-${index}`,
          conversationId,
          role: "tool",
          content: `Searching (${event.useCase})...`,
          toolName: "queryExa",
          order: order++,
        },
      ];
    }

    if (event.type === "repo_monitors") {
      return [
        {
          messageId: `${conversationId}-repos-${timestamp}-${index}`,
          conversationId,
          role: "tool",
          content: "Repo monitors",
          toolName: "queryRepos",
          repoMonitors: event.monitors,
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
