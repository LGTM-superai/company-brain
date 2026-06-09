# LGTM Cafe Launch Room Hackathon Plan

## Summary

LGTM is a fictional landing-page studio for cafes. The hackathon project is **Cafe Launch Room**, an agentic company-brain workflow that helps LGTM ship a client cafe landing page by coordinating Notion, Slack, MongoDB, Exa, Stripe, Vercel, browser automation, and a derived knowledge vault.

The demo client is **Harbor Bean Cafe**.

The core product is not a generic chatbot. It is a launch operator for a cafe website project:

```text
Cafe Launch Room = source router + action agent + launch memory
```

It answers:

```text
Is this cafe landing page ready to launch?
If not, what is blocked, who owns it, what should we do next, and can you take the approved action?
```

## Current Team

| Person | Email | Role |
|---|---|---|
| Edrick Kesuma | edrickkesuma21@gmail.com | Lead Developer |
| Lakshya Agarwal | alakshya2648@gmail.com | Design Lead |
| Darren Prasetya | darrenprasetya41@gmail.com | Backend/Data Developer |
| Carlos Vincent Frasenda | c.frasenda10gmail.com | PM/Ops and Client Comms |

Role split:

- **Edrick** owns Vercel frontend, website implementation, responsive sections, and browser QA fixes.
- **Lakshya** owns brand direction, typography, cafe visual treatment, and image crop review.
- **Darren** owns MongoDB lead metrics, Notion asset sync, and the knowledge-vault asset pipeline.
- **Carlos** owns client brief, reservation-link follow-up, Stripe payment flow, and launch coordination.

Note: Carlos's email is intentionally recorded exactly as provided. Validate it before sending real email.

## Source Systems

Canonical sources:

- **Notion**: client brief, Kanban sprint board, launch copy, asset pages, payment approvals.
- **Slack**: project discussion, nudges, action notifications.
- **MongoDB**: landing-page leads, CTA clicks, menu downloads, inquiry metrics.
- **Stripe**: client launch deposit payment links and demo-safe financial workflows.
- **Vercel**: deployed landing-page preview.
- **Exa**: external documentation, public site retrieval, link extraction, and blocker validation.
- **Browser automation**: interactive website testing such as clicking links, checking rendered pages, and screenshots.
- **Knowledge vault**: derived memory, launch brief, asset notes, QA reports, and action logs.

## Notion Workspace

Root page:

