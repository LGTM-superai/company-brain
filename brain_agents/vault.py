"""ObsidianVault — read & search the Markdown vault the agents use as their KB.

A vault is just a folder of `.md` files with YAML frontmatter (exactly what
`seed_vault.py` writes, and what the "file -> AI -> Markdown" pipeline would
produce). This reader gives the knowledge + purchasing tools real save/search
behaviour over those notes — no external service required for the POC.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cached_property
from pathlib import Path

import yaml

DEFAULT_VAULT_DIR = Path(__file__).resolve().parents[1] / "vault"


@dataclass
class Note:
    path: str                 # vault-relative, e.g. "People/Maya Krishnan - Personal.md"
    frontmatter: dict
    body: str
    raw: str


def _parse(path: Path, root: Path) -> Note:
    raw = path.read_text(encoding="utf-8")
    fm: dict = {}
    body = raw
    if raw.startswith("---"):
        _, _, rest = raw.partition("---")
        fm_text, sep, body = rest.partition("---")
        if sep:
            fm = yaml.safe_load(fm_text) or {}
    return Note(path=str(path.relative_to(root)), frontmatter=fm, body=body.strip(), raw=raw)


class ObsidianVault:
    """Filesystem-backed vault: list, read, search notes; resolve people & teams."""

    def __init__(self, root: Path | str = DEFAULT_VAULT_DIR) -> None:
        self.root = Path(root)

    @cached_property
    def notes(self) -> list[Note]:
        if not self.root.exists():
            return []
        return [_parse(p, self.root) for p in sorted(self.root.rglob("*.md"))]

    def refresh(self) -> None:
        self.__dict__.pop("notes", None)  # drop the cache (e.g. after new files land)

    # -------------------------------------------------------------- read/search
    def read_note(self, path: str) -> str:
        target = (self.root / path)
        if not target.exists():
            # tolerate a bare title like "Maya Krishnan - Personal"
            matches = [n for n in self.notes if Path(n.path).stem == path or n.path == path]
            if matches:
                return matches[0].raw
            return f"Note not found: {path}"
        return target.read_text(encoding="utf-8")

    def search(self, query: str, limit: int = 8) -> list[dict]:
        """Keyword search across frontmatter values + body. Ranked by hit count."""
        terms = [t for t in query.lower().split() if t]
        scored: list[tuple[int, Note]] = []
        for note in self.notes:
            hay = (note.body + " " + yaml.safe_dump(note.frontmatter, allow_unicode=True)).lower()
            score = sum(hay.count(t) for t in terms)
            if score:
                scored.append((score, note))
        scored.sort(key=lambda s: s[0], reverse=True)
        return [
            {"path": n.path, "score": s, "excerpt": _excerpt(n.body, terms)}
            for s, n in scored[:limit]
        ]

    # ------------------------------------------------------------------ people
    def people(self, note_type: str = "personal") -> list[Note]:
        return [n for n in self.notes if n.frontmatter.get("type") == note_type]

    def get_person(self, name: str) -> dict | None:
        for n in self.people():
            if n.frontmatter.get("person", "").lower() == name.lower():
                return _person_dict(n.frontmatter)
        return None

    def get_team(self, team: str) -> list[dict]:
        team = team.lower().strip()
        return [
            _person_dict(n.frontmatter)
            for n in self.people()
            if str(n.frontmatter.get("team", "")).lower() == team
        ]


def _person_dict(fm: dict) -> dict:
    """Normalise a personal note's frontmatter into the shape tools/planning expect."""
    return {
        "name": fm.get("person"),
        "email": fm.get("email"),
        "team": fm.get("team"),
        "role": fm.get("role"),
        "hometown": fm.get("hometown"),
        "dietary": list(fm.get("dietary") or []),
        "avoid": list(fm.get("allergens") or []),          # allergens -> 'avoid'
        "cuisine_preferences": list(fm.get("cuisine_preferences") or []),
        "dislikes": list(fm.get("dislikes") or []),
        "personality": list(fm.get("personality") or []),
    }


def _excerpt(body: str, terms: list[str], width: int = 120) -> str:
    low = body.lower()
    pos = next((low.find(t) for t in terms if low.find(t) >= 0), -1)
    if pos < 0:
        return body[:width].replace("\n", " ").strip()
    start = max(0, pos - width // 3)
    return body[start:start + width].replace("\n", " ").strip()
