"""Company Brain — the Admin Duty Agent (OpenAI Agents SDK).

A single agent (`orchestrator`) that owns every tool directly — knowledge lookup,
purchasing, vulnerability response, and reporting — with a prompt-injection guardrail
and human-in-the-loop approval before it spends money.

Default model is set once in `config.DEFAULT_MODEL` (gpt-5-mini).

Usage
-----
    from brain_agents import build_default_context, run_admin_turn
    ctx = build_default_context()
    print(run_admin_turn("Order lunch for the tech team", ctx, approve=lambda i: True))

Or run it interactively:  `python admin.py`
"""

from __future__ import annotations

from .config import DEFAULT_MODEL, DEFAULT_MODEL_SETTINGS
from .context import BrainContext, build_default_context
from .orchestrator import ALL_AGENTS, orchestrator
from .runtime import run_admin_turn

__all__ = [
    "orchestrator",
    "ALL_AGENTS",
    "BrainContext",
    "build_default_context",
    "run_admin_turn",
    "run_brain",
    "DEFAULT_MODEL",
    "DEFAULT_MODEL_SETTINGS",
]


def run_brain(prompt: str, context: BrainContext | None = None, max_turns: int = 24) -> str:
    """Convenience wrapper: run one duty, auto-approving any spend.

    Handy for scripted demos. For real human-in-the-loop approval use
    `run_admin_turn(..., approve=<your callback>)` or the `admin.py` CLI.
    Requires OPENAI_API_KEY in the environment.
    """
    ctx = context or build_default_context()
    return run_admin_turn(prompt, ctx, approve=lambda _item: True, max_turns=max_turns)
