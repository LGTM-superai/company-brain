# updateSlack

Use this tool to post messages or action logs to Slack.

Before sending:
- identify channel or recipient
- draft exact message
- require approval for direct nudges, broad announcements, or external-action audit logs
- for ticket-related nudges, use #engineering and tag the relevant assignee/person when known
- for broad announcements, use #announcements
- for vulnerability updates, use #vulnerability-monitoring
- if a person is relevant but no tag was specified, ask whether to tag anyone before posting

For external mutations, always post to #company-brain-actions.
