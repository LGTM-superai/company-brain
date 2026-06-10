import type { ToolDefinition } from "../types";
import { createProjectBudget, distributeBudgetToProjects } from "./stripe-runtime";

export const makePayment: ToolDefinition = {
  name: "makePayment",
  mode: "payment",
  owners: ["laksh"],
  allowedAgents: ["paymentsManager"],
  description:
    "Allocate a budget to a project via Stripe Issuing virtual card, or distribute a total budget across multiple projects by percentage.",
  promptPath: "packages/tools/src/payments/make-payment.prompt.md",
  async run(input) {
    const {
      action,
      projectName,
      amountCents,
      currency,
      projects,
    } = input as {
      action: "setBudget" | "distributeBudget";
      projectName?: string;
      amountCents: number;
      currency?: string;
      projects?: { name: string; percentage: number }[];
    };

    if (!amountCents || amountCents <= 0) {
      return { ok: false, tool: "makePayment", summary: "amountCents must be a positive integer." };
    }

    try {
      if (action === "distributeBudget") {
        if (!projects || projects.length === 0) {
          return { ok: false, tool: "makePayment", summary: "projects array is required for distributeBudget." };
        }
        const totalPct = projects.reduce((sum, p) => sum + p.percentage, 0);
        if (totalPct > 100) {
          return { ok: false, tool: "makePayment", summary: `Percentages total ${totalPct}% (max 100%).` };
        }

        const allocations = await distributeBudgetToProjects(amountCents, projects, currency);
        const summaryLines = allocations
          .map((a) => `${a.projectId}: $${(a.amountCents / 100).toFixed(2)}`)
          .join(", ");

        return {
          ok: true,
          tool: "makePayment",
          summary: `Distributed $${(amountCents / 100).toFixed(2)} across ${allocations.length} projects: ${summaryLines}`,
          data: { action: "distributeBudget", allocations },
        };
      }

      if (!projectName) {
        return { ok: false, tool: "makePayment", summary: "projectName is required for setBudget." };
      }

      const allocation = await createProjectBudget(projectName, amountCents, currency);
      return {
        ok: true,
        tool: "makePayment",
        summary: `Budget of $${(amountCents / 100).toFixed(2)} allocated to "${projectName}" (card ${allocation.cardId.slice(-8)}).`,
        data: { action: "setBudget", allocation },
      };
    } catch (error) {
      return {
        ok: false,
        tool: "makePayment",
        summary: `Stripe error: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
};
