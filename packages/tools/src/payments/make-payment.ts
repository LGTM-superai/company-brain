import { createScaffoldTool } from "../scaffold";
import type { ToolDefinition } from "../types";

export const makePayment: ToolDefinition = {
  name: "makePayment",
  mode: "payment",
  owners: ["laksh"],
  allowedAgents: ["paymentsManager"],
  description: "Skeleton payment disbursement tool. Does not execute real payments yet.",
  promptPath: "packages/tools/src/payments/make-payment.prompt.md",
  run: createScaffoldTool("makePayment", "Scaffolded payment disbursement."),
};
