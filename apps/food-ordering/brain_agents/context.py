"""Shared run context + stub service clients passed to every agent run.

`BrainContext` is the dependency bag handed to `Runner.run(..., context=ctx)`.
Tools read it via `wrapper.context`. The integration clients here are STUBS that
return deterministic mock data so the whole agent graph is runnable offline —
swap each one for the real Exa / Obsidian / Slack / Notion / GitHub client as
those land, with no change to the tools or agents.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from merchant import MerchantAdapter, MockMerchantAdapter, PaymentAuthorization

from .vault import ObsidianVault

# The knowledge base is the real Obsidian vault (see brain_agents/vault.py); the
# other integrations below are still stubs returning deterministic mock data.
VaultService = ObsidianVault


class WebSearchService:
    """Exa web search (external info + vuln chatter).

    Real when EXA_API_KEY is set; otherwise returns a clearly-marked placeholder so
    the graph still runs offline.
    """

    def __init__(self) -> None:
        self._exa = None
        key = os.environ.get("EXA_API_KEY")
        if key:
            try:
                from exa_py import Exa
                self._exa = Exa(key)
            except Exception:
                self._exa = None

    def search(self, query: str, num_results: int = 5) -> list[dict]:
        if self._exa is None:
            return [{"title": f"(no EXA_API_KEY) would search: {query}", "url": "https://exa.ai"}]
        res = self._exa.search(query, num_results=num_results, type="auto")
        return [{"title": (r.title or r.url), "url": r.url} for r in res.results]


class SlackService:
    """Slack Web API client (chat.postMessage).

    Real when SLACK_BOT_TOKEN (xoxb-...) is set; otherwise returns a clearly-marked
    placeholder so the graph still runs offline.
    """

    API = "https://slack.com/api/chat.postMessage"

    def __init__(self) -> None:
        self._token = os.environ.get("SLACK_BOT_TOKEN")

    def post(self, channel: str, text: str) -> str:
        if not self._token:
            return f"(no SLACK_BOT_TOKEN) would post to #{channel}: {text[:80]}"
        import requests

        resp = requests.post(
            self.API,
            headers={"Authorization": f"Bearer {self._token}"},
            json={"channel": channel, "text": text},
            timeout=10,
        )
        data = resp.json()
        if not data.get("ok"):
            return f"Slack error posting to #{channel}: {data.get('error')}"
        return f"posted to #{channel} (ts {data.get('ts')})"


class NotionService:
    """STUB for Notion sprint boards."""

    def read_board(self, project: str) -> dict:
        return {"project": project, "in_progress": 3, "done": 7, "blocked": 1}

    def create_ticket(self, board: str, title: str, body: str) -> str:
        return f"(stub) created ticket on {board!r}: {title}"


class GitHubService:
    """STUB for dependency listing + PR creation (coding agent)."""

    def list_dependencies(self, project: str) -> list[dict]:
        return [
            {"package": "requests", "version": "2.31.0"},
            {"package": "pydantic", "version": "2.10.0"},
        ]

    def open_pull_request(self, repo: str, title: str, body: str, branch: str) -> str:
        return f"(stub) opened PR on {repo} ({branch}): {title}  [awaiting human review]"


# --------------------------------------------------------------------------- #
# The context bag
# --------------------------------------------------------------------------- #
@dataclass
class BrainContext:
    requester: str                       # email of the human making the request
    merchant: MerchantAdapter            # buyer-side ordering (mock for now)
    payment: PaymentAuthorization        # the agent's virtual Stripe card + limit
    # Spends at or above this trigger human-in-the-loop approval; below it auto-approve.
    auto_approve_under_cents: int = 3_000
    vault: VaultService = field(default_factory=VaultService)
    web: WebSearchService = field(default_factory=WebSearchService)
    slack: SlackService = field(default_factory=SlackService)
    notion: NotionService = field(default_factory=NotionService)
    github: GitHubService = field(default_factory=GitHubService)


def build_default_context(
    requester: str = "ceo@company.com",
    card_limit_cents: int = 10_000,
    auto_approve_under_cents: int = 3_000,
) -> BrainContext:
    """Wire a ready-to-run context: mock merchant + a $100 virtual card + stubs."""
    return BrainContext(
        requester=requester,
        merchant=MockMerchantAdapter(),
        payment=PaymentAuthorization(
            card_id="ic_brain_agent",
            authorized_by=requester,
            limit_cents=card_limit_cents,
        ),
        auto_approve_under_cents=auto_approve_under_cents,
    )
