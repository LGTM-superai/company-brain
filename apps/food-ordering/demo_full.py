"""End-to-end demo: upload + AI auto-tagging, then ask the agent (with tool-call traces).

1. Ingests a few mock documents — each AI-classified (title/tags/domain/sensitivity).
2. Asks the agent questions as different roles, showing the answer AND the trace of
   tool calls — including how access control gates restricted content.

    python demo_full.py
"""

from __future__ import annotations

import re

from dotenv import load_dotenv

load_dotenv()

from brain_agents import build_default_context, run_admin_turn_traced
from brain_kb.classify import classify
from brain_kb.config import build_service
from brain_kb.models import User
from brain_kb.vectorstore import VectorIndex

DOCS = [
    ("vpn-setup.txt",
     "Connecting to the corporate VPN: install the GlobalProtect client, sign in with "
     "your SSO credentials, and choose the Singapore gateway. If multi-factor "
     "authentication fails, contact the IT helpdesk on Slack #it-support."),
    ("exec-comp.txt",
     "FY26 Executive Compensation (STRICTLY CONFIDENTIAL). The CEO base salary is "
     "SGD 320,000 with a 40% annual bonus target. VP salaries range from SGD 220,000 to "
     "260,000. Equity refresh grants are reviewed each December by the board."),
    ("roadmap.txt",
     "Product roadmap. Q3: ship the knowledge base, semantic vector search, and the Slack "
     "assistant. Q4: launch the mobile app and enterprise SSO. General availability is "
     "targeted for December 2026."),
    ("refund-policy.txt",
     "Customer refund policy. Customers may request a refund within 30 days of purchase; "
     "refunds are issued to the original payment method. Chargebacks and payment disputes "
     "are handled by the finance team within five business days."),
]

QUESTIONS = [
    ("evan", "csuite", "What is the CEO's base salary?"),
    ("alice", "dev", "What is the CEO's base salary?"),
    ("alice", "dev", "How do I connect to the company VPN?"),
    ("evan", "csuite", "What's planned on the product roadmap for Q4?"),
]


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


def rule(label=""):
    print("\n" + "═" * 76)
    if label:
        print(label)


def main():
    svc = build_service()
    vidx = VectorIndex(persist_dir=".brain/chroma", reset=True)
    for u in (User(username="alice", role="dev"), User(username="hannah", role="hr"),
              User(username="evan", role="csuite")):
        svc.users.upsert(u)

    rule("1) UPLOAD + AI AUTO-CLASSIFICATION")
    for fname, text in DOCS:
        ai = classify(text, fname)
        meta = svc.ingest({
            "doc_id": slug(fname.rsplit(".", 1)[0]), "title": ai["title"],
            "summary": ai["summary"], "domain": ai["domain"], "doc_types": ai["doc_types"],
            "tags": ai["tags"], "sensitivity": ai["sensitivity"],
        }, text)
        vidx.index(meta.doc_id, text, {"title": meta.title, "sensitivity": meta.sensitivity})
        print(f"\n  📄 {fname}")
        print(f"     title:       {meta.title}")
        print(f"     sensitivity: {meta.sensitivity}   domain: {meta.domain}")
        print(f"     doc_types:   {meta.doc_types}")
        print(f"     tags:        {meta.tags}")

    rule("2) ASK THE ENGINE  (answer + tool-call trace, access-gated by role)")
    for username, role, q in QUESTIONS:
        ctx = build_default_context(requester=f"{username}@company.com", role=role)
        answer, trace = run_admin_turn_traced(q, ctx, approve=lambda _i: False)
        print(f"\n  ── {username} ({role}) asks: {q!r}")
        steps = " → ".join(c.get("tool") or f"handoff:{c.get('handoff')}" for c in trace) or "(no tools)"
        print(f"     tools called: {steps}")
        print(f"     answer: {answer}")


if __name__ == "__main__":
    main()
