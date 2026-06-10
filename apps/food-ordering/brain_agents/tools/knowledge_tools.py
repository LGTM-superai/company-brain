"""Knowledge-base + web search tools (Obsidian vault via MCP, Exa for the web)."""

from __future__ import annotations

from agents import RunContextWrapper, function_tool

from ..context import BrainContext


@function_tool
def search_company_kb(ctx: RunContextWrapper[BrainContext], query: str) -> str:
    """Search the company knowledge base (Obsidian vault) for relevant notes.

    Args:
        query: What to look for, in natural language.
    """
    hits = ctx.context.vault.search(query)
    if not hits:
        return "No matching notes found."
    return "\n".join(f"- {h['path']}: {h['excerpt']}" for h in hits)


@function_tool
def read_note(ctx: RunContextWrapper[BrainContext], path: str) -> str:
    """Read the full Markdown contents of a single vault note by its path.

    Args:
        path: Vault-relative path, e.g. 'Handbook/Expenses.md'.
    """
    return ctx.context.vault.read_note(path)


@function_tool
def list_employees(ctx: RunContextWrapper[BrainContext]) -> str:
    """List the company's employee roster — name, role, and team — from the people directory.

    Use this for "who works here", "give me a roster", "list employees", or "who is on <team>".
    """
    people = ctx.context.vault.roster()
    if not people:
        return "No employees found in the directory."
    rows = []
    for p in sorted(people, key=lambda x: (x.get("team") or "", x.get("name") or "")):
        rows.append(f"- {p.get('name')} — {p.get('role','?')} ({p.get('team','?')})")
    return f"{len(people)} employees:\n" + "\n".join(rows)


@function_tool
def web_search(ctx: RunContextWrapper[BrainContext], query: str) -> str:
    """Search the public web via Exa for external/up-to-date information.

    Args:
        query: The web search query.
    """
    results = ctx.context.web.search(query)
    return "\n".join(f"- {r['title']} ({r['url']})" for r in results)
