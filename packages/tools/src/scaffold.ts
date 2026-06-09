import type { ToolHandler } from "./types";
import type { ToolName } from "@company-brain/shared";

export function createScaffoldTool(name: ToolName, summary: string): ToolHandler {
  return async (input, context) => ({
    ok: true,
    tool: name,
    summary,
    data: {
      scaffold: true,
      input,
      context,
    },
  });
}
