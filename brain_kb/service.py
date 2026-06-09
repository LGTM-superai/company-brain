"""KBService — search the catalog (titles for all) and read content (gated by access).

`read_many` handles Case B (answers spanning multiple files): read every doc the
user can access, mark the rest as gated, and let the caller synthesise across them.
"""

from __future__ import annotations

from typing import Callable

from .blobstore import AccessDenied, BlobNotFound, IngestBlob, UserBlob
from .catalog import Catalog, UserDirectory
from .models import DocumentMeta, ReadResult, User

BlobFactory = Callable[[User], UserBlob]


class KBService:
    def __init__(
        self,
        catalog: Catalog,
        users: UserDirectory,
        blob_factory: BlobFactory,
        ingest_blob: IngestBlob,
    ) -> None:
        self.catalog = catalog
        self.users = users
        self._blob_factory = blob_factory
        self._ingest = ingest_blob

    # ----------------------------------------------------------------- search
    def search(self, query: str, filters: dict | None = None, limit: int = 10) -> list[DocumentMeta]:
        """Catalog search — NOT access-filtered (titles/metadata visible to all)."""
        return self.catalog.search(query, filters, limit)

    # ------------------------------------------------------------------- read
    def read(self, user: User, doc_id: str) -> ReadResult:
        meta = self.catalog.get(doc_id)
        if meta is None:
            return ReadResult(doc_id=doc_id, title="", found=False, accessible=False,
                              note="No such document.")
        blob = self._blob_factory(user)
        try:
            content = blob.read_md(meta.s3_key_md)
            return ReadResult(doc_id=doc_id, title=meta.title, found=True, accessible=True,
                              sensitivity=meta.sensitivity, content=content)
        except AccessDenied:
            return ReadResult(
                doc_id=doc_id, title=meta.title, found=True, accessible=False,
                sensitivity=meta.sensitivity,
                note=(f"You don't have access to the contents of this {meta.sensitivity} "
                      f"document (owner: {meta.owner})."),
            )
        except BlobNotFound:
            return ReadResult(doc_id=doc_id, title=meta.title, found=True, accessible=False,
                              sensitivity=meta.sensitivity, note="Content missing from storage.")

    def read_many(self, user: User, doc_ids: list[str]) -> list[ReadResult]:
        """Case B: read a set of docs; caller synthesises across the accessible ones."""
        return [self.read(user, d) for d in doc_ids]

    # ----------------------------------------------------------------- ingest
    def ingest(self, meta_fields: dict, content: str) -> DocumentMeta:
        """Write the MD to storage and upsert the catalog. Tier+domain set the S3 key."""
        sens = meta_fields["sensitivity"]
        domain = meta_fields["domain"]
        doc_id = meta_fields["doc_id"]
        key = f"md/{sens}/{domain}/{doc_id}.md"
        self._ingest.write_md(key, content)
        meta = DocumentMeta(s3_key_md=key, **meta_fields)
        self.catalog.upsert(meta)
        return meta
