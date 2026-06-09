# Company Brain Architecture

## Shape

This repository uses a monorepo structure:

```txt
apps/
  web/                  # Next.js frontend and backend routes
packages/
  agents/               # agent definitions and prompts
  tools/                # tool definitions, skeleton handlers, and tool prompts
  shared/               # shared event, user, tool, and permission types
docs/
```

## Agent Pattern

The main Company Brain agent acts as a router. It should not carry every source-specific instruction.

Specialist agents own scoped behavior:

- Coder: code, repository, GitHub, debugging, and implementation tasks.
- Payments Manager: payment and purchasing flows.
- Searcher: read-only retrieval across Notion, Slack, GitHub, and Exa.
- Updater: external mutations across Notion, Slack, and GitHub.

## Tool Prompt Pattern

Each tool has two files:

```txt
tool-name.ts
tool-name.prompt.md
```

The TypeScript file defines:

- tool name
- read/write/payment mode
- owner
- allowed agents
- scaffolded handler
- prompt path

The prompt file defines how the tool should act once wired to the real API.

This keeps the main prompt small while allowing each integration to have precise behavior.

## Tool Call Events

The frontend should render agent events in order:

```txt
Tool called: queryNotion
Tool called: querySlack
Tool called: queryExa

Exa search results

Company Brain: ...
```

The shared event schema lives in:

```txt
packages/shared/src/agent-events.ts
```

## Mutation Rule

Every external mutation must:

- require approval
- update the external source
- post an audit message to `#company-brain-actions`
