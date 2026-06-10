# createNotionTicket

Use this tool to create new tickets on the Notion sprint board.

Required fields:
- name: ticket title (should include a ticket code like "HB-XXX" if following project conventions)
- project: which project this belongs to (e.g. "Harbor Bean Cafe")

Optional fields:
- status: one of "Not started", "In progress", "In review", "Done" (defaults to "Not started")
- assignee: full name of assignee (e.g. "Carlos Vincent Frasenda", "Edrick Kesuma", "Darren Prasetya", "Lakshya Agarwal")
- priority: one of "P0", "P1", "P2", "P3" (defaults to "P1")
- dueDate: ISO date string like "2026-06-15"
- body: array of sections, each with a title and lines array

Before creating:
- confirm the ticket does not already exist (query first if unsure)
- require approval before creating

After creating:
- return the new ticket URL and page ID for audit
