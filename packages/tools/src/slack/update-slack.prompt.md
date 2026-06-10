# updateSlack

Use this tool to post messages or task completion notifications to Slack.

## Actions

### send_message
Post a message to a specific channel, optionally tagging a user.

Required fields:
- `action`: "send_message"
- `channel`: one of "taskUpdates", "actions", "alerts"
- `text`: the message body (supports Slack mrkdwn)

Optional:
- `tagUser`: a PersonId to mention at the start of the message

### notify_task_done
Post a structured task completion notification to #task-updates.

Required fields:
- `action`: "notify_task_done"
- `task.taskName`: name of the completed task
- `task.summary`: what happened
- `task.owner`: PersonId of the task owner (will be tagged)
- `task.status`: "completed" or "failed"

Optional:
- `task.duration`: how long the task took

## Channels
- **taskUpdates** → #task-updates — task completion logs
- **actions** → #company-brain-actions — audit log for external mutations
- **alerts** → #brain-alerts — critical alerts and failures

## Rules
- Always post to #company-brain-actions for external mutations (notion writes, github pushes, payments)
- Tag the task owner so they get a Slack notification
- Keep messages concise — one line summary + details if needed
