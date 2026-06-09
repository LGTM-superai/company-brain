import { agentRegistry } from "@company-brain/agents";
import { toolRegistry } from "@company-brain/tools";

export default function CommandCenterPage() {
  return (
    <main>
      <h1>Company Brain Command Center</h1>
      <p>Chat-first interface. Tool calls and Exa results should stream into this page.</p>

      <section>
        <h2>Agents</h2>
        <ul>
          {Object.values(agentRegistry).map((agent) => (
            <li key={agent.id}>
              <strong>{agent.name}</strong> - {agent.owner}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Tools</h2>
        <ul>
          {Object.values(toolRegistry).map((tool) => (
            <li key={tool.name}>
              <strong>{tool.name}</strong> - {tool.mode}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
