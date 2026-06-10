import type { ToolName } from "@company-brain/shared";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import { getRuntimeModel } from "../../../lib/ai-model";
import { connectMongo } from "../../../lib/mongodb";
import { MessageModel } from "../../../lib/models";
import { queryExaVerdict } from "../../../lib/exa-runtime";
import { HARBOR_BEAN_PROJECT } from "../../../lib/notion-runtime";
import {
  queryMcpNotionTickets,
  updateMcpTicketFields,
  updateMcpLatestAgentNote,
} from "../../../lib/notion-mcp-runtime";
import {
  querySlackMessages,
  updateSlackMessage,
  type SlackChannelPurpose,
} from "../../../lib/slack-runtime";
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

export const runtime = "nodejs";

type ChatRequestBody = {
  id?: string;
  messages?: UIMessage[];
};

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
  query: z.string(),
  channels: z.array(z.string()).optional(),
  timeRange: z.string().optional(),
  people: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  lookbackDays: z.number().int().min(1).max(365).optional(),
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
  const incomingMessages = Array.isArray(body.messages) ? body.messages : [];
  const latestUserMessage = [...incomingMessages].reverse().find((message) => message.role === "user");
  const rawMessage = latestUserMessage ? textFromUiMessage(latestUserMessage).trim() : "";

  if (!rawMessage) {
    return new Response("Message is required.", { status: 400 });
  }

  await connectMongo();

  const conversationId = body.id ?? `conversation-${Date.now()}`;
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

  const toolMessageIds = new Map<string, string>();
  const modelMessages = await buildModelMessages(conversationId, incomingMessages);
  const toolChoice = forcedToolChoiceForLatestMessage(rawMessage, pendingAction, approvalGranted);

  try {
    const result = streamText({
      model: getRuntimeModel(),
      system: systemPrompt({ pendingAction, approvalGranted }),
      messages: modelMessages,
      tools: buildTools({
        conversationId,
        approvalGranted,
        pendingAction,
      }),
      toolChoice,
      stopWhen: stepCountIs(8),
      maxOutputTokens: 900,
      experimental_onToolCallStart: async (event) => {
        const toolName = event.toolCall.toolName as ToolName;
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
      onFinish: async (event) => {
        const text = event.text.trim();

        if (text) {
          await persistAssistantMessage(conversationId, text, nextOrder++);
          await updateConversationSummary(conversationId, summaryFromAnswer(rawMessage, text));
        }
      },
      onError: async (event) => {
        await updateConversationSummary(
          conversationId,
          `Tool or model failure while handling: ${titleFromMessage(rawMessage)}`,
        );
        console.error(event.error);
      },
    });

    return result.toUIMessageStreamResponse({
      onError: (error) => friendlyStreamError(error),
    });
  } catch (error) {
    const message = friendlyStreamError(error);
    await persistAssistantMessage(conversationId, message, nextOrder++);
    await updateConversationSummary(conversationId, message);
    return new Response(message, { status: 500 });
  }
}

