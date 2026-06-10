import { createScaffoldTool } from "../scaffold";
import type { ToolDefinition } from "../types";

export const updateNotion: ToolDefinition = {
  name: "updateNotion",
  mode: "write",
  owners: ["edrick"],
  allowedAgents: ["updater"],
  description: "Update mutable Notion sprint board fields or a controlled Latest agent note on a ticket.",
  promptPath: "packages/tools/src/notion/update-notion.prompt.md",
  run: createScaffoldTool("updateNotion", "Scaffolded Notion sprint board update."),
};
