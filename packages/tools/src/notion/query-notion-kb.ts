import { createScaffoldTool } from "../scaffold";
import type { ToolDefinition } from "../types";

export const queryNotionKB: ToolDefinition = {
  name: "queryNotionKB",
  mode: "read",
  owners: ["carlos"],
  allowedAgents: ["searcher"],
  description: "Read company knowledge base docs, policies, briefs, and semi-structured Notion pages.",
  promptPath: "packages/tools/src/notion/query-notion-kb.prompt.md",
  run: createScaffoldTool("queryNotionKB", "Scaffolded Notion knowledge base query."),
};
