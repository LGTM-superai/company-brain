"""Wiring: build a KBService from env. Local (mongomock + local files) by default;
Amazon DocumentDB + S3 when configured.

Env:
    MONGODB_URI        if set → real Mongo/DocumentDB; else in-memory mongomock
                       DocumentDB form: mongodb://<user>:<pass>@<endpoint>:27017/
                         ?tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false
    MONGO_TLS_CA_FILE  path to the Amazon RDS CA bundle (global-bundle.pem) for DocumentDB TLS
    BRAIN_DB_NAME      default "company_brain"
    KB_BACKEND         "local" (default) | "s3"
    KB_LOCAL_ROOT      local blob root (default: infra/sample_kb)
    KB_S3_BUCKET       bucket for the s3 backend
    AWS_REGION_NAME    default "us-east-1"
    KB_INGEST_ACCESS_KEY_ID / KB_INGEST_SECRET_ACCESS_KEY   ingest creds (s3 backend)
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

from .blobstore import LocalIngestBlob, LocalUserBlob, S3IngestBlob, S3UserBlob
from .catalog import Catalog, UserDirectory
from .models import User
from .service import KBService

load_dotenv()

DB_NAME = os.environ.get("BRAIN_DB_NAME", "company_brain")
MONGODB_URI = os.environ.get("MONGODB_URI")
MONGO_TLS_CA_FILE = os.environ.get("MONGO_TLS_CA_FILE")  # Amazon RDS CA bundle for DocumentDB
KB_BACKEND = os.environ.get("KB_BACKEND", "local").lower()
S3_BUCKET = os.environ.get("KB_S3_BUCKET")
AWS_REGION = os.environ.get("AWS_REGION_NAME") or os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
LOCAL_ROOT = Path(os.environ.get(
    "KB_LOCAL_ROOT", str(Path(__file__).resolve().parents[1] / "infra" / "sample_kb")))

_db = None


def get_db():
    """Return a Mongo database handle: real if MONGODB_URI is set, else mongomock."""
    global _db
    if _db is not None:
        return _db
    if MONGODB_URI:
        import pymongo
        # DocumentDB requires TLS with the Amazon RDS CA bundle. retryWrites=false
        # (unsupported by DocumentDB) is set in the URI.
        kwargs = {"tls": True, "tlsCAFile": MONGO_TLS_CA_FILE} if MONGO_TLS_CA_FILE else {}
        _db = pymongo.MongoClient(MONGODB_URI, **kwargs)[DB_NAME]
    else:
        import mongomock
        _db = mongomock.MongoClient()[DB_NAME]
    return _db


def _blob_factory(user: User):
    if KB_BACKEND == "s3":
        # Per-user IAM keys if present (tiered access); else ambient creds.
        return S3UserBlob(
            S3_BUCKET, AWS_REGION,
            user.aws_access_key_id, user.aws_secret_access_key, user.aws_session_token,
        )
    return LocalUserBlob(LOCAL_ROOT, user.role)


def _ingest_blob():
    if KB_BACKEND == "s3":
        return S3IngestBlob(
            S3_BUCKET, AWS_REGION,
            os.environ.get("KB_INGEST_ACCESS_KEY_ID"),
            os.environ.get("KB_INGEST_SECRET_ACCESS_KEY"),
            os.environ.get("KB_INGEST_SESSION_TOKEN"),
        )
    return LocalIngestBlob(LOCAL_ROOT)


def build_service(db=None) -> KBService:
    db = db or get_db()
    return KBService(
        catalog=Catalog(db["documents"]),
        users=UserDirectory(db["users"]),
        blob_factory=_blob_factory,
        ingest_blob=_ingest_blob(),
    )
