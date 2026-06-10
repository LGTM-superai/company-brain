"""Agentic runtime: run one admin duty to completion, pausing for human approval.

The agent reasons and calls tools/handoffs itself. When it tries to spend money the
SDK raises a tool-approval *interruption*; we surface it to a human `approve` callback,
then resume the exact same run with the decision applied.

`run_admin_turn_traced` records the tool calls via a run hook, so the trace is captured
even if the run errors (e.g. hits the step limit).
"""

from __future__ import annotations

from typing import Any, Callable

from agents import (
    InputGuardrailTripwireTriggered,
    MaxTurnsExceeded,
    RunHooks,
    Runner,
)

from .context import BrainContext
from .orchestrator import orchestrator

ApproveFn = Callable[[Any], bool]


class _ToolRecorder(RunHooks):
    """Records each tool call as it starts (survives run errors)."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def on_tool_start(self, context, agent, tool):
        self.calls.append({"tool": getattr(tool, "name", "?")})


def _drive(user_input, ctx, session, approve, max_turns, hooks=None):
    """Run the agent through the approval loop; return the final RunResult."""
    result = Runner.run_sync(orchestrator, user_input, context=ctx, session=session,
                             max_turns=max_turns, hooks=hooks)
    while result.interruptions:
        state = result.to_state()
        for item in result.interruptions:
            (state.approve if (approve and bool(approve(item))) else state.reject)(item)
        result = Runner.run_sync(orchestrator, state, context=ctx, session=session,
                                 max_turns=max_turns, hooks=hooks)
    return result


def run_admin_turn(user_input, ctx, session=None, approve=None, max_turns=30) -> str:
    """Run a single admin request to completion and return the agent's final reply."""
    try:
        return _drive(user_input, ctx, session, approve, max_turns).final_output or "(no response)"
    except InputGuardrailTripwireTriggered:
        return "⚠️  Blocked by the prompt-injection guardrail — request not processed."
    except MaxTurnsExceeded:
        return "⚠️  I couldn't converge on an answer within the step limit. Try rephrasing."


def run_admin_turn_traced(user_input, ctx, session=None, approve=None, max_turns=30):
    """Like run_admin_turn, but also returns the trace of tool calls made."""
    rec = _ToolRecorder()
    try:
        result = _drive(user_input, ctx, session, approve, max_turns, hooks=rec)
        return (result.final_output or "(no response)"), rec.calls
    except InputGuardrailTripwireTriggered:
        return "⚠️  Blocked by the prompt-injection guardrail.", rec.calls
    except MaxTurnsExceeded:
        return "⚠️  I couldn't converge on an answer within the step limit. Try rephrasing.", rec.calls
