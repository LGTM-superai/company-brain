"""Vector search over document content — ChromaDB + AWS Bedrock (Titan) embeddings.

A real local vector DB (Chroma, persisted to disk) with embeddings from Bedrock
Titan v2 (1024-dim, cosine). Content is chunked, embedded, and indexed; queries are
embedded and matched by semantic similarity — so it finds answers by *meaning*, not
keywords.

Access note: each chunk carries its document's `sensitivity`, so `search()` can
pre-filter to the tiers a user is cleared for — the per-chunk gating that keeps
semantic search from leaking restricted content.
"""

from __future__ import annotations

import json
import os

import boto3

EMBED_MODEL = "amazon.titan-embed-text-v2:0"


class VectorIndex:
    def __init__(self, collection="company_kb", persist_dir: str | None = None,
                 region: str | None = None, reset: bool = False) -> None:
        import chromadb

        region = region or os.environ.get("AWS_REGION_NAME") or "us-west-2"
        self._rt = boto3.client("bedrock-runtime", region_name=region)
        self._client = (chromadb.PersistentClient(path=persist_dir)
                        if persist_dir else chromadb.EphemeralClient())
        if reset:
            try:
                self._client.delete_collection(collection)
            except Exception:
                pass
        self._col = self._client.get_or_create_collection(
            collection, metadata={"hnsw:space": "cosine"})

    # ----------------------------------------------------------------- embed
    def _embed(self, text: str) -> list[float]:
        r = self._rt.invoke_model(modelId=EMBED_MODEL, body=json.dumps({"inputText": text}))
        return json.loads(r["body"].read())["embedding"]

    @staticmethod
    def _chunks(text: str, size: int = 600, overlap: int = 80) -> list[str]:
        text = text.strip()
        if len(text) <= size:
            return [text]
        out, i = [], 0
        while i < len(text):
            out.append(text[i:i + size])
            i += size - overlap
        return out

    # ----------------------------------------------------------------- index
    def index(self, doc_id: str, text: str, metadata: dict) -> int:
        chunks = self._chunks(text)
        self._col.upsert(
            ids=[f"{doc_id}#{i}" for i in range(len(chunks))],
            embeddings=[self._embed(c) for c in chunks],
            documents=chunks,
            metadatas=[{**metadata, "doc_id": doc_id, "chunk": i} for i in range(len(chunks))],
        )
        return len(chunks)

    # ---------------------------------------------------------------- search
    def search(self, query: str, k: int = 3,
               allowed_sensitivities: set[str] | None = None) -> list[dict]:
        where = {"sensitivity": {"$in": list(allowed_sensitivities)}} if allowed_sensitivities else None
        res = self._col.query(query_embeddings=[self._embed(query)], n_results=k, where=where)
        hits = []
        for i in range(len(res["ids"][0])):
            m = res["metadatas"][0][i]
            hits.append({
                "doc_id": m["doc_id"],
                "title": m.get("title"),
                "sensitivity": m.get("sensitivity"),
                "score": round(1 - res["distances"][0][i], 3),  # cosine sim
                "snippet": res["documents"][0][i].strip()[:170],
            })
        return hits
