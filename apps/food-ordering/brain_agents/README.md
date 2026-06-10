# Company Brain — Admin Duty Agent (`brain_agents`)

A **single agent** built on the **OpenAI Agents SDK** (`openai-agents`, imports as
`agents`). This package is named `brain_agents` so it does **not** shadow the SDK's
top-level `agents` module.

The `orchestrator` (the "Admin Duty Agent") owns every tool directly — no sub-agents,
no handoffs. It picks the right tools per request, carries a `prompt_injection_guardrail`,
and pauses for human approval before spending.

## Tools

| Duty | Tools |
|---|---|
| **Knowledge** | `search_company_kb`, `read_note`, `web_search` |
| **Purchasing** | `lookup_team`, `plan_team_meal`, `find_restaurants`, `get_menu`, `place_order` 🔐 |
| **Vulnerability** | `list_dependencies`, `check_advisories`, `post_slack_alert`, `create_notion_ticket`, `open_fix_pull_request` |
| **Reporting** | `read_sprint_board`, `post_slack_message` |

🔐 `place_order` requires human-in-the-loop approval above the spend threshold.

## Model (AWS Bedrock by default)

Configured in [`config.py`](config.py) from env / `.env`:

```
BRAIN_MODEL_PROVIDER=bedrock                                   # default
BRAIN_BEDROCK_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0
AWS_REGION_NAME=us-east-1                                      # + AWS creds (env/profile/role)
```

Bedrock goes through **LiteLLM** (`agents.extensions.models.litellm_model.LitellmModel`).
Set `BRAIN_BEDROCK_MODEL` to whatever model/inference-profile your account has enabled.
To use OpenAI instead: `BRAIN_MODEL_PROVIDER=openai` + `BRAIN_AGENT_MODEL` + `OPENAI_API_KEY`.

## Structure

```
brain_agents/
├── config.py        # DEFAULT_MODEL + model settings
├── context.py       # BrainContext + integration clients + build_default_context()
├── vault.py         # ObsidianVault — real KB read/search
├── guardrails.py    # prompt-injection input guardrail
├── tools/           # @function_tool wrappers grouped by domain
├── orchestrator.py  # the single Admin Duty Agent (all tools) + ALL_AGENTS
└── runtime.py       # run_admin_turn — agentic loop with approval handling
```

`BrainContext` is the dependency bag (`Runner.run(..., context=ctx)`); tools reach
integrations via `wrapper.context`.

- **Knowledge base — real.** `vault.py`'s `ObsidianVault` reads and searches the
  Markdown vault in [`../vault/`](../vault) (generate it with `python seed_vault.py`:
  10 people, each a resume + a personal note with frontmatter). `get_team`,
  `get_person`, `search`, and `read_note` are genuine.
- **Purchasing — real adapter.** Wired to `MockMerchantAdapter`, so spending limits
  are genuinely enforced (`PaymentDeclined`). `plan_team_meal` gives each teammate a
  *different* dish based on their dietary needs + cuisine preferences from the vault.
- **Slack / Notion / GitHub / Exa — stubs** returning deterministic mock data; swap
  each for a real client without touching the tools or agents.

## Run it agentically (admin duty agent)

`admin.py` is an interactive loop: you type a duty in natural language, the agent
reasons, looks things up, and acts — delegating to the right specialist. It keeps
conversation memory (`SQLiteSession`) and **pauses for your approval before spending
money**.

```bash
pip install -r requirements.txt
export OPENAI_API_KEY=sk-...
python admin.py
```

```
admin> order lunch for the tech team, about $18 a head
  ┌─────────────────────────────────────────────
  │ 🔐 APPROVAL NEEDED — the agent wants to run: place_order
  │    arguments: {"merchant_id":"timbre-foodcourt","item_ids":[...]}
  └─────────────────────────────────────────────
  Approve this spend? [y/N] y
  Ordered 4 different dishes for the tech team — total SGD 54.19, ETA 35m.
```

### Human-in-the-loop spending

`place_order` carries `needs_approval`: spends **at or above** `auto_approve_under_cents`
(default SGD 30, on `BrainContext`) raise a tool-approval interruption.
`runtime.run_admin_turn` surfaces it to an `approve` callback, then resumes the same
run with the decision — so the agent acts autonomously but never moves money unattended.

### Programmatic

```python
from brain_agents import build_default_context, run_admin_turn
ctx = build_default_context(requester="ceo@company.com")
print(run_admin_turn("Order lunch for the tech team, ~$18 a head", ctx, approve=lambda i: True))
```

### Offline

```bash
python demo_agents.py     # no key -> prints the wired graph (agents, tools, approval gate)
```

## Production TODOs (scaffold → real)

- Replace stub clients in `context.py` with real Exa / Obsidian-MCP / Slack / Notion /
  GitHub clients.
- Harden `prompt_injection_guardrail` (classifier + content provenance); add an
  output guardrail on purchasing.
- Route approvals to Slack (Approve/Deny buttons) instead of the terminal, and gate the
  coding agent's PR merges the same way.
- Add tracing/audit export for every tool call that moves money or changes systems.
