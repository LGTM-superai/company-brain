import { createScaffoldTool } from "../scaffold";
import type { ToolDefinition } from "../types";

export const queryNotion: ToolDefinition = {
  name: "queryNotion",
  mode: "read",
  owners: ["edrick"],
  allowedAgents: ["searcher"],
  description: "Read Notion sprint board tickets, status, assignees, blockers, and project progress.",
  promptPath: "packages/tools/src/notion/query-notion.prompt.md",
  run: createScaffoldTool("queryNotion", "Scaffolded Notion sprint board query."),
};
