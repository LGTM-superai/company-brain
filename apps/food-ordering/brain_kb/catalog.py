"""The Mongo-backed catalog (`documents`) and user directory (`users`).

Search is written portably (fetch + score in Python) so it runs identically on
mongomock and **Amazon DocumentDB**. DocumentDB has no `$text`/full-text operator, so
Python-side scoring is the portable approach; for full-text at scale add Amazon
OpenSearch, and for semantic search use DocumentDB vector search — the `Catalog.search`
interface stays the same either way.

Note: search is intentionally NOT access-filtered — titles/metadata are visible to
everyone; content is gated at read time by S3 IAM.
"""

from __future__ import annotations

import re

from .models import DocumentMeta, User

# Common words to ignore so natural-language queries don't match on filler.
_STOP = {
    "the", "a", "an", "of", "to", "for", "and", "or", "my", "me", "i", "you",
    "is", "are", "be", "on", "in", "at", "it", "this", "that", "give", "list",
    "get", "show", "please", "can", "could", "do", "does", "with", "from", "as",
    "by", "what", "who", "how", "all", "any", "some", "your", "our", "we", "us",
}


def _tokens(text: str) -> list[str]:
    """Word tokens, lowercased, ≥3 chars, minus stopwords."""
    return [t for t in re.findall(r"[a-z0-9]{3,}", text.lower()) if t not in _STOP]


def _strip(doc: dict) -> dict:
    doc = dict(doc)
    doc.pop("_id", None)
    return doc


class Catalog:
    def __init__(self, collection) -> None:
        self.col = collection

    def upsert(self, meta: DocumentMeta) -> None:
        self.col.update_one({"doc_id": meta.doc_id}, {"$set": meta.model_dump()}, upsert=True)

    def get(self, doc_id: str) -> DocumentMeta | None:
        doc = self.col.find_one({"doc_id": doc_id})
        return DocumentMeta(**_strip(doc)) if doc else None

    def count(self) -> int:
        return self.col.count_documents({})

    def search(self, query: str, filters: dict | None = None, limit: int = 10) -> list[DocumentMeta]:
        mongo_q: dict = {}
        if filters:
            for f in ("domain", "sensitivity"):
                if filters.get(f):
                    mongo_q[f] = filters[f]
            if filters.get("tags"):
                mongo_q["tags"] = {"$in": list(filters["tags"])}
            if filters.get("doc_types"):
                mongo_q["doc_types"] = {"$in": list(filters["doc_types"])}

        docs = list(self.col.find(mongo_q))
        terms = _tokens(query)
        if not terms:
            # No meaningful keywords: return filtered docs if filtering, else nothing
            # (avoids returning the whole KB for a natural-language question).
            return [DocumentMeta(**_strip(d)) for d in docs][:limit] if filters else []

        scored: list[tuple[int, dict]] = []
        for d in docs:
            words = set(_tokens(" ".join([
                d.get("title", ""), d.get("summary", ""), d.get("domain", ""),
                " ".join(d.get("tags", [])), " ".join(d.get("doc_types", [])),
            ])))
            # A term counts if it equals a word or is a prefix of one (auth→authentication).
            score = sum(1 for t in terms if t in words or any(w.startswith(t) for w in words))
            if score > 0:
                scored.append((score, d))

        scored.sort(key=lambda s: s[0], reverse=True)
        return [DocumentMeta(**_strip(d)) for _, d in scored[:limit]]


class UserDirectory:
    def __init__(self, collection) -> None:
        self.col = collection

    def upsert(self, user: User) -> None:
        self.col.update_one({"username": user.username}, {"$set": user.model_dump()}, upsert=True)

    def get(self, username: str) -> User | None:
        doc = self.col.find_one({"username": username})
        return User(**_strip(doc)) if doc else None
