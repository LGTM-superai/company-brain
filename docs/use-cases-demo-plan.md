# Company Brain — Use Cases & Demo Flow

**Narrative arc:** Corporate → Utility → PM → Engineering → Autonomous Security

---

## 1. Team Dinner Ordering (Admin)

**Persona:** Admin / Office Manager

**Flow:**
1. User asks: "Order team dinner for tonight"
2. Bedrock routes to appropriate tools
3. Queries HR Knowledge Base → retrieves team dietary preferences/restrictions
4. Sends constraints to Exa → web search for restaurant/food suggestions
5. Presents recommendations to admin → admin picks
6. Re-prompts with per-person food breakdown → asks for confirmation
7. Back-and-forth until final confirmation
8. Triggers Stripe purchase against company admin budget
9. Transaction completes (simulated on Stripe)
10. Slack confirmation to team channel

**Integrations:** Bedrock, Knowledge Base, Exa, Stripe, Slack

---

## 2. Document Retrieval (General Employee)

**Persona:** Any team member

**Part A — Retrieval + Delivery:**
1. User asks: "Get me the onboarding folder"
2. System retrieves full folder from KB
3. Presents for download/view
4. Prompts: "Would you like me to send this to a Slack channel?"
5. On confirmation → delivers to Slack

**Part B — Access Denial (separate demo moment):**
1. User asks: "Get me the payroll documents"
2. System checks user identity/credentials
3. Returns: "You don't have access to the finance folder. Ask your admin."

**Integrations:** Bedrock, Knowledge Base, Slack, Identity/Auth

---

## 3. Sprint Board Management (PM)

**Persona:** PM / Tech Lead

**Part A — Status Read:**
1. User asks: "What's the sprint status?" or "Any blockers?"
2. Queries Notion sprint board
3. Returns: tasks in progress, completed, blocked, upcoming
4. Highlights blockers with assignees and days stalled

**Part B — Cross-tool Correlation (Sprint ↔ PRs):**
1. System links Notion blockers to GitHub PR state
2. Shows: "HB-204 is blocked — related PR #47 has been waiting on review for 3 days"
3. User can drill into PR or ask to ping reviewer

**Part C — Task Update:**
1. User says: "Move task X to done"
2. System asks for confirmation (human-in-the-loop)
3. Updates Notion board + posts audit to `#company-brain-actions`

**Integrations:** Bedrock, Notion (read + write), GitHub, Slack

---

## 4. PR Review Blockers (Engineering)

**Persona:** Engineer / Tech Lead

**Flow A — Blocker Resolution:**
1. User asks: "What PRs are blocked?"
2. Queries GitHub for stale PRs (pending reviews, conflicts, failing CI)
3. Cross-references with Notion sprint tickets
4. Returns: who's blocking, how long, linked ticket
5. User asks to ping → Slack message with @mention (human-in-the-loop)

**Flow B — Manual Vulnerability Check:**
1. User asks: "Check for vulnerabilities in our dependencies"
2. Exa searches for CVEs matching project dependencies
3. Returns: severity, affected packages, suggested fixes

**Integrations:** Bedrock, GitHub, Notion, Slack, Exa

---

## 5. CVE Monitoring + Auto-PR (Autonomous)

**Persona:** No one — fully autonomous, event-driven

**Flow:**
1. Exa stream-monitors for new CVEs relevant to project dependencies
2. Vulnerability detected → Slack notification to `#security`, @tags responsible engineer
3. Agent analyzes CVE against codebase
4. Creates code fix (dependency bump, patch, config change)
5. Opens PR on GitHub
6. Second Slack notification: "PR #XX created to fix CVE-YYYY — @engineer please review"
7. If breaking change → tags decision-maker, asks for approval before proceeding

**Fallback:** If automation not ready for demo, show manual version from Use Case 4 Flow B.

**Integrations:** Exa (streaming), Bedrock, GitHub, Slack

---

## Cross-Cutting: Identity & Auth

**Requirement:** Login page that establishes user identity and role.

**Current thinking:** AWS Cognito User Pools (email/password, no SSO)

**Where it shows in demo:**
- Doc retrieval: access denial for restricted folders
- Team dinner: only admin role can approve Stripe purchase
- Sprint: non-PM can read but not move tickets

**Alternatives to discuss:**
- AWS Cognito (simplest AWS-native)
- Amazon Verified Permissions (fine-grained policies)
- Lightweight JWT + user table (if Cognito overkill)
- Bedrock session attributes (role info per-session)

---

## Cross-Cutting: Vercel Showcase

**Problem:** Vercel is just hosting right now — need to show depth.

**Options:**
- Agent triggers/inspects Vercel preview deployments
- Sprint view shows deployment preview links per ticket
- PR blocker notifications include Vercel build status
- CVE fix PR auto-generates preview URL in Slack notification
- Vercel CI/CD sandbox for live demo

---

## Stack Coverage

| Use Case | Bedrock | KB/Notion | Exa | Stripe | Slack | GitHub | Vercel | Auth |
|---|---|---|---|---|---|---|---|---|
| 1. Team Dinner | ✅ | ✅ dietary | ✅ search | ✅ payment | ✅ confirm | - | - | ✅ admin gate |
| 2. Doc Retrieval | ✅ | ✅ fetch | - | - | ✅ delivery | - | - | ✅ denial |
| 3. Sprint Mgmt | ✅ | ✅ read+write | - | - | ✅ notify | ✅ PR link | ✅ preview | ✅ role gate |
| 4. PR Blockers | ✅ | ✅ cross-ref | ✅ vuln check | - | ✅ @ping | ✅ PRs | ✅ build status | - |
| 5. CVE Monitor | ✅ | - | ✅ stream | - | ✅ @tag x2 | ✅ auto-PR | ✅ preview URL | - |

---

## Demo Order (Recommended)

1. **Login** → show identity (sets up role-gating for later)
2. **Team Dinner** → relatable, touches most tools, ends with Slack confirmation
3. **Doc Retrieval A** → quick, shows KB + Slack
4. **Doc Retrieval B** → access denied, proves auth works
5. **Sprint Status** → Notion read + PR cross-link
6. **Sprint Update** → Notion write + audit notification
7. **PR Blockers** → GitHub + Slack pings
8. **Manual Vuln Check** → Exa security search (bridge to closer)
9. **CVE Auto-PR** → fully autonomous wow moment

---

## Open Questions for Team

- Auth approach: Cognito vs. lightweight JWT vs. Bedrock session attributes?
- Vercel: CI/CD sandbox access or just preview URL linking?
- Spending analytics post-dinner (MongoDB) — add or skip?
- CVE repo merge timeline — is it ready for demo day?
