"""Guardrails for the agent graph.

The headline risk in this system: the same agents that can *spend money* also read
untrusted content (company files, web/Exa results, advisories). A malicious note or
page could try to steer a purchase. This input guardrail is the scaffold for that
defense — a heuristic prompt-injection screen on the orchestrator's entry point.
Harden it (classifier model, content provenance, tool-level allow-lists) before
going anywhere near production money movement.
"""

from __future__ import annotations

from agents import GuardrailFunctionOutput, RunContextWrapper, input_guardrail

from .context import BrainContext

_INJECTION_MARKERS = (
    "ignore previous instructions",
    "ignore all previous",
    "disregard your instructions",
    "you are now",
    "system prompt",
    "exfiltrate",
    "raise the spending limit",
    "increase the card limit",
)


@input_guardrail
def prompt_injection_guardrail(
    ctx: RunContextWrapper[BrainContext],
    agent,
    user_input,
) -> GuardrailFunctionOutput:
    """Trip if the incoming request contains obvious prompt-injection markers."""
    text = user_input if isinstance(user_input, str) else str(user_input)
    lowered = text.lower()
    hit = next((m for m in _INJECTION_MARKERS if m in lowered), None)
    return GuardrailFunctionOutput(
        output_info={"matched_marker": hit},
        tripwire_triggered=hit is not None,
    )
