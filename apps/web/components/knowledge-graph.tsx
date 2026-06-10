"use client";

import { useState, useMemo, useCallback } from "react";
import type { KnowledgeNode } from "../lib/data";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const sourceColors: Record<string, string> = {
  s3: "text-emerald-400",
  notion: "text-orange-400",
  both: "text-purple-400",
};

export function KnowledgeGraph({ nodes }: { nodes: KnowledgeNode[] }) {
  const [filter, setFilter] = useState("");
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const filteredNodes = useMemo(() => {
    if (!filter) return nodes;
    const q = filter.toLowerCase();
    const matched = new Set<string>();

    // Find nodes matching the filter
    for (const node of nodes) {
      if (node.label.toLowerCase().includes(q)) {
        matched.add(node.nodeId);
      }
    }

    // Include their direct neighbors
    for (const node of nodes) {
      if (matched.has(node.nodeId)) {
        for (const link of node.links) matched.add(link);
      }
    }

    return nodes.filter((n) => matched.has(n.nodeId));
  }, [nodes, filter]);

  const nodeMap = useMemo(
    () => new Map(filteredNodes.map((n) => [n.nodeId, n])),
    [filteredNodes],
  );

  const edges = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ from: KnowledgeNode; to: KnowledgeNode }> = [];
    for (const node of filteredNodes) {
      for (const targetId of node.links) {
        const target = nodeMap.get(targetId);
        if (!target) continue;
        const key = [node.nodeId, targetId].sort().join(":");
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ from: node, to: target });
      }
    }
    return result;
  }, [filteredNodes, nodeMap]);

  const connectedToHovered = useMemo(() => {
    if (!hoveredNode) return new Set<string>();
    const node = nodeMap.get(hoveredNode);
    if (!node) return new Set<string>();
    return new Set([hoveredNode, ...node.links.filter((l) => nodeMap.has(l))]);
  }, [hoveredNode, nodeMap]);

  const handleMouseEnter = useCallback((nodeId: string) => setHoveredNode(nodeId), []);
  const handleMouseLeave = useCallback(() => setHoveredNode(null), []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Filter tags..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs h-8 text-sm bg-background/50"
        />
        <div className="flex gap-2 text-[10px] text-muted-foreground">
          {Object.entries(sourceColors).map(([key, color]) => (
            <span key={key} className="flex items-center gap-1">
              <span className={cn("inline-block w-2 h-2 rounded-full", color.replace("text-", "bg-"))} />
              {key === "both" ? "S3 + Notion" : key === "s3" ? "S3" : "Notion"}
            </span>
          ))}
        </div>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {filteredNodes.length} tags / {edges.length} links
        </span>
      </div>

      <div className="relative min-h-[640px] rounded-xl border border-border bg-neutral-950/80 overflow-hidden select-none">
        {/* Subtle dot grid */}
        <div className="absolute inset-0 bg-[radial-gradient(circle,hsl(var(--border)/0.15)_1px,transparent_1px)] bg-[size:24px_24px]" />

        {/* Edges */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {edges.map((edge) => {
            const isHighlighted =
              hoveredNode &&
              connectedToHovered.has(edge.from.nodeId) &&
              connectedToHovered.has(edge.to.nodeId);
            const isDimmed = hoveredNode && !isHighlighted;

            return (
              <line
                key={`${edge.from.nodeId}-${edge.to.nodeId}`}
                x1={edge.from.x}
                y1={edge.from.y}
                x2={edge.to.x}
                y2={edge.to.y}
                stroke={isHighlighted ? "hsl(var(--primary))" : "hsl(var(--border))"}
                strokeWidth={isHighlighted ? "0.2" : "0.1"}
                opacity={isDimmed ? 0.15 : isHighlighted ? 0.9 : 0.4}
                className="transition-opacity duration-150"
              />
            );
          })}
        </svg>

        {/* Nodes as text labels */}
        {filteredNodes.map((node) => {
          const color = sourceColors[node.source] ?? "text-muted-foreground";
          const weight = (node.metadata as any)?.weight ?? 1;
          const fontSize = Math.min(14, 9 + weight * 0.8);
          const isActive = hoveredNode === node.nodeId;
          const isConnected = connectedToHovered.has(node.nodeId);
          const isDimmed = hoveredNode && !isConnected;

          return (
            <button
              key={node.nodeId}
              type="button"
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded cursor-pointer whitespace-nowrap",
                "transition-all duration-150 ease-out",
                "hover:bg-white/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                color,
                isActive && "bg-white/10 scale-110 z-20",
                isDimmed && "opacity-20",
              )}
              style={{
                left: `${node.x}%`,
                top: `${node.y}%`,
                fontSize: `${fontSize}px`,
              }}
              onMouseEnter={() => handleMouseEnter(node.nodeId)}
              onMouseLeave={handleMouseLeave}
            >
              {node.label}
              {isActive && (
                <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground whitespace-nowrap">
                  {weight} doc{weight !== 1 ? "s" : ""} · {node.links.length} link{node.links.length !== 1 ? "s" : ""}
                </span>
              )}
            </button>
          );
        })}

        {/* Hovered node documents popup */}
        {hoveredNode && (() => {
          const node = nodeMap.get(hoveredNode);
          if (!node) return null;
          const docs = (node.metadata as any)?.documents ?? [];
          if (docs.length === 0) return null;
          return (
            <div className="absolute bottom-3 left-3 max-w-sm p-2.5 rounded-lg bg-card/95 backdrop-blur border border-border/60 shadow-xl z-30">
              <p className="text-xs font-medium text-foreground mb-1.5">
                Documents tagged <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">{node.label}</Badge>
              </p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {docs.slice(0, 6).map((doc: any, i: number) => (
                  <div key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", doc.source === "s3" ? "bg-emerald-400" : "bg-orange-400")} />
                    <span className="truncate">{doc.title || doc.path}</span>
                  </div>
                ))}
                {docs.length > 6 && (
                  <span className="text-[9px] text-muted-foreground">+{docs.length - 6} more</span>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
