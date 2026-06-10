import { queryNotionTickets } from "../lib/notion-runtime";

const requestedTitle = process.argv.slice(2).join(" ").trim();
const ticketQuery = requestedTitle || "HB-101 Collect final reservation link from Harbor Bean";
const result = await queryNotionTickets({
  project: "Harbor Bean Cafe",
  ticket: ticketQuery,
  includeBody: true,
});

if (!result.tickets.length && requestedTitle.toLowerCase().includes("confirm final reservation link")) {
  const fallback = await queryNotionTickets({
    project: "Harbor Bean Cafe",
    ticket: "reservation link",
    includeBody: true,
  });

  printTickets(fallback.tickets);
} else {
  printTickets(result.tickets);
}

function printTickets(tickets: typeof result.tickets) {
  console.log(
    JSON.stringify(
      {
        count: tickets.length,
        tickets: tickets.map((ticket) => ({
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
