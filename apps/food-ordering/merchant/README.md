# Merchant adapter (POC)

Buyer-side food ordering for Company Brain's agentic purchasing use case
("order lunch for the tech team"). The rest of the system depends only on the
`MerchantAdapter` interface, so the backing provider can be swapped with no
upstream changes.

## Why an adapter + mock

There is **no public, self-serve, buyer-side food-ordering API** for Singapore.
Grab / foodpanda / Deliveroo / Uber Eats Marketplace / DoorDash are all
merchant-side or courier-side. The only genuine buyer-side API is **Uber
Consumer Delivery**, which is approval-gated and not available in Singapore.
So the POC uses a mock, and the interface is modeled on the Uber Consumer
Delivery contract so a real provider drops in cleanly later.

## The contract

```
discover_merchants(location, constraints) -> [Merchant]   # constraint-aware, ranked
get_menu(merchant_id)                     -> Menu
build_cart(merchant_id, lines)            -> Cart          # re-prices from source menu
submit_order(cart, payment)               -> Order         # enforces the card limit
get_order_status(order_id)                -> Order
reorder(order_id)                         -> Cart
```

Money is always integer minor units (cents) + a currency code — never floats.

## Constraint handling

`OrderConstraints` carries the dietary tags, excluded allergens, per-head budget,
and headcount the agent derives from the company brain (the Obsidian vault).
`discover_merchants` returns only merchants that can actually satisfy them, and
`MenuItem.satisfies(...)` is the per-item check used for both discovery and the
agent's per-person item selection.

## Spending guardrail

`PaymentAuthorization` simulates the agent's virtual Stripe card and its limit.
`submit_order` raises `PaymentDeclined` when a cart exceeds the limit — a stand-in
for what Stripe Issuing `spending_controls` + the real-time authorization webhook
enforce in production.

## Run it

```bash
pip install -r requirements.txt
python demo_order_lunch.py     # full "order lunch for the tech team" flow
pytest tests/ -q               # 12 tests
```

## Swapping in a real provider

Implement `MerchantAdapter` and pass it wherever `MockMerchantAdapter` is used:

- `UberConsumerDeliveryAdapter` — apply for Uber's early-access program; viable
  wherever Uber Eats operates (not SG today).
- `CateringPartnerAdapter` (CaterSpot / Grain) — best real Singapore fit, via a
  B2B partnership.
