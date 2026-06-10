import type { ToolDefinition } from "../types";
import { searchExa } from "../exa/exa-runtime";
import { chargeFoodOrder } from "./stripe-runtime";
import { getTeamProfile, buildSearchQuery, type TeamProfile } from "./team-profiles";

export type FoodRecommendation = {
  restaurantName: string;
  url: string;
  reason: string;
  estimatedCostPerHead: string;
};

export type FoodOrderResult = {
  team: TeamProfile;
  recommendations: FoodRecommendation[];
  budgetPerHeadCents: number;
  searchQuery: string;
  payment?: {
    totalCents: number;
    paymentIntentId: string;
    status: string;
  };
};

export const buySomething: ToolDefinition = {
  name: "buySomething",
  mode: "payment",
  owners: ["laksh"],
  allowedAgents: ["paymentsManager"],
  description:
    "Order food for a team. Reads team dietary profiles, searches Exa for restaurants matching constraints, and optionally charges via Stripe.",
  promptPath: "packages/tools/src/payments/buy-something.prompt.md",
  async run(input) {
    const {
      teamName,
      budgetPerHeadCents,
      confirm,
    } = input as {
      teamName: string;
      budgetPerHeadCents?: number;
      confirm?: boolean;
    };

    if (!teamName) {
      return { ok: false, tool: "buySomething", summary: "teamName is required." };
    }

    const profile = getTeamProfile(teamName);
    if (!profile) {
      return {
        ok: false,
        tool: "buySomething",
        summary: `Unknown team "${teamName}". Available: tech, product, design.`,
      };
    }

    const budget = budgetPerHeadCents ?? 1500;
    const query = buildSearchQuery(profile, budget);

    let recommendations: FoodRecommendation[] = [];
    try {
      const exaResults = await searchExa(query);
      recommendations = exaResults.map((r) => ({
        restaurantName: r.title,
        url: r.url,
        reason: r.summary,
        estimatedCostPerHead: `~$${(budget / 100).toFixed(0)}/person`,
      }));
    } catch {
      // Exa unavailable — we still return the team profile and constraints
    }

    const result: FoodOrderResult = {
      team: profile,
      recommendations,
      budgetPerHeadCents: budget,
      searchQuery: query,
    };

    if (confirm) {
      try {
        const totalCents = budget * profile.headcount;
        const paymentResult = await chargeFoodOrder(
          totalCents,
          `Team lunch: ${teamName} (${profile.headcount} people)`,
        );
        result.payment = {
          totalCents,
          paymentIntentId: paymentResult.paymentIntentId,
          status: paymentResult.status,
        };
      } catch {
        // Stripe unavailable — order proceeds without payment
      }
    }

    const summaryParts = [
      `Team "${teamName}" (${profile.headcount} people).`,
      `Dietary: ${profile.combinedDietary.join(", ") || "none"}.`,
      `Allergens to avoid: ${profile.combinedAllergens.join(", ") || "none"}.`,
    ];

    if (recommendations.length > 0) {
      summaryParts.unshift(`Found ${recommendations.length} restaurant(s).`);
    }

    if (result.payment) {
      summaryParts.push(
        `Payment of $${(result.payment.totalCents / 100).toFixed(2)} ${result.payment.status}.`,
      );
    }

    return {
      ok: true,
      tool: "buySomething",
      summary: summaryParts.join(" "),
      data: result,
    };
  },
};
