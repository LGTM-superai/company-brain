"""Company Brain HTTP API (FastAPI).

Endpoints:
    GET  /health           liveness + doc count + backend
    POST /search           catalog search (titles/metadata for all)
    POST /read             read one doc — content gated by the user's access
    POST /ingest           index a document (write MD + upsert catalog)
    POST /ask              run the agent for a user (needs model creds)

Run:  uvicorn api.app:app --reload
Local backend (mongomock + infra/sample_kb) by default; set MONGODB_URI / KB_BACKEND=s3
to use Atlas + S3.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from brain_kb.config import KB_BACKEND, build_service
from brain_kb.seed import seed_all

svc = build_service()
if svc.catalog.count() == 0:  # POC convenience: seed the local catalog once
    seed_all(svc.catalog, svc.users)

app = FastAPI(title="Company Brain API", version="0.1.0")


# ── request models ───────────────────────────────────────────────────────────
class SearchReq(BaseModel):
    query: str
    limit: int = 10
    domain: str | None = None
    sensitivity: str | None = None


class ReadReq(BaseModel):
    username: str
    doc_id: str


class IngestReq(BaseModel):
    doc_id: str
    title: str
    domain: str
    sensitivity: str
    content: str
    summary: str = ""
    doc_types: list[str] = []
    tags: list[str] = []
    owner: str | None = None
    team: str | None = None


class AskReq(BaseModel):
    username: str
    prompt: str


# ── endpoints ────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "backend": KB_BACKEND, "documents": svc.catalog.count()}


@app.post("/search")
def search(req: SearchReq):
    filters = {k: v for k, v in (("domain", req.domain), ("sensitivity", req.sensitivity)) if v}
    hits = svc.search(req.query, filters or None, req.limit)
    return {"results": [h.model_dump() for h in hits]}


@app.post("/read")
def read(req: ReadReq):
    user = svc.users.get(req.username)
    if user is None:
        raise HTTPException(status_code=404, detail=f"unknown user {req.username!r}")
    return svc.read(user, req.doc_id).model_dump()


@app.post("/ingest")
def ingest(req: IngestReq):
    fields = req.model_dump(exclude={"content"})
    meta = svc.ingest(fields, req.content)
    return {"ingested": meta.model_dump()}


@app.post("/ask")
def ask(req: AskReq):
    user = svc.users.get(req.username)
    if user is None:
        raise HTTPException(status_code=404, detail=f"unknown user {req.username!r}")
    # Lazy import — only needed here, and requires model credentials at runtime.
    from brain_agents import build_default_context, run_admin_turn

    ctx = build_default_context(requester=req.username)
    # Unattended API: deny spend by default (route approvals via Slack later).
    answer = run_admin_turn(req.prompt, ctx, approve=lambda _i: False)
    return {"answer": answer}
