"""Demo: "Order lunch for the tech team" — driven by the real Obsidian vault.

Plays the Company Brain *agent* on top of the MerchantAdapter, but pulls the team
and their dietary needs / personalities / cuisine preferences straight from the
vault notes (vault/People/*.md). Each of the 4 tech-team members gets a DIFFERENT
dish that fits their constraints and tastes.

Run:  python seed_vault.py   # once, to create the vault
      python demo_order_lunch.py
"""

from __future__ import annotations

from brain_agents.vault import ObsidianVault
from merchant import (
    Diner,
    MockMerchantAdapter,
    PaymentAuthorization,
    format_money,
    plan_team_order,
)
from merchant.models import Allergen, CartLine, DietaryTag

BUDGET_PER_HEAD_CENTS = 1800   # SGD 18.00, authorised by the requester
CARD_LIMIT_CENTS = 10_000      # the agent's $100 virtual Stripe card


def _enum_set(values, enum_cls):
    out = set()
    for v in values or []:
        try:
            out.add(enum_cls(v.strip().lower()))
        except ValueError:
            pass
    return out


def rule(label: str = "") -> None:
    print(f"\n{'─' * 66}")
    if label:
        print(label)


def main() -> None:
    vault = ObsidianVault()
    agent = MockMerchantAdapter()

    members = vault.get_team("tech")
    if not members:
        print("No tech team found — run `python seed_vault.py` first.")
        return

    rule('CEO request: "Order lunch for the tech team."')
    print("Team pulled from the Obsidian vault:")
    for m in members:
        diet = ", ".join(m["dietary"]) or "no restrictions"
        prefs = ", ".join(m["cuisine_preferences"]) or "open"
        print(f"  • {m['name']:15} from {m['hometown']:18} "
              f"diet=[{diet}] prefers=[{prefs}]")

    diners = [
        Diner(
            name=m["name"],
            dietary=_enum_set(m["dietary"], DietaryTag),
            avoid=_enum_set(m["avoid"], Allergen),
            cuisine_preferences=m["cuisine_preferences"],
        )
        for m in members
    ]

    rule("Planning a different dish for each person…")
    plan = plan_team_order(agent, diners, BUDGET_PER_HEAD_CENTS)
    if plan is None or plan.covered < len(diners):
        print("Could not cover everyone from one merchant.")
        return

    print(f"Chosen merchant: {plan.merchant.name}  (★{plan.merchant.rating})")
    for a in plan.assignments:
        print(f"  • {a.diner.name:15} → {a.item.name:26} "
              f"[{a.item.cuisine:9}] {format_money(a.item.price_cents)}")

    distinct = len({a.item.id for a in plan.assignments})
    print(f"\n  {distinct} distinct dishes for {plan.covered} people.")

    # Build + place the single order.
    item_ids = [a.item.id for a in plan.assignments]
    cart = agent.build_cart(
        plan.merchant.id,
        [CartLine(item_id=i, name=i, unit_price_cents=0) for i in item_ids],
    )

    rule("Cart")
    print(f"  Subtotal:     {format_money(cart.subtotal_cents)}")
    print(f"  Delivery fee: {format_money(cart.delivery_fee_cents)}")
    print(f"  TOTAL:        {format_money(cart.total_cents)}")

    payment = PaymentAuthorization(
        card_id="ic_techteam_agent", authorized_by="ceo@company.com",
        limit_cents=CARD_LIMIT_CENTS,
    )
    print(f"\n  Charging virtual card {payment.card_id} "
          f"(limit {format_money(payment.limit_cents)})…")
    order = agent.submit_order(cart, payment)

    rule("Order placed ✅")
    print(f"  Order {order.id} · {plan.merchant.name} · {format_money(order.total_cents)} "
          f"· ETA {order.eta_minutes}m")

    rule("Tracking")
    print(f"  status: {order.status.value}")
    while order.status.value != "delivered":
        order = agent.advance_order(order.id)
        print(f"  status: {order.status.value}")


if __name__ == "__main__":
    main()
