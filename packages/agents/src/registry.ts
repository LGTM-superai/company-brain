import { agentTools } from "@company-brain/shared";
import type { AgentDefinition } from "./types";

export const agentRegistry: Record<string, AgentDefinition> = {
  main: {
    id: "main",
    name: "Company Brain Router",
    owner: "everyone",
    purpose: "Route requests to specialist agents without carrying every source-specific instruction in the main prompt.",
    tools: agentTools.main,
    promptPath: "packages/agents/src/main/prompt.md",
  },
  coder: {
    id: "coder",
    name: "Coder",
    owner: "darren",
    purpose: "Handle coding, repository, GitHub, debugging, and implementation-related tasks.",
    tools: agentTools.coder,
    promptPath: "packages/agents/src/coder/prompt.md",
  },
  paymentsManager: {
    id: "paymentsManager",
    name: "Payments Manager",
    owner: "laksh",
    purpose: "Handle payment and purchasing workflows through scaffolded payment tools.",
    tools: agentTools.paymentsManager,
    promptPath: "packages/agents/src/payments-manager/prompt.md",
  },
  searcher: {
    id: "searcher",
    name: "Searcher",
    owner: "everyone",
    purpose: "Retrieve context from company and external data sources without modifying them.",
    tools: agentTools.searcher,
    promptPath: "packages/agents/src/searcher/prompt.md",
  },
  updater: {
    id: "updater",
    name: "Updater",
    owner: "everyone",
    purpose: "Modify external systems after evidence gathering and approval.",
    tools: agentTools.updater,
    promptPath: "packages/agents/src/updater/prompt.md",
  },
};
