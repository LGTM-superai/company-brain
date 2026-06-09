"""Agentic purchasing tools — wrap the MerchantAdapter + the spending limit.

The LLM passes plain strings/lists; these tools translate to the typed merchant
models, enforce the card limit, and return readable confirmations. The deterministic
spending guardrail lives in the adapter (PaymentDeclined), never in the model's
judgement.
"""

from __future__ import annotations

from agents import RunContextWrapper, function_tool

from merchant import (
    DietaryTag,
    Diner,
    GeoLocation,
    OrderConstraints,
    format_money,
    plan_team_order,
)
from merchant.adapter import ItemUnavailable, MerchantNotFound, PaymentDeclined
from merchant.models import Allergen, CartLine

from ..context import BrainContext


def _to_enum_set(values, enum_cls):
    out = set()
    for v in values or []:
        try:
            out.add(enum_cls(v.strip().lower()))
        except ValueError:
            continue  # ignore tags the catalogue doesn't model
    return out


@function_tool
def lookup_team(ctx: RunContextWrapper[BrainContext], team: str) -> str:
    """Look up a team's members and their dietary needs from the company brain.

    Args:
        team: Team name, e.g. 'tech'.
    """
    members = ctx.context.vault.get_team(team)
    if not members:
        return f"No team named {team!r} found."
    lines = []
    for m in members:
        diet = ", ".join(m["dietary"]) or "no restrictions"
        avoid = ", ".join(m["avoid"]) or "none"
        prefs = ", ".join(m.get("cuisine_preferences", [])) or "open"
        lines.append(f"- {m['name']}: diet=[{diet}] avoid=[{avoid}] prefers=[{prefs}]")
    return f"{len(members)} member(s) on '{team}':\n" + "\n".join(lines)


@function_tool
def plan_team_meal(
    ctx: RunContextWrapper[BrainContext],
    team: str,
    budget_per_head_sgd: float,
) -> str:
    """Plan a DIFFERENT, suitable dish for every member of a team, from one merchant.

    Reads the team from the company brain, honours each person's dietary needs,
    allergens and cuisine preferences, and returns a per-person plan plus the exact
    merchant_id and item_ids to pass to place_order.

    Args:
        team: Team name, e.g. 'tech'.
        budget_per_head_sgd: Max spend per person in SGD.
    """
    members = ctx.context.vault.get_team(team)
    if not members:
        return f"No team named {team!r} found."

    diners = [
        Diner(
            name=m["name"],
            dietary=_to_enum_set(m["dietary"], DietaryTag),
            avoid=_to_enum_set(m["avoid"], Allergen),
            cuisine_preferences=m.get("cuisine_preferences", []),
        )
        for m in members
    ]
    budget_cents = int(round(budget_per_head_sgd * 100))
    plan = plan_team_order(ctx.context.merchant, diners, budget_cents)
    if plan is None or plan.covered < len(diners):
        covered = plan.covered if plan else 0
        return (f"Could not cover all {len(diners)} members from one merchant "
                f"(covered {covered}). Consider splitting the order or raising the budget.")

    rows = [
        f"- {a.diner.name} -> {a.item.name} ({a.item.id}) "
        f"{format_money(a.item.price_cents)} [{a.item.cuisine}]"
        for a in plan.assignments
    ]
    item_ids = [a.item.id for a in plan.assignments]
    return (
        f"Plan at {plan.merchant.name} ({plan.merchant.id}), "
        f"total {format_money(plan.total_cents)} for {plan.covered} people:\n"
        + "\n".join(rows)
        + f"\n\nTo order, call place_order(merchant_id='{plan.merchant.id}', "
        f"item_ids={item_ids})."
    )


