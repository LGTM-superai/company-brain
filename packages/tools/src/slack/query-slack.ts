import type { ToolDefinition } from "../types";
import { getSlackClient } from "./client";

export const querySlack: ToolDefinition = {
  name: "querySlack",
  mode: "read",
  owners: ["edrick"],
  allowedAgents: ["searcher"],
  description:
    "Search Slack channels and threads for updates, blockers, announcements, and action logs.",
  promptPath: "packages/tools/src/slack/query-slack.prompt.md",
  async run(input) {
    const { query, channel, limit } = input as {
      query?: string;
      channel?: string;
      limit?: number;
    };

    if (!query && !channel) {
      return {
        ok: false,
        tool: "querySlack",
        summary: "Missing required field: query or channel",
      };
    }

    const client = getSlackClient();

    try {
      if (query) {
        const result = await client.search.messages({
          query,
          count: limit ?? 10,
          sort: "timestamp",
          sort_dir: "desc",
        });

        const matches = result.messages?.matches ?? [];
        const messages = matches.map((m) => ({
          text: m.text ?? "",
          channel: (m.channel as { name?: string })?.name ?? m.channel,
          user: m.user ?? m.username ?? "unknown",
          ts: m.ts ?? "",
          permalink: m.permalink ?? "",
        }));

        return {
          ok: true,
          tool: "querySlack",
          summary: `Found ${messages.length} message(s) matching "${query}"`,
          data: { query, messages },
        };
      }

      const result = await client.conversations.history({
        channel: channel!,
        limit: limit ?? 20,
      });

      const messages = (result.messages ?? []).map((m) => ({
        text: m.text ?? "",
        user: m.user ?? "unknown",
        ts: m.ts ?? "",
      }));

      return {
        ok: true,
        tool: "querySlack",
        summary: `Fetched ${messages.length} recent message(s) from channel`,
        data: { channel, messages },
      };
    } catch (error) {
      return {
        ok: false,
        tool: "querySlack",
        summary: `Slack query failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
};
