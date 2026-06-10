import { NextResponse } from "next/server";
import {
  generateText,
  stepCountIs,
  tool,
  type ModelMessage,
} from "ai";
import { z } from "zod";
import type {
  AgentEvent,
  BudgetAllocationEvent,
  FoodOrderEvent,
  RepoMonitor,
  ToolName,
} from "@company-brain/shared";
import { users, type PersonId } from "@company-brain/shared";
import { toolRegistry } from "@company-brain/tools";
import { getRuntimeModel } from "../../../lib/ai-model";
import { connectMongo } from "../../../lib/mongodb";
import { MessageModel } from "../../../lib/models";
import { queryExaVerdict as queryHarborBeanExaVerdict } from "../../../lib/exa-runtime";
import { HARBOR_BEAN_PROJECT } from "../../../lib/notion-runtime";
import {
  queryMcpNotionTickets,
  updateMcpLatestAgentNote,
  updateMcpTicketFields,
} from "../../../lib/notion-mcp-runtime";
import {
  clearPendingAction,
  ensureConversation,
  getNextOrder,
  getPendingAction,
  isApprovalMessage,
  persistAssistantMessage,
  persistSlackAudit,
  persistToolCall,
  persistToolFailure,
  persistToolResult,
  persistUserMessage,
  setPendingAction,
  titleFromMessage,
  updateConversationSummary,
  type PendingAction,
  type TicketFieldChanges,
} from "../../../lib/run-history";
import { gmt8TodayFromNow } from "../../../lib/time";
import {
  queryExaCVE,
  queryExaNews,
  queryExaSearch,
} from "../../../../../exa-runtime";

export const runtime = "nodejs";

type ChatRequestBody = {
  conversationId?: string;
  message?: string;
};

type SlackChannelPurpose =
  | "announcements"
  | "engineering"
  | "vulnerability-monitoring"
  | "company-brain-actions";

const ticketFieldChangesSchema = z.object({
  name: z.string().optional(),
  status: z.string().optional(),
  project: z.string().optional(),
  assignee: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  priority: z.string().optional(),
});

const updateNotionInputSchema = z.object({
  action: z.enum(["record_latest_agent_note", "update_ticket_fields", "move_status"]),
  ticket: z.string(),
  note: z.string().optional(),
  changes: ticketFieldChangesSchema.optional(),
  current: ticketFieldChangesSchema.optional(),
  currentStatus: z.string().optional(),
  newStatus: z.string().optional(),
  approved: z.boolean().optional(),
  reason: z.string().optional(),
});

type UpdateNotionInput = z.infer<typeof updateNotionInputSchema>;

