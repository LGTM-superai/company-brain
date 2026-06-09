import { createScaffoldTool } from "../scaffold";
import type { ToolDefinition } from "../types";

export const buySomething: ToolDefinition = {
  name: "buySomething",
  mode: "payment",
  owners: ["laksh"],
  allowedAgents: ["paymentsManager"],
  description: "Skeleton purchasing tool. Does not execute real purchases yet.",
  promptPath: "packages/tools/src/payments/buy-something.prompt.md",
  run: createScaffoldTool("buySomething", "Scaffolded purchasing action."),
};
