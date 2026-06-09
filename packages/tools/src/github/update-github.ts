import { createScaffoldTool } from "../scaffold";
import type { ToolDefinition } from "../types";

export const updateGithub: ToolDefinition = {
  name: "updateGithub",
  mode: "write",
  owners: ["edrick", "darren"],
  allowedAgents: ["updater", "coder"],
  description: "Update GitHub issues, PR metadata, labels, comments, or branches after approval.",
  promptPath: "packages/tools/src/github/update-github.prompt.md",
  run: createScaffoldTool("updateGithub", "Scaffolded GitHub update."),
};
