# Demo runbook — Company Brain

Everything below runs **on a laptop** (no VPC/AWS infra needed). The catalog uses
in-memory mongomock, content uses local files, and the model + embeddings use **AWS
Bedrock** (live).

## 0. One-time setup (~2 min)

```bash
pip install -r requirements.txt
cp .env.example .env          # then fill in AWS creds + EXA_API_KEY (see below)
python seed_vault.py          # 10 people for the agent/people lookups
python seed_vectors.py        # embed the sample KB into the vector DB (for /vsearch)
```

`.env` essentials:
```ini
BRAIN_MODEL_PROVIDER=bedrock
BRAIN_BEDROCK_MODEL=us.amazon.nova-lite-v1:0   # Nova works now; Claude pending Marketplace
AWS_REGION_NAME=us-west-2
AWS_ACCESS_KEY_ID=...        AWS_SECRET_ACCESS_KEY=...
KB_BACKEND=local
EXA_API_KEY=...
```

Start the backend (serves the API **and** the demo page at `/`):
```bash
uvicorn api.app:app --reload     # http://localhost:8000/
```

Demo users: **alice** = dev · **hannah** = hr · **evan** = csuite.

---

## 1. Semantic search beats keyword search  *(the headline)*

```bash
python demo_vector_search.py
```
Show that queries with **no shared words** still find the right doc by meaning, e.g.
*"how do I get reimbursed for something I bought"* → **Customer Refund Policy**.

## 2. Access control is enforced by infrastructure, not the model

Same query, different user — the **restricted** doc only appears for C-suite:
```bash
curl -sX POST localhost:8000/vsearch -H 'content-type: application/json' \
     -d '{"query":"how much do engineers earn","username":"alice"}'   # dev → no comp doc
curl -sX POST localhost:8000/vsearch -H 'content-type: application/json' \
     -d '{"query":"how much do engineers earn","username":"evan"}'    # csuite → comp doc
```
And content reads fail closed:
```bash
curl -sX POST localhost:8000/read -H 'content-type: application/json' \
     -d '{"username":"alice","doc_id":"fy26-budget"}'   # accessible:false (confidential)
```
Talking point: *titles are searchable by everyone; **content** is gated. With real S3 it's
IAM that enforces it — the LLM is never the gatekeeper, which kills prompt-injection exfiltration.*

## 3. Upload anything → converted → searchable

In the UI (or curl), upload a **PDF or DOCX**:
```bash
curl -sX POST localhost:8000/upload -F file=@/path/to/policy.pdf \
     -F title="Refund Policy" -F domain=business -F sensitivity=confidential
```
It's converted to Markdown, added to the catalog **and** the vector DB — then findable
via `/vsearch`.

## 4. The agent does real work (Bedrock)

```bash
python admin.py
admin> who on the tech team has a nut allergy, and where did they grow up?
admin> order lunch for the tech team, about $18 a head     # pauses for spend approval
```
Or the deterministic lunch flow (no model needed):
```bash
python demo_order_lunch.py     # vault → 4 different meals → mock order → delivery tracking
```

---

## One-liner architecture
> A FastAPI brain over a tiered knowledge base — catalog + content with **role-based access
> enforced by S3 IAM**, **semantic search** (Chroma + Bedrock embeddings) with per-chunk
> access filtering, **PDF/DOCX ingestion**, and an **agent** (Bedrock) that looks things up,
> orders within a spend limit, and posts to Slack.

## If something's off
- **Agent errors on a model** → Claude is pending its Bedrock Marketplace subscription; keep
  `BRAIN_BEDROCK_MODEL=us.amazon.nova-lite-v1:0` (Nova works today).
- **`/vsearch` returns nothing** → run `python seed_vectors.py` first.
- **Persistence** → mongomock resets on restart; DocumentDB is deployed but VPC-only, so use
  local for the laptop demo. Re-run the seed scripts after a restart.
