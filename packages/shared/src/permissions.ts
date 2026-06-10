import type { AgentId, ToolName } from "./tool-types";
import type { PersonId } from "./users";

export const toolOwners: Record<ToolName, PersonId[]> = {
  queryNotion: ["edrick"],
  updateNotion: ["edrick"],
  querySlack: ["edrick"],
  updateSlack: ["edrick"],
  queryGithub: ["edrick", "darren"],
  updateGithub: ["edrick", "darren"],
  queryExa: ["laksh", "edrick"],
  queryRepos: ["edrick", "darren"],
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
  searcher: ["queryNotion", "querySlack", "queryGithub", "queryExa", "queryRepos"],
  updater: ["updateNotion", "updateSlack", "updateGithub"],
};
