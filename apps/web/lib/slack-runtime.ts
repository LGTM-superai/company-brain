import { users } from "@company-brain/shared";
import { getEnv, requireEnv } from "./env";

export type SlackChannelPurpose =
  | "announcements"
  | "engineering"
  | "vulnerability-monitoring"
  | "company-brain-actions";

export type QuerySlackInput = {
  query: string;
  channels?: string[];
  timeRange?: string;
  people?: string[];
  limit?: number;
  lookbackDays?: number;
};

export type UpdateSlackInput = {
  channel?: string;
  channelPurpose?: SlackChannelPurpose;
  text?: string;
  message?: string;
  system?: string;
  target?: string;
  action?: string;
  mentionPeople?: string[];
  audit?: boolean;
};

type SlackChannel = {
  id: string;
  name: string;
  purpose: SlackChannelPurpose | "custom";
};

type SlackApiResponse = {
  ok?: boolean;
  error?: string;
  response_metadata?: { next_cursor?: string };
  [key: string]: unknown;
};

const CHANNEL_CONFIG: Record<SlackChannelPurpose, { env: string; name: string }> = {
  announcements: { env: "SLACK_ANNOUNCEMENTS_CHANNEL_ID", name: "announcements" },
  engineering: { env: "SLACK_ENGINEERING_CHANNEL_ID", name: "engineering" },
  "vulnerability-monitoring": {
    env: "SLACK_VULNERABILITY_MONITORING_CHANNEL_ID",
    name: "vulnerability-monitoring",
  },
  "company-brain-actions": {
    env: "SLACK_ACTION_CHANNEL_ID",
    name: "company-brain-actions",
  },
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "from",
  "have",
  "into",
  "that",
  "the",
  "this",
  "what",
  "when",
  "where",
  "with",
  "would",
]);

let cachedChannels: SlackChannel[] | undefined;
let cachedUsers: Array<Record<string, unknown>> | undefined;

export function routeSlackChannelPurposes(query: string, channels?: string[]) {
  if (channels?.length) {
    return channels.map((channel) => normalizeChannelRef(channel));
  }

  const normalized = query.toLowerCase();
  const purposes = new Set<SlackChannelPurpose>();

  if (/\b(announce|announcement|announcements|event|events|all[- ]hands|company direction)\b/.test(normalized)) {
    purposes.add("announcements");
  }

  if (/\b(vulnerab\w*|cve|security|exploit|patch|incident|risk|fix)\b/.test(normalized)) {
    purposes.add("vulnerability-monitoring");
  }

  if (/\b(action log|audit|company brain|company-brain|previous things done|what did you do)\b/.test(normalized)) {
    purposes.add("company-brain-actions");
  }

  if (/\b(ticket|tickets|engineering|engineer|blocker|blocked|bug|deploy|launch|hb-\d+|harbor bean|code|pr)\b/.test(normalized)) {
    purposes.add("engineering");
  }

  if (!purposes.size) {
    purposes.add("engineering");
  }

  return [...purposes];
}

