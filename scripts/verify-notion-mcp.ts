import { queryMcpNotionTickets } from "../apps/web/lib/notion-mcp-runtime";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;

async function waitForMcpServer() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await queryMcpNotionTickets({ project: "Harbor Bean Cafe" });

      if (!result.ok) {
        throw new Error("Query returned ok: false");
      }

      console.log(`Notion MCP server is healthy (attempt ${attempt}/${MAX_RETRIES})`);
      console.log(`Found ${result.count} tickets in project "${result.project}"`);
      console.log(
        result.tickets.map((t) => `  ${t.code} [${t.status}] ${t.name}`).join("\n"),
      );
      return;
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        console.error(`Failed to reach Notion MCP after ${MAX_RETRIES} attempts.`);
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }

      console.log(`Attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${RETRY_DELAY_MS}ms...`);
      await Bun.sleep(RETRY_DELAY_MS);
    }
  }
}

await waitForMcpServer();
