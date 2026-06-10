"""Tests for the spending human-in-the-loop policy (no LLM / API key needed).

Exercises the `needs_approval` predicate directly: small spends auto-approve,
larger ones require a human, and anything unpriceable fails safe (require approval).
"""

import asyncio
from types import SimpleNamespace

from brain_agents import build_default_context
from brain_agents.tools.purchasing_tools import _place_order_needs_approval

FOODCOURT_TEAM = [
    "timbre-foodcourt-quinoa-bowl",
    "timbre-foodcourt-butter-chicken",
    "timbre-foodcourt-salmon-don",
    "timbre-foodcourt-chicken-rice",
]


def _needs_approval(ctx, args) -> bool:
    wrapper = SimpleNamespace(context=ctx)
    return asyncio.run(_place_order_needs_approval(wrapper, args, "call_1"))


def test_small_order_auto_approved():
    ctx = build_default_context(auto_approve_under_cents=3_000)
    # chicken rice 650 + delivery 350 = 1000c, below the $30 threshold.
    args = {"merchant_id": "tian-tian", "item_ids": ["tian-tian-chicken-rice"]}
    assert _needs_approval(ctx, args) is False


def test_team_lunch_needs_human_approval():
    ctx = build_default_context(auto_approve_under_cents=3_000)
    # Whole tech-team food-court order (~$54) is above the threshold.
    args = {"merchant_id": "timbre-foodcourt", "item_ids": FOODCOURT_TEAM}
    assert _needs_approval(ctx, args) is True


def test_unpriceable_order_fails_safe():
    ctx = build_default_context()
    args = {"merchant_id": "does-not-exist", "item_ids": ["nope"]}
    assert _needs_approval(ctx, args) is True


def test_threshold_is_configurable():
    # Raise the bar so the team lunch slips under auto-approval.
    ctx = build_default_context(auto_approve_under_cents=10_000)
    args = {"merchant_id": "timbre-foodcourt", "item_ids": FOODCOURT_TEAM}
    assert _needs_approval(ctx, args) is False