export async function querySlackMessages(input: QuerySlackInput) {
  const query = input.query.trim();

  if (!query) {
    return {
      ok: false,
      source: "slack",
      message: "Tool failed: querySlack (query is required).",
    };
  }

  const channelRefs = routeSlackChannelPurposes(query, input.channels);
  const channels = await Promise.all(channelRefs.map((channel) => resolveSlackChannel(channel)));
  const limit = clamp(input.limit ?? 8, 1, 20);
  const oldest = oldestTimestamp(input.lookbackDays ?? lookbackDaysFromTimeRange(input.timeRange));
  const tokens = queryTokens(query);
  const people = await resolveSlackUsers(input.people ?? []);
  const allMatches: Array<Record<string, unknown> & { score: number; ts: string }> = [];
  const channelErrors: Array<{ channel: string; error: string }> = [];

  for (const channel of channels) {
    const response = await readSlackHistory(channel.id, oldest);

    if (!response.ok) {
      channelErrors.push({ channel: `#${channel.name}`, error: response.error });
      continue;
    }

    for (const message of response.messages ?? []) {
      const text = slackText(message);
      const score = scoreSlackMessage(text, message, tokens, people);

      if (score <= 0 && tokens.length) continue;

      allMatches.push({
        channel: `#${channel.name}`,
        channelId: channel.id,
        ts: String(message.ts ?? ""),
        user: String(message.user ?? message.username ?? "unknown"),
        text: compactSlackText(text),
        score,
      });
    }
  }

  const matches = allMatches
    .sort((left, right) => right.score - left.score || Number(right.ts) - Number(left.ts))
    .slice(0, limit)
    .map(({ score: _score, ...match }) => match);

  if (channelErrors.length === channels.length) {
    return {
      ok: false,
      source: "slack",
      query,
      routedChannels: channels.map((channel) => `#${channel.name}`),
      count: 0,
      matches: [],
      channelErrors,
      message:
        "Tool failed: querySlack (the Slack bot could not read the routed channels. Invite the bot to the channel or add channel history scopes).",
    };
  }

  return {
    ok: true,
    source: "slack",
    query,
    routedChannels: channels.map((channel) => `#${channel.name}`),
    count: matches.length,
    matches,
    channelErrors,
    summaryHint:
      matches.length > 0
        ? "Summarize these Slack messages with channel and timestamp context."
        : "No matching Slack messages were found in the routed channels and lookback window.",
  };
}

export async function updateSlackMessage(input: UpdateSlackInput) {
  const rawText = slackMessageText(input);

  if (!rawText) {
    return {
      ok: false,
      source: "slack",
      message: "Tool failed: updateSlack (message text is required).",
    };
  }

  const channel = await resolveSlackChannel(
    input.channel ?? input.channelPurpose ?? defaultSlackChannelPurpose(input),
  );
  const mentionUsers = await resolveSlackUsers(input.mentionPeople ?? []);
  const textBody = mentionUsers.length ? rawText.replace(/<@[A-Z0-9]+>\s*/g, "").trim() : rawText;
  const text = withSlackMentions(textBody, mentionUsers.map((user) => user.id));
  const post = await postSlackMessage(channel.id, text);
  let auditPost: { channel?: string; ts?: string } | undefined;

  if (input.audit !== false && channel.purpose !== "company-brain-actions") {
    const auditChannel = await resolveSlackChannel("company-brain-actions");
    const auditText = `Slack action: posted to #${channel.name}. ${auditSummary(input, rawText)}`;
    auditPost = await postSlackMessage(auditChannel.id, auditText);
  }

  return {
    ok: true,
    source: "slack",
    channel: `#${channel.name}`,
    channelId: channel.id,
    ts: post.ts,
    text,
    mentioned: mentionUsers.map((user) => ({
      id: user.id,
      name: user.name,
    })),
    audit:
      auditPost || channel.purpose === "company-brain-actions"
        ? {
            channel: "#company-brain-actions",
            ts: auditPost?.ts ?? post.ts,
          }
        : undefined,
  };
}

export function defaultSlackChannelPurpose(input: Pick<UpdateSlackInput, "system" | "action" | "message" | "text">) {
  const text = `${input.system ?? ""} ${input.action ?? ""} ${input.message ?? ""} ${input.text ?? ""}`.toLowerCase();

  if (/\b(announce|announcement|all[- ]hands|company-wide|launch announcement)\b/.test(text)) {
    return "announcements";
  }

  if (/\b(vulnerab\w*|cve|security|exploit|patch|incident)\b/.test(text)) {
    return "vulnerability-monitoring";
  }

  if (/\b(ticket|hb-\d+|blocker|engineer|engineering|launch|pr|deploy)\b/.test(text)) {
    return "engineering";
  }

  return "company-brain-actions";
}

export function withSlackMentions(text: string, mentionIds: string[]) {
  const uniqueMentions = [...new Set(mentionIds)].filter(Boolean);
  if (!uniqueMentions.length) return text.trim();
  return `${uniqueMentions.map((id) => `<@${id}>`).join(" ")} ${text.trim()}`;
}

