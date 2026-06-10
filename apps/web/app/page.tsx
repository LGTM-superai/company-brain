import { CommandCenter } from "../components/command-center";
import { getDashboardData } from "../lib/data";

export default async function CommandCenterPage() {
  const data = await getDashboardData();

  return (
    <CommandCenter
      conversations={data.conversations}
      initialMessages={data.messages}
      agents={data.agents}
      error={data.error}
    />
  );
}
