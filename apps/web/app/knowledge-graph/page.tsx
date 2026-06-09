import { KnowledgeGraph } from "../../components/knowledge-graph";
import { AppShell } from "../../components/shell";
import { getDashboardData } from "../../lib/data";

export default async function KnowledgeGraphPage() {
  const data = await getDashboardData();

  return (
    <AppShell activePath="/knowledge-graph">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Knowledge Graph</p>
          <h1>Source Map</h1>
        </div>
        <p className="audit-note">Derived from MongoDB seed data</p>
      </section>

      {data.error ? <div className="setup-banner">{data.error} Run `bun run seed` after setting MONGODB_URL.</div> : null}

      <div className="graph-page-grid">
        <KnowledgeGraph nodes={data.knowledgeNodes} />

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Nodes</p>
              <h2>Indexed Objects</h2>
            </div>
          </div>
          <div className="node-list">
            {data.knowledgeNodes.map((node) => (
              <article className="node-card" key={node.nodeId}>
                <strong>{node.label}</strong>
                <span>{node.type} · {node.source}</span>
                <p>{node.summary}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
