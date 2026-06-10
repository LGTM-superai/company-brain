import Stripe from "stripe";
import { getEnv } from "../env";

const STRIPE_TIMEOUT_MS = 15_000;

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = getEnv("STRIPE_SECRET_KEY") ?? getEnv("STRIPE_SECRET_TOKEN");
    if (!key) throw new Error("Missing required env var: STRIPE_SECRET_KEY");
    _stripe = new Stripe(key, { timeout: STRIPE_TIMEOUT_MS });
  }
  return _stripe;
}

export type BudgetAllocation = {
  projectId: string;
  amountCents: number;
  currency: string;
  cardId: string;
  status: "active" | "created";
};

export type FoodOrderResult = {
  orderId: string;
  merchantName: string;
  items: { name: string; priceCents: number; forPerson: string }[];
  totalCents: number;
  currency: string;
  paymentIntentId: string;
  status: "succeeded" | "requires_action";
};

export async function createProjectBudget(
  projectName: string,
  amountCents: number,
  currency = "usd",
): Promise<BudgetAllocation> {
  const stripe = getStripe();

  const financialAccount = await getOrCreateTreasuryAccount(stripe);

  const cardholder = await stripe.issuing.cardholders.create({
    name: `Project: ${projectName}`,
    email: "brain-agent@company.com",
    phone_number: "+15555550100",
    status: "active",
    type: "company",
    billing: {
      address: {
        line1: "1 Raffles Place",
        city: "Singapore",
        state: "SG",
        postal_code: "048616",
        country: "SG",
      },
    },
  });

  const card = await stripe.issuing.cards.create({
    cardholder: cardholder.id,
    currency,
    type: "virtual",
    status: "active",
    financial_account: financialAccount.id,
    spending_controls: {
      spending_limits: [{ amount: amountCents, interval: "all_time" }],
    },
  });

  return {
    projectId: projectName,
    amountCents,
    currency,
    cardId: card.id,
    status: "active",
  };
}

export async function distributeBudgetToProjects(
  totalCents: number,
  projects: { name: string; percentage: number }[],
  currency = "usd",
): Promise<BudgetAllocation[]> {
  const allocations: BudgetAllocation[] = [];

  for (const project of projects) {
    const projectAmount = Math.floor(totalCents * (project.percentage / 100));
    const allocation = await createProjectBudget(project.name, projectAmount, currency);
    allocations.push(allocation);
  }

  return allocations;
}

export async function chargeFoodOrder(
  amountCents: number,
  description: string,
  currency = "sgd",
): Promise<{ paymentIntentId: string; status: string; cardId?: string; financialAccount?: string }> {
  const stripe = getStripe();

  const financialAccount = await getOrCreateTreasuryAccount(stripe);
  const card = await getOrCreateIssuingCard(stripe, financialAccount.id, currency);

  const authorization = await stripe.testHelpers.issuing.authorizations.create({
    amount: amountCents,
    currency,
    card: card.id,
    merchant_data: {
      category: "eating_places_restaurants",
      name: description.slice(0, 25),
      network_id: "1234567890",
    },
  });

  if (authorization.status === "pending") {
    await stripe.testHelpers.issuing.authorizations.capture(authorization.id);
  }

  return {
    paymentIntentId: authorization.id,
    status: authorization.status === "pending" ? "succeeded" : authorization.status,
    cardId: card.id,
    financialAccount: financialAccount.id,
  };
}

async function getOrCreateTreasuryAccount(stripe: Stripe) {
  const existing = await stripe.treasury.financialAccounts.list({ limit: 1 });
  if (existing.data.length > 0) return existing.data[0];

  return stripe.treasury.financialAccounts.create({
    supported_currencies: ["sgd", "usd"],
    features: {
      card_issuing: { requested: true },
      financial_addresses: { aba: { requested: true } },
    },
  });
}

async function getOrCreateIssuingCard(stripe: Stripe, financialAccountId: string, currency: string) {
  const existingCards = await stripe.issuing.cards.list({
    status: "active",
    limit: 1,
  });

  if (existingCards.data.length > 0) return existingCards.data[0];

  let cardholder: Stripe.Issuing.Cardholder;
  const existingHolders = await stripe.issuing.cardholders.list({ limit: 1, status: "active" });

  if (existingHolders.data.length > 0) {
    cardholder = existingHolders.data[0];
  } else {
    cardholder = await stripe.issuing.cardholders.create({
      name: "Company Brain Treasury",
      email: "treasury@company.com",
      phone_number: "+15555550100",
      status: "active",
      type: "company",
      billing: {
        address: {
          line1: "1 Raffles Place",
          city: "Singapore",
          state: "SG",
          postal_code: "048616",
          country: "SG",
        },
      },
    });
  }

  return stripe.issuing.cards.create({
    cardholder: cardholder.id,
    currency,
    type: "virtual",
    status: "active",
    financial_account: financialAccountId,
    spending_controls: {
      spending_limits: [{ amount: 500_000, interval: "monthly" }],
      allowed_categories: ["eating_places_restaurants", "fast_food_restaurants"],
    },
  });
}
