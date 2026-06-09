import type { ToolName } from "@company-brain/shared";

export function ToolCallLine({ tool }: { tool: ToolName }) {
  return <div>Tool called: {tool}</div>;
}
