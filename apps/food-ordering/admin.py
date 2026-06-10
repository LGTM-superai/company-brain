#!/usr/bin/env python3
"""Company Brain — Admin Duty Agent (interactive).

Talk to the agent in natural language; it reasons, looks things up, and acts —
delegating to the knowledge / purchasing / vulnerability / reporting specialists.
Anything that spends money pauses for your approval right here in the terminal.

    export OPENAI_API_KEY=sk-...
    python admin.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()  # before importing brain_agents (config builds the model at import time)

from brain_agents import build_default_context, run_admin_turn
from brain_agents.config import DEFAULT_MODEL_NAME, MODEL_PROVIDER

SESSION_DB = Path(__file__).parent / ".brain" / "admin_sessions.db"

EXAMPLES = """Examples:
  • order lunch for the tech team, about $18 a head
  • who on the team has a nut allergy, and where did they grow up?
  • give me a status update on Project Atlas and post it to #leadership
  • check the backend repo for vulnerable dependencies and open fixes
"""


def interactive_approve(item) -> bool:
    """Human-in-the-loop gate for spending. Returns True to approve the charge."""
    print("\n  ┌─────────────────────────────────────────────")
    print(f"  │ 🔐 APPROVAL NEEDED — the agent wants to run: {item.name}")
    print(f"  │    arguments: {item.arguments}")
    print("  └─────────────────────────────────────────────")
    try:
        answer = input("  Approve this spend? [y/N] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        return False
    return answer.startswith("y")


def _check_credentials() -> str | None:
    """Return an error message if the active model provider lacks credentials."""
    if MODEL_PROVIDER == "openai":
        if not os.environ.get("OPENAI_API_KEY"):
            return "OPENAI_API_KEY is not set (BRAIN_MODEL_PROVIDER=openai)."
        return None
    # bedrock: creds can come from env, a profile, SSO, or an instance role — we can't
    # reliably detect all of those, so only warn (don't block) if none are obvious.
    if not (os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("AWS_PROFILE")):
        print("⚠️  No AWS_ACCESS_KEY_ID or AWS_PROFILE detected — Bedrock calls will "
              "fail unless credentials are available another way (SSO / instance role).\n")
    return None


def main() -> None:
    err = _check_credentials()
    if err:
        print(f"{err}\n\nFor an offline view of the agent graph, run:  python demo_agents.py")
        sys.exit(1)

    SESSION_DB.parent.mkdir(parents=True, exist_ok=True)
    # Lazy import so the no-key path above doesn't require the SDK memory module.
    from agents.memory import SQLiteSession

    requester = os.environ.get("BRAIN_REQUESTER", "ceo@company.com")
    ctx = build_default_context(requester=requester)
    session = SQLiteSession("admin-cli", str(SESSION_DB))

    print("Company Brain — Admin Duty Agent")
    print(f"Model: {DEFAULT_MODEL_NAME} ({MODEL_PROVIDER}) · signed in as {requester}.")
    print("Type a duty, or 'exit'.\n")
    print(EXAMPLES)

    while True:
        try:
            user = input("admin> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not user:
            continue
        if user.lower() in {"exit", "quit", ":q"}:
            break
        reply = run_admin_turn(user, ctx, session=session, approve=interactive_approve)
        print(f"\n{reply}\n")

    print("Goodbye.")


if __name__ == "__main__":
    main()
