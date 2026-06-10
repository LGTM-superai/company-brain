import { WebClient } from "@slack/web-api";

let _client: WebClient | null = null;

export function getSlackClient(): WebClient {
  if (!_client) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error("Missing SLACK_BOT_TOKEN env var");
    _client = new WebClient(token);
  }
  return _client;
}

export const CHANNELS = {
  taskUpdates: "task-updates",
  actions: "company-brain-actions",
  alerts: "brain-alerts",
} as const;

export type SlackChannel = keyof typeof CHANNELS;
