# LGTM Company Knowledge Base

LGTM designs, builds, and launches high-converting landing pages for client businesses. The studio combines client discovery, brand direction, asset management, web implementation, QA, lead tracking, and payment operations into one coordinated launch workflow.

# Company Overview

LGTM helps clients ship polished landing pages without making the client manage separate tools for content, design assets, implementation status, payment links, and launch QA.

Current delivery focus: cafe and local-business landing pages.

Primary client workspace: Harbor Bean Cafe.

# Team

| Person | Email | Role | Ownership |
|---|---|---|---|
| Edrick Kesuma | edrickkesuma21@gmail.com | Lead Developer | Vercel frontend, website implementation, responsive sections, browser QA, sprint-board operations, Slack and GitHub integration |
| Lakshya Agarwal | alakshya2648@gmail.com | Design Lead / Payments Manager | Brand direction, typography, visual treatment, image crop review, payment-manager workflows, external research ownership |
| Darren Prasetya | darrenprasetya41@gmail.com | Backend/Data Developer | MongoDB lead metrics, Notion asset sync, knowledge-vault asset pipeline, code context, GitHub updates |
| Carlos Vincent Frasenda | c.frasenda10gmail.com | PM/Ops | Client brief, reservation-link follow-up, Notion knowledge base, client/project documentation, Stripe payment flow, launch coordination |

# Source Systems

- Notion: client briefs, Kanban tickets, launch copy, asset pages, payment approvals, and operating documentation.
- Slack: project discussion, nudges, approvals-in-context, stakeholder updates, and action notifications.
- MongoDB: landing-page leads, CTA clicks, menu downloads, contact form submissions, and inquiry metrics.
- Stripe: client launch deposit payment links and approved payment workflows.
- Vercel: deployed landing-page previews and production landing pages.
- Exa: external documentation, public-site retrieval, link extraction, and technical blocker validation.
- Browser automation: rendered-page QA, link checks, CTA checks, mobile layout checks, and screenshots.
- Knowledge vault: derived launch memory, asset notes, QA reports, summaries, and action logs.

# Operating Rules

- Notion remains canonical for project status, launch copy, client inputs, approvals, and asset references.
- Current ticket status must come from the active Notion Kanban board.
- Client brief and website copy must come from Notion before implementation or QA decisions.
- Lead metrics must come from MongoDB.
- Payment state must come from Stripe.
- Website launch readiness must be checked against the Notion brief and rendered website behavior.
- The knowledge vault is useful memory, but it must be refreshed from canonical tools when freshness matters.
- External mutations require an audit notification in `#company-brain-actions`.

# Client Workspace: Harbor Bean Cafe

Harbor Bean Cafe is the active landing-page client. The landing page supports reservations, menu discovery, opening-hours visibility, cafe location discovery, and private-event inquiries.

Canonical CTA: Reserve a table.

Brand direction:

- Warm neighborhood cafe.
- Calm morning energy.
- Simple typography.
- Soft earth tones.
- Food photography that feels real and client-provided rather than stock-like.

Current landing-page scope:

- Hero section with primary CTA.
- Opening hours and cafe address.
- Menu photo/image asset handling.
- Google Maps embed.
- Lead capture tracking in MongoDB.
- Vercel landing-page preview.
- Launch QA against the Notion brief and canonical website copy.

# Harbor Bean Sprint Board

Active Kanban columns:

- Not Started
- In Progress
- In Review
- Deployed

Current ticket snapshot:

| Code | Ticket | Status | Owner |
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

Current launch blockers:

- Final reservation or booking URL is still needed from Harbor Bean.
- Google Maps embed needs responsive mobile validation.
- Website CTA wording must stay aligned with the Notion canonical CTA: Reserve a table.

# Marketing & Assets

Marketing owns Harbor Bean launch copy, menu assets, image notes, and canonical website copy.

Important asset workflow:

- Client uploads menu photos and storefront images into Notion.
- Design reviews crop, color, and visual treatment.
- Data/Ops syncs useful asset metadata into the knowledge vault.
- Engineering uses the actual client-provided image assets when building or checking the page.
- Asset notes should include source page, last synced date, visible text, image purpose, and usage guidance.

# Finance & Ops

Finance & Ops owns client payment readiness and launch-payment workflows.

Harbor Bean payment workflow:

1. Pricing terms or deposit request are approved in Notion.
2. The payment manager checks for an existing Stripe payment link.
3. A human approves the final action.
4. Stripe creates the client payment link.
5. The action is posted to `#company-brain-actions`.
6. Payment state is logged back into launch memory.

Current known deposit request:

- Client: Harbor Bean Cafe
- Amount: 500 USD
- Reason: landing page launch deposit
- Approval source: Notion

# Company Brain Behavior

The Company Brain reads the right source, acts in the right tool, and leaves a clear audit trail.

Supported workflows:

- Summarize Harbor Bean landing-page progress from the Notion sprint board and project docs.
- Identify client-input, design, engineering, QA, asset, and payment blockers.
- Draft client follow-ups for missing launch inputs.
- Move Notion ticket status after resolving the exact ticket.
- Retrieve the latest Harbor Bean menu assets from Notion-derived memory and source pages.
- Check whether the public landing page matches Notion canonical copy.
- Validate technical blockers with external documentation and rendered browser checks.
- Query MongoDB lead metrics from approved templates.
- Create approved Stripe payment links after human approval.
- Update the Harbor Bean launch brief with the latest verified status.

External actions that require `#company-brain-actions` notification:

- Notion ticket status changes.
- Notion page comments or edits.
- Slack nudges or stakeholder messages.
- Stripe payment links, payouts, coupons, refunds, or onboarding links.

# Useful Launch Questions

1. How is the Harbor Bean landing page coming along?
2. What is blocking the Harbor Bean launch?
3. Draft a message to the cafe owner asking for the reservation link.
4. Move Edrick's hero section ticket to In Review.
5. Show me the latest menu photo for Harbor Bean.
6. Check whether the Harbor Bean website matches the Notion brief and whether links work.
7. Create the Stripe payment link for Harbor Bean's launch deposit.
8. Update the Harbor Bean launch brief with everything we know.
