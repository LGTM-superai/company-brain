import { KnowledgeGraphPlaceholder } from "../../components/knowledge-graph";

export default function KnowledgeGraphPage() {
  return (
    <main>
      <h1>Knowledge Graph</h1>
      <p>Derived graph over Notion, Slack, GitHub, Exa, S3/files, users, and tickets.</p>
      <KnowledgeGraphPlaceholder />
    </main>
  );
}
