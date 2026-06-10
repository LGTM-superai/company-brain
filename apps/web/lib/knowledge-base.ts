type AccessLevel = "public" | "internal" | "confidential" | "restricted";

type KBDocument = {
  id: string;
  title: string;
  domain: string;
  sensitivity: AccessLevel;
  content: string;
  summary: string;
  owner?: string;
  team?: string;
};

const ROLE_ACCESS: Record<string, AccessLevel[]> = {
  admin: ["public", "internal", "confidential", "restricted"],
  "lead developer": ["public", "internal", "confidential"],
  "design lead": ["public", "internal", "confidential"],
  "coder agent owner": ["public", "internal"],
  "pm/ops": ["public", "internal", "confidential"],
  engineer: ["public", "internal"],
  intern: ["public"],
};

const SAMPLE_KB: KBDocument[] = [
  {
    id: "company-overview",
    title: "Company Overview — Harbor Bean Cafe",
    domain: "general",
    sensitivity: "public",
    summary: "Harbor Bean is a specialty coffee chain in Singapore focused on third-wave coffee and community spaces.",
    content: `# Harbor Bean Cafe — Company Overview

Harbor Bean is a specialty coffee chain based in Singapore, founded in 2023. We operate 4 cafes across the CBD, Tiong Bahru, Holland Village, and Jurong East.

**Mission:** Make specialty coffee accessible to everyone in Singapore.

**Team size:** 45 (20 baristas, 10 kitchen, 8 tech, 4 product, 3 design)

**Tech stack:** Next.js, AWS, Vercel, Notion for project management, Slack for communication.

**Current sprint:** Harbor Bean landing page redesign (Project: Harbor Bean Cafe Website).`,
  },
  {
    id: "architecture",
    title: "System Architecture",
    domain: "engineering",
    sensitivity: "internal",
    summary: "Monorepo architecture with Next.js frontend, AWS backend, and multi-agent AI system.",
    content: `# System Architecture

## Stack
- Frontend: Next.js on Vercel
- Backend: AWS (DocumentDB, S3, Bedrock)
- AI: Multi-agent system with Vercel AI SDK
- Integrations: Notion, Slack, Exa, Stripe, GitHub

## Agent Architecture
- Router agent delegates to specialists (Searcher, Updater, Coder, Payments Manager)
- Each specialist has scoped tools and prompts
- All mutations require human approval
- Audit trail via #company-brain-actions Slack channel

## Data Flow
User → Router → Specialist → Tool (Notion/Slack/Exa/Stripe/GitHub) → Response → Audit`,
  },
  {
    id: "sprint-2026-06",
    title: "Sprint June 2026 — Harbor Bean Landing Page",
    domain: "product",
    sensitivity: "internal",
    summary: "Current sprint focused on landing page redesign with Google Maps embed, responsive layout, and reservation system.",
    content: `# Sprint June 2026: Harbor Bean Cafe Website

**Goal:** Ship the Harbor Bean landing page with maps, menu, and reservation flow.

**Key tickets:**
- HB-101: Add reservation URL and CTA button (blocked on client input)
- HB-102: Menu page with dietary filters
- HB-103: Mobile responsive layout
- HB-204: Google Maps iframe embed (technical blocker — aspect-ratio/overflow on mobile)
- HB-205: Reservation confirmation email

**Team assignments:** See Notion board for current assignees and status.
**Deadline:** June 20, 2026`,
  },
  {
    id: "billing-api",
    title: "Billing API Documentation",
    domain: "engineering",
    sensitivity: "internal",
    summary: "Internal billing API for subscription management and payment processing via Stripe.",
    content: `# Billing API

## Endpoints
- POST /api/billing/subscribe — Create new subscription
- POST /api/billing/charge — One-time charge (used by food ordering)
- GET /api/billing/usage — Current period usage
- POST /api/billing/budget — Allocate project budget (creates Stripe Issuing card)

## Integration
Uses Stripe in test mode (sk_test_*). Virtual cards are created per project with spending limits.

## Access
Only admin and PM roles can view billing. Engineers can trigger charges through the agent with approval.`,
  },
  {
    id: "fy26-budget",
    title: "FY26 Budget Allocation",
    domain: "business",
    sensitivity: "confidential",
    summary: "Annual budget breakdown including engineering costs, marketing spend, and team expenses.",
    content: `# FY26 Budget — Harbor Bean

**Total annual budget:** SGD 2.4M

## Breakdown
- Engineering & Infrastructure: SGD 800K (33%)
- Marketing & Events: SGD 400K (17%)
- Team food & activities: SGD 120K (5%)
- Coffee supplies & equipment: SGD 600K (25%)
- Rent & operations: SGD 480K (20%)

## Team meal budget
- Weekly team lunch: SGD 25/person
- Monthly team dinner: SGD 50/person
- Quarterly offsite: SGD 200/person

**Approval required for:** expenses over SGD 500/person, unbudgeted categories.`,
  },
  {
    id: "maya-krishnan",
    title: "Maya Krishnan — Employee Profile",
    domain: "people",
    sensitivity: "restricted",
    summary: "Personal details and dietary preferences for Maya Krishnan, Senior Backend Engineer.",
    content: `# Maya Krishnan — Employee Profile

**Role:** Senior Backend Engineer
**Team:** Tech
**Email:** maya@company.com

## Dietary Restrictions
- Vegan, gluten-free
- Allergens: peanuts, tree nuts
- Cuisine preferences: Healthy, South Indian
- Dislikes: red meat, heavy fried food

## Notes
Grew up in a vegetarian Tamil household in Bangalore. Became vegan in university. Serious nut allergy — reads every label.`,
  },
];

