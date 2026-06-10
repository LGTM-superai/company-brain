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

  const cardholder = await stripe.issuing.cardholders.create({
    name: `Project: ${projectName}`,
    email: "brain-agent@company.com",
    phone_number: "+15555550100",
    status: "active",
    type: "individual",
    billing: {
      address: {
        line1: "1 Market St",
        city: "San Francisco",
        state: "CA",
        postal_code: "94105",
        country: "US",
      },
    },
    individual: {
      first_name: "Company",
      last_name: "Brain",
      dob: { day: 1, month: 1, year: 1990 },
      card_issuing: {
        user_terms_acceptance: {
          date: Math.floor(Date.now() / 1000),
          ip: "127.0.0.1",
        },
      },
    },
  });

  const card = await stripe.issuing.cards.create({
    cardholder: cardholder.id,
    currency,
    type: "virtual",
    status: "active",
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
): Promise<{ paymentIntentId: string; status: string }> {
  const stripe = getStripe();

  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency,
    description,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    metadata: { source: "company-brain", type: "food_order" },
  });

  return {
    paymentIntentId: intent.id,
    status: intent.status,
  };
}
