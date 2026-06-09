import { createScaffoldTool } from "../scaffold";
import type { ToolDefinition } from "../types";

export const updateSlack: ToolDefinition = {
  name: "updateSlack",
  mode: "write",
  owners: ["edrick"],
  allowedAgents: ["updater"],
  description: "Send Slack messages, nudges, and #company-brain-actions audit notifications.",
  promptPath: "packages/tools/src/slack/update-slack.prompt.md",
  run: createScaffoldTool("updateSlack", "Scaffolded Slack update."),
};
