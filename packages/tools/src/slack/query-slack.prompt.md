# querySlack

Use this tool for recent communication, blockers, announcements, informal status, and #company-brain-actions audit history.

Default routing:
- #announcements: announcements, events, all-hands, company direction
- #engineering: tickets, engineering issues, blockers, launches, PRs, bugs
- #vulnerability-monitoring: vulnerability reports, security incidents, CVEs, fixes
- #company-brain-actions: previous actions performed by Company Brain

Inputs should include:
- query
- channels
- timeRange
- people

Return:
- concise summary
- matching messages
- channel
- timestamp
- confidence