function normalizeChannelRef(channel: string) {
  return channel.trim().replace(/^#/, "").toLowerCase() as SlackChannelPurpose | string;
}

async function resolveSlackChannel(channelRef: string) {
  const normalized = normalizeChannelRef(channelRef);
  const configured = CHANNEL_CONFIG[normalized as SlackChannelPurpose];

  if (configured) {
    const configuredId = getEnv(configured.env);

    if (configuredId) {
      return {
        id: configuredId,
        name: configured.name,
        purpose: normalized as SlackChannelPurpose,
      };
    }
  }

  if (/^[CGD][A-Z0-9]+$/.test(channelRef)) {
    return {
      id: channelRef,
      name: configured?.name ?? channelRef,
      purpose: configured ? (normalized as SlackChannelPurpose) : "custom",
    };
  }

  const channels = await listSlackChannels();
  const match = channels.find((channel) => channel.name.toLowerCase() === normalized);

  if (!match) {
    throw new Error(`Slack channel "${channelRef}" was not found or the bot cannot access it.`);
  }

  return match;
}

async function listSlackChannels() {
  if (cachedChannels) return cachedChannels;

  const channels: SlackChannel[] = [];
  let cursor: string | undefined;

  do {
    const response = await slackApi<{
      channels?: Array<{ id?: string; name?: string }>;
      response_metadata?: { next_cursor?: string };
    }>("conversations.list", {
      exclude_archived: true,
      limit: 1000,
      types: "public_channel,private_channel",
      cursor,
    });

    for (const channel of response.channels ?? []) {
      if (!channel.id || !channel.name) continue;
      channels.push({
        id: channel.id,
        name: channel.name,
        purpose: purposeFromChannelName(channel.name),
      });
    }

    cursor = response.response_metadata?.next_cursor || undefined;
  } while (cursor);

  cachedChannels = channels;
  return channels;
}

async function resolveSlackUsers(people: string[]) {
  const resolved: Array<{ id: string; name: string }> = [];

  for (const person of people) {
    const user = await resolveSlackUser(person);
    if (user) resolved.push(user);
  }

  return resolved;
}

async function resolveSlackUser(person: string) {
  const normalized = person.trim().toLowerCase();
  if (!normalized) return null;

  if (/^U[A-Z0-9]+$/.test(person.trim())) {
    return { id: person.trim(), name: person.trim() };
  }

  const localUser = users.find((user) => {
    const candidates = [user.id, user.name, user.email].map((value) => value.toLowerCase());
    return candidates.includes(normalized) || user.name.toLowerCase().includes(normalized);
  });

  const email = localUser?.email.includes("@") ? localUser.email : normalized.includes("@") ? normalized : undefined;

  if (email) {
    const byEmail = await slackApi<{
      ok?: boolean;
      user?: { id?: string; real_name?: string; name?: string };
    }>("users.lookupByEmail", { email }, { allowErrors: true });

    if (byEmail.ok && byEmail.user?.id) {
      return {
        id: byEmail.user.id,
        name: byEmail.user.real_name ?? byEmail.user.name ?? localUser?.name ?? person,
      };
    }
  }

  const slackUsers = await listSlackUsers();
  const match = slackUsers.find((user) => {
    const profile = isRecord(user.profile) ? user.profile : {};
    const candidates = [
      user.name,
      user.real_name,
      profile.real_name,
      profile.display_name,
      profile.email,
      localUser?.name,
    ]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.toLowerCase());

    return candidates.some((candidate) => candidate === normalized || candidate.includes(normalized));
  });

  if (!match || typeof match.id !== "string") return null;

  return {
    id: match.id,
    name: String(match.real_name ?? match.name ?? person),
  };
}

async function listSlackUsers() {
  if (cachedUsers) return cachedUsers;

  const allUsers: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;

  do {
    const response = await slackApi<{
      members?: Array<Record<string, unknown>>;
      response_metadata?: { next_cursor?: string };
    }>("users.list", {
      limit: 1000,
      cursor,
    });

    allUsers.push(...(response.members ?? []));
    cursor = response.response_metadata?.next_cursor || undefined;
  } while (cursor);

  cachedUsers = allUsers;
  return allUsers;
}

