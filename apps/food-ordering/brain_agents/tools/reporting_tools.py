"""C-suite reporting tools — read Notion sprint boards, post summaries to Slack."""

from __future__ import annotations

from agents import RunContextWrapper, function_tool

from ..context import BrainContext


@function_tool
def read_sprint_board(ctx: RunContextWrapper[BrainContext], project: str) -> str:
    """Read the current state of a project's Notion sprint board.

    Args:
        project: Project name.
    """
    b = ctx.context.notion.read_board(project)
    return (f"{b['project']}: {b['in_progress']} in progress, "
            f"{b['done']} done, {b['blocked']} blocked.")


@function_tool
def post_slack_message(ctx: RunContextWrapper[BrainContext], channel: str, message: str) -> str:
    """Post a status update / summary to a Slack channel.

    Args:
        channel: Channel name (no '#').
        message: The message to post.
    """
    return ctx.context.slack.post(channel, message)