function buildTools({
  conversationId,
  approvalGranted,
  pendingAction,
}: {
  conversationId: string;
  approvalGranted: boolean;
  pendingAction: PendingAction | null;
}) {
  return {
    queryNotion: tool({
      description:
        "Query the live Notion sprint board for Harbor Bean ticket properties and body sections. Use this before answering sprint status, blockers, readiness, and ticket moves.",
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
          tickets: result.tickets.map((ticket: (typeof result.tickets)[number]) => ({
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
            sections: ticket.sections.map((section: (typeof ticket.sections)[number]) => ({
              title: section.title,
              text: section.text,
            })),
          })),
        };
      },
    }),
    queryExa: tool({
      description:
        "Validate a technical blocker with Exa Beta Agent and return blocker validity, evidence, and suggested Notion/Slack follow-ups. If this fails, do not write evidence to Notion.",
      inputSchema: z.object({
        query: z.string(),
        source_preference: z.string().optional(),
      }),
      execute: async (input) => queryExaVerdict(input.query),
    }),
    querySlack: tool({
      description:
        "Read recent Slack messages from routed channels. Defaults: announcements for events/company direction, engineering for tickets/engineering issues, vulnerability-monitoring for security reports, and company-brain-actions for action history.",
      inputSchema: querySlackInputSchema,
      execute: async (input) => {
        try {
          return await querySlackMessages(input);
        } catch (error) {
          return {
            ok: false,
            source: "slack",
            message: "Tool failed: querySlack",
            error: error instanceof Error ? error.message : "Unknown Slack error.",
          };
        }
      },
    }),
    updateNotion: tool({
      description:
        "Update the live Notion sprint board after queryNotion. Can write Latest agent note or update mutable ticket fields: Name, Status, Project, Assignee, Due Date, and Priority. Mutations use approval and current-state guards.",
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

          return updateMcpLatestAgentNote({
            ticket: input.ticket,
            note: input.note,
          });
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
        }

        return result;
      },
    }),
    updateSlack: tool({
      description:
        "Post real Slack messages, nudges, announcements, vulnerability notes, and #company-brain-actions audit logs. Non-audit channel posts require approval.",
      inputSchema: updateSlackInputSchema,
      execute: async (input) => {
        const slackApprovalGranted = approvalGranted && pendingAction?.type === "slack_message";
        const request = buildSlackUpdateRequest(
          input,
          pendingAction,
          slackApprovalGranted,
        );

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
            text: request.value.text ?? request.value.message ?? "",
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

        try {
          const result = await updateSlackMessage(request.value);

          if (!result.ok) {
            return result;
          }

          await persistSlackAudit(conversationId, result.text ?? request.value.text ?? request.value.message ?? "", {
            ...request.value,
            channel: result.channel,
            slack: {
              ts: result.ts,
              audit: result.audit,
            },
          });

          if (pendingAction?.type === "slack_message") {
            await clearPendingAction(conversationId);
          }

          return result;
        } catch (error) {
          return {
            ok: false,
            source: "slack",
            message: "Tool failed: updateSlack",
            error: error instanceof Error ? error.message : "Unknown Slack error.",
          };
        }
      },
    }),
  };
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
        channelPurpose: pendingAction.channelPurpose as SlackChannelPurpose | undefined,
        text: pendingAction.text,
        mentionPeople: pendingAction.mentionPeople,
      },
    };
  }

  const rawText = input.text ?? input.message ?? auditTextFromSlackInput(input);
  const text = sanitizeSlackDraftText(rawText, input.mentionPeople);

  if (!text.trim()) {
    return {
      ok: false as const,
      message: "Tool failed: updateSlack (text, message, or system/target/action is required).",
    };
  }

  return {
    ok: true as const,
    value: {
      channel: input.channel,
      channelPurpose: input.channelPurpose,
      text: text.trim(),
      message: input.message,
      system: input.system,
      target: input.target,
      action: input.action,
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

function sanitizeSlackDraftText(text: string, mentionPeople?: string[]) {
  let sanitized = text.replace(/<@[A-Z0-9]+>\s*/g, "");

  if (mentionPeople?.length) {
    for (const person of mentionPeople) {
      sanitized = sanitized.replace(new RegExp(`@?${escapeRegExp(person)}\\s*`, "gi"), "");
      const firstName = person.split(/\s+/)[0];
      if (firstName) {
        sanitized = sanitized.replace(new RegExp(`@?${escapeRegExp(firstName)}\\s*`, "gi"), "");
      }
    }
  }

  return sanitized
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^\s*[-–—,:]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shouldAskSlackApproval(
  input: {
    channel?: string;
    channelPurpose?: SlackChannelPurpose;
    system?: string;
    target?: string;
    action?: string;
  },
  approved: boolean,
) {
  if (approved) return false;
  if (input.channelPurpose === "company-brain-actions") return false;
  if (!input.channel && !input.channelPurpose && input.system && input.target && input.action) return false;
  return true;
}

function slackApprovalMessage(input: {
  channel?: string;
  channelPurpose?: SlackChannelPurpose;
  text?: string;
  mentionPeople?: string[];
}) {
  const destination = input.channel ? `#${input.channel.replace(/^#/, "")}` : `#${input.channelPurpose ?? "company-brain-actions"}`;
  const mentionLine = input.mentionPeople?.length
    ? `I will tag: ${input.mentionPeople.join(", ")}.`
    : "No one is tagged yet. If someone should be tagged, tell me who; otherwise say yes to send as-is.";

  return `Approve posting to ${destination}? ${mentionLine} Message: "${input.text ?? ""}"`;
}

function forcedToolChoiceForLatestMessage(
  message: string,
  pendingAction: PendingAction | null,
  approvalGranted: boolean,
) {
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
        channel: draft.channel,
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

  const channelName = channelMatch[1].toLowerCase();
  const text = cleanupRecoveredSlackDraft(messageMatch[1]);

  if (text.length < 8) return null;

  const channelPurpose = slackChannelPurposeFromName(channelName);

  return {
    channel: channelPurpose ? undefined : channelName,
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

function slackChannelPurposeFromName(channelName: string): SlackChannelPurpose | undefined {
  const normalized = channelName.replace(/^#/, "").toLowerCase();

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

function extractMentionPeopleFromText(text: string) {
  const people: string[] = [];
  const candidates = [
    { pattern: /\bEdrick(?:\s+Kesuma)?\b/i, name: "Edrick Kesuma" },
    { pattern: /\bCarlos(?:\s+Vincent\s+Frasenda)?\b/i, name: "Carlos Vincent Frasenda" },
    { pattern: /\bDarren(?:\s+Prasetya)?\b/i, name: "Darren Prasetya" },
    { pattern: /\bLaksh(?:ya)?(?:\s+Agarwal)?\b/i, name: "Lakshya Agarwal" },
  ];

  for (const candidate of candidates) {
    if (candidate.pattern.test(text)) {
      people.push(candidate.name);
    }
  }

  return people;
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
- querySlack reads recent Slack messages from the relevant company channels.
- queryExa validates technical blockers against external documentation.
- updateNotion writes controlled Notion sprint-board updates.
- updateSlack posts real Slack messages and #company-brain-actions audit notifications.

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
- Do not stage Slack messages in plain assistant text. Any Slack draft that might later be sent must be staged by calling updateSlack, even if the user only asks to "show the updated message".
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
- If queryExa returns ok false, say Exa validation failed and do not present the result as Exa-backed. You may mention ticket-body docs only as internal Notion context and suggest retrying Exa.
- After a successful queryExa blocker validation, end the answer with this exact follow-up question: "Do you want me to append this finding to the Notion ticket, or send a Slack nudge/message?"
- If the user asks to append/write/save/record the Exa finding to Notion, call updateNotion with action "record_latest_agent_note" and include verdict, evidence URL, and recommended next step in the note.
- If the user asks to tell Slack/send a nudge/message, call updateSlack with a concise message that includes the ticket, verdict, evidence URL, and next step.
- updateNotion can update these sprint-board fields: Name, Status, Project, Assignee, Due Date, and Priority. It can also write Latest agent note in the ticket body.
- Use updateNotion action "update_ticket_fields" for board-property changes. Put requested field changes in changes: { name, status, project, assignee, dueDate, priority }.
- For reassignments, use changes.assignee. Known teammate names: Carlos Vincent Frasenda, Edrick Kesuma, Darren Prasetya, Lakshya Agarwal.
- Do not reject reassignment, due-date, title, project, priority, or status changes as unsupported when they target the sprint board.
- All sprint-board field changes require second-turn approval. On the first request, call updateNotion with update_ticket_fields so it stores pending approval and returns the approval prompt, then ask the user to confirm.
- If the user approves a pending action, call updateNotion with approved true, then call updateSlack.
- After any successful updateNotion mutation, call updateSlack with system "Notion", target ticket code/name, and the action so it is recorded in #company-brain-actions.
- After any successful updateSlack mutation to a non-audit channel, mention that updateSlack also audited it to #company-brain-actions only if the tool returned an audit.
- Never say an audit was posted unless updateSlack was actually called and returned ok true.
- If a tool returns ok false, explain the graceful failure. Never invent successful writes.
- Final answers should be concise: state the result, evidence, and next step.

Pending action:
${pendingAction ? JSON.stringify(pendingAction) : "none"}
Approval in latest user message: ${approvalGranted ? "yes" : "no"}
`.trim();
}

async function buildModelMessages(conversationId: string, incomingMessages: UIMessage[]) {
  const persistedMessages = await MessageModel.find({
    conversationId,
    role: { $in: ["user", "assistant"] },
  })
    .sort({ order: 1 })
    .limit(16)
    .lean();

  const uiMessages: UIMessage[] = [
    ...persistedMessages.map((message) => ({
      id: message.messageId,
      role: message.role as "user" | "assistant",
      parts: [{ type: "text" as const, text: message.content }],
    })),
    ...incomingMessages,
  ];

  const seen = new Set<string>();
  const deduped = uiMessages.filter((message) => {
    const key = `${message.role}:${textFromUiMessage(message)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(textFromUiMessage(message).trim());
  });

  return convertToModelMessages(deduped, { ignoreIncompleteToolCalls: true });
}

function textFromUiMessage(message: UIMessage) {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function friendlyStreamError(error: unknown) {
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
    return "Tool failed: querySlack (SLACK_BOT_TOKEN is not set).";
  }

  return "Company Brain could not complete this run. Check the provider credentials and try again.";
}

function summaryFromAnswer(userMessage: string, answer: string) {
  const trimmedAnswer = answer.replace(/\s+/g, " ").trim();
  return `${titleFromMessage(userMessage)} -> ${trimmedAnswer.slice(0, 120)}`;
}
