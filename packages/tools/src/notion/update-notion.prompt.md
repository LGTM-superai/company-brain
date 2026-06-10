# updateNotion

Use this tool to update Notion sprint board tickets.

Default assumption:
- Notion is the sprint board source, not a general knowledge base.

Allowed changes:
- Name
- Status
- Project
- Assignee
- Due Date
- Priority
- Latest agent note in the ticket body

Before updating:
- identify exact ticket
- confirm current state
- produce intended new state
- require approval for any sprint-board field change

After updating:
- return audit payload for updateSlack