[LGTM Notion root](https://app.notion.com/p/3791796ed79a808bb8b0f8cee524349f)

Main pages:

- Company Handbook - LGTM Cafe Studio
- Product & Engineering - Cafe Landing Pages
- Sprint Board - Harbor Bean Landing Page
- Marketing & Launch - Harbor Bean
- Finance & Ops - Cafe Launches
- Company Brain Agent Manual - Cafe Launch Room

Real Kanban database:

[Harbor Bean Landing Page Kanban](https://app.notion.com/p/d42b31c6bb0f4d28aa525dbf40c7f70d)

Kanban columns:

- Not Started
- In Progress
- In Review
- Deployed

Kanban properties:

- Ticket title
- Ticket code
- Status
- Assignee
- Assignee Email
- Role
- Priority
- Workstream
- Client
- Due Date
- Blocked Reason
- Needs Action Notify
- Source URL

Representative tickets:

| Code | Ticket | Status | Assignee |
|---|---|---|---|
| HB-101 | Collect final reservation link from Harbor Bean | Not Started | Carlos |
| HB-201 | Build hero and opening-hours section | In Progress | Edrick |
| HB-202 | Design menu photo treatment and responsive crop | In Progress | Lakshya |
| HB-203 | Sync Harbor Bean menu photo into knowledge vault | In Progress | Darren |
| HB-204 | Validate map embed issue with Exa docs search | In Progress | Edrick |
| HB-301 | Cafe brand direction and typography | In Review | Lakshya |
| HB-302 | Client brief and launch copy | In Review | Carlos |
| HB-303 | Lead form MongoDB tracking template | In Review | Darren |
| HB-401 | Harbor Bean launch brief v1 | Deployed | Carlos |
| HB-402 | Landing page shell deployed to Vercel preview | Deployed | Edrick |

## Provider Surface

Use the Scout-style pattern: each source exposes a tiny natural-language surface.

```text
query_notion
update_notion
query_slack
update_slack
query_mongo
query_exa
query_stripe
update_stripe
query_knowledge
update_knowledge
notify_action
browser_verify_site
list_contexts
```

Provider responsibilities:

- `query_notion`: read client brief, Kanban tickets, launch copy, asset pages, payment approvals.
- `update_notion`: move ticket status, add comments, update docs.
- `query_slack`: read selected project channels and action history.
- `update_slack`: send approved nudges or stakeholder updates.
- `query_mongo`: use approved lead-metric aggregation templates.
- `query_exa`: validate technical blockers and fetch/crawl public website content.
- `query_stripe`: inspect payment-link state or connected-account readiness.
- `update_stripe`: create approved test-mode payment links or demo-safe payouts.
- `query_knowledge`: search derived launch memory and synced assets.
- `update_knowledge`: write launch brief, QA report, asset note, and action log.
- `notify_action`: post external mutation audits to `#company-brain-actions`.
- `browser_verify_site`: click website links and verify rendered behavior.

## Knowledge Vault

The knowledge vault is derived memory, not the source of truth.

Recommended structure:

```text
knowledge-vault/
  index.md
  log.md
  Clients/
    Harbor Bean Cafe/
      Launch Brief.md
      Website QA Report.md
      Lead Metrics.md
      Payment State.md
      Assets/
        Menu Photo.md
        Storefront Photo.md
  Assets/
    notion/
      harbor-bean/
        menu-photo.jpg
        storefront.jpg
```

Use it for:

- launch status summaries
- current blockers
- source links
- OCR/image summaries
- QA findings
- payment-action logs
- action notifications

Do not use it as canonical truth. Re-check Notion, MongoDB, Stripe, Vercel, or Slack when freshness matters.

## Design Rules

1. Existing tools stay canonical.
2. The agent uses the smallest necessary provider set.
3. The agent cites sources.
4. Current status comes from the Notion Kanban board.
5. Client brief and website copy come from Notion.
6. Lead metrics come from MongoDB.
7. Payment state comes from Stripe.
8. Exa validates external technical docs and fetches public website content.
9. Browser automation verifies interactive website behavior.
10. External mutations require notification to `#company-brain-actions`.
11. Ambiguous actions require clarification.
12. If sources conflict, show the conflict.

## External Action Notification Rule

Any external mutation must call `notify_action` after success.

External mutations include:

- Notion ticket status changes.
- Notion page comments or edits.
- Slack nudges or stakeholder messages.
- Stripe payment links, payouts, coupons, refunds, or onboarding links.

External mutations do not include:

- `update_knowledge`
- read-only provider calls
- `notify_action` itself

Notification target:

```text
#company-brain-actions
```

Notification format:

```text
[Company Brain Action]
Actor: <user>
Action: <short action>
System: <Notion | Slack | Stripe>
Target: <ticket/page/channel/account/etc.>
Result: <success/failure/id>
Reason: <user request or agent recommendation>
Source run: <run id or knowledge log link>
```

Example:

```text
[Company Brain Action]
Actor: Carlos
Action: Moved ticket to In Review
System: Notion
Target: HB-201 - Build hero and opening-hours section
Result: Success
Reason: User requested ticket status update
Source run: Harbor Bean launch log, 2026-06-08
```

## Use Cases

### 1. Landing Page Project Status

User:

```text
How is the Harbor Bean landing page coming along?
```

Agent behavior:

- `query_knowledge`: check existing Harbor Bean launch brief.
- `query_notion`: read Harbor Bean Kanban board and client brief.
- `query_slack`: inspect recent project discussion if available.

Expected answer:

```text
Harbor Bean is moving, but not launch-ready yet.

Deployed:
- Launch brief v1
- Landing page shell

In Review:
- Brand direction
- Client brief and launch copy
- Lead tracking template

In Progress:
- Hero and opening-hours section
- Menu photo treatment
- Menu asset sync
- Map embed validation

Main blocker: the reservation link is still missing from the client.
Technical risk: the Google Maps embed is not responsive on mobile.
```

Follow-up:

```text
Who should I follow up with?
```

Expected answer:

```text
Follow up with Carlos for the client reservation link, and with Edrick on the map embed issue.
Carlos owns HB-101, which is still Not Started and marked as needing action notification if a nudge is sent.
```

### 2. Blocker Detection + Exa Validation

User:

```text
What is blocking the Harbor Bean launch?
```

Agent behavior:

- `query_notion`: inspect Kanban tickets and blocked reasons.
- `query_slack`: search project discussion for stale/unstated blockers.
- `query_exa`: validate technical blockers against external docs.

Expected answer:

```text
There are two launch blockers.

1. Confirmed client-input blocker:
The reservation link is missing. HB-101 is Not Started and Carlos owns the client follow-up.

2. Technical blocker:
The Google Maps embed is not responsive on mobile. Exa docs search suggests this is likely a responsive iframe/container issue rather than a vendor outage, so it should be fixable.
```

Follow-up:

```text
What should I send Edrick?
```

Expected draft:

```text
Hey Edrick, quick check on HB-204. I found that the map issue is likely a responsive iframe/container problem. Can you wrap the map embed in an aspect-ratio container and verify it on mobile before QA?
```

### 3. Owner Nudge

User:

```text
Draft a message to the cafe owner asking for the reservation link.
```

Agent behavior:

- `query_notion`: read Harbor Bean client brief and HB-101.
- Draft a concise client message.
- If the user asks to send it, `update_slack` or email integration sends it, then `notify_action`.

Expected draft:

```text
Hi Harbor Bean team, quick check: could you send the final reservation or booking link for the landing page? We need it to finish the primary CTA before launch QA.
```

### 4. Sprint Board Action

User:

```text
Move Edrick's hero section ticket to In Review.
```

Agent behavior:

- `query_notion`: resolve exact ticket: `HB-201 - Build hero and opening-hours section`.
- `update_notion`: set Status from `In Progress` to `In Review`.
- `update_knowledge`: append to Harbor Bean launch log.
- `notify_action`: post to `#company-brain-actions`.

Expected answer:

```text
Moved HB-201, "Build hero and opening-hours section", from In Progress to In Review and posted the action notification to #company-brain-actions.
```

Follow-up:

```text
What changed after that?
```

Expected answer:

```text
Edrick's hero section work is now In Review. Harbor Bean has one fewer In Progress ticket. The remaining launch blockers are the reservation link and the map embed QA issue.
```

### 5. Cafe Asset Retrieval

User:

```text
Show me the latest menu photo for Harbor Bean.
```

Agent behavior:

- `query_knowledge`: search asset notes.
- If stale/missing, `query_notion`: read Harbor Bean Menu Photo Assets page.
- Download image/file blocks before temporary Notion file URLs expire.
- `update_knowledge`: write image metadata, OCR text, and source citation.
- Return the actual image.

Expected answer:

```text
Found the latest Harbor Bean menu photo from the Notion asset page.

Source: Harbor Bean Menu Photo Assets
Last synced: 2026-06-08

[image returned]
```

Follow-up:

```text
What text is visible in the menu photo?
```

Expected answer:

```text
The menu photo includes espresso, cappuccino, iced latte, matcha latte, banana bread, and croissant items.
```

### 6. Website Content And Link QA

User:

```text
Check whether the Harbor Bean website matches the Notion brief and whether the links work.
```

Agent behavior:

- `query_notion`: read Harbor Bean Client Brief and Website Canonical Copy.
- `query_exa`: fetch/crawl public Vercel website text, links, and image links.
- `browser_verify_site`: click primary nav and CTA links, verify rendered behavior.
- Optional code check: inspect route/config files.
- `update_knowledge`: write QA report.

Expected answer:

```text
I found 3 launch QA issues.

1. CTA mismatch:
Notion says "Reserve a table"; website says "Join waitlist".

2. Missing reservation link:
The primary CTA has no final URL because the client has not sent it yet.

3. Mobile map issue:
The Google Maps embed overflows the mobile viewport. This appears to be a responsive iframe/container issue.
```

If the user asks to comment in Notion or message Slack, the agent must call `notify_action`.

### 7. Cafe Lead Metrics

User:

```text
How many leads has the Harbor Bean preview page captured?
```

Agent behavior:

- `query_notion`: read Landing Page Leads Data Contract.
- `query_mongo`: run approved aggregation template.
- `update_knowledge`: optionally update Lead Metrics page.

Example Mongo collections:

```text
landing_page_leads
reservation_clicks
contact_form_submissions
menu_downloads
```

Expected answer:

```text
The Harbor Bean preview page has captured 42 leads this week:
- 31 newsletter signups
- 8 private-event inquiries
- 3 catering/contact submissions

I used the approved "Count leads by event type" aggregation template.
```

### 8. Client Payment Link

User:

```text
Create the Stripe payment link for Harbor Bean's launch deposit.
```

Agent behavior:

- `query_notion`: read Harbor Bean Launch Deposit Request.
- `query_stripe`: check whether a payment link already exists.
- Ask for human approval.
- `update_stripe`: create test-mode payment link.
- `update_knowledge`: log payment state.
- `notify_action`: post to `#company-brain-actions`.

Expected pre-approval response:

```text
I found an approved launch deposit request for Harbor Bean.

Amount: 500 USD
Reason: landing page launch deposit
Approval source: Notion - Harbor Bean Launch Deposit Request

Create the Stripe test-mode payment link?
```

Expected post-action response:

```text
Created the Stripe test-mode payment link for Harbor Bean's 500 USD launch deposit and posted the action notification to #company-brain-actions.
```

### 9. Launch Brief Update

User:

```text
Update the Harbor Bean launch brief with everything we know.
```

Agent behavior:

- `query_notion`: current Kanban status, brief, assets, payment approvals.
- `query_mongo`: latest lead metrics if requested.
- `query_knowledge`: previous launch brief.
- `update_knowledge`: write current launch summary.

Knowledge output should include:

- launch status
- blockers
- owners
- latest assets
- website QA state
- lead metrics
- payment state
- external action log

## Stage Demo Script

Recommended live sequence:

```text
1. How is the Harbor Bean landing page coming along?
2. What is blocking the Harbor Bean launch?
3. Draft a message to the cafe owner asking for the reservation link.
4. Move Edrick's hero section ticket to In Review.
5. Show me the latest menu photo for Harbor Bean.
6. Check whether the Harbor Bean website matches the Notion brief and whether the links work.
7. Create the Stripe payment link for Harbor Bean's launch deposit.
8. Update the Harbor Bean launch brief with everything we know.
```

This demonstrates:

- reading a real Notion Kanban board
- reasoning over semi-structured docs
- validating a technical blocker with Exa
- updating a ticket
- notifying an audit channel
- retrieving a visual asset
- testing a deployed website
- querying business metrics
- creating a Stripe payment link
- maintaining derived launch memory

## What To Cut For The Hackathon

Do not build:

- full permissions model
- Slack DMs
- full Notion workspace crawler
- arbitrary MongoDB query generation
- real payroll
- production payment flows
- complex background sync
- multi-user memory

Build:

- one cafe client
- one Notion Kanban database
- selected Notion docs/assets
- one Slack action channel
- one MongoDB lead metrics collection
- one Stripe test-mode payment link flow
- one Exa blocker-validation flow
- one browser QA flow
- one knowledge-vault launch brief

## Success Criteria

The demo should make the audience feel:

```text
LGTM can ask one agent about a client landing-page launch, and it knows where to look, what is blocked, who owns it, what action is safe, and how to keep launch memory up to date.
```

