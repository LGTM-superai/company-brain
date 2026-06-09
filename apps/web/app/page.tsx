import { ChatInterface } from "../components/chat/chat-interface";
import { AppShell } from "../components/shell";
import { getDashboardData } from "../lib/data";

export default async function CommandCenterPage() {
  const data = await getDashboardData();

  return (
    <AppShell activePath="/">
      <section className="page-heading command-topbar">
        <div>
          <h1>Precision Chatbot</h1>
          <p className="audit-note">Company Brain command center</p>
        </div>
        <div className="topbar-actions" aria-label="Command center actions">
          <span className="quiet-pill">Writes log to #company-brain-actions</span>
          <button className="icon-button" type="button" aria-label="Notifications">
            <span className="material-symbols-outlined">notifications</span>
          </button>
          <button className="icon-button" type="button" aria-label="Settings">
            <span className="material-symbols-outlined">settings</span>
          </button>
        </div>
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
