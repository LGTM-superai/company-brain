import { createScaffoldTool } from "../scaffold";
import type { ToolDefinition } from "../types";

export const queryGithub: ToolDefinition = {
  name: "queryGithub",
  mode: "read",
  owners: ["edrick", "darren"],
  allowedAgents: ["searcher", "coder"],
  description: "Read GitHub repositories, issues, pull requests, branches, files, and review context.",
  promptPath: "packages/tools/src/github/query-github.prompt.md",
  run: createScaffoldTool("queryGithub", "Scaffolded GitHub query."),
};
