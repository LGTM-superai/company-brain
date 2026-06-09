# updateNotionSprintBoard

Use this tool to update Notion sprint board tickets.

Allowed changes:
- status
- assignee
- priority
- blocked reason
- notes

Before updating:
- identify exact ticket
- confirm current state
- produce intended new state
- require approval for status or assignee changes

After updating:
- return audit payload for updateSlack
