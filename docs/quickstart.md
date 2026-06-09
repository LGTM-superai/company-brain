# Company Brain Quickstart

## Prerequisites

Use Bun. The repo is configured for:

```bash
bun@1.2.19
```

Check your version:

```bash
bun --version
```

## Install

From the repository root:

```bash
bun i
```

This installs the Next.js app and workspace packages:

```txt
apps/web
packages/agents
packages/tools
packages/shared
```

## Environment

Create a root `.env` file:

```bash
cp .env.example .env
```

Set:

```txt
MONGODB_URL=...
MONGODB_DB_NAME=company_brain
```

## Seed MongoDB

From the repository root:

```bash
bun run seed
```

This creates sample:

- users
- agents
- conversations
- messages
- knowledge graph nodes

## Run The App

From the repository root:

```bash
bun run dev
```

Open:

```txt
http://localhost:3000
```

The root script delegates to:

```bash
bun run --cwd apps/web dev
```

## Typecheck

Run:

```bash
bun run typecheck
```

This verifies the Next app and shared package imports compile.

## What Exists Right Now

This is a scaffold, not a fully wired agent runtime yet.

Implemented:

- agent registry
- tool registry
- tool ownership mapping
- tool prompt files
- agent prompt files
- shared streamed event schema
- Mongo-backed Next.js app
- Mongo-backed chat API route
- Mongo-backed knowledge graph page
- Mongo-backed users page

Not implemented yet:

- real LLM runtime
- Vercel AI SDK streaming
- real Notion/Slack/GitHub/Exa API calls
- real payment execution
- real approval workflow

## Verify Agents

Open the app:

```txt
http://localhost:3000
```

You should see the registered agents listed:

```txt
Company Brain Router - everyone
Coder - darren
Payments Manager - laksh
Searcher - everyone
Updater - everyone
```

Expected ownership:

```txt
coder -> darren
paymentsManager -> laksh
searcher -> everyone
updater -> everyone
```

## Verify Tools

The command center page should list the scaffolded tools.

Expected tools:

```txt
queryNotionKB
updateNotionKB
queryNotionSprintBoard
updateNotionSprintBoard
querySlack
updateSlack
queryGithub
updateGithub
queryExa
makePayment
buySomething
```

Expected ownership:

```txt
queryNotionKB, updateNotionKB -> carlos
queryNotionSprintBoard, updateNotionSprintBoard -> edrick
querySlack, updateSlack -> edrick
queryGithub, updateGithub -> edrick, darren
queryExa -> laksh, edrick
makePayment, buySomething -> laksh
```

## Verify The Chat API Scaffold

With the dev server running, call:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"conversationId":"conv-pistachio-launch-blocker","message":"What is blocking launch? Verify with Exa."}'
```

Expected shape:

```json
{
  "conversationId": "conv-pistachio-launch-blocker",
  "events": [
    { "type": "tool_call", "tool": "queryNotionSprintBoard" },
    { "type": "tool_call", "tool": "querySlack" },
    { "type": "tool_call", "tool": "queryExa" },
    {
      "type": "assistant_message",
      "content": "I checked the relevant company context and returned the most relevant current answer with source-aware routing."
    },
    { "type": "done" }
  ]
}
```

On Windows PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/chat -ContentType "application/json" -Body '{"conversationId":"conv-pistachio-launch-blocker","message":"What is blocking launch? Verify with Exa."}'
```

The route persists the user message, tool call lines, Exa result block, and assistant response into MongoDB.

## Verify The Knowledge Graph Page

Open:

```txt
http://localhost:3000/knowledge-graph
```

This is a placeholder for the derived graph over:

- Notion pages
- Notion sprint board tickets
- Slack threads
- GitHub issues and PRs
- Exa search results
- users

The graph should be treated as a derived view, not the source of truth.

## Verify The Users Page

Open:

```txt
http://localhost:3000/users
```

Expected users:

```txt
Edrick Kesuma - Lead Developer
Lakshya Agarwal - Design Lead / Payments Manager
Darren Prasetya - Coder Agent Owner
Carlos Vincent Frasenda - PM/Ops
```

## Where To Edit Prompts

Main router prompt:

```txt
packages/agents/src/main/prompt.md
```

Specialist prompts:

```txt
packages/agents/src/coder/prompt.md
packages/agents/src/payments-manager/prompt.md
packages/agents/src/searcher/prompt.md
packages/agents/src/updater/prompt.md
```

Tool prompts:

```txt
packages/tools/src/**/**/*.prompt.md
```

## Next Implementation Step

Wire `apps/web/app/api/chat/route.ts` to a real streaming agent runner.

Recommended event order:

```txt
Tool called: queryNotionSprintBoard
Tool called: querySlack
Tool called: queryExa

Exa search results

Company Brain: final answer
```

The shared event type is here:

```txt
packages/shared/src/agent-events.ts
```
