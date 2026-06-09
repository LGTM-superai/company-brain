import type { KnowledgeNode } from "../lib/data";

export function KnowledgeGraph({ nodes }: { nodes: KnowledgeNode[] }) {
  const nodeMap = new Map(nodes.map((node) => [node.nodeId, node]));
  const edges = nodes.flatMap((node) =>
    node.links
      .map((targetId) => {
        const target = nodeMap.get(targetId);
        return target ? { from: node, to: target } : null;
      })
      .filter((edge): edge is { from: KnowledgeNode; to: KnowledgeNode } => Boolean(edge)),
  );

  return (
    <section className="graph-shell panel">
      <div className="graph-canvas">
        <svg className="graph-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {edges.map((edge) => (
            <line
              key={`${edge.from.nodeId}-${edge.to.nodeId}`}
              x1={edge.from.x}
              y1={edge.from.y}
              x2={edge.to.x}
              y2={edge.to.y}
            />
          ))}
        </svg>

        {nodes.map((node) => (
          <article
            className={node.nodeId === "company-brain" ? "graph-node core-node" : "graph-node"}
            key={node.nodeId}
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
          >
            <strong>{node.label}</strong>
            <span>{node.source}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