@function_tool
def find_restaurants(
    ctx: RunContextWrapper[BrainContext],
    required_dietary: list[str],
    excluded_allergens: list[str],
    budget_per_head_sgd: float,
    preferred_cuisines: list[str],
) -> str:
    """Find merchants that can satisfy the whole group's constraints, ranked best-first.

    Args:
        required_dietary: Dietary tags every order must support (e.g. ['halal','vegan']).
        excluded_allergens: Allergens to exclude (e.g. ['peanuts']).
        budget_per_head_sgd: Max spend per person in SGD.
        preferred_cuisines: Optional cuisine preferences.
    """
    constraints = OrderConstraints(
        required_dietary=_to_enum_set(required_dietary, DietaryTag),
        excluded_allergens=_to_enum_set(excluded_allergens, Allergen),
        budget_per_head_cents=int(round(budget_per_head_sgd * 100)),
        preferred_cuisines=preferred_cuisines or [],
    )
    merchants = ctx.context.merchant.discover_merchants(GeoLocation(), constraints)
    if not merchants:
        return "No single merchant can satisfy all constraints. Consider splitting the order."
    return "\n".join(
        f"- {m.id}: {m.name} (rating {m.rating}, ETA {m.eta_minutes}m, "
        f"delivery {format_money(m.delivery_fee_cents)})"
        for m in merchants
    )


@function_tool
def get_menu(ctx: RunContextWrapper[BrainContext], merchant_id: str) -> str:
    """Get a merchant's menu, including each item's price, dietary tags and allergens.

    Args:
        merchant_id: The merchant id from find_restaurants.
    """
    try:
        menu = ctx.context.merchant.get_menu(merchant_id)
    except MerchantNotFound:
        return f"Unknown merchant {merchant_id!r}."
    lines = []
    for it in menu.items:
        tags = ", ".join(sorted(t.value for t in it.dietary_tags)) or "-"
        allerg = ", ".join(sorted(a.value for a in it.allergens)) or "none"
        lines.append(f"- {it.id}: {it.name} {format_money(it.price_cents)} "
                     f"[diet: {tags}] [allergens: {allerg}]")
    return "\n".join(lines)


async def _place_order_needs_approval(
    ctx: RunContextWrapper[BrainContext], args: dict, call_id: str
) -> bool:
    """Human-in-the-loop gate: require approval when the spend hits the threshold.

    Prices the proposed cart up-front; if it can't be priced, fail safe and require
    approval.
    """
    threshold = getattr(ctx.context, "auto_approve_under_cents", 0)
    try:
        item_ids = args.get("item_ids") or []
        cart = ctx.context.merchant.build_cart(
            args.get("merchant_id"),
            [CartLine(item_id=i, name=i, unit_price_cents=0) for i in item_ids],
        )
        return cart.total_cents >= threshold
    except Exception:
        return True


@function_tool(needs_approval=_place_order_needs_approval)
def place_order(
    ctx: RunContextWrapper[BrainContext],
    merchant_id: str,
    item_ids: list[str],
) -> str:
    """Place an order and charge the agent's virtual card (limit enforced).

    Pass one item id per portion (repeat an id for multiple of the same dish).

    Args:
        merchant_id: The chosen merchant.
        item_ids: Menu item ids to order, one per portion.
    """
    adapter = ctx.context.merchant
    lines = [CartLine(item_id=i, name=i, unit_price_cents=0, quantity=1) for i in item_ids]
    try:
        cart = adapter.build_cart(merchant_id, lines)
    except (MerchantNotFound, ItemUnavailable) as e:
        return f"Could not build order: {e}"

    try:
        order = adapter.submit_order(cart, ctx.context.payment)
    except PaymentDeclined as e:
        return (f"DECLINED: order total {format_money(cart.total_cents)} exceeds the "
                f"card limit {format_money(ctx.context.payment.limit_cents)}. "
                f"Escalate to {ctx.context.payment.authorized_by} for approval. ({e})")

    return (f"Order {order.id} placed with {merchant_id} for "
            f"{format_money(order.total_cents)}, ETA {order.eta_minutes}m. "
            f"Charged card {order.payment_card_id}.")
