"""Agentic runtime: run one admin duty to completion, pausing for human approval.

The agent reasons and calls tools/handoffs itself. When it tries to spend money the
SDK raises a tool-approval *interruption*; we surface it to a human `approve` callback,
then resume the exact same run with the decision applied. This is the human-in-the-loop
loop that makes the admin agent safe to let off the leash.
"""

from __future__ import annotations

from typing import Any, Callable

from agents import (
    InputGuardrailTripwireTriggered,
    MaxTurnsExceeded,
    Runner,
)

from .context import BrainContext
from .orchestrator import orchestrator

# An approval decision: given the pending tool-approval item, return True to allow it.
ApproveFn = Callable[[Any], bool]


def run_admin_turn(
    user_input: Any,
    ctx: BrainContext,
    session: Any | None = None,
    approve: ApproveFn | None = None,
    max_turns: int = 24,
) -> str:
    """Run a single admin request to completion and return the agent's final reply.

    `approve` is called once per pending money-spending action. If omitted, such
    actions are rejected (safe default). Pass an interactive callback (CLI) or an
    auto-approver (scripted demos).
    """
    try:
        result = Runner.run_sync(
            orchestrator, user_input, context=ctx, session=session, max_turns=max_turns
        )
        while result.interruptions:
            state = result.to_state()
            for item in result.interruptions:
                allowed = bool(approve(item)) if approve else False
                if allowed:
                    state.approve(item)
                else:
                    state.reject(item)
            result = Runner.run_sync(
                orchestrator, state, context=ctx, session=session, max_turns=max_turns
            )
        return result.final_output or "(no response)"
    except InputGuardrailTripwireTriggered:
        return "⚠️  Blocked by the prompt-injection guardrail — request not processed."
    except MaxTurnsExceeded:
        return "⚠️  Stopped after too many steps. Try a narrower request."
