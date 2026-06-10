import type { AgentId, ToolName } from "./tool-types";
import type { PersonId } from "./users";

export const toolOwners: Record<ToolName, PersonId[]> = {
  queryNotion: ["edrick"],
  updateNotion: ["edrick"],
  createNotionTicket: ["edrick"],
  querySlack: ["edrick"],
  updateSlack: ["edrick"],
  queryGithub: ["edrick", "darren"],
  updateGithub: ["edrick", "darren"],
  queryExa: ["laksh", "edrick"],
  queryRepos: ["edrick", "darren"],
  queryKnowledgeBase: ["everyone"],
  makePayment: ["laksh"],
  buySomething: ["laksh"],
};

export const agentOwners: Record<AgentId, PersonId[]> = {
  main: ["everyone"],
  coder: ["darren"],
  paymentsManager: ["laksh"],
  searcher: ["everyone"],
  updater: ["everyone"],
};

export const agentTools: Record<AgentId, ToolName[]> = {
  main: [],
  coder: ["queryGithub", "updateGithub"],
  paymentsManager: ["makePayment", "buySomething"],
  searcher: ["queryNotion", "querySlack", "queryGithub", "queryExa", "queryRepos", "queryKnowledgeBase"],
  updater: ["updateNotion", "createNotionTicket", "updateSlack", "updateGithub"],
};
