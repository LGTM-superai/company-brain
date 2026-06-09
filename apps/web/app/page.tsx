import { ChatInterface } from "../components/chat/chat-interface";
import { AppShell } from "../components/shell";
import { getDashboardData } from "../lib/data";

export default async function CommandCenterPage() {
  const data = await getDashboardData();

  return (
    <AppShell activePath="/">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Command Center</p>
          <h1>Company Brain</h1>
        </div>
        <p className="audit-note">External writes log to #company-brain-actions</p>
      </section>

      {data.error ? <div className="setup-banner">{data.error} Run `bun run seed` after setting MONGODB_URL.</div> : null}

      <ChatInterface
        conversations={data.conversations}
        initialMessages={data.messages}
        agents={data.agents}
      />
    </AppShell>
  );
}
