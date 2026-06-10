import { moveMcpTicketStatus } from "../lib/notion-mcp-runtime";

try {
  const result = await moveMcpTicketStatus({
    ticket: "HB-204 Validate responsive Google Maps embed",
    currentStatus: "In progress",
    newStatus: "In review",
  });

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        source: "notion-mcp",
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
