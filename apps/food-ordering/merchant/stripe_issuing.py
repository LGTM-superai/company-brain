"""Stripe Issuing — virtual cards with spending limits for agent purchases.

Each agent gets a **virtual card** with a spending limit and food-only MCC categories.
Placing an order creates a Stripe **authorization** on the card; Stripe's spending
controls enforce the limit (it declines over-limit or wrong-category charges in real
time). Because our merchant is a mock (no real card-present checkout), we use Stripe's
test-mode test helpers to simulate the merchant authorization.

Requires STRIPE_API_KEY (sk_test_...) on an account with Issuing enabled.
"""

from __future__ import annotations

import os
import time

# MCC categories an agent card is allowed to spend on (food only) — valid Stripe values.
FOOD_CATEGORIES = [
    "eating_places_restaurants",
    "fast_food_restaurants",
    "caterers",
    "bakeries",
    "grocery_stores_supermarkets",
]


class StripeIssuing:
    def __init__(self, api_key: str | None = None, currency: str | None = None) -> None:
        import stripe
        self._s = stripe
        self._s.api_key = api_key or os.environ["STRIPE_API_KEY"]
        self.currency = (currency or os.environ.get("STRIPE_CARD_CURRENCY", "usd")).lower()

    def create_virtual_card(self, name: str = "Company Brain Agent",
                            limit_cents: int = 10_000) -> str:
        """Create a cardholder + virtual card with an all-time spending limit. Returns card id."""
        ch = self._s.issuing.Cardholder.create(
            name=name, email="agent@company.com", phone_number="+15555550123",
            status="active", type="individual",
            billing={"address": {"line1": "1 Market St", "city": "San Francisco",
                                  "state": "CA", "postal_code": "94105", "country": "US"}},
            individual={
                "first_name": name.split()[0], "last_name": name.split()[-1],
                "dob": {"day": 1, "month": 1, "year": 1990},
                # the cardholder must accept Stripe's Authorized User Terms to be issued a card
                "card_issuing": {"user_terms_acceptance": {
                    "date": int(time.time()), "ip": "8.8.8.8"}},
            },
        )
        card = self._s.issuing.Card.create(
            cardholder=ch.id, currency=self.currency, type="virtual", status="active",
            spending_controls={
                "spending_limits": [{"amount": limit_cents, "interval": "all_time"}],
                "allowed_categories": FOOD_CATEGORIES,
            },
        )
        return card.id

    def card_details(self, card_id: str) -> dict:
        """Card metadata + the PAN/CVC (test mode only)."""
        c = self._s.issuing.Card.retrieve(card_id, expand=["number", "cvc"])
        limit = c.spending_controls.spending_limits[0].amount if c.spending_controls.spending_limits else None
        return {
            "id": c.id, "last4": c.last4, "brand": c.brand,
            "exp_month": c.exp_month, "exp_year": c.exp_year,
            "number": getattr(c, "number", None), "cvc": getattr(c, "cvc", None),
            "limit_cents": limit, "currency": c.currency,
        }

    def authorize(self, card_id: str, amount_cents: int,
                  merchant_name: str = "Timbre+ Food Court") -> dict:
        """Simulate a merchant authorization; Stripe applies spending controls (approve/decline)."""
        auth = self._s.issuing.Authorization.TestHelpers.create(
            card=card_id, amount=amount_cents,
            merchant_data={"category": "eating_places_restaurants",
                           "name": merchant_name, "city": "Singapore", "country": "SG"},
        )
        reason = None
        if not auth.approved and getattr(auth, "request_history", None):
            reason = getattr(auth.request_history[0], "reason", None)
        return {"approved": bool(auth.approved), "id": auth.id,
                "amount": auth.amount, "decline_reason": reason}

    def capture(self, auth_id: str) -> None:
        """Capture an approved authorization (creates the transaction)."""
        self._s.issuing.Authorization.TestHelpers.capture(auth_id)


def configured() -> bool:
    return bool(os.environ.get("STRIPE_API_KEY") and os.environ.get("STRIPE_CARD_ID"))
