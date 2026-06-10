"""Offline tests for the KB service: catalog search + access-gated reads + ingest.

Uses mongomock for the catalog and the local-files backend (which enforces the same
role→tier matrix as S3 IAM), so no AWS/Atlas needed.
"""

import mongomock
import pytest

from brain_kb.blobstore import LocalIngestBlob, LocalUserBlob
from brain_kb.catalog import Catalog, UserDirectory
from brain_kb.seed import SAMPLE_ROOT, seed_all
from brain_kb.service import KBService
from brain_kb.models import User


@pytest.fixture
def svc():
    db = mongomock.MongoClient()["company_brain_test"]
    catalog = Catalog(db["documents"])
    users = UserDirectory(db["users"])
    seed_all(catalog, users)
    return KBService(
        catalog=catalog,
        users=users,
        blob_factory=lambda u: LocalUserBlob(SAMPLE_ROOT, u.role),
        ingest_blob=LocalIngestBlob(SAMPLE_ROOT),
    )


def test_seeded_catalog(svc):
    assert svc.catalog.count() == 5
    assert svc.users.get("alice").role == "dev"
    assert svc.users.get("evan").role == "csuite"


def test_search_returns_titles_for_all_tiers(svc):
    # "budget" should surface the confidential finance doc by title/tags — unfiltered.
    hits = svc.search("budget")
    assert any(h.doc_id == "fy26-budget" for h in hits)


def test_dev_can_read_internal_not_confidential(svc):
    alice = svc.users.get("alice")  # dev
    r = svc.read(alice, "billing-api")          # internal
    assert r.accessible and "BILLING_API_KEY" in r.content
    r2 = svc.read(alice, "fy26-budget")         # confidential
    assert r2.found and not r2.accessible and r2.content is None
    assert "access" in r2.note.lower()


def test_hr_reads_restricted_not_confidential(svc):
    hannah = svc.users.get("hannah")  # hr
    assert svc.read(hannah, "maya-krishnan-personnel").accessible      # restricted ✓
    assert not svc.read(hannah, "fy26-budget").accessible              # confidential ✗


def test_csuite_reads_everything(svc):
    evan = svc.users.get("evan")  # csuite
    for doc_id in ("company-overview", "billing-api", "fy26-budget", "maya-krishnan-personnel"):
        assert svc.read(evan, doc_id).accessible


def test_case_b_multi_file(svc):
    # "plan and budget for June" spans the internal sprint doc + the confidential budget.
    ids = ["sprint-2026-06", "fy26-budget"]
    dev = svc.read_many(svc.users.get("alice"), ids)
    assert [r.accessible for r in dev] == [True, False]   # dev: sprint only
    csuite = svc.read_many(svc.users.get("evan"), ids)
    assert all(r.accessible for r in csuite)              # csuite: both


def test_ingest_roundtrip(svc, tmp_path):
    # Ingest into a temp root so we don't touch the sample files.
    svc._ingest = LocalIngestBlob(tmp_path)
    svc._blob_factory = lambda u: LocalUserBlob(tmp_path, u.role)
    meta = svc.ingest(
        {"doc_id": "new-runbook", "title": "Deploy Runbook", "domain": "engineering",
         "doc_types": ["runbook"], "tags": ["deploy"], "sensitivity": "internal",
         "owner": "wei@company.com"},
        "# Deploy Runbook\nStep 1...",
    )
    assert meta.s3_key_md == "md/internal/engineering/new-runbook.md"
    assert svc.catalog.get("new-runbook") is not None
    assert svc.read(User(username="x", role="dev"), "new-runbook").accessible
    # A restricted ingest is not readable by a dev.
    svc.ingest(
        {"doc_id": "secret-memo", "title": "Comp Memo", "domain": "people",
         "doc_types": ["personnel"], "tags": [], "sensitivity": "restricted"},
        "# Comp\n...",
    )
    assert not svc.read(User(username="x", role="dev"), "secret-memo").accessible
