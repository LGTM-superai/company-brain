import { WebClient } from "@slack/web-api";
import { getEnv } from "../env";

let _client: WebClient | null = null;

export function getSlackClient(): WebClient {
  if (!_client) {
    const token = getEnv("SLACK_BOT_TOKEN");
    if (!token) throw new Error("Missing SLACK_BOT_TOKEN env var");
    _client = new WebClient(token);
  }
  return _client;
}

export const CHANNELS = {
  taskUpdates: "task-updates",
  actions: getEnv("SLACK_ACTION_CHANNEL_ID") ?? "company-brain-actions",
  alerts: "brain-alerts",
  announcements: getEnv("SLACK_ANNOUNCEMENTS_CHANNEL_ID") ?? "announcements",
  engineering: getEnv("SLACK_ENGINEERING_CHANNEL_ID") ?? "engineering",
  vulnerabilityMonitoring:
    getEnv("SLACK_VULNERABILITY_MONITORING_CHANNEL_ID") ?? "vulnerability-monitoring",
} as const;

export type SlackChannel = keyof typeof CHANNELS;
