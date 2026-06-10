import { queryMcpNotionTickets } from "../lib/notion-mcp-runtime";

const requestedTitle = process.argv.slice(2).join(" ").trim();
const ticketQuery = requestedTitle || "HB-101 Collect final reservation link from Harbor Bean";

try {
  const result = await queryMcpNotionTickets({
    project: "Harbor Bean Cafe",
    ticket: ticketQuery,
    includeBody: true,
  });

  if (!result.tickets.length && requestedTitle.toLowerCase().includes("confirm final reservation link")) {
    const fallback = await queryMcpNotionTickets({
      project: "Harbor Bean Cafe",
      ticket: "reservation link",
      includeBody: true,
    });

    printTickets(fallback);
  } else {
    printTickets(result);
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

function printTickets(result: Awaited<ReturnType<typeof queryMcpNotionTickets>>) {
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        source: result.source,
        count: result.tickets.length,
        tickets: result.tickets.map((ticket) => ({
          code: ticket.code,
          name: ticket.name,
          status: ticket.status,
          assignee: ticket.assignee,
          dueDate: ticket.dueDate,
          priority: ticket.priority,
          body: ticket.body,
          sections: ticket.sections.map((section) => ({
            title: section.title,
            text: section.text,
          })),
        })),
      },
      null,
      2,
    ),
  );
}
