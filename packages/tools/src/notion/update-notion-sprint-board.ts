import { createScaffoldTool } from "../scaffold";
import type { ToolDefinition } from "../types";

export const updateNotionSprintBoard: ToolDefinition = {
  name: "updateNotionSprintBoard",
  mode: "write",
  owners: ["edrick"],
  allowedAgents: ["updater"],
  description: "Update ticket status, assignee, priority, blocked reason, or notes on the Notion sprint board.",
  promptPath: "packages/tools/src/notion/update-notion-sprint-board.prompt.md",
  run: createScaffoldTool("updateNotionSprintBoard", "Scaffolded Notion sprint board update."),
};
