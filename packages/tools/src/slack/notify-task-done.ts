import type { PersonId } from "@company-brain/shared";
import { sendSlackMessage } from "./send-message";

export type TaskDoneNotification = {
  taskName: string;
  summary: string;
  owner: PersonId;
  status: "completed" | "failed";
  duration?: string;
};

export async function notifyTaskDone(notification: TaskDoneNotification) {
  const emoji = notification.status === "completed" ? "[DONE]" : "[FAILED]";
  const text = [
    `${emoji} *${notification.taskName}*`,
    notification.summary,
    notification.duration ? `Duration: ${notification.duration}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return sendSlackMessage({
    channel: "taskUpdates",
    text,
    tagUser: notification.owner,
  });
}
