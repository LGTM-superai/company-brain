import type { AgentId, ToolMode, ToolName } from "@company-brain/shared";
import type { PersonId } from "@company-brain/shared";

export type ToolExecutionContext = {
  actorId?: PersonId;
  runId?: string;
  agentId?: AgentId;
};

export type ToolResult = {
  ok: boolean;
  tool: ToolName;
  summary: string;
  data?: unknown;
};

export type ToolHandler = (input: unknown, context: ToolExecutionContext) => Promise<ToolResult>;

export type ToolDefinition = {
  name: ToolName;
  mode: ToolMode;
  owners: PersonId[];
  allowedAgents: AgentId[];
  description: string;
  promptPath: string;
  run: ToolHandler;
};
