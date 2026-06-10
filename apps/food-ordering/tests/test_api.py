"""API tests for the offline endpoints (health/search/read/ingest).

`/ask` is not tested here — it runs the agent and needs model credentials.
"""

import mongomock
from fastapi.testclient import TestClient

import api.app as appmod
from brain_kb.blobstore import LocalIngestBlob, LocalUserBlob
from brain_kb.catalog import Catalog, UserDirectory
from brain_kb.seed import seed_users
from brain_kb.service import KBService

client = TestClient(appmod.app)


def test_health():
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["documents"] >= 5


def test_search_finds_doc():
    r = client.post("/search", json={"query": "billing api authentication"})
    assert any(h["doc_id"] == "billing-api" for h in r.json()["results"])


def test_read_access_enforced():
    # dev cannot read the confidential budget…
    dev = client.post("/read", json={"username": "alice", "doc_id": "fy26-budget"}).json()
    assert dev["found"] and dev["accessible"] is False and dev["content"] is None
    # …but C-suite can.
    cs = client.post("/read", json={"username": "evan", "doc_id": "fy26-budget"}).json()
    assert cs["accessible"] is True and "Budget" in cs["content"]


def test_unknown_user_404():
    r = client.post("/read", json={"username": "nobody", "doc_id": "billing-api"})
    assert r.status_code == 404


def test_ingest_then_read(tmp_path, monkeypatch):
    # Point the API's service at a temp blob root so ingest doesn't touch sample_kb.
    db = mongomock.MongoClient()["api_ingest_test"]
    users = UserDirectory(db["users"])
    seed_users(users)
    test_svc = KBService(
        catalog=Catalog(db["documents"]),
        users=users,
        blob_factory=lambda u: LocalUserBlob(tmp_path, u.role),
        ingest_blob=LocalIngestBlob(tmp_path),
    )
    monkeypatch.setattr(appmod, "svc", test_svc)

    r = client.post("/ingest", json={
        "doc_id": "deploy-runbook", "title": "Deploy Runbook", "domain": "engineering",
        "sensitivity": "internal", "content": "# Deploy\nStep 1...", "doc_types": ["runbook"],
    })
    assert r.json()["ingested"]["s3_key_md"] == "md/internal/engineering/deploy-runbook.md"

    got = client.post("/read", json={"username": "alice", "doc_id": "deploy-runbook"}).json()
    assert got["accessible"] and "Deploy" in got["content"]
