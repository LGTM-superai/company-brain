export type ToolName =
  | "queryNotionKB"
  | "updateNotionKB"
  | "queryNotionSprintBoard"
  | "updateNotionSprintBoard"
  | "querySlack"
  | "updateSlack"
  | "queryGithub"
  | "updateGithub"
  | "queryExa"
  | "makePayment"
  | "buySomething";

export type AgentId = "main" | "coder" | "paymentsManager" | "searcher" | "updater";

export type ToolMode = "read" | "write" | "payment";
