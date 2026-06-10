export type ToolName =
  | "queryNotion"
  | "updateNotion"
  | "createNotionTicket"
  | "querySlack"
  | "updateSlack"
  | "queryGithub"
  | "updateGithub"
  | "queryExa"
  | "queryRepos"
  | "queryKnowledgeBase"
  | "queryTeamDietary"
  | "makePayment"
  | "buySomething";

export type AgentId = "main" | "coder" | "paymentsManager" | "searcher" | "updater";

export type ToolMode = "read" | "write" | "payment";
