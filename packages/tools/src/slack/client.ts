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
  actions: process.env.SLACK_ACTION_CHANNEL_ID ?? "company-brain-actions",
  alerts: "brain-alerts",
  announcements: process.env.SLACK_ANNOUNCEMENTS_CHANNEL_ID ?? "announcements",
  engineering: process.env.SLACK_ENGINEERING_CHANNEL_ID ?? "engineering",
  vulnerabilityMonitoring:
    process.env.SLACK_VULNERABILITY_MONITORING_CHANNEL_ID ?? "vulnerability-monitoring",
} as const;

export type SlackChannel = keyof typeof CHANNELS;
