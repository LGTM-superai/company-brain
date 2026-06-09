import { ChatInterface } from "../components/chat/chat-interface";
import { AppShell } from "../components/shell";
import { getDashboardData } from "../lib/data";

export default async function CommandCenterPage() {
  const data = await getDashboardData();

  return (
    <AppShell
      activePath="/"
      conversations={data.conversations.map((c) => ({
        conversationId: c.conversationId,
        title: c.title,
        updatedLabel: c.updatedLabel,
      }))}
    >
      {data.error ? (
        <div className="m-4 border border-error/30 rounded-lg bg-error/5 p-3 text-error text-sm">
          {data.error} Run `bun run seed` after setting MONGODB_URL.
        </div>
      ) : null}

      <ChatInterface
        conversations={data.conversations}
        initialMessages={data.messages}
        agents={data.agents}
      />
    </AppShell>
  );
}
