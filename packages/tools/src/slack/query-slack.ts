import { createScaffoldTool } from "../scaffold";
import type { ToolDefinition } from "../types";

export const querySlack: ToolDefinition = {
  name: "querySlack",
  mode: "read",
  owners: ["edrick"],
  allowedAgents: ["searcher"],
  description: "Search Slack channels and threads for updates, blockers, announcements, and action logs.",
  promptPath: "packages/tools/src/slack/query-slack.prompt.md",
  run: createScaffoldTool("querySlack", "Scaffolded Slack query."),
};
