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

import asyncio
import os
import pathlib
import re

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from brain_kb.access import ROLE_TIERS
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
    """Keyword/metadata search over the catalog (titles visible to everyone)."""
    filters = {k: v for k, v in (("domain", req.domain), ("sensitivity", req.sensitivity)) if v}
    hits = svc.search(req.query, filters or None, req.limit)
    return {"results": [h.model_dump() for h in hits]}


# Lazy, shared vector index (ChromaDB + Bedrock embeddings).
_vindex = None


def _vector_index():
    global _vindex
    if _vindex is None:
        from brain_kb.vectorstore import VectorIndex
        _vindex = VectorIndex(persist_dir=".brain/chroma")
    return _vindex


class VSearchReq(BaseModel):
    query: str
    username: str | None = None  # if given, results are filtered to the user's tiers
    k: int = 5


@app.post("/vsearch")
def vsearch(req: VSearchReq):
    """Semantic (vector) search over document content, access-filtered by role."""
    allowed = None
    if req.username:
        u = svc.users.get(req.username)
        if u is not None:
            allowed = ROLE_TIERS.get(u.role)
    try:
        return {"results": _vector_index().search(req.query, k=req.k, allowed_sensitivities=allowed)}
    except Exception as e:  # Bedrock/Chroma unavailable
        raise HTTPException(status_code=503, detail=f"vector search unavailable: {e}")


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
    from brain_agents import build_default_context, run_admin_turn_traced

    ctx = build_default_context(requester=req.username, role=user.role)
    # Unattended API: deny spend by default (route approvals via Slack later).
    answer, trace = run_admin_turn_traced(req.prompt, ctx, approve=lambda _i: False)
    return {"answer": answer, "trace": trace}


# ─────────────────────────────────────────────────────────────────────────────
# MINIMAL DEMO FRONTEND  — remove this whole block (+ the frontend/ dir) to delete.
# CORS lets a Vercel-hosted page call this API; GET / serves the same page so it
# also works server-side with no Vercel; /upload ingests a text/markdown file.
# ─────────────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

_FRONTEND = pathlib.Path(__file__).resolve().parents[1] / "frontend" / "index.html"


@app.get("/", response_class=HTMLResponse)
def index():
    if _FRONTEND.exists():
        return _FRONTEND.read_text(encoding="utf-8")
    return "<h1>Company Brain API</h1><p>frontend/index.html not found.</p>"


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "doc"


@app.post("/upload")
async def upload(
    file: UploadFile = File(...),
    title: str = Form(""),
    domain: str = Form(""),
    sensitivity: str = Form(""),
    doc_types: str = Form(""),
    auto_classify: bool = Form(True),
):
    raw = await file.read()
    from brain_kb.convert import to_markdown
    try:
        content = to_markdown(file.filename, raw, file.content_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    fields = {
        "doc_id": _slug(pathlib.Path(file.filename or "doc").stem),
        "title": title or (file.filename or "Untitled"),
        "domain": domain, "sensitivity": sensitivity,
        "doc_types": [t.strip() for t in doc_types.split(",") if t.strip()],
        "tags": [], "summary": "",
    }
    # AI classification: fill anything the caller didn't specify (title/domain/
    # sensitivity/doc_types/tags/summary) from the document content.
    if auto_classify and not os.environ.get("KB_DISABLE_CLASSIFY"):
        try:
            from brain_kb.classify import classify
            # Off the event loop — the Bedrock call takes a few seconds.
            ai = await asyncio.to_thread(classify, content, file.filename)
            if not title:
                fields["title"] = ai["title"]
            fields["domain"] = domain or ai["domain"]
            fields["sensitivity"] = sensitivity or ai["sensitivity"]
            fields["doc_types"] = fields["doc_types"] or ai["doc_types"]
            fields["tags"] = ai["tags"]
            fields["summary"] = ai["summary"]
        except Exception:
            pass  # fall back to caller-provided values
    fields["domain"] = fields["domain"] or "general"
    fields["sensitivity"] = fields["sensitivity"] or "internal"

    meta = svc.ingest(fields, content)
    # Best-effort: also embed into the vector DB so /vsearch finds it by meaning.
    if not os.environ.get("KB_DISABLE_VECTOR"):
        try:
            await asyncio.to_thread(
                _vector_index().index, meta.doc_id, content,
                {"title": meta.title, "sensitivity": meta.sensitivity})
        except Exception:
            pass  # keyword /search still works even if embeddings are unavailable
    return {"ingested": meta.model_dump()}