const querySlackInputSchema = z.object({
  query: z.string().optional(),
  channel: z.string().optional(),
  channelPurpose: z
    .enum(["announcements", "engineering", "vulnerability-monitoring", "company-brain-actions"])
    .optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

const updateSlackInputSchema = z.object({
  channel: z.string().optional(),
  channelPurpose: z
    .enum(["announcements", "engineering", "vulnerability-monitoring", "company-brain-actions"])
    .optional(),
  text: z.string().optional(),
  message: z.string().optional(),
  system: z.string().optional(),
  target: z.string().optional(),
  action: z.string().optional(),
  mentionPeople: z.array(z.string()).optional(),
  audit: z.boolean().optional(),
  approved: z.boolean().optional(),
  reason: z.string().optional(),
});

type UpdateSlackToolInput = z.infer<typeof updateSlackInputSchema>;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ChatRequestBody;
  const rawMessage = body.message?.trim() ?? "";

  if (!rawMessage) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  await connectMongo();

  const conversationId = body.conversationId ?? `conversation-${Date.now()}`;
  await ensureConversation(conversationId, titleFromMessage(rawMessage));

  let nextOrder = await getNextOrder(conversationId);
  await persistUserMessage(conversationId, rawMessage, nextOrder++);

  let pendingAction = await getPendingAction(conversationId);
  let approvalGranted = pendingAction ? isApprovalMessage(rawMessage) : false;

  if (!pendingAction && isSlackSendConfirmation(rawMessage)) {
    const recoveredAction = await recoverPendingSlackActionFromDraft(conversationId);

    if (recoveredAction) {
      await setPendingAction(conversationId, recoveredAction);
      pendingAction = recoveredAction;
      approvalGranted = true;
    }
  }

  const events: AgentEvent[] = [];
  const toolMessageIds = new Map<string, string>();
  const modelMessages = await buildModelMessages(conversationId);
  const toolChoice = forcedToolChoiceForLatestMessage(rawMessage, pendingAction, approvalGranted);

  try {
    const result = await generateText({
      model: getRuntimeModel(),
      system: systemPrompt({ pendingAction, approvalGranted }),
      messages: modelMessages,
      tools: buildTools({
        conversationId,
        approvalGranted,
        pendingAction,
        events,
        nextOrderRef: {
          get: () => nextOrder,
          set: (value) => {
            nextOrder = value;
          },
        },
      }),
      toolChoice,
      stopWhen: stepCountIs(8),
      maxOutputTokens: 900,
      experimental_onToolCallStart: async (event) => {
        const toolName = event.toolCall.toolName as ToolName;
        events.push({ type: "tool_call", tool: toolName, args: event.toolCall.input });
        const messageId = await persistToolCall(
          conversationId,
          toolName,
          event.toolCall.input,
          nextOrder++,
        );
        toolMessageIds.set(event.toolCall.toolCallId, messageId);
      },
      experimental_onToolCallFinish: async (event) => {
        const messageId = toolMessageIds.get(event.toolCall.toolCallId);

        if (event.success) {
          await persistToolResult(messageId, event.output, event.durationMs);
          return;
        }

        await persistToolFailure(messageId, event.error, event.durationMs);
      },
    });

    const answer = result.text.trim() || "Done.";
    events.push({ type: "assistant_message", content: answer });
    events.push({ type: "done" });

    await persistAssistantMessage(conversationId, answer, nextOrder++);
    await updateConversationSummary(conversationId, summaryFromAnswer(rawMessage, answer));

    return NextResponse.json({ conversationId, events });
  } catch (error) {
    const message = friendlyError(error);
    events.push({ type: "assistant_message", content: message });
    events.push({ type: "done" });

    await persistAssistantMessage(conversationId, message, nextOrder++);
    await updateConversationSummary(conversationId, message);

    return NextResponse.json({ conversationId, events }, { status: 500 });
  }
}

function buildTools({
  conversationId,
  approvalGranted,
  pendingAction,
  events,
  nextOrderRef,
}: {
  conversationId: string;
  approvalGranted: boolean;
  pendingAction: PendingAction | null;
  events: AgentEvent[];
  nextOrderRef: { get: () => number; set: (value: number) => void };
}) {
  return {
    queryNotion: tool({
      description:
        "Query the live Notion sprint board for Harbor Bean ticket properties and body sections. Use this before sprint status, blockers, readiness, and ticket updates.",
      inputSchema: z.object({
        project: z.string().default(HARBOR_BEAN_PROJECT),
        ticket: z.string().optional(),
        includeBody: z.boolean().default(true),
        fields: z.array(z.string()).optional(),
      }),
      execute: async (input) => {
        const result = await queryMcpNotionTickets(input);
        return {
          ...result,
          tickets: result.tickets.map((ticket) => ({
            pageId: ticket.pageId,
            url: ticket.url,
            code: ticket.code,
            name: ticket.name,
            status: ticket.status,
            project: ticket.project,
            assignee: ticket.assignee,
            dueDate: ticket.dueDate,
            priority: ticket.priority,
            overdue: ticket.overdue,
            body: ticket.body,
            sections: ticket.sections.map((section) => ({
              title: section.title,
              text: section.text,
            })),
          })),
        };
      },
    }),
    updateNotion: tool({
      description:
        "Update the live Notion sprint board after queryNotion. Can write Latest agent note or update Name, Status, Project, Assignee, Due Date, and Priority. Mutations use approval and current-state guards.",
      inputSchema: updateNotionInputSchema,
      execute: async (input) => {
        const notionApprovalGranted =
          approvalGranted &&
          (pendingAction?.type === "update_ticket_fields" || pendingAction?.type === "move_status");

        if (input.action === "record_latest_agent_note") {
          if (!input.note) {
            return {
              ok: false,
              message: "Tool failed: updateNotion (note is required).",
            };
          }

          const result = await updateMcpLatestAgentNote({
            ticket: input.ticket,
            note: input.note,
          });

          if (result.ok) {
            await auditExternalMutation(conversationId, {
              system: "Notion",
              target: input.ticket,
              action: "Recorded Latest agent note",
            });
          }

          return result;
        }

        const request = await buildTicketFieldUpdateRequest(
          input,
          pendingAction,
          notionApprovalGranted,
        );

        if (!request.ok) {
          return {
            ok: false,
            message: request.message,
          };
        }

        if (!notionApprovalGranted) {
          const action: PendingAction = {
            actionId: `${conversationId}-pending-${Date.now()}`,
            type: "update_ticket_fields",
            ticket: request.ticket,
            current: request.current,
            changes: request.changes,
            reason: input.reason ?? "User requested a sprint-board update that requires approval.",
            createdAt: new Date().toISOString(),
          };

          await setPendingAction(conversationId, action);

          return {
            ok: false,
            requiresApproval: true,
            message: approvalMessage(request.ticketName, request.current, request.changes),
            pendingAction: action,
          };
        }

        const result = await updateMcpTicketFields({
          ticket: request.ticket,
          current: request.current,
          changes: request.changes,
        });

        if (result.ok) {
          await clearPendingAction(conversationId);
          await auditExternalMutation(conversationId, {
            system: "Notion",
            target: request.ticketName,
            action: `Applied sprint-board changes: ${formatChanges(request.current, request.changes)}`,
          });
        }

        return result;
      },
    }),
    queryExa: tool({
      description:
        "Use Exa for external documentation, blocker validation, CVE details, recent news, or web research. HB-204 blocker validation should use the official Google Maps iframe query.",
      inputSchema: z.object({
        query: z.string(),
        source_preference: z.string().optional(),
        useCase: z.enum(["verification", "research", "cve", "news"]).optional(),
      }),
      execute: async (input) => {
        const useCase = input.useCase ?? inferExaUseCase(input.query);
        const runId = `exa-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        if (useCase === "research") {
          const result = await queryExaSearch(input.query);
          if (result.ok) {
            const event = {
              type: "exa_results" as const,
              results: result.results.map((item) => ({
                title: item.title,
                url: item.url,
                summary: item.summary,
                publishedDate: item.published_date,
              })),
            };
            events.push(event);
            await persistToolCard(conversationId, "queryExa", "Exa search results", nextOrderRef, {
              exaResults: event.results,
            });
          }
          return result;
        }

        if (useCase === "cve") {
          const result = await queryExaCVE(input.query);
          if (result.ok) {
            const event = { type: "exa_cve" as const, runId, result: result.result };
            events.push(event);
            await persistToolCard(conversationId, "queryExa", "CVE details", nextOrderRef, {
              exaCVE: result.result,
            });
          }
          return result;
        }

        if (useCase === "news") {
          const result = await queryExaNews(input.query);
          if (result.ok) {
            const event = { type: "exa_news" as const, runId, articles: result.articles };
            events.push(event);
            await persistToolCard(conversationId, "queryExa", "News results", nextOrderRef, {
              exaNews: result.articles,
            });
          }
          return result;
        }

        const result = await queryHarborBeanExaVerdict(input.query);
        if (result.ok) {
          const event = { type: "exa_verdict" as const, runId, verdict: result.verdict };
          events.push(event);
          await persistToolCard(conversationId, "queryExa", "Exa verdict", nextOrderRef, {
            exaVerdict: result.verdict,
          });
        }
        return result;
      },
    }),
    querySlack: tool({
      description:
        "Read Slack messages using the develop Slack tool. Route announcements/events to #announcements, tickets/blockers to #engineering, security to #vulnerability-monitoring, and audits to #company-brain-actions.",
      inputSchema: querySlackInputSchema,
      execute: async (input) => {
        const channel = input.channel ?? slackChannelIdForPurpose(input.channelPurpose);
        return toolRegistry.querySlack.run(
          {
            query: channel ? undefined : input.query,
            channel,
            limit: input.limit,
          },
          {},
        );
      },
    }),
    updateSlack: tool({
      description:
        "Stage or send real Slack messages using the develop Slack tool. Non-audit channel posts require approval. Action audits go to #company-brain-actions.",
      inputSchema: updateSlackInputSchema,
      execute: async (input) => {
        const slackApprovalGranted = approvalGranted && pendingAction?.type === "slack_message";
        const request = buildSlackUpdateRequest(input, pendingAction, slackApprovalGranted);

        if (!request.ok) {
          return {
            ok: false,
            message: request.message,
          };
        }

        if (shouldAskSlackApproval(request.value, slackApprovalGranted)) {
          const pendingSlackAction: PendingAction = {
            actionId: `${conversationId}-pending-slack-${Date.now()}`,
            type: "slack_message",
            channel: request.value.channel,
            channelPurpose: request.value.channelPurpose,
            text: request.value.text,
            mentionPeople: request.value.mentionPeople,
            reason: input.reason ?? "User requested a Slack write that requires approval.",
            createdAt: new Date().toISOString(),
          };

          await setPendingAction(conversationId, pendingSlackAction);

          return {
            ok: false,
            requiresApproval: true,
            message: slackApprovalMessage(request.value),
            pendingAction: pendingSlackAction,
          };
        }

        const channel = slackToolChannelForPurpose(request.value.channelPurpose);
        const text = withSlackMentions(request.value.text, request.value.mentionPeople);
        const result = await toolRegistry.updateSlack.run(
          {
            action: "send_message",
            channel,
            text,
          },
          {},
        );

        if (!result.ok) {
          return result;
        }

        const sent = result.data as { ok?: boolean; channel?: string; ts?: string } | undefined;
        await persistSlackAudit(conversationId, text, {
          channel: sent?.channel ?? channel,
          ts: sent?.ts,
          audit: request.value.channelPurpose === "company-brain-actions",
        });

        if (request.value.channelPurpose !== "company-brain-actions") {
          await auditExternalMutation(conversationId, {
            system: "Slack",
            target: `#${request.value.channelPurpose}`,
            action: `Posted message${request.value.mentionPeople?.length ? ` tagging ${request.value.mentionPeople.join(", ")}` : ""}`,
          });
        }

        if (pendingAction?.type === "slack_message") {
          await clearPendingAction(conversationId);
        }

        return {
          ...result,
          audit: request.value.channelPurpose !== "company-brain-actions",
        };
      },
    }),
    queryRepos: tool({
      description:
        "Query the CVE monitoring service for registered repos, tracked packages, and alert configuration.",
      inputSchema: z.object({
        monitorId: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional(),
      }),
      execute: async (input) => {
        const result = await toolRegistry.queryRepos.run(input, {});
        if (result.ok && result.data) {
          const monitors = ((result.data as { monitors?: RepoMonitor[] }).monitors ?? []);
          const event = { type: "repo_monitors" as const, monitors };
          events.push(event);
          await persistToolCard(conversationId, "queryRepos", "Repo monitors", nextOrderRef, {
            repoMonitors: monitors,
          });
        }
        return result;
      },
    }),
    makePayment: tool({
      description:
        "Allocate project budget via Stripe virtual card, or distribute a total budget across projects.",
      inputSchema: z.object({
        action: z.enum(["setBudget", "distributeBudget"]),
        projectName: z.string().optional(),
        amountCents: z.number().int().positive(),
        currency: z.string().optional(),
        projects: z
          .array(z.object({ name: z.string(), percentage: z.number().min(0).max(100) }))
          .optional(),
      }),
      execute: async (input) => {
        const result = await toolRegistry.makePayment.run(input, {});
        if (result.ok && result.data) {
          const data = result.data as {
            action: string;
            allocations?: BudgetAllocationEvent[];
            allocation?: BudgetAllocationEvent;
          };
          const allocations = data.allocations ?? (data.allocation ? [data.allocation] : []);
          const totalCents = allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
          const event = { type: "budget_allocated" as const, allocations, totalCents };
          events.push(event);
          await persistToolCard(conversationId, "makePayment", "Budget allocated", nextOrderRef, {
            budgetAllocations: allocations,
          });
          await auditExternalMutation(conversationId, {
            system: "Stripe",
            target: allocations.map((allocation) => allocation.projectId).join(", "),
            action: `Allocated $${(totalCents / 100).toFixed(2)}`,
          });
        }
        return result;
      },
    }),
    buySomething: tool({
      description:
        "Order food for a team. Reads team dietary profiles, searches Exa for restaurant matches, and can charge through Stripe when confirmed.",
      inputSchema: z.object({
        teamName: z.string(),
        budgetPerHeadCents: z.number().int().positive().optional(),
        confirm: z.boolean().optional(),
      }),
      execute: async (input) => {
        const result = await toolRegistry.buySomething.run(input, {});
        if (result.ok && result.data) {
          const data = result.data as {
            team: {
              teamName: string;
              headcount: number;
              combinedDietary: string[];
              combinedAllergens: string[];
            };
            recommendations: FoodOrderEvent["recommendations"];
            budgetPerHeadCents: number;
            payment?: FoodOrderEvent["payment"];
          };
          const order: FoodOrderEvent = {
            teamName: data.team.teamName,
            headcount: data.team.headcount,
            dietary: data.team.combinedDietary,
            allergens: data.team.combinedAllergens,
            recommendations: data.recommendations,
            budgetPerHeadCents: data.budgetPerHeadCents,
            payment: data.payment,
          };
          const event = { type: "food_order" as const, order };
          events.push(event);
          await persistToolCard(conversationId, "buySomething", "Food order", nextOrderRef, {
            foodOrder: order,
          });
        }
        return result;
      },
    }),
  };
}

