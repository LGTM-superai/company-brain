"""Vulnerability-management tools — dependency scan, advisories, Slack, Notion, PRs."""

from __future__ import annotations

from agents import RunContextWrapper, function_tool

from ..context import BrainContext


@function_tool
def list_dependencies(ctx: RunContextWrapper[BrainContext], project: str) -> str:
    """List a project's dependencies and their pinned versions.

    Args:
        project: Project / repo name.
    """
    deps = ctx.context.github.list_dependencies(project)
    return "\n".join(f"- {d['package']} {d['version']}" for d in deps)


@function_tool
def check_advisories(ctx: RunContextWrapper[BrainContext], package: str, version: str) -> str:
    """Check a package@version for known vulnerabilities (OSV/GitHub Advisory + Exa).

    Args:
        package: Package name.
        version: Pinned version to check.
    """
    # STUB: a real impl queries OSV.dev / GitHub Advisory DB, with Exa for chatter.
    results = ctx.context.web.search(f"{package} {version} CVE vulnerability")
    return f"(stub advisory check for {package}@{version})\n" + "\n".join(
        f"- {r['title']} ({r['url']})" for r in results
    )


@function_tool
def post_slack_alert(ctx: RunContextWrapper[BrainContext], channel: str, message: str) -> str:
    """Post a vulnerability alert to the right Slack channel.

    Args:
        channel: Channel name (no '#').
        message: Alert text.
    """
    return ctx.context.slack.post(channel, message)


@function_tool
def create_notion_ticket(
    ctx: RunContextWrapper[BrainContext], board: str, title: str, body: str
) -> str:
    """Create a vulnerability ticket on a project's Notion sprint board.

    Args:
        board: The project's sprint board.
        title: Ticket title.
        body: Ticket details.
    """
    return ctx.context.notion.create_ticket(board, title, body)


@function_tool
def open_fix_pull_request(
    ctx: RunContextWrapper[BrainContext],
    repo: str,
    package: str,
    from_version: str,
    to_version: str,
) -> str:
    """Open a PR that bumps a vulnerable dependency. NEVER auto-merges — human reviews.

    Args:
        repo: Target repository.
        package: Dependency to upgrade.
        from_version: Current version.
        to_version: Fixed version.
    """
    title = f"fix(deps): bump {package} {from_version} -> {to_version}"
    body = (f"Automated fix for a vulnerability in {package} {from_version}.\n"
            f"Bumps to {to_version}. Requires human review before merge.")
    branch = f"fix/{package}-{to_version}"
    return ctx.context.github.open_pull_request(repo, title, body, branch)
