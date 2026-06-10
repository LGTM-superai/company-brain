"""Team-meal planning: give each diner a *different* dish that fits their needs.

This is deterministic, preference-aware selection — the logic an agent would run
on top of the `MerchantAdapter`. Kept as plain code (not an LLM call) so spending
decisions are reproducible and testable.
"""

from __future__ import annotations

from dataclasses import dataclass

from .adapter import MerchantAdapter
from .models import (
    Allergen,
    DietaryTag,
    GeoLocation,
    MenuItem,
    Merchant,
)


@dataclass
class Diner:
    name: str
    dietary: set[DietaryTag]
    avoid: set[Allergen]
    cuisine_preferences: list[str]


@dataclass
class Assignment:
    diner: Diner
    item: MenuItem


@dataclass
class TeamPlan:
    merchant: Merchant
    assignments: list[Assignment]

    @property
    def covered(self) -> int:
        return len(self.assignments)

    @property
    def preference_matches(self) -> int:
        return sum(
            1 for a in self.assignments
            if a.item.cuisine and a.item.cuisine.lower()
            in {c.lower() for c in a.diner.cuisine_preferences}
        )

    @property
    def total_cents(self) -> int:
        return (sum(a.item.price_cents for a in self.assignments)
                + self.merchant.delivery_fee_cents)


def _rank_key(item: MenuItem, diner: Diner):
    """Prefer items matching a cuisine preference, then cheaper ones."""
    prefs = {c.lower() for c in diner.cuisine_preferences}
    pref_hit = item.cuisine is not None and item.cuisine.lower() in prefs
    return (0 if pref_hit else 1, item.price_cents)


def _assign_distinct(
    items: list[MenuItem],
    diners: list[Diner],
    budget_per_head_cents: int | None,
) -> list[Assignment]:
    """Greedily give each diner a distinct suitable item.

    Most-constrained diners are served first (they have the fewest options), each
    taking their best-ranked dish that nobody else has already claimed.
    """
    def viable(d: Diner) -> list[MenuItem]:
        out = [
            it for it in items
            if it.satisfies(d.dietary, d.avoid)
            and (budget_per_head_cents is None or it.price_cents <= budget_per_head_cents)
        ]
        return sorted(out, key=lambda it: _rank_key(it, d))

    order = sorted(diners, key=lambda d: len(viable(d)))  # fewest options first
    taken: set[str] = set()
    assignments: list[Assignment] = []
    for diner in order:
        choice = next((it for it in viable(diner) if it.id not in taken), None)
        if choice is not None:
            taken.add(choice.id)
            assignments.append(Assignment(diner=diner, item=choice))
    # Restore the original diner order for a stable, readable plan.
    by_name = {a.diner.name: a for a in assignments}
    return [by_name[d.name] for d in diners if d.name in by_name]


def plan_team_order(
    adapter: MerchantAdapter,
    diners: list[Diner],
    budget_per_head_cents: int | None = None,
    location: GeoLocation | None = None,
) -> TeamPlan | None:
    """Find the single best merchant to give every diner a different fitting dish.

    Merchants are scored by (diners covered, cuisine-preference matches, rating) so
    a varied team lands at a place whose menu actually reflects their tastes.
    """
    location = location or GeoLocation()
    candidates = adapter.discover_merchants(location)  # all merchants; scored below

    best: TeamPlan | None = None
    for merchant in candidates:
        menu = adapter.get_menu(merchant.id)
        assignments = _assign_distinct(menu.items, diners, budget_per_head_cents)
        if not assignments:
            continue
        plan = TeamPlan(merchant=merchant, assignments=assignments)
        key = (plan.covered, plan.preference_matches, merchant.rating)
        if best is None or key > (best.covered, best.preference_matches, best.merchant.rating):
            best = plan
    return best
