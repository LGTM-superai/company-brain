import { createScaffoldTool } from "../scaffold";
import type { ToolDefinition } from "../types";

export const queryNotionSprintBoard: ToolDefinition = {
  name: "queryNotionSprintBoard",
  mode: "read",
  owners: ["edrick"],
  allowedAgents: ["searcher"],
  description: "Read Notion sprint board tickets, status, assignees, blockers, and project progress.",
  promptPath: "packages/tools/src/notion/query-notion-sprint-board.prompt.md",
  run: createScaffoldTool("queryNotionSprintBoard", "Scaffolded Notion sprint board query."),
};
