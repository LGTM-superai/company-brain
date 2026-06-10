"""Create the agent's Stripe virtual card (run once). Prints the card id + details.

    STRIPE_API_KEY=sk_test_... python setup_stripe_card.py [limit_dollars]

Then put the printed STRIPE_CARD_ID into .env so orders charge this card.
Requires a Stripe account with Issuing enabled (test mode).
"""

from __future__ import annotations

import sys

from dotenv import load_dotenv

load_dotenv()

from merchant.stripe_issuing import StripeIssuing


def main() -> None:
    limit_cents = int(float(sys.argv[1]) * 100) if len(sys.argv) > 1 else 10_000
    si = StripeIssuing()
    card_id = si.create_virtual_card(name="Tech Team Lunch Agent", limit_cents=limit_cents)
    d = si.card_details(card_id)
    print("\n✅ Created virtual card. Add this to .env:\n")
    print(f"STRIPE_CARD_ID={card_id}")
    print(f"\n  {d['brand']} •••• {d['last4']}  exp {d['exp_month']:02d}/{d['exp_year']}  "
          f"limit {d['limit_cents'] / 100:.2f} {d['currency'].upper()}  (food MCC only)")
    print(f"  full number (test): {d['number']}  cvc: {d['cvc']}")


if __name__ == "__main__":
    main()
