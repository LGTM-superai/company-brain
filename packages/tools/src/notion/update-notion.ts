import { createScaffoldTool } from "../scaffold";
import type { ToolDefinition } from "../types";

export const updateNotion: ToolDefinition = {
  name: "updateNotion",
  mode: "write",
  owners: ["edrick"],
  allowedAgents: ["updater"],
  description: "Update ticket status, assignee, priority, blocked reason, or notes on the Notion sprint board.",
  promptPath: "packages/tools/src/notion/update-notion.prompt.md",
  run: createScaffoldTool("updateNotion", "Scaffolded Notion sprint board update."),
};
