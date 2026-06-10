"""Tests for the Obsidian vault reader and the distinct-meal planner.

These rely on the generated vault — run `python seed_vault.py` first (CI should
run it as a fixture step).
"""

import pytest

from brain_agents.vault import ObsidianVault
from merchant import Diner, MockMerchantAdapter, plan_team_order
from merchant.models import Allergen, DietaryTag


def _enum_set(values, enum_cls):
    out = set()
    for v in values or []:
        try:
            out.add(enum_cls(v.strip().lower()))
        except ValueError:
            pass
    return out


@pytest.fixture(scope="module")
def vault() -> ObsidianVault:
    v = ObsidianVault()
    if not v.notes:
        pytest.skip("vault not generated — run `python seed_vault.py`")
    return v


# ------------------------------------------------------------------ vault
def test_vault_has_ten_people(vault):
    assert len(vault.people("personal")) == 10
    assert len(vault.people("resume")) == 10


def test_get_team_tech_has_four(vault):
    team = vault.get_team("tech")
    names = {m["name"] for m in team}
    assert names == {"Maya Krishnan", "Omar Hassan", "Sofia Almeida", "Wei Zhang"}


def test_get_person_parses_dietary(vault):
    maya = vault.get_person("Maya Krishnan")
    assert "vegan" in maya["dietary"]
    assert "peanuts" in maya["avoid"]
    assert "Healthy" in maya["cuisine_preferences"]
    assert maya["hometown"] == "Bangalore, India"


def test_search_finds_relevant_note(vault):
    hits = vault.search("pescatarian Lisbon")
    assert hits
    assert any("Sofia Almeida" in h["path"] for h in hits)


def test_read_note_by_bare_title(vault):
    text = vault.read_note("Wei Zhang - Personal")
    assert "Hainanese" in text or "hawker" in text.lower()


# --------------------------------------------------------------- planning
@pytest.fixture
def tech_diners(vault):
    return [
        Diner(
            name=m["name"],
            dietary=_enum_set(m["dietary"], DietaryTag),
            avoid=_enum_set(m["avoid"], Allergen),
            cuisine_preferences=m["cuisine_preferences"],
        )
        for m in vault.get_team("tech")
    ]


def test_plan_gives_everyone_a_distinct_meal(tech_diners):
    plan = plan_team_order(MockMerchantAdapter(), tech_diners, budget_per_head_cents=1800)
    assert plan is not None
    assert plan.covered == 4
    item_ids = [a.item.id for a in plan.assignments]
    assert len(set(item_ids)) == 4  # all different dishes


def test_plan_picks_preference_matching_merchant(tech_diners):
    plan = plan_team_order(MockMerchantAdapter(), tech_diners, budget_per_head_cents=1800)
    # The multi-cuisine food court matches everyone's tastes -> highest pref score.
    assert plan.merchant.id == "timbre-foodcourt"
    assert plan.preference_matches == 4


def test_plan_respects_dietary(tech_diners):
    plan = plan_team_order(MockMerchantAdapter(), tech_diners, budget_per_head_cents=1800)
    by_name = {a.diner.name: a.item for a in plan.assignments}
    assert DietaryTag.VEGAN in by_name["Maya Krishnan"].dietary_tags
    assert DietaryTag.HALAL in by_name["Omar Hassan"].dietary_tags
    assert DietaryTag.PESCATARIAN in by_name["Sofia Almeida"].dietary_tags
    # Maya is allergic to peanuts/tree_nuts — her dish must contain neither.
    assert not (by_name["Maya Krishnan"].allergens & {Allergen.PEANUTS, Allergen.TREE_NUTS})


def test_plan_under_card_limit(tech_diners):
    plan = plan_team_order(MockMerchantAdapter(), tech_diners, budget_per_head_cents=1800)
    assert plan.total_cents <= 10_000  # fits the $100 virtual card
