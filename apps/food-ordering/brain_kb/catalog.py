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

from .models import DocumentMeta, User


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
        terms = [t for t in query.lower().split() if t]

        scored: list[tuple[int, dict]] = []
        for d in docs:
            hay = " ".join([
                d.get("title", ""), d.get("summary", ""), d.get("domain", ""),
                " ".join(d.get("tags", [])), " ".join(d.get("doc_types", [])),
            ]).lower()
            score = sum(hay.count(t) for t in terms) if terms else 1
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
