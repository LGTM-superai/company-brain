"""Knowledge-base tools backed by the real KB: vector search + access-gated read.

`kb_search` does semantic search over company documents, filtered to the caller's
clearance; `kb_read` returns a document's full content if the caller's role allows it
(fail-closed). These let the agent answer questions FROM the uploaded documents.
"""

from __future__ import annotations

from agents import RunContextWrapper, function_tool

from brain_kb.access import ROLE_TIERS
from brain_kb.models import User

from ..context import BrainContext

_svc = None
_vidx = None


def _service():
    global _svc
    if _svc is None:
        from brain_kb.config import build_service
        _svc = build_service()
    return _svc


def _vindex():
    global _vidx
    if _vidx is None:
        from brain_kb.vectorstore import VectorIndex
        _vidx = VectorIndex(persist_dir=".brain/chroma")
    return _vidx


@function_tool
def kb_search(ctx: RunContextWrapper[BrainContext], query: str) -> str:
    """Search company documents/policies/uploaded files by meaning. Returns the most
    relevant documents (id, title, sensitivity, snippet) the caller is allowed to see.

    Args:
        query: What to look for, in natural language.
    """
    allowed = ROLE_TIERS.get(getattr(ctx.context, "role", "csuite"))
    hits = _vindex().search(query, k=5, allowed_sensitivities=allowed)
    if not hits:
        return "No matching documents found in the knowledge base."
    return "\n".join(
        f"- {h['doc_id']}: {h['title']} [{h['sensitivity']}] — {h['snippet']}" for h in hits
    )


@function_tool
def kb_read(ctx: RunContextWrapper[BrainContext], doc_id: str) -> str:
    """Read the full content of a company document by its id. Content is gated by the
    caller's role — returns an access note instead if they're not cleared.

    Args:
        doc_id: The document id from kb_search.
    """
    role = getattr(ctx.context, "role", "csuite")
    res = _service().read(User(username=ctx.context.requester, role=role), doc_id)
    if res.accessible:
        return res.content or ""
    return res.note or "You do not have access to this document's contents."
