# Chat Intent Patterns

Regex patterns used in `apps/web/app/api/chat/route.ts` to route user messages to the correct tool/workflow.

## Exa Use Cases

| Use Case | Pattern | Triggers |
|----------|---------|----------|
| Verification | `/verify\|is it true\|fact.?check\|confirm that\|evidence for/i` | "Verify that Next.js 15 supports after()" |
| Research | `/how (do\|to\|can)\|find docs\|documentation\|tutorial\|explain how/i` | "Find docs on Bun test runner" |
| CVE | `/cve\|vulnerability\|security (issue\|flaw\|bug)\|exploit\|advisory/i` | "What's the latest on CVE-2024-21538?" |
| News | `/news\|market\|competitor\|recent.*(article\|report)\|industry/i` | "Any recent news on Vercel?" |

**Fallback**: If none of the 4 above match but the generic pattern does, defaults to **research**.

Generic pattern: `/exa|verify|external|docs|vulnerability|public|block/i`

## Other Routing

| Intent | Pattern | Tools Triggered |
|--------|---------|-----------------|
| Repo Monitors | `/repo monitor\|cve\|vulnerability monitor\|package\.json\|dependencies audit/i` | `queryRepos` → repo_monitors event |
| Updates | `/move\|update\|send\|assign\|change\|post/i` | `updateNotion`, `updateSlack` |
| GitHub | message includes `github` or `code` | `queryGithub` |

## Priority

Patterns are evaluated independently (not mutually exclusive). A single message can trigger multiple tools. For example, "verify this CVE vulnerability" would match both `verification` (Exa) and `repo monitors`.

The Exa use case check uses first-match priority: verification > research > cve > news > generic fallback.
