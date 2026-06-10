import type { ToolDefinition } from "../types";
import { searchExa } from "./exa-runtime";

export const queryExa: ToolDefinition = {
  name: "queryExa",
  mode: "read",
  owners: ["laksh", "edrick"],
  allowedAgents: ["searcher"],
  description: "Search the live web for external validation, technical docs, public website evidence, and vulnerability context.",
  promptPath: "packages/tools/src/exa/query-exa.prompt.md",
  async run(input) {
    const { query } = input as { query: string };
    if (!query) {
      return { ok: false, tool: "queryExa", summary: "Missing required field: query" };
    }

    try {
      const results = await searchExa(query);
      return {
        ok: true,
        tool: "queryExa",
        summary: `Found ${results.length} result(s) for "${query}"`,
        data: { query, results },
      };
    } catch (error) {
      return {
        ok: false,
        tool: "queryExa",
        summary: `Exa search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
};
