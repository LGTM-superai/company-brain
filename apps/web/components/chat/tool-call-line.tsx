import type { ToolName } from "@company-brain/shared";

export function ToolCallLine({ tool }: { tool: ToolName }) {
  return (
    <div className="flex items-center gap-2 text-tertiary">
      <span className="material-symbols-outlined text-[16px]">build</span>
      <span className="text-xs font-mono uppercase tracking-widest">{tool}</span>
    </div>
  );
}
