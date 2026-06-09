"""Function tools exposed to the Company Brain agents.

Every tool takes `ctx: RunContextWrapper[BrainContext]` as its first argument and
reaches integrations through `ctx.context`. Tools return human-readable strings
(token-cheap and model-friendly); swap the stub clients behind them for real ones
without touching the tool signatures.
"""

from .knowledge_tools import read_note, search_company_kb, web_search
from .purchasing_tools import (
    find_restaurants,
    get_menu,
    lookup_team,
    place_order,
    plan_team_meal,
)
from .reporting_tools import post_slack_message, read_sprint_board
from .vuln_tools import (
    check_advisories,
    create_notion_ticket,
    list_dependencies,
    open_fix_pull_request,
    post_slack_alert,
)

__all__ = [
    "search_company_kb",
    "read_note",
    "web_search",
    "lookup_team",
    "plan_team_meal",
    "find_restaurants",
    "get_menu",
    "place_order",
    "list_dependencies",
    "check_advisories",
    "post_slack_alert",
    "create_notion_ticket",
    "open_fix_pull_request",
    "read_sprint_board",
    "post_slack_message",
]
