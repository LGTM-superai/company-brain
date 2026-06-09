import type { AgentId, ToolName } from "./tool-types";
import type { PersonId } from "./users";

export const toolOwners: Record<ToolName, PersonId[]> = {
  queryNotionKB: ["carlos"],
  updateNotionKB: ["carlos"],
  queryNotionSprintBoard: ["edrick"],
  updateNotionSprintBoard: ["edrick"],
  querySlack: ["edrick"],
  updateSlack: ["edrick"],
  queryGithub: ["edrick", "darren"],
  updateGithub: ["edrick", "darren"],
  queryExa: ["laksh", "edrick"],
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
  searcher: ["queryNotionKB", "queryNotionSprintBoard", "querySlack", "queryGithub", "queryExa"],
  updater: ["updateNotionKB", "updateNotionSprintBoard", "updateSlack", "updateGithub"],
};