async function persistToolCard(
  conversationId: string,
  toolName: ToolName,
  content: string,
  nextOrderRef: { get: () => number; set: (value: number) => void },
  fields: Record<string, unknown>,
) {
  const order = nextOrderRef.get();
  nextOrderRef.set(order + 1);

  await MessageModel.create({
    messageId: `${conversationId}-${toolName}-card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId,
    role: "tool",
    content,
    toolName,
    order,
    ...fields,
  });
}

async function auditExternalMutation(
  conversationId: string,
  input: { system: string; target: string; action: string },
) {
  const text = `${input.system}: ${input.action} on ${input.target}`;

  try {
    const result = await toolRegistry.updateSlack.run(
      {
        action: "send_message",
        channel: "actions",
        text,
      },
      {},
    );

    await persistSlackAudit(conversationId, text, {
      ...input,
      result,
    });

    return result;
  } catch (error) {
    await persistSlackAudit(conversationId, text, {
      ...input,
      error: error instanceof Error ? error.message : "Unknown Slack audit error.",
    });

    return {
      ok: false,
      tool: "updateSlack",
      summary: error instanceof Error ? error.message : "Unknown Slack audit error.",
    };
  }
}

function buildSlackUpdateRequest(
  input: UpdateSlackToolInput,
  pendingAction: PendingAction | null,
  shouldUsePendingAction: boolean,
) {
  if (shouldUsePendingAction && pendingAction?.type === "slack_message") {
    return {
      ok: true as const,
      value: {
        channel: pendingAction.channel,
        channelPurpose: normalizeSlackPurpose(pendingAction.channelPurpose) ?? "engineering",
        text: pendingAction.text,
        mentionPeople: pendingAction.mentionPeople,
      },
    };
  }

  const text = (input.text ?? input.message ?? auditTextFromSlackInput(input)).trim();

  if (!text) {
    return {
      ok: false as const,
      message: "Tool failed: updateSlack (text, message, or system/target/action is required).",
    };
  }

  return {
    ok: true as const,
    value: {
      channel: input.channel,
      channelPurpose:
        normalizeSlackPurpose(input.channelPurpose) ??
        defaultSlackPurposeFromInput(input) ??
        "company-brain-actions",
      text,
      mentionPeople: input.mentionPeople,
      audit: input.audit,
    },
  };
}

function auditTextFromSlackInput(input: UpdateSlackToolInput) {
  if (input.system && input.target && input.action) {
    return `${input.system}: ${input.action} on ${input.target}`;
  }

  if (input.action && input.target) {
    return `${input.action} on ${input.target}`;
  }

  return "";
}

function defaultSlackPurposeFromInput(input: UpdateSlackToolInput): SlackChannelPurpose | undefined {
  if (input.audit || (input.system && input.target && input.action)) return "company-brain-actions";
  return undefined;
}

function shouldAskSlackApproval(
  input: {
    channelPurpose?: SlackChannelPurpose;
  },
  approved: boolean,
) {
  if (approved) return false;
  return input.channelPurpose !== "company-brain-actions";
}

function slackApprovalMessage(input: {
  channelPurpose?: SlackChannelPurpose;
  text?: string;
  mentionPeople?: string[];
}) {
  const destination = `#${input.channelPurpose ?? "company-brain-actions"}`;
  const mentionLine = input.mentionPeople?.length
    ? `I will tag: ${input.mentionPeople.join(", ")}.`
    : "No one is tagged yet. If someone should be tagged, tell me who; otherwise say yes to send as-is.";

  return `Approve posting to ${destination}? ${mentionLine} Message: "${input.text ?? ""}"`;
}

function slackChannelIdForPurpose(purpose?: SlackChannelPurpose) {
  if (!purpose) return undefined;

  const envKeyByPurpose: Record<SlackChannelPurpose, string> = {
    announcements: "SLACK_ANNOUNCEMENTS_CHANNEL_ID",
    engineering: "SLACK_ENGINEERING_CHANNEL_ID",
    "vulnerability-monitoring": "SLACK_VULNERABILITY_MONITORING_CHANNEL_ID",
    "company-brain-actions": "SLACK_ACTION_CHANNEL_ID",
  };

  return process.env[envKeyByPurpose[purpose]];
}

function slackToolChannelForPurpose(purpose?: SlackChannelPurpose) {
  const normalized = normalizeSlackPurpose(purpose) ?? "company-brain-actions";
  const map: Record<SlackChannelPurpose, string> = {
    announcements: "announcements",
    engineering: "engineering",
    "vulnerability-monitoring": "vulnerabilityMonitoring",
    "company-brain-actions": "actions",
  };
  return map[normalized];
}

function normalizeSlackPurpose(value?: string): SlackChannelPurpose | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/^#/, "").toLowerCase();

  if (
    normalized === "announcements" ||
    normalized === "engineering" ||
    normalized === "vulnerability-monitoring" ||
    normalized === "company-brain-actions"
  ) {
    return normalized;
  }

  return undefined;
}

function withSlackMentions(text: string, mentionPeople?: string[]) {
  if (!mentionPeople?.length) return text;
  const mentions = mentionPeople
    .map((person) => personIdFromName(person))
    .filter((person): person is PersonId => Boolean(person) && person !== "everyone")
    .map((personId) => {
      const user = users.find((candidate) => candidate.id === personId);
      return user?.slackId ? `<@${user.slackId}>` : `@${personId}`;
    });

  if (!mentions.length) return text;
  return `${mentions.join(" ")} ${stripPlainNameMentions(text, mentionPeople)}`.trim();
}

function stripPlainNameMentions(text: string, mentionPeople: string[]) {
  let stripped = text.replace(/<@[A-Z0-9]+>\s*/g, "");

  for (const person of mentionPeople) {
    stripped = stripped.replace(new RegExp(`@?${escapeRegExp(person)}\\s*`, "gi"), "");
    const firstName = person.split(/\s+/)[0];
    if (firstName) {
      stripped = stripped.replace(new RegExp(`@?${escapeRegExp(firstName)}\\s*`, "gi"), "");
    }
  }

  return stripped
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^\s*[-,:]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function personIdFromName(name: string): PersonId | undefined {
  const normalized = name.trim().replace(/^@/, "").toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "everyone" || normalized === "channel") return "everyone";

  const match = users.find(
    (user) =>
      user.id === normalized ||
      user.name.toLowerCase() === normalized ||
      user.slackHandle.toLowerCase() === normalized ||
      user.name.toLowerCase().startsWith(normalized),
  );

  return match?.id;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function forcedToolChoiceForLatestMessage(
  message: string,
  pendingAction: PendingAction | null,
  approvalGranted: boolean,
) {
  if (
    approvalGranted &&
    (pendingAction?.type === "update_ticket_fields" || pendingAction?.type === "move_status")
  ) {
    return { type: "tool" as const, toolName: "updateNotion" as const };
  }

  if (pendingAction?.type === "slack_message" && approvalGranted) {
    return { type: "tool" as const, toolName: "updateSlack" as const };
  }

  if (isSlackWriteIntent(message)) {
    return { type: "tool" as const, toolName: "updateSlack" as const };
  }

  return undefined;
}

function isSlackWriteIntent(message: string) {
  const normalized = message.toLowerCase();

  if (!/\b(slack|nudge|notify|ping|tag|send|post|message|announce|announcement)\b/.test(normalized)) {
    return false;
  }

  const readOnly =
    /\b(read|query|search|summarize|summarise|what|who|when|where|history|logs?)\b/.test(normalized) &&
    !/\b(send|post|nudge|notify|ping|tag|announce)\b/.test(normalized);

  return !readOnly;
}

function isSlackSendConfirmation(message: string) {
  return /\b(send it|post it|send this|post this|ok send|okay send|go ahead|yes|yep|yeah|confirm|confirmed|do it)\b/i.test(
    message,
  );
}

async function recoverPendingSlackActionFromDraft(conversationId: string) {
  const recentAssistantMessages = await MessageModel.find({
    conversationId,
    role: "assistant",
  })
    .sort({ order: -1 })
    .limit(8)
    .lean();

  for (const message of recentAssistantMessages) {
    const draft = parseSlackDraftFromAssistantText(message.content);

    if (draft) {
      return {
        actionId: `${conversationId}-recovered-slack-${Date.now()}`,
        type: "slack_message" as const,
        channelPurpose: draft.channelPurpose,
        text: draft.text,
        mentionPeople: draft.mentionPeople,
        reason: "Recovered from the last assistant Slack draft after the user approved sending.",
        createdAt: new Date().toISOString(),
      };
    }
  }

  return null;
}

function parseSlackDraftFromAssistantText(content: string) {
  const channelMatch =
    content.match(/\*\*Channel:\*\*\s*#?([a-z0-9_-]+)/i) ??
    content.match(/\bChannel:\s*#?([a-z0-9_-]+)/i);
  const messageMatch =
    content.match(/\*\*Message:\*\*\s*(?:>\s*)?([\s\S]+)/i) ??
    content.match(/\bMessage:\s*(?:>\s*)?([\s\S]+)/i);

  if (!channelMatch || !messageMatch) return null;

  const channelPurpose = normalizeSlackPurpose(channelMatch[1]) ?? "engineering";
  const text = cleanupRecoveredSlackDraft(messageMatch[1]);

  if (text.length < 8) return null;

  return {
    channelPurpose,
    text,
    mentionPeople: extractMentionPeopleFromText(text),
  };
}

function cleanupRecoveredSlackDraft(text: string) {
  return text
    .split(/\n?\s*---/)[0]
    .replace(/\n?\s*Reply\s+\*\*?yes[\s\S]*$/i, "")
    .replace(/\n?\s*Do you want me to post[\s\S]*$/i, "")
    .replace(/^>\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMentionPeopleFromText(text: string) {
  return users.filter((user) => new RegExp(`\\b${escapeRegExp(user.name.split(" ")[0])}\\b`, "i").test(text)).map((user) => user.name);
}

async function buildTicketFieldUpdateRequest(
  input: UpdateNotionInput,
  pendingAction: PendingAction | null,
  shouldUsePendingAction: boolean,
) {
  if (shouldUsePendingAction && pendingAction) {
    if (pendingAction.type === "update_ticket_fields") {
      return {
        ok: true as const,
        ticket: pendingAction.ticket,
        ticketName: pendingAction.ticket,
        current: pendingAction.current,
        changes: pendingAction.changes,
      };
    }

    if (pendingAction.type === "move_status") {
      return {
        ok: true as const,
        ticket: pendingAction.ticket,
        ticketName: pendingAction.ticket,
        current: { status: pendingAction.currentStatus },
        changes: { status: pendingAction.newStatus },
      };
    }
  }

  const changes = normalizeTicketFieldChanges({
    ...(input.changes ?? {}),
    ...(input.action === "move_status" || input.newStatus ? { status: input.newStatus } : {}),
  });

  if (!Object.keys(changes).length) {
    return {
      ok: false as const,
      message:
        "Tool failed: updateNotion (provide at least one sprint-board field change in changes, such as assignee, status, dueDate, priority, project, or name).",
    };
  }

  const result = await queryMcpNotionTickets({
    ticket: input.ticket,
    includeBody: false,
  });

  if (result.tickets.length !== 1) {
    return {
      ok: false as const,
      message: `Tool failed: updateNotion (expected one Notion ticket for "${input.ticket}", found ${result.tickets.length}).`,
    };
  }

  const ticket = result.tickets[0];
  const current = normalizeTicketFieldChanges({
    ...currentSnapshotForChanges(ticket, changes),
    ...(input.current ?? {}),
    ...(input.currentStatus ? { status: input.currentStatus } : {}),
  });

  return {
    ok: true as const,
    ticket: input.ticket,
    ticketName: ticket.name,
    current,
    changes,
  };
}

function currentSnapshotForChanges(
  ticket: Awaited<ReturnType<typeof queryMcpNotionTickets>>["tickets"][number],
  changes: TicketFieldChanges,
) {
  const current: TicketFieldChanges = {};

  if (changes.name !== undefined) current.name = ticket.name;
  if (changes.status !== undefined) current.status = ticket.status;
  if (changes.project !== undefined) current.project = ticket.project;
  if (changes.assignee !== undefined) current.assignee = ticket.assignee;
  if (changes.dueDate !== undefined) current.dueDate = ticket.dueDate;
  if (changes.priority !== undefined) current.priority = ticket.priority;

  return current;
}

function normalizeTicketFieldChanges(changes: TicketFieldChanges) {
  const normalized: TicketFieldChanges = {};

  if (changes.name !== undefined) normalized.name = changes.name.trim();
  if (changes.status !== undefined) normalized.status = normalizeStatus(changes.status);
  if (changes.project !== undefined) normalized.project = normalizeProject(changes.project);
  if (changes.assignee !== undefined) normalized.assignee = normalizeAssignee(changes.assignee);
  if (changes.dueDate !== undefined) normalized.dueDate = changes.dueDate;
  if (changes.priority !== undefined) normalized.priority = normalizePriority(changes.priority);

  return Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => value !== undefined && value !== ""),
  ) as TicketFieldChanges;
}

function normalizeStatus(status: string) {
  const aliases: Record<string, string> = {
    "not started": "Not started",
    todo: "Not started",
    "to do": "Not started",
    "in progress": "In progress",
    progress: "In progress",
    "in review": "In review",
    review: "In review",
    deployed: "Done",
    done: "Done",
    complete: "Done",
    completed: "Done",
  };

  return aliases[normalizeKey(status)] ?? status.trim();
}

function normalizeProject(project: string) {
  const aliases: Record<string, string> = {
    "harbor bean": HARBOR_BEAN_PROJECT,
    "harbor bean cafe": HARBOR_BEAN_PROJECT,
  };

  return aliases[normalizeKey(project)] ?? project.trim();
}

function normalizeAssignee(assignee: string) {
  const aliases: Record<string, string> = {
    carlos: "Carlos Vincent Frasenda",
    "carlos vincent": "Carlos Vincent Frasenda",
    "carlos vincent frasenda": "Carlos Vincent Frasenda",
    edrick: "Edrick Kesuma",
    "edrick kesuma": "Edrick Kesuma",
    darren: "Darren Prasetya",
    "darren prasetya": "Darren Prasetya",
    laksh: "Lakshya Agarwal",
    lakshya: "Lakshya Agarwal",
    "lakshya agarwal": "Lakshya Agarwal",
  };

  return aliases[normalizeKey(assignee)] ?? assignee.trim();
}

function normalizePriority(priority: string) {
  const trimmed = priority.trim();
  return /^p\d+$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

function normalizeKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function approvalMessage(ticketName: string, current: TicketFieldChanges, changes: TicketFieldChanges) {
  return `I found ${ticketName}. Apply sprint-board changes: ${formatChanges(current, changes)}?`;
}

function formatChanges(current: TicketFieldChanges, changes: TicketFieldChanges) {
  return (Object.keys(changes) as Array<keyof TicketFieldChanges>)
    .map((field) => `${field} ${formatValue(current[field])} -> ${formatValue(changes[field])}`)
    .join(", ");
}

function formatValue(value: unknown) {
  return value === null || value === "" || value === undefined ? "empty" : String(value);
}

async function buildModelMessages(conversationId: string): Promise<ModelMessage[]> {
  const persistedMessages = await MessageModel.find({
    conversationId,
    role: { $in: ["user", "assistant"] },
  })
    .sort({ order: 1 })
    .limit(18)
    .lean();

  return persistedMessages.map((message) => ({
    role: message.role as "user" | "assistant",
    content: message.content,
  }));
}

function inferExaUseCase(query: string): "verification" | "research" | "cve" | "news" {
  if (/cve|vulnerability|security|exploit|advisory/i.test(query)) return "cve";
  if (/news|recent|article|market|competitor|industry/i.test(query)) return "news";
  if (/verify|valid|blocker|is it true|fact.?check|confirm/i.test(query)) return "verification";
  return "research";
}

function systemPrompt({
  pendingAction,
  approvalGranted,
}: {
  pendingAction: PendingAction | null;
  approvalGranted: boolean;
}) {
  return `
You are LGTM Company Brain for the Harbor Bean Cafe landing-page sprint board.
Today is ${gmt8TodayFromNow(Date.now())} in GMT+8, computed from Date.now().

Use a Scout-style router surface:
- queryNotion reads live Notion sprint-board properties and body sections.
- querySlack reads recent Slack messages through the Slack tool from origin develop.
- queryExa validates technical blockers and retrieves live web context.
- updateNotion writes controlled Notion sprint-board updates.
- updateSlack posts real Slack messages and #company-brain-actions audit notifications.
- queryRepos, makePayment, and buySomething are available for develop's repo/payment/food demos.

Rules:
- Source of truth for tickets is live Notion, not Mongo.
- Always queryNotion before sprint-board answers, blocker checks, readiness summaries, status moves, assignee changes, due-date changes, priority changes, project changes, title changes, and note writes.
- Always queryNotion before updateNotion for any Notion mutation.
- Use querySlack when the user asks about recent communication, announcements, informal status, blocker chatter, vulnerability reports, or previous Company Brain actions.
- Route querySlack by default:
  - #announcements for announcements, events, all-hands, company direction, and broad updates.
  - #engineering for tickets, engineering issues, blockers, launch status, PRs, bugs, and implementation chatter.
  - #vulnerability-monitoring for vulnerability reports, security incidents, CVEs, patches, and security fixes.
  - #company-brain-actions for prior actions taken by Company Brain.
- When a question mixes sprint-board state and recent team chatter, call queryNotion first, then querySlack on the routed channel.
- For ticket-related Slack writes, use #engineering and tag the relevant assignee/person when known.
- For broad announcements, use #announcements and avoid mass mentions unless the user explicitly asks.
- For vulnerability updates, use #vulnerability-monitoring.
- For action audits, use #company-brain-actions.
- If the user asks to send/update Slack but no tag is specified and a person is relevant, ask whether to tag anyone before posting. Do not guess broad tags.
- Non-audit Slack posts require approval. Call updateSlack once to stage the message and ask for approval; after the user confirms, call updateSlack again with approved true.
- Do not stage Slack messages only in plain assistant text. Any Slack draft that might later be sent must be staged by calling updateSlack, even if the user only asks to "show the updated message".
- If the user asks to revise a staged Slack message, call updateSlack again with the revised text and mentionPeople so the pending action is updated.
- If Pending action is type "slack_message" and Approval in latest user message is yes, your next action must be updateSlack with approved true.
- Never say a Slack message was sent, posted, nudged, notified, or tagged unless updateSlack was called in the current turn and returned ok true.
- For project-level Harbor Bean questions, query all tickets with bodies.
- Treat overdue as a potential blocker when Due Date is before today in GMT+8.
- HB-101 is a client-input blocker if overdue and still missing the reservation URL.
- HB-204 technical blocker validation must call queryExa with this exact compact query unless the user gives a better one: "official docs responsive iframe aspect-ratio Google Maps embed mobile overflow".
- After queryExa validates HB-204, classify the blocker using blocker_validity/verdict:
  - valid_blocker means work is blocked by missing external input.
  - fixable_implementation_issue means docs show a clear implementation path and the ticket is not truly externally blocked.
  - partially_valid means implementation is probably possible but still needs team verification.
  - unknown means no evidence-backed decision.
- queryExa answers only by default. Do not call updateNotion or updateSlack for Exa evidence unless the user explicitly chooses that follow-up.
- If queryExa returns ok false, say Exa validation failed and do not present the result as Exa-backed.
- After a successful queryExa blocker validation, end the answer with this exact follow-up question: "Do you want me to append this finding to the Notion ticket, or send a Slack nudge/message?"
- If the user asks to append/write/save/record the Exa finding to Notion, call updateNotion with action "record_latest_agent_note" and include verdict, evidence URL, and recommended next step in the note.
- If the user asks to tell Slack/send a nudge/message, call updateSlack with a concise message that includes the ticket, verdict, evidence URL, and next step.
- updateNotion can update these sprint-board fields: Name, Status, Project, Assignee, Due Date, and Priority. It can also write Latest agent note in the ticket body.
- Use updateNotion action "update_ticket_fields" for board-property changes. Put requested field changes in changes: { name, status, project, assignee, dueDate, priority }.
- For reassignments, use changes.assignee. Known teammate names: Carlos Vincent Frasenda, Edrick Kesuma, Darren Prasetya, Lakshya Agarwal.
- Do not reject reassignment, due-date, title, project, priority, or status changes as unsupported when they target the sprint board.
- All sprint-board field changes require second-turn approval. On the first request, call updateNotion with update_ticket_fields so it stores pending approval and returns the approval prompt, then ask the user to confirm.
- If the user approves a pending Notion action, call updateNotion with approved true. The server handles the #company-brain-actions audit.
- If a tool returns ok false, explain the graceful failure. Never invent successful writes.
- Final answers should be concise: state the result, evidence, and next step.

Pending action:
${pendingAction ? JSON.stringify(pendingAction) : "none"}
Approval in latest user message: ${approvalGranted ? "yes" : "no"}
`.trim();
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (/AI_MODEL/.test(message)) {
    return "AI_MODEL is not set, so Company Brain could not start the agent run.";
  }

  if (/NOTION_TOKEN/.test(message)) {
    return "Tool failed: queryNotion (NOTION_TOKEN is not set).";
  }

  if (/NOTION_MCP_AUTH_TOKEN/.test(message)) {
    return "Tool failed: queryNotion (NOTION_MCP_AUTH_TOKEN is not set).";
  }

  if (/fetch failed|ECONNREFUSED|MCP|Notion MCP/i.test(message)) {
    return "Tool failed: queryNotion (Notion MCP server is unavailable. Run `bun run notion:mcp` and try again).";
  }

  if (/EXA_API_KEY/.test(message)) {
    return "Tool failed: queryExa (EXA_API_KEY is not set).";
  }

  if (/SLACK_BOT_TOKEN/.test(message)) {
    return "Tool failed: updateSlack (SLACK_BOT_TOKEN is not set).";
  }

  return "Company Brain could not complete this run. Check provider credentials and try again.";
}

function summaryFromAnswer(userMessage: string, answer: string) {
  const trimmedAnswer = answer.replace(/\s+/g, " ").trim();
  return `${titleFromMessage(userMessage)} -> ${trimmedAnswer.slice(0, 120)}`;
}
