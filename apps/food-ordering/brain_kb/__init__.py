"""Company Brain knowledge base: Mongo catalog + access-gated S3 content.

Search the catalog (titles/metadata visible to all), then read content gated by the
user's role/IAM (fail-closed). See module docstrings for the local-vs-Atlas/S3 wiring.
"""

from .blobstore import AccessDenied, BlobNotFound
from .catalog import Catalog, UserDirectory
from .config import build_service, get_db
from .models import DocumentMeta, ReadResult, User
from .service import KBService

__all__ = [
    "KBService",
    "build_service",
    "get_db",
    "Catalog",
    "UserDirectory",
    "DocumentMeta",
    "User",
    "ReadResult",
    "AccessDenied",
    "BlobNotFound",
]
