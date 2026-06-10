import type { PersonId } from "@company-brain/shared";
import type { ToolDefinition, ToolHandler } from "../types";
import { sendSlackMessage, type SendMessageInput } from "./send-message";
import { notifyTaskDone, type TaskDoneNotification } from "./notify-task-done";
import type { SlackChannel } from "./client";

type UpdateSlackInput = {
  action: "send_message" | "notify_task_done";
  channel?: SlackChannel;
  text?: string;
  tagUser?: PersonId;
  task?: TaskDoneNotification;
};

const handler: ToolHandler = async (input, context) => {
  const params = input as UpdateSlackInput;

  if (params.action === "notify_task_done" && params.task) {
    const result = await notifyTaskDone(params.task);
    return {
      ok: true,
      tool: "updateSlack",
      summary: `Notified ${params.task.owner} that "${params.task.taskName}" ${params.task.status}.`,
      data: result,
    };
  }

  if (params.action === "send_message" && params.channel && params.text) {
    const msgInput: SendMessageInput = {
      channel: params.channel,
      text: params.text,
      tagUser: params.tagUser,
    };
    const result = await sendSlackMessage(msgInput);
    return {
      ok: true,
      tool: "updateSlack",
      summary: `Sent message to #${result.channel}.`,
      data: result,
    };
  }

  return {
    ok: false,
    tool: "updateSlack",
    summary: "Invalid input: must specify action with required fields.",
  };
};

export const updateSlack: ToolDefinition = {
  name: "updateSlack",
  mode: "write",
  owners: ["edrick"],
  allowedAgents: ["updater"],
  description: "Send Slack messages and task completion notifications to channels, tagging the task owner.",
  promptPath: "packages/tools/src/slack/update-slack.prompt.md",
  run: handler,
};
