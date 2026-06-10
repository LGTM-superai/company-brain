"""Demo: real vector search over mock documents (ChromaDB + Bedrock embeddings).

Ingests a handful of mock docs, then runs semantic queries whose wording does NOT
overlap with the documents — showing retrieval by meaning, plus access-tier filtering.

    python demo_vector_search.py
"""

from __future__ import annotations

from dotenv import load_dotenv

load_dotenv()

from brain_kb.vectorstore import VectorIndex

DOCS = [
    ("billing-api", "Billing API Authentication", "internal",
     "Internal services authenticate to the payments service by sending a bearer token "
     "taken from the BILLING_API_KEY environment variable. The base URL is "
     "https://billing.internal/v1 with endpoints for charges, refunds, and customers."),
    ("refund-policy", "Customer Refund Policy", "confidential",
     "Customers may request their money back within 30 days of purchase. Reimbursements "
     "are issued to the original payment method. Disputed charges and chargebacks are "
     "handled by the finance team within five business days."),
    ("incident-runbook", "Incident Response Runbook", "internal",
     "When the website becomes unavailable, immediately page the on-call engineer, open a "
     "war room in Slack, and post regular status updates to the customers channel until "
     "service is restored and a postmortem is scheduled."),
    ("comp-bands", "Engineering Compensation Bands", "restricted",
     "Senior backend engineers are paid between SGD 150,000 and 190,000 per year. "
     "Performance reviews and salary adjustments happen twice a year, in June and December."),
    ("onboarding", "New Hire Onboarding", "internal",
     "In their first week, new engineers set up their laptop with full-disk encryption, are "
     "added to Slack and GitHub, and pair with a mentor to ship a small change to production."),
    ("leave-policy", "Paid Leave Policy", "internal",
     "Full-time employees receive 20 days of paid annual leave in addition to public "
     "holidays. Unused leave of up to 5 days may be carried over into the next year."),
]

QUERIES = [
    "how do I get reimbursed for something I bought",   # -> refund-policy
    "what should I do when the site crashes",            # -> incident-runbook
    "how do new joiners get set up on their first day",  # -> onboarding
    "how much do developers earn here",                  # -> comp-bands (restricted!)
    "connecting to the payment system securely",         # -> billing-api
    "taking time off work",                              # -> leave-policy
]


def line(label=""):
    print("\n" + "─" * 72)
    if label:
        print(label)


def main() -> None:
    idx = VectorIndex(collection="vector_demo", persist_dir=".brain/chroma", reset=True)
    line("Indexing mock documents into the vector DB (Chroma + Bedrock Titan)…")
    for doc_id, title, sens, text in DOCS:
        n = idx.index(doc_id, text, {"title": title, "sensitivity": sens})
        print(f"  • {title:34} [{sens:12}] {n} chunk(s)")

    line("SEMANTIC SEARCH  (query wording does not match the docs' words)")
    for q in QUERIES:
        print(f'\n  Q: "{q}"')
        for r in idx.search(q, k=2):
            print(f"     {r['score']:.3f}  [{r['sensitivity']:12}] {r['title']}")
            print(f"            ↳ {r['snippet']}")

    line("ACCESS-FILTERED SEARCH  (per-chunk sensitivity gating)")
    q = "how much do developers earn here"
    print(f'  Q: "{q}"')
    print("\n  Unfiltered (sees everything):")
    for r in idx.search(q, k=1):
        print(f"     {r['score']:.3f}  [{r['sensitivity']}] {r['title']}")
    print("\n  As a DEV (allowed: public, internal — restricted is filtered OUT):")
    hits = idx.search(q, k=2, allowed_sensitivities={"public", "internal"})
    for r in hits:
        print(f"     {r['score']:.3f}  [{r['sensitivity']}] {r['title']}")
    print("     → the restricted comp doc never surfaces; the agent can't even see the snippet.")


if __name__ == "__main__":
    main()
