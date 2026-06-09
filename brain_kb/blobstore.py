"""Content storage with access enforcement.

Two backends, same interface:
- **LocalUserBlob** — reads MD from a local folder, enforcing the role→tier matrix in
  code (mirrors IAM). For offline dev/test, no AWS needed.
- **S3UserBlob** — reads MD from S3 using the *user's* IAM creds; S3 IAM is the hard
  boundary and a 403 surfaces as AccessDenied (fail-closed).

Plus ingest writers (LocalIngestBlob / S3IngestBlob) for the pipeline side.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from .access import can_read


class AccessDenied(Exception):
    """The caller's role/creds are not allowed to read this object."""


class BlobNotFound(Exception):
    pass


# ── Reader (per-user) ────────────────────────────────────────────────────────
class UserBlob(ABC):
    @abstractmethod
    def read_md(self, key: str) -> str:
        """Return Markdown content, or raise AccessDenied / BlobNotFound."""


class LocalUserBlob(UserBlob):
    def __init__(self, root: Path, role: str) -> None:
        self.root = Path(root)
        self.role = role

    def read_md(self, key: str) -> str:
        if not can_read(self.role, key):
            raise AccessDenied(key)
        p = self.root / key
        if not p.exists():
            raise BlobNotFound(key)
        return p.read_text(encoding="utf-8")


def _s3_client(region, access_key=None, secret_key=None, session_token=None):
    """Explicit creds when an access_key is given, else the ambient default chain
    (env vars incl. AWS_SESSION_TOKEN, profile, or instance role)."""
    import boto3
    if access_key:
        return boto3.client(
            "s3", region_name=region, aws_access_key_id=access_key,
            aws_secret_access_key=secret_key, aws_session_token=session_token,
        )
    return boto3.client("s3", region_name=region)


class S3UserBlob(UserBlob):
    def __init__(self, bucket, region, access_key=None, secret_key=None, session_token=None) -> None:
        self.bucket = bucket
        self.s3 = _s3_client(region, access_key, secret_key, session_token)

    def read_md(self, key: str) -> str:
        from botocore.exceptions import ClientError
        try:
            obj = self.s3.get_object(Bucket=self.bucket, Key=key)
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("AccessDenied", "403"):
                raise AccessDenied(key) from e
            if code in ("NoSuchKey", "404"):
                raise BlobNotFound(key) from e
            raise
        return obj["Body"].read().decode("utf-8")


# ── Ingest writer ────────────────────────────────────────────────────────────
class IngestBlob(ABC):
    @abstractmethod
    def write_md(self, key: str, content: str) -> None: ...


class LocalIngestBlob(IngestBlob):
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def write_md(self, key: str, content: str) -> None:
        p = self.root / key
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")


class S3IngestBlob(IngestBlob):
    def __init__(self, bucket, region, access_key=None, secret_key=None, session_token=None) -> None:
        self.bucket = bucket
        self.s3 = _s3_client(region, access_key, secret_key, session_token)

    def write_md(self, key: str, content: str) -> None:
        self.s3.put_object(
            Bucket=self.bucket, Key=key,
            Body=content.encode("utf-8"), ContentType="text/markdown",
        )
