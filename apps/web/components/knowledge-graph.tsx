"use client";

import type { KnowledgeNode } from "../lib/data";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

const sourceConfig: Record<
  string,
  { bg: string; border: string; dot: string; label: string }
> = {
  slack: {
    bg: "bg-purple-500/10 dark:bg-purple-500/15",
    border: "border-purple-500/40",
    dot: "bg-purple-500",
    label: "Slack",
  },
  github: {
    bg: "bg-neutral-500/10 dark:bg-neutral-400/15",
    border: "border-neutral-400/40",
    dot: "bg-neutral-400",
    label: "GitHub",
  },
  exa: {
    bg: "bg-cyan-500/10 dark:bg-cyan-500/15",
    border: "border-cyan-500/40",
    dot: "bg-cyan-500",
    label: "Exa",
  },
  notion: {
    bg: "bg-orange-500/10 dark:bg-orange-500/15",
    border: "border-orange-500/40",
    dot: "bg-orange-500",
    label: "Notion",
  },
  s3: {
    bg: "bg-emerald-500/10 dark:bg-emerald-500/15",
    border: "border-emerald-500/40",
    dot: "bg-emerald-500",
    label: "S3",
  },
  internal: {
    bg: "bg-primary/10",
    border: "border-primary/40",
    dot: "bg-primary",
    label: "Internal",
  },
};

const hubNodeIds = new Set([
  "company-brain",
  "hub-slack",
  "hub-github",
  "hub-exa",
  "hub-notion",
  "hub-s3",
]);

function getNodeSize(node: KnowledgeNode): string {
  if (node.nodeId === "company-brain") return "w-[150px] h-[150px]";
  if (hubNodeIds.has(node.nodeId)) return "w-[110px] h-[110px]";
  if (["channel", "repository", "database"].includes(node.type))
    return "w-[90px] h-[90px]";
  return "w-[72px] h-[72px]";
}

export function KnowledgeGraph({ nodes }: { nodes: KnowledgeNode[] }) {
  const nodeMap = new Map(nodes.map((node) => [node.nodeId, node]));
  const edges = nodes.flatMap((node) =>
    node.links
      .map((targetId) => {
        const target = nodeMap.get(targetId);
        return target ? { from: node, to: target } : null;
      })
      .filter(
        (edge): edge is { from: KnowledgeNode; to: KnowledgeNode } =>
          Boolean(edge),
      ),
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="relative min-h-[680px] rounded-xl border border-border bg-card/50 backdrop-blur-sm overflow-hidden">
        {/* Grid background */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,hsl(var(--primary)/0.03),transparent_70%)]" />
        <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,hsl(var(--border)/0.08)_0px,transparent_1px,transparent_48px),repeating-linear-gradient(90deg,hsl(var(--border)/0.08)_0px,transparent_1px,transparent_48px)]" />

        {/* SVG edges */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="edge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="hsl(var(--border))" stopOpacity="0.3" />
              <stop offset="50%" stopColor="hsl(var(--border))" stopOpacity="0.6" />
              <stop offset="100%" stopColor="hsl(var(--border))" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          {edges.map((edge) => (
            <line
              key={`${edge.from.nodeId}-${edge.to.nodeId}`}
              x1={edge.from.x}
              y1={edge.from.y}
              x2={edge.to.x}
              y2={edge.to.y}
              stroke="url(#edge-gradient)"
              strokeWidth="0.15"
            />
          ))}
        </svg>

        {/* Nodes */}
        {nodes.map((node) => {
          const config = sourceConfig[node.source] ?? sourceConfig.internal;
          const size = getNodeSize(node);
          const isHub = node.nodeId === "company-brain";

          return (
            <Tooltip key={node.nodeId}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border flex flex-col items-center justify-center text-center p-2 cursor-pointer",
                    "transition-all duration-200 ease-out",
                    "hover:scale-110 hover:shadow-lg hover:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    size,
                    isHub
                      ? "bg-primary/15 border-primary/60 shadow-lg shadow-primary/10"
                      : cn(config.bg, config.border, "shadow-sm"),
                  )}
                  style={{ left: `${node.x}%`, top: `${node.y}%` }}
                >
                  {isHub && (
                    <span className="absolute inset-0 rounded-full animate-ping bg-primary/5" />
                  )}
                  <span
                    className={cn(
                      "font-medium leading-tight line-clamp-2 text-foreground",
                      isHub ? "text-[11px]" : hubNodeIds.has(node.nodeId) ? "text-[10px]" : "text-[9px]",
                    )}
                  >
                    {node.label}
                  </span>
                  <span
                    className={cn(
                      "text-muted-foreground mt-0.5",
                      isHub ? "text-[9px]" : "text-[8px]",
                    )}
                  >
                    {node.source}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[220px]">
                <p className="font-medium text-xs">{node.label}</p>
                <p className="text-[10px] opacity-80 mt-0.5">{node.summary}</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Badge
                    variant="secondary"
                    className="text-[9px] px-1.5 py-0"
                  >
                    {node.type}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-[9px] px-1.5 py-0"
                  >
                    {node.source}
                  </Badge>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}

        {/* Legend */}
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-center gap-4 px-3 py-2 rounded-lg bg-card/80 backdrop-blur-sm border border-border/50">
          {Object.entries(sourceConfig).map(([key, config]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className={cn("w-2 h-2 rounded-full", config.dot)} />
              <span className="text-[10px] text-muted-foreground font-medium">
                {config.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
