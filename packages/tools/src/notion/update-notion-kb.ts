import { createScaffoldTool } from "../scaffold";
import type { ToolDefinition } from "../types";

export const updateNotionKB: ToolDefinition = {
  name: "updateNotionKB",
  mode: "write",
  owners: ["carlos"],
  allowedAgents: ["updater"],
  description: "Update company knowledge base docs and project documentation in Notion.",
  promptPath: "packages/tools/src/notion/update-notion-kb.prompt.md",
  run: createScaffoldTool("updateNotionKB", "Scaffolded Notion knowledge base update."),
};