async function postSlackMessage(channel: string, text: string) {
  const payload = await slackApi<{
    channel?: string;
    ts?: string;
    message?: { text?: string };
  }>("chat.postMessage", {
    channel,
    text,
  });

  return {
    channel: payload.channel,
    ts: payload.ts,
    text: payload.message?.text,
  };
}

async function readSlackHistory(channel: string, oldest: string) {
  try {
    const response = await slackApi<{
      messages?: Array<Record<string, unknown>>;
    }>("conversations.history", {
      channel,
      limit: 60,
      oldest,
      inclusive: true,
    });

    return {
      ok: true as const,
      messages: response.messages ?? [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!/not_in_channel/.test(message)) {
      return {
        ok: false as const,
        error: message,
      };
    }

    try {
      await slackApi("conversations.join", { channel });
      const response = await slackApi<{
        messages?: Array<Record<string, unknown>>;
      }>("conversations.history", {
        channel,
        limit: 60,
        oldest,
        inclusive: true,
      });

      return {
        ok: true as const,
        messages: response.messages ?? [],
      };
    } catch (joinError) {
      return {
        ok: false as const,
        error: joinError instanceof Error ? joinError.message : String(joinError),
      };
    }
  }
}

async function slackApi<T extends SlackApiResponse>(
  method: string,
  body: Record<string, unknown>,
  options: { allowErrors?: boolean } = {},
): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("SLACK_BOT_TOKEN")}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(removeUndefined(body)),
  });

  const payload = (await response.json().catch(() => ({}))) as T;

  if (!payload.ok && !options.allowErrors) {
    throw new Error(`Slack ${method} failed: ${payload.error ?? response.statusText}`);
  }

  return payload;
}

function slackMessageText(input: UpdateSlackInput) {
  const explicit = input.text ?? input.message;
  if (explicit?.trim()) return explicit.trim();

  if (input.system && input.target && input.action) {
    return `${input.system}: ${input.action} on ${input.target}`;
  }

  if (input.action && input.target) {
    return `${input.action} on ${input.target}`;
  }

  return "";
}

function auditSummary(input: UpdateSlackInput, text: string) {
  if (input.system && input.target && input.action) {
    return `${input.system}: ${input.action} on ${input.target}`;
  }

  return compactSlackText(text, 220);
}

function purposeFromChannelName(name: string): SlackChannel["purpose"] {
  const normalized = name.toLowerCase();

  if (normalized === "announcements") return "announcements";
  if (normalized === "engineering") return "engineering";
  if (normalized === "vulnerability-monitoring") return "vulnerability-monitoring";
  if (normalized === "company-brain-actions") return "company-brain-actions";

  return "custom";
}

function oldestTimestamp(lookbackDays: number) {
  const days = clamp(lookbackDays, 1, 365);
  return String(Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000));
}

function lookbackDaysFromTimeRange(timeRange?: string) {
  if (!timeRange) return 30;

  const normalized = timeRange.toLowerCase();
  const match = normalized.match(/(\d+)\s*(day|days|week|weeks|month|months)/);
  if (!match) return 30;

  const value = Number(match[1]);
  const unit = match[2];

  if (unit.startsWith("week")) return value * 7;
  if (unit.startsWith("month")) return value * 30;
  return value;
}

function queryTokens(query: string) {
  return query
    .toLowerCase()
    .replace(/#[a-z0-9-_]+/g, " ")
    .split(/[^a-z0-9-]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function scoreSlackMessage(
  text: string,
  message: Record<string, unknown>,
  tokens: string[],
  people: Array<{ id: string; name: string }>,
) {
  const normalized = text.toLowerCase();
  let score = tokens.reduce((current, token) => current + (normalized.includes(token) ? 2 : 0), 0);

  for (const person of people) {
    if (String(message.user ?? "") === person.id || normalized.includes(`<@${person.id.toLowerCase()}>`)) {
      score += 4;
    }
  }

  if (!tokens.length) score += 1;
  if (String(message.subtype ?? "") === "bot_message") score -= 1;

  return score;
}

function slackText(message: Record<string, unknown>) {
  return String(message.text ?? "").replace(/\s+/g, " ").trim();
}

function compactSlackText(text: string, maxLength = 700) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function removeUndefined(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
