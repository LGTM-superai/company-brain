"""Pydantic models for the knowledge-base catalog and access."""

from __future__ import annotations

from pydantic import BaseModel, Field


class DocumentMeta(BaseModel):
    """One row in the Mongo `documents` catalog. Mirrors the MD frontmatter."""

    doc_id: str
    title: str
    summary: str = ""
    domain: str
    doc_types: list[str] = Field(default_factory=list)  # multi-class
    tags: list[str] = Field(default_factory=list)
    sensitivity: str  # public | internal | confidential | restricted
    s3_key_md: str
    s3_key_raw: str | None = None
    owner: str | None = None
    team: str | None = None
    project: str | None = None
    status: str = "active"


class User(BaseModel):
    """A row in the Mongo `users` collection (POC auth)."""

    username: str
    role: str  # dev | hr | csuite
    aws_access_key_id: str | None = None      # used by the S3 backend
    aws_secret_access_key: str | None = None
    aws_session_token: str | None = None      # for temporary STS creds


class ReadResult(BaseModel):
    """Outcome of a content read — fail-closed: title is always shown, content may be gated."""

    doc_id: str
    title: str
    found: bool
    accessible: bool
    sensitivity: str | None = None
    content: str | None = None
    note: str | None = None
