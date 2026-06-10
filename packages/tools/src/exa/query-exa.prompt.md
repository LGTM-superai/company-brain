# queryExa

Use this tool when internal context needs external validation.

Good uses:
- technical documentation
- public website evidence
- vulnerability context
- verifying whether a blocker is resolvable

For sprint-board blocker validation:
- decide whether the blocker is valid, fixable, partially valid, or unknown
- prefer official documentation
- do not mutate Notion or Slack from this tool
- return suggested follow-ups for the agent to ask the user about

Return:
- verdict
- blocker_validity
- confidence
- evidence URL
- evidence title
- summary
- recommended next step
- suggested Notion note
- suggested Slack message
