import type { ToolName } from "./tool-types";

export type ExaSearchResult = {
  title: string;
  url: string;
  summary: string;
  publishedDate?: string;
  author?: string;
  image?: string;
  favicon?: string;
  highlights?: string[];
};

export type AgentEvent =
  | {
      type: "tool_call";
      tool: ToolName;
      args?: unknown;
    }
  | {
      type: "tool_result";
      tool: ToolName;
      result: unknown;
    }
  | {
      type: "exa_results";
      results: ExaSearchResult[];
    }
  | {
      type: "assistant_message";
      content: string;
    }
  | {
      type: "done";
    };
