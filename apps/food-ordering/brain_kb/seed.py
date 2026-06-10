"""Seed the catalog (from the sample_kb MD frontmatter) and a few demo users.

For the local backend the files already live under infra/sample_kb, so we only seed
the Mongo catalog + users. Idempotent (upserts).
"""

from __future__ import annotations

from pathlib import Path

import yaml

from .catalog import Catalog, UserDirectory
from .models import DocumentMeta, User

SAMPLE_ROOT = Path(__file__).resolve().parents[1] / "infra" / "sample_kb"

DEMO_USERS = [
    User(username="alice", role="dev"),
    User(username="hannah", role="hr"),
    User(username="evan", role="csuite"),
]


def _parse_frontmatter(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8")
    if not raw.startswith("---"):
        return {}
    _, _, rest = raw.partition("---")
    fm_text, _, _ = rest.partition("---")
    return yaml.safe_load(fm_text) or {}


def seed_catalog(catalog: Catalog, sample_root: Path = SAMPLE_ROOT) -> int:
    n = 0
    for p in sorted((sample_root / "md").rglob("*.md")):
        fm = _parse_frontmatter(p)
        if not fm.get("doc_id"):
            continue
        catalog.upsert(DocumentMeta(
            doc_id=fm["doc_id"], title=fm.get("title", fm["doc_id"]),
            summary=fm.get("summary", ""), domain=fm.get("domain", "unknown"),
            doc_types=fm.get("doc_types", []), tags=fm.get("tags", []),
            sensitivity=fm["sensitivity"], s3_key_md=fm["s3_key_md"],
            owner=fm.get("owner"), team=fm.get("team"), status=fm.get("status", "active"),
        ))
        n += 1
    return n


def seed_users(users: UserDirectory) -> int:
    for u in DEMO_USERS:
        users.upsert(u)
    return len(DEMO_USERS)


def seed_all(catalog: Catalog, users: UserDirectory) -> tuple[int, int]:
    return seed_catalog(catalog), seed_users(users)
