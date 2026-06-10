import { CommandCenter } from "../components/command-center";
import { getDashboardData } from "../lib/data";
import { getSessionUser } from "../lib/session";

export default async function CommandCenterPage() {
  const [data, user] = await Promise.all([getDashboardData(), getSessionUser()]);

  return (
    <CommandCenter
      conversations={data.conversations}
      initialMessages={data.messages}
      agents={data.agents}
      error={data.error}
      currentUser={user ? { id: user.id, name: user.name, role: user.role } : null}
    />
  );
}
