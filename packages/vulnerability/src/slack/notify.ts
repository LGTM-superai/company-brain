import { WebClient } from "@slack/web-api";
import { getConfig } from "../config.js";

let _slack: WebClient | null = null;

async function getClient(): Promise<WebClient> {
  if (_slack) return _slack;
  const cfg = await getConfig();
  _slack = new WebClient(cfg.slackBotToken);
  return _slack;
}

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  moderate: "🟡",
  medium: "🟡",
  low: "🟢",
  unknown: "⚪",
};

export async function postCveAlert(opts: {
  channelId: string;
  cveId: string;
  severity: string;
  pkg: string;
  currentVersion: string;
  patchedVersion: string;
  advisoryUrl: string;
  prUrl: string;
  repo: string;
}): Promise<string> {
  const slack = await getClient();
  const emoji = SEVERITY_EMOJI[opts.severity.toLowerCase()] ?? "⚪";

  const res = await slack.chat.postMessage({
    channel: opts.channelId,
    text: `${opts.cveId} (${opts.severity}) in ${opts.pkg} — fix PR opened for ${opts.repo}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🛡️ Vulnerability Fix PR Opened" },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*CVE:*\n<${opts.advisoryUrl}|${opts.cveId}>`,
          },
          {
            type: "mrkdwn",
            text: `*Severity:*\n${emoji} ${opts.severity}`,
          },
          {
            type: "mrkdwn",
            text: `*Package:*\n\`${opts.pkg}\``,
          },
          {
            type: "mrkdwn",
            text: `*Fix:*\n\`${opts.currentVersion}\` → \`${opts.patchedVersion}\``,
          },
          {
            type: "mrkdwn",
            text: `*Repository:*\n${opts.repo}`,
          },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            style: "primary",
            text: { type: "plain_text", text: "Review Pull Request" },
            url: opts.prUrl,
          },
        ],
      },
    ],
  });

  return (res as any).ts as string;
}

export async function postNoFix(opts: {
  channelId: string;
  cveId: string;
  severity: string;
  pkg: string;
  currentVersion: string;
  advisoryUrl: string;
  repo: string;
}): Promise<void> {
  const slack = await getClient();
  const emoji = SEVERITY_EMOJI[opts.severity.toLowerCase()] ?? "⚪";

  await slack.chat.postMessage({
    channel: opts.channelId,
    text: `${opts.cveId} in ${opts.pkg} — no patch available yet for ${opts.repo}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "⚠️ Vulnerability — No Fix Available" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*CVE:*\n<${opts.advisoryUrl}|${opts.cveId}>` },
          { type: "mrkdwn", text: `*Severity:*\n${emoji} ${opts.severity}` },
          { type: "mrkdwn", text: `*Package:*\n\`${opts.pkg}\`` },
          { type: "mrkdwn", text: `*Current:*\n\`${opts.currentVersion}\`` },
          { type: "mrkdwn", text: `*Repository:*\n${opts.repo}` },
        ],
        text: {
          type: "mrkdwn",
          text: "No patched version is available yet. Monitor this advisory for updates.",
        },
      },
    ],
  });
}

export async function postError(opts: {
  channelId: string;
  cveId: string;
  pkg: string;
  repo: string;
  error: string;
}): Promise<void> {
  const slack = await getClient();
  await slack.chat.postMessage({
    channel: opts.channelId,
    text: `Failed to process ${opts.cveId} in ${opts.pkg} for ${opts.repo}: ${opts.error}`,
  });
}
