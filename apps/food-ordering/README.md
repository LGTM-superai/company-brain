# Company Brain

An agentic **admin duty assistant** for a company: ask it questions, have it run
operational duties, and let it act on your behalf — within guardrails. Built as a POC
on the [OpenAI Agents SDK](https://github.com/openai/openai-agents-python), with model
calls routed through **AWS Bedrock**.

You talk to one agent in natural language; it reasons and uses tools to get things done:

- **Knowledge** — answers questions from the company knowledge base (an Obsidian vault) and the web (Exa).
- **Purchasing** — orders things (e.g. team lunch) within a virtual-card limit, picking a *different* dish per person from their dietary needs and tastes, and pausing for **human approval** before spending.
- **Vulnerability response** — scans a project's dependencies, alerts Slack, files a Notion ticket, and opens a fix PR (a human merges).
- **Reporting** — summarises project status from sprint boards for leadership.

> POC status: the agent, the Obsidian knowledge base, **Exa** web search, and **Slack**
> (outbound) are wired for real. Stripe/merchant ordering is a deterministic **mock**, and
> Notion/GitHub are **stubs** returning placeholder data — each is swappable behind a stable
> interface without touching the agent.

---

## Architecture

```
            You ──▶ Admin Duty Agent (single agent, OpenAI Agents SDK)
                         │   model: AWS Bedrock via LiteLLM (default)
                         │   guardrail: prompt-injection screen
                         ▼
   ┌──────────────┬──────────────┬───────────────┬──────────────┐
   │  Knowledge   │  Purchasing  │ Vulnerability │  Reporting    │   ← tools
   │ vault + Exa  │ mock merchant│ Exa + stubs   │  stubs        │
   └──────────────┴──────┬───────┴───────────────┴──────────────┘
                         │  🔐 place_order → human-in-the-loop approval
                         ▼
              Obsidian vault · Exa · Slack · (Notion/GitHub/Stripe: stub/mock)
```

The agent is a **single** agent that owns every tool directly — no sub-agents/handoffs.
See [`brain_agents/README.md`](brain_agents/README.md) for the tool list and internals,
and [`merchant/README.md`](merchant/README.md) for the buyer-side ordering design.

## Quick start

```bash
pip install -r requirements.txt
cp .env.example .env        # then fill in your keys (see below)
python seed_vault.py        # generate the Obsidian vault (10 people)
python demo_agents.py       # offline: print the wired agent graph
python admin.py             # interactive: talk to the admin agent (needs model creds)
```

## Configuration (`.env`)

Secrets live only in `.env`, which is **gitignored**. Start from `.env.example`.

| Variable | Needed for |
|---|---|
| `BRAIN_MODEL_PROVIDER` | `bedrock` (default) or `openai` |
| `BRAIN_BEDROCK_MODEL`, `AWS_REGION_NAME`, AWS creds | model calls via Bedrock |
| `OPENAI_API_KEY` | model calls if provider = `openai` |
| `EXA_API_KEY` | real web search (vuln monitoring + lookups) |
| `SLACK_BOT_TOKEN` (`xoxb-…`) | posting to Slack (`chat:write`, `chat:write.public`) |

## Try it

```
$ python admin.py
admin> who on the tech team has a nut allergy, and where did they grow up?
admin> order lunch for the tech team, about $18 a head
  🔐 APPROVAL NEEDED — place_order {"merchant_id":"timbre-foodcourt", ...}
  Approve this spend? [y/N] y
  Ordered 4 different dishes for the tech team — total SGD 54.19.
```

Standalone demos (no LLM needed):

```bash
python demo_order_lunch.py   # vault → 4 distinct meals → mock order → delivery tracking
python send_slack_test.py    # post a test message to Slack
pytest -q                    # 25 tests
```

## HTTP API  (the contract for the frontend)

```bash
uvicorn api.app:app --reload          # serves the API + the demo page at /
```

| Endpoint | Body | Purpose |
|---|---|---|
| `GET /` | — | the demo frontend page |
| `GET /health` | — | liveness + doc count + backend |
| `POST /search` | `{query, limit?, domain?, sensitivity?}` | **keyword** search over the catalog (titles for everyone) |
| `POST /vsearch` | `{query, username?, k?}` | **semantic/vector** search over content, **access-filtered by role** |
| `POST /read` | `{username, doc_id}` | read one doc — **content gated by the user's role** (fail-closed) |
| `POST /upload` | multipart: `file, title?, domain?, sensitivity?` | upload text/MD/**PDF/DOCX** → convert → index (catalog + vector) |
| `POST /ingest` | `{doc_id, title, domain, sensitivity, content, …}` | index a doc from JSON |
| `POST /ask` | `{username, prompt}` | run the agent for a user (needs model creds) |

Users (for the access checks): `alice`=dev, `hannah`=hr, `evan`=csuite.

```bash
curl -s localhost:8000/health
curl -sX POST localhost:8000/vsearch -H 'content-type: application/json' \
     -d '{"query":"how much do engineers earn","username":"alice"}'   # restricted filtered out
curl -sX POST localhost:8000/read -H 'content-type: application/json' \
     -d '{"username":"alice","doc_id":"fy26-budget"}'                 # dev → gated; csuite → allowed
```

CORS is enabled, so a Vercel-hosted `frontend/index.html` can call this API directly.
Set `MONGODB_URI` (DocumentDB) and `KB_BACKEND=s3` + `KB_S3_BUCKET` to switch the local
mongomock + files backend to DocumentDB + S3 — no code changes.

## Project layout

```
brain_agents/   the Admin Duty Agent: config, context, tools, guardrails, runtime
brain_kb/       knowledge base: catalog (Mongo) + access-gated content (S3) +
                convert (pdf/docx) + vectorstore (Chroma + Bedrock embeddings)
api/            FastAPI app (search / vsearch / read / upload / ingest / ask)
frontend/       single-page upload + search UI (deploy to Vercel or served at /)
merchant/       buyer-side ordering: MerchantAdapter interface + mock + meal planner
infra/          Terraform (S3 + IAM + DocumentDB) and a local sample KB / access sim
vault/          Obsidian knowledge base (generated by seed_vault.py)
tests/          merchant, vault, spend-approval, KB-access/service, convert, API (48)
admin.py        interactive agent CLI (human-in-the-loop approval)
seed_vectors.py populate the vector DB from the sample KB (for /vsearch)
demo_*.py       runnable demos (lunch order, vector search)
```

## Deployment (step by step)

This deploys the production backend: **S3 + IAM** for content, **Amazon DocumentDB** for the
catalog/search, and the **FastAPI** app. Local dev needs none of this (mongomock + files).

### Prerequisites
- AWS account + credentials with S3, IAM, and DocumentDB rights
- A model provider: **AWS Bedrock** (a Claude model enabled in your region) *or* an OpenAI key
- Terraform ≥ 1.5, Python ≥ 3.11
- *(optional)* an Exa API key, a Slack app + bot token

### 1. Clone & install
```bash
git clone https://github.com/LGTM-superai/food-ordering.git
cd food-ordering
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

### 2. Provision S3 + IAM + DocumentDB (Terraform)
```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars      # set bucket_name; create_docdb=true + a password
terraform init
terraform plan
terraform apply
terraform output -json reader_access_keys         # dev / hr / csuite IAM keys
terraform output -json ingest_access_key          # ingest pipeline keys
terraform output docdb_endpoint                   # DocumentDB cluster endpoint
terraform output docdb_uri_template               # MONGODB_URI (substitute your password)
cd ../..
```
DocumentDB is **opt-in** — set `create_docdb = true` and `docdb_master_password` in
`terraform.tfvars`. It runs in your default VPC.

### 3. Get the DocumentDB CA bundle
DocumentDB requires TLS with the Amazon RDS CA bundle:
```bash
curl -s https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o infra/global-bundle.pem
```
DocumentDB is reachable **only inside its VPC** — run the app in the same VPC, or use an
SSH tunnel through a bastion for local dev.

### 4. Configure `.env`
```ini
# model
BRAIN_MODEL_PROVIDER=bedrock
BRAIN_BEDROCK_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0
AWS_REGION_NAME=us-east-1
AWS_ACCESS_KEY_ID=...            # or AWS_PROFILE / instance role
AWS_SECRET_ACCESS_KEY=...
# knowledge base → DocumentDB + S3
MONGODB_URI=mongodb://brainadmin:PASS@CLUSTER-ENDPOINT:27017/?tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false
MONGO_TLS_CA_FILE=infra/global-bundle.pem
KB_BACKEND=s3
KB_S3_BUCKET=<your bucket name>
KB_INGEST_ACCESS_KEY_ID=<from terraform ingest_access_key>
KB_INGEST_SECRET_ACCESS_KEY=<...>
# integrations (optional)
EXA_API_KEY=...
SLACK_BOT_TOKEN=xoxb-...
```

### 5. Load users (with their IAM keys) and ingest documents
Map each username to a role + the matching IAM keys from step 2:
```bash
python - <<'PY'
from brain_kb.config import build_service
from brain_kb.models import User
svc = build_service()
svc.users.upsert(User(username="alice",  role="dev",    aws_access_key_id="AKIA...DEV", aws_secret_access_key="..."))
svc.users.upsert(User(username="hannah", role="hr",     aws_access_key_id="AKIA...HR",  aws_secret_access_key="..."))
svc.users.upsert(User(username="evan",   role="csuite", aws_access_key_id="AKIA...CS",  aws_secret_access_key="..."))
print("users loaded")
PY
```
Ingest a document (writes the MD to S3 and upserts the catalog):
```bash
curl -sX POST localhost:8000/ingest -H 'content-type: application/json' -d '{
  "doc_id":"billing-api","title":"Billing API","domain":"engineering",
  "sensitivity":"internal","doc_types":["api-documentation"],
  "content":"# Billing API\nAuthenticate with BILLING_API_KEY ..."}'
```

### 6. Run the API
```bash
uvicorn api.app:app --host 0.0.0.0 --port 8000              # single process
uvicorn api.app:app --host 0.0.0.0 --port 8000 --workers 4  # production
```
For cloud: containerize and run on **ECS/Fargate, EKS, or EC2** behind an ALB, in the
**same VPC** as DocumentDB (it's VPC-only) and the same region as S3. Inject `.env`
values as task/secret env vars.

### 7. Verify
```bash
curl localhost:8000/health
curl -sX POST localhost:8000/read -H 'content-type: application/json' \
     -d '{"username":"alice","doc_id":"fy26-budget"}'    # dev → gated; csuite → allowed
```

### Security checklist
- Never commit `.env` or `*.tfstate` (both gitignored — they hold secrets).
- Prod: prefer **STS AssumeRole** over long-lived user keys; keep **DocumentDB** private to
  its VPC with a tight security group; **SSE-KMS** for the `restricted` tier; enable **CloudTrail**.

## Status & roadmap

- ✅ Single admin agent, Bedrock-via-LiteLLM, prompt-injection guardrail
- ✅ Obsidian vault knowledge base (real read/search) + 10 seeded people
- ✅ Constraint-aware team purchasing with human-in-the-loop spend approval (mock merchant)
- ✅ Exa web search (live) · Slack outbound (live)
- ✅ S3 + IAM knowledge base (Terraform) — tiered access by role (dev/hr/csuite)
- ✅ KB retrieval: catalog + access-gated reads (Case-B multi-file) + FastAPI
- ✅ Upload converter (text/Markdown/**PDF/DOCX** → Markdown)
- ✅ **Vector/semantic search** (ChromaDB + Bedrock Titan embeddings) with per-chunk access filtering
- ✅ Amazon DocumentDB cluster deployed (VPC-only) · real S3 bucket wired
- ⏳ Wire the KB search/read tools into the agent for `/ask`
- ⏳ Run the app in-VPC to use DocumentDB persistently (it's unreachable from a laptop)
- ⏳ Inbound Slack ("ask the bot in Slack") via Socket Mode
- ⏳ Real Notion / GitHub / Stripe Issuing integrations

> Security note: never commit `.env`. Treat retrieved notes and web results as untrusted
> data; spending is gated by code (the card limit + approval), not the model's judgement.
