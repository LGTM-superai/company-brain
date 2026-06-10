import type { ToolName } from "@company-brain/shared";
import { ConversationModel, MessageModel, SlackAuditModel } from "./models";

export type TicketFieldChanges = {
  name?: string;
  status?: string;
  project?: string;
  assignee?: string;
  dueDate?: string | null;
  priority?: string;
};

export type PendingAction =
  | {
  actionId: string;
  type: "move_status";
  ticket: string;
  currentStatus: string;
  newStatus: string;
  reason: string;
  createdAt: string;
}
  | {
      actionId: string;
      type: "update_ticket_fields";
      ticket: string;
      current: TicketFieldChanges;
      changes: TicketFieldChanges;
      reason: string;
      createdAt: string;
    }
  | {
      actionId: string;
      type: "slack_message";
      channel?: string;
      channelPurpose?: string;
      text: string;
      mentionPeople?: string[];
      reason: string;
      createdAt: string;
    }
  | {
      actionId: string;
      type: "create_ticket";
      ticket: string;
      changes: TicketFieldChanges;
      reason: string;
      createdAt: string;
    };

export async function ensureConversation(conversationId: string, title: string) {
  const existing = await ConversationModel.findOne({ conversationId });

  if (existing) {
    return existing;
  }

  return ConversationModel.create({
    conversationId,
    title,
    summary: "Harbor Bean sprint-board demo run.",
    updatedLabel: "Just now",
    order: 0,
  });
}

export async function getNextOrder(conversationId: string) {
  const lastMessage = await MessageModel.findOne({ conversationId })
    .sort({ order: -1 })
    .select({ order: 1 })
    .lean();

  return Number(lastMessage?.order ?? 0) + 1;
}

export async function persistUserMessage(conversationId: string, content: string, order: number) {
  return MessageModel.create({
    messageId: `${conversationId}-user-${Date.now()}`,
    conversationId,
    role: "user",
    content,
    order,
  });
}

export async function persistAssistantMessage(conversationId: string, content: string, order: number) {
  return MessageModel.create({
    messageId: `${conversationId}-assistant-${Date.now()}`,
    conversationId,
    role: "assistant",
    content,
    order,
  });
}

export async function persistToolCall(
  conversationId: string,
  toolName: ToolName,
  input: unknown,
  order: number,
) {
  const messageId = `${conversationId}-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await MessageModel.create({
    messageId,
    conversationId,
    role: "tool",
    content: `Tool called: ${toolName}`,
    toolName,
    toolData: {
      state: "called",
      input: compactValue(input),
    },
    order,
  });

  return messageId;
}

export async function persistToolResult(messageId: string | undefined, output: unknown, durationMs?: number) {
  if (!messageId) return;

  await MessageModel.updateOne(
    { messageId },
    {
      $set: {
        toolData: {
          state: "finished",
          durationMs,
          output: compactValue(output),
        },
      },
    },
  );
}

export async function persistToolFailure(messageId: string | undefined, error: unknown, durationMs?: number) {
  if (!messageId) return;

  await MessageModel.updateOne(
    { messageId },
    {
      $set: {
        content: "Tool failed",
        toolData: {
          state: "failed",
          durationMs,
          error: error instanceof Error ? error.message : String(error),
        },
      },
    },
  );
}

export async function setPendingAction(conversationId: string, pendingAction: PendingAction) {
  await ConversationModel.updateOne({ conversationId }, { $set: { pendingAction } });
}

export async function getPendingAction(conversationId: string) {
  const conversation = await ConversationModel.findOne({ conversationId }).select({ pendingAction: 1 }).lean();
  return (conversation?.pendingAction ?? null) as PendingAction | null;
}

export async function clearPendingAction(conversationId: string) {
  await ConversationModel.updateOne({ conversationId }, { $set: { pendingAction: null } });
}

export async function persistSlackAudit(
  conversationId: string,
  message: string,
  action?: Record<string, unknown>,
) {
  const auditId = `${conversationId}-audit-${Date.now()}`;
  const channel = typeof action?.channel === "string" ? action.channel : "#company-brain-actions";

  await SlackAuditModel.create({
    auditId,
    conversationId,
    channel,
    message,
    action,
  });

  return {
    ok: true,
    channel,
    message,
    auditId,
  };
}

export async function updateConversationSummary(conversationId: string, summary: string) {
  await ConversationModel.updateOne(
    { conversationId },
    {
      $set: {
        summary,
        updatedLabel: "Just now",
      },
    },
  );
}

export function titleFromMessage(message: string) {
  const title = message.replace(/\s+/g, " ").trim();
  return title.length > 52 ? `${title.slice(0, 49)}...` : title || "Harbor Bean demo";
}

export function isApprovalMessage(message: string) {
  return /\b(yes|yep|yeah|approve|approved|confirm|confirmed|go ahead|do it|move it|please do)\b/i.test(
    message,
  );
}

function compactValue(value: unknown) {
  const json = JSON.stringify(value, (_key, nestedValue) => {
    if (typeof nestedValue === "string" && nestedValue.length > 900) {
      return `${nestedValue.slice(0, 900)}...`;
    }

    return nestedValue;
  });

  if (!json) return value;
  return JSON.parse(json.length > 8000 ? JSON.stringify(`${json.slice(0, 7997)}...`) : json);
}
