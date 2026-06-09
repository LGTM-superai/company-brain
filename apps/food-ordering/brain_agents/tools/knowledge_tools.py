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
def web_search(ctx: RunContextWrapper[BrainContext], query: str) -> str:
    """Search the public web via Exa for external/up-to-date information.

    Args:
        query: The web search query.
    """
    results = ctx.context.web.search(query)
    return "\n".join(f"- {r['title']} ({r['url']})" for r in results)
