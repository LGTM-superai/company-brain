import type { AgentId, ToolName } from "@company-brain/shared";
import type { PersonId } from "@company-brain/shared";

export type AgentDefinition = {
  id: AgentId;
  name: string;
  owner: PersonId;
  purpose: string;
  tools: ToolName[];
  promptPath: string;
};
