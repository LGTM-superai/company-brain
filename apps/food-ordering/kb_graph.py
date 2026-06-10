"""Generate a visual knowledge graph from the live data.

Documents (DocumentDB catalog) are nodes, colored by sensitivity tier and clustered by
domain. Edges come from (1) shared tags and (2) semantic similarity (Chroma vectors,
each doc linked to its nearest neighbours). Writes an interactive `knowledge_graph.html`
and prints a text summary.

    python kb_graph.py
"""

from __future__ import annotations

import itertools
import os
from collections import defaultdict

import numpy as np
from dotenv import load_dotenv

load_dotenv()

TIER_COLOR = {"public": "#22c55e", "internal": "#3b82f6",
              "confidential": "#fbbf24", "restricted": "#ef4444"}
KNN = 2          # semantic neighbours per doc (each doc links to its nearest)
SIM_FLOOR = 0.0   # always connect nearest neighbours (keeps the graph connected)


def _catalog() -> dict:
    from pymongo import MongoClient
    db = MongoClient(os.environ["MONGODB_URI"], tlsCAFile="infra/global-bundle.pem",
                     serverSelectionTimeoutMS=8000)["company_brain"]
    return {d["doc_id"]: d for d in db["documents"].find()}


def _doc_embeddings() -> dict:
    import chromadb
    col = chromadb.PersistentClient(path=".brain/chroma").get_collection("company_kb")
    res = col.get(include=["embeddings", "metadatas"])
    chunks = defaultdict(list)
    for emb, meta in zip(res["embeddings"], res["metadatas"]):
        chunks[meta["doc_id"]].append(np.array(emb, dtype=float))
    return {d: np.mean(v, axis=0) for d, v in chunks.items()}


def _cos(a, b) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


def main() -> None:
    docs = _catalog()
    emb = _doc_embeddings()
    ids = list(docs)

    # edges: shared tags (strong) + kNN semantic (per doc, dedup pairs)
    edges = {}  # (a,b) -> (label, weight, color)
    for a, b in itertools.combinations(ids, 2):
        shared = set(docs[a].get("tags", [])) & set(docs[b].get("tags", []))
        if shared:
            edges[(a, b)] = ("shared: " + ", ".join(list(shared)[:4]), 2 + len(shared), "#7aa2f7")
    for a in ids:
        if a not in emb:
            continue
        sims = sorted(((b, _cos(emb[a], emb[b])) for b in ids if b != a and b in emb),
                      key=lambda x: x[1], reverse=True)
        for b, s in sims[:KNN]:
            if s < SIM_FLOOR:
                continue
            key = (a, b) if (a, b) in edges else ((b, a) if (b, a) in edges else (a, b))
            edges.setdefault(key, (f"similar {s:.2f}", 1, "#3b4252"))

    # build the interactive graph
    from pyvis.network import Network
    net = Network(height="820px", width="100%", bgcolor="#0e1117", font_color="#e6edf3")
    net.barnes_hut(gravity=-9000, spring_length=160)
    for did, d in docs.items():
        sens = d.get("sensitivity", "internal")
        net.add_node(
            did, label=(d.get("title") or did)[:34],
            color=TIER_COLOR.get(sens, "#888"), size=16,
            title=f"{d.get('title')}\n[{sens}] · {d.get('domain')}\ntags: {', '.join(d.get('tags', []))}",
        )
    for (a, b), (label, w, color) in edges.items():
        net.add_edge(a, b, value=w, title=label, color=color)
    net.write_html("knowledge_graph.html", notebook=False)

    # text summary
    print(f"\nKNOWLEDGE GRAPH — {len(docs)} documents, {len(edges)} edges  -> knowledge_graph.html\n")
    by_tier = defaultdict(list)
    for did, d in docs.items():
        by_tier[d.get("sensitivity", "?")].append(d.get("title", did))
    for tier in ("public", "internal", "confidential", "restricted"):
        for t in by_tier.get(tier, []):
            print(f"  [{tier:12}] {t}")
    print("\n  EDGES:")
    for (a, b), (label, w, _c) in sorted(edges.items(), key=lambda e: -e[1][1]):
        print(f"   {docs[a].get('title','?')[:26]:26}  —  {docs[b].get('title','?')[:26]:26}  ({label})")


if __name__ == "__main__":
    main()
