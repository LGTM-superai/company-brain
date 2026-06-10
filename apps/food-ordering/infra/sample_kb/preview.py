"""Local preview of the knowledge base: simulate Mongo catalog + S3 IAM access.

Walks the sample bucket layout (md/<tier>/<domain>/*.md), shows what the Mongo
catalog would expose (titles for everyone), and what content each role could
actually read through the S3 IAM prefix policy. Also demonstrates a Case-B answer
that spans multiple files.

    python infra/sample_kb/preview.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from access import ROLE_TIERS, can_read  # noqa: E402


def load_catalog() -> list[dict]:
    docs = []
    for p in sorted((HERE / "md").rglob("*.md")):
        raw = p.read_text(encoding="utf-8")
        fm, body = {}, raw
        if raw.startswith("---"):
            _, _, rest = raw.partition("---")
            fmtext, _, body = rest.partition("---")
            fm = yaml.safe_load(fmtext) or {}
        docs.append({
            "doc_id": fm.get("doc_id"),
            "title": fm.get("title"),
            "tier": fm.get("sensitivity"),
            "doc_types": fm.get("doc_types", []),
            "key": fm.get("s3_key_md", str(p.relative_to(HERE))),
            "body": body.strip(),
        })
    return docs


def s3_get(role: str, doc: dict) -> str | None:
    """Simulate S3 GetObject under the role's IAM policy: content or None (403)."""
    return doc["body"] if can_read(role, doc["key"]) else None


def rule(label=""):
    print("\n" + "─" * 70)
    if label:
        print(label)


def main() -> None:
    catalog = load_catalog()

    rule("MONGO CATALOG  (titles visible to everyone — content gated by S3)")
    for d in catalog:
        print(f"  [{d['tier']:12}] {d['title']:48} classes={d['doc_types']}")

    rule("CONTENT ACCESS BY ROLE  (simulating the S3 IAM prefix policy)")
    for role in ("dev", "hr", "csuite"):
        readable = [d for d in catalog if s3_get(role, d)]
        gated = [d for d in catalog if not s3_get(role, d)]
        print(f"\n  {role}  (tiers: {sorted(ROLE_TIERS[role])})")
        print(f"    reads {len(readable)}/{len(catalog)}")
        for d in gated:
            print(f"    🔒 gated: {d['title']}  ({d['tier']})")

    # Case B: an answer that spans multiple files.
    rule("CASE B — answer spanning multiple files")
    print('  Query: "What is the plan and budget for the June sprint?"')
    relevant = [d for d in catalog if d["doc_id"] in ("sprint-2026-06", "fy26-budget")]
    for role in ("dev", "csuite"):
        readable = [d for d in relevant if s3_get(role, d)]
        gated = [d for d in relevant if not s3_get(role, d)]
        print(f"\n  {role}: synthesises from {len(readable)} doc(s): "
              f"{[d['doc_id'] for d in readable]}")
        if gated:
            print(f"    + sees but can't open: {[d['doc_id'] for d in gated]} "
                  f"→ partial answer with a 'gated' note")
        else:
            print("    → full answer across both docs")


if __name__ == "__main__":
    main()
