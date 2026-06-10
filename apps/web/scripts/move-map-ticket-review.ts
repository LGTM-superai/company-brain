import { moveTicketStatus } from "../lib/notion-runtime";

const result = await moveTicketStatus({
  ticket: "HB-204 Validate responsive Google Maps embed",
  currentStatus: "In progress",
  newStatus: "In review",
});

console.log(JSON.stringify(result, null, 2));
