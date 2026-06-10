import type { ToolDefinition } from "../types";
import { searchExa } from "../exa/exa-runtime";
import { chargeFoodOrder } from "./stripe-runtime";
import { getTeamProfile, buildSearchQuery, type TeamProfile, type TeamMember } from "./team-profiles";

export type FoodRecommendation = {
  restaurantName: string;
  url: string;
  reason: string;
  estimatedCostPerHead: string;
};

export type FoodLineItem = {
  person: string;
  item: string;
  priceCents: number;
  notes?: string;
};

export type FoodOrderResult = {
  team: TeamProfile;
  recommendations: FoodRecommendation[];
  budgetPerHeadCents: number;
  searchQuery: string;
  lineItems?: FoodLineItem[];
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
      excludeRestaurants,
    } = input as {
      teamName: string;
      budgetPerHeadCents?: number;
      confirm?: boolean;
      excludeRestaurants?: string[];
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

    const budget = budgetPerHeadCents ?? 2500;
    const query = buildSearchQuery(profile, budget, excludeRestaurants);

    const result: FoodOrderResult = {
      team: profile,
      recommendations: [],
      budgetPerHeadCents: budget,
      searchQuery: query,
    };

    if (confirm) {
      // Skip Exa search on confirm — recommendations were already shown in Phase 1
      const lineItems = generateLineItems(profile.members, budget);
      result.lineItems = lineItems;

      try {
        const totalCents = lineItems.reduce((sum, li) => sum + li.priceCents, 0);
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
    } else {
      // Phase 1: search Exa for restaurant recommendations
      try {
        const exaResults = await searchExa(query);
        result.recommendations = exaResults.map((r) => ({
          restaurantName: r.title,
          url: r.url,
          reason: r.summary,
          estimatedCostPerHead: `~$${(budget / 100).toFixed(0)}/person`,
        }));
      } catch {
        // Exa unavailable — we still return the team profile and constraints
      }
    }

    const summaryParts = [
      `Team "${teamName}" (${profile.headcount} people).`,
      `Dietary: ${profile.combinedDietary.join(", ") || "none"}.`,
      `Allergens to avoid: ${profile.combinedAllergens.join(", ") || "none"}.`,
    ];

    if (result.recommendations.length > 0) {
      summaryParts.unshift(`Found ${result.recommendations.length} restaurant(s).`);
    }

    if (result.payment) {
      summaryParts.push(
        `Payment of $${(result.payment.totalCents / 100).toFixed(2)} ${result.payment.status}.`,
      );
    }

    if (result.lineItems?.length) {
      summaryParts.push(`Items: ${result.lineItems.map((li) => `${li.person}: ${li.item}`).join("; ")}.`);
    }

    return {
      ok: true,
      tool: "buySomething",
      summary: summaryParts.join(" "),
      data: result,
    };
  },
};

const MENU_BY_DIET: Record<string, { items: { name: string; price: number }[] }> = {
  vegan: {
    items: [
      { name: "Impossible Rendang Bowl", price: 1890 },
      { name: "Avocado Poke Bowl (vegan)", price: 2100 },
      { name: "Tempeh Nasi Lemak", price: 1650 },
    ],
  },
  vegetarian: {
    items: [
      { name: "Paneer Tikka Masala with Naan", price: 1980 },
      { name: "Truffle Mushroom Pasta", price: 2200 },
      { name: "Thai Green Curry (tofu)", price: 1750 },
    ],
  },
  halal: {
    items: [
      { name: "Chicken Shawarma Plate", price: 1850 },
      { name: "Lamb Kofta with Hummus", price: 2400 },
      { name: "Nasi Briyani Ayam", price: 1690 },
    ],
  },
  pescatarian: {
    items: [
      { name: "Salmon Teriyaki Don", price: 2350 },
      { name: "Mediterranean Sea Bass", price: 2600 },
      { name: "Prawn Aglio Olio", price: 1980 },
    ],
  },
  gluten_free: {
    items: [
      { name: "Grilled Chicken Rice Bowl (GF)", price: 1790 },
      { name: "Thai Basil Chicken with Rice", price: 1650 },
      { name: "Vietnamese Pho (rice noodle)", price: 1550 },
    ],
  },
  default: {
    items: [
      { name: "Wagyu Beef Don", price: 2800 },
      { name: "Laksa with Prawns", price: 1590 },
      { name: "Chicken Katsu Curry", price: 1780 },
      { name: "BBQ Pulled Pork Burger", price: 1950 },
    ],
  },
};

function generateLineItems(members: TeamMember[], budgetPerHead: number): FoodLineItem[] {
  return members.map((member) => {
    const primaryDiet = member.dietary[0] ?? "default";
    const menu = MENU_BY_DIET[primaryDiet] ?? MENU_BY_DIET.default;
    const affordable = menu.items.filter((i) => i.price <= budgetPerHead);
    const pool = affordable.length > 0 ? affordable : menu.items;
    const pick = pool[Math.floor(Math.random() * pool.length)];

    const notes: string[] = [];
    if (member.allergens.length > 0) {
      notes.push(`No ${member.allergens.join(", ")}`);
    }
    if (member.dislikes.length > 0) {
      notes.push(`Avoids: ${member.dislikes.join(", ")}`);
    }

    return {
      person: member.name,
      item: pick.name,
      priceCents: pick.price,
      notes: notes.length > 0 ? notes.join(". ") : undefined,
    };
  });
}
