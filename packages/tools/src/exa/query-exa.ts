import { createScaffoldTool } from "../scaffold";
import type { ToolDefinition } from "../types";

export const queryExa: ToolDefinition = {
  name: "queryExa",
  mode: "read",
  owners: ["laksh", "edrick"],
  allowedAgents: ["searcher"],
  description: "Search the live web for external validation, technical docs, public website evidence, and vulnerability context.",
  promptPath: "packages/tools/src/exa/query-exa.prompt.md",
  run: createScaffoldTool("queryExa", "Scaffolded Exa web search."),
};