function getUserAccessLevel(username?: string): AccessLevel[] {
  if (!username) return ["public"];

  const userRoles: Record<string, string> = {
    edrick: "lead developer",
    laksh: "design lead",
    darren: "coder agent owner",
    carlos: "pm/ops",
    admin: "admin",
  };

  const role = userRoles[username.toLowerCase()] ?? "engineer";
  return ROLE_ACCESS[role] ?? ["public"];
}

export function queryKnowledgeBase(
  query: string,
  domain?: string,
  username?: string,
) {
  const allowedLevels = getUserAccessLevel(username);
  const queryLower = query.toLowerCase();

  const matches = SAMPLE_KB.filter((doc) => {
    if (domain && doc.domain !== domain) return false;

    const matchesQuery =
      doc.title.toLowerCase().includes(queryLower) ||
      doc.summary.toLowerCase().includes(queryLower) ||
      doc.content.toLowerCase().includes(queryLower) ||
      doc.domain.includes(queryLower);

    return matchesQuery;
  });

  const results = matches.map((doc) => {
    const hasAccess = allowedLevels.includes(doc.sensitivity);

    if (!hasAccess) {
      return {
        id: doc.id,
        title: doc.title,
        domain: doc.domain,
        sensitivity: doc.sensitivity,
        accessDenied: true,
        message: `Access denied. "${doc.title}" requires ${doc.sensitivity}-level access. Your role (${username ?? "anonymous"}) does not have permission. Contact your admin for access.`,
      };
    }

    return {
      id: doc.id,
      title: doc.title,
      domain: doc.domain,
      sensitivity: doc.sensitivity,
      accessDenied: false,
      summary: doc.summary,
      owner: doc.owner,
      team: doc.team,
      downloadUrl: `/api/kb/download/${encodeURIComponent(doc.id)}`,
    };
  });

  if (results.length === 0) {
    return {
      ok: true as const,
      tool: "queryKnowledgeBase",
      query,
      results: [],
      message: `No documents found matching "${query}"${domain ? ` in domain "${domain}"` : ""}.`,
    };
  }

  const denied = results.filter((r) => r.accessDenied);
  const accessible = results.filter((r) => !r.accessDenied);

  return {
    ok: true as const,
    tool: "queryKnowledgeBase",
    query,
    results: accessible,
    accessDenied: denied,
    message: accessible.length
      ? `Found ${accessible.length} document(s).${denied.length ? ` ${denied.length} document(s) require higher access.` : ""}`
      : `All ${denied.length} matching document(s) require higher access than your current role.`,
  };
}
