"""Demo / smoke test for the Company Brain agent graph.

Without OPENAI_API_KEY it does a DRY RUN: instantiates the whole graph and prints
the roster, each agent's tools and handoffs, and the configured model — proving the
scaffold is wired correctly, offline.

With OPENAI_API_KEY set it actually runs a sample request through the orchestrator.

Run:  python demo_agents.py
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

from brain_agents import ALL_AGENTS, build_default_context, run_admin_turn
from brain_agents.config import DEFAULT_MODEL_NAME, MODEL_PROVIDER


def dry_run() -> None:
    print(f"Company Brain — Admin Duty Agent\n"
          f"Model: {DEFAULT_MODEL_NAME} (provider: {MODEL_PROVIDER})\n")
    for agent in ALL_AGENTS:
        tools = [t.name for t in agent.tools]
        handoffs = [h.name if hasattr(h, "name") else str(h) for h in agent.handoffs]
        guards = [g.name for g in agent.input_guardrails]
        approvals = [t.name for t in agent.tools if getattr(t, "needs_approval", False)]
        print(f"● {agent.name}")
        if tools:
            print(f"    tools:     {', '.join(tools)}")
        if handoffs:
            print(f"    hands off: {', '.join(handoffs)}")
        if guards:
            print(f"    guardrails:{', '.join(guards)}")
        if approvals:
            print(f"    approval:  {', '.join(approvals)} (human-in-the-loop)")
    print("\nDry run OK — graph instantiated.")
    print("Run it agentically:  python admin.py")


def _auto_approve(item) -> bool:
    print(f"    [auto-approving spend: {item.name}({item.arguments})]")
    return True


def live_run() -> None:
    ctx = build_default_context(requester="ceo@company.com")
    for prompt in [
        "Order lunch for the tech team, budget about $18 a head.",
        "Give me a status update on Project Atlas.",
    ]:
        print(f"\n>>> {prompt}")
        print(run_admin_turn(prompt, ctx, approve=_auto_approve))


if __name__ == "__main__":
    # `--live` runs real model calls (needs credentials for the active provider);
    # default just prints the wired graph offline.
    import sys
    if "--live" in sys.argv:
        live_run()
    else:
        dry_run()
