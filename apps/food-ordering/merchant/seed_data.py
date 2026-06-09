"""Seeded Singapore restaurants + menus for the POC mock adapter.

Prices are realistic-ish SGD in integer cents. Dietary tags and allergens are
hand-set so the constraint logic has something meaningful to filter on.
"""

from __future__ import annotations

from .models import Allergen as A
from .models import DietaryTag as D
from .models import Menu, MenuItem, Merchant


def _item(merchant_id, suffix, name, price, tags=(), allergens=(), desc="", cuisine=None):
    return MenuItem(
        id=f"{merchant_id}-{suffix}",
        merchant_id=merchant_id,
        name=name,
        description=desc,
        price_cents=price,
        cuisine=cuisine,
        dietary_tags=set(tags),
        allergens=set(allergens),
    )


# --------------------------------------------------------------------------- #
# Merchants
# --------------------------------------------------------------------------- #
MERCHANTS: list[Merchant] = [
    Merchant(
        id="green-bowl",
        name="Green Bowl Salads",
        cuisines=["Salads", "Healthy", "Build-your-own"],
        dietary_options={D.VEGAN, D.VEGETARIAN, D.HALAL, D.GLUTEN_FREE, D.NUT_FREE,
                         D.DAIRY_FREE, D.SEAFOOD_FREE, D.PESCATARIAN},
        rating=4.7,
        eta_minutes=30,
        delivery_fee_cents=399,
        min_order_cents=2000,
    ),
    Merchant(
        id="zaffron",
        name="Zaffron Kitchen",
        cuisines=["Indian", "North Indian"],
        dietary_options={D.HALAL, D.VEGETARIAN, D.NUT_FREE},
        rating=4.5,
        eta_minutes=40,
        delivery_fee_cents=499,
    ),
    Merchant(
        id="sushi-express",
        name="Sushi Express SG",
        cuisines=["Japanese", "Sushi"],
        dietary_options={D.PESCATARIAN, D.GLUTEN_FREE},
        rating=4.3,
        eta_minutes=35,
        delivery_fee_cents=450,
    ),
    Merchant(
        id="tian-tian",
        name="Tian Tian Hainanese Chicken Rice",
        cuisines=["Chinese", "Hawker"],
        dietary_options={D.NUT_FREE, D.DAIRY_FREE},
        rating=4.6,
        eta_minutes=25,
        delivery_fee_cents=350,
    ),
    Merchant(
        id="nasi-padang",
        name="Sabar Menanti Nasi Padang",
        cuisines=["Malay", "Indonesian", "Hawker"],
        dietary_options={D.HALAL, D.DAIRY_FREE},
        rating=4.4,
        eta_minutes=30,
        delivery_fee_cents=400,
    ),
    # A multi-cuisine food court: one delivery can satisfy a whole diverse team
    # with a *different* dish per person.
    Merchant(
        id="timbre-foodcourt",
        name="Timbre+ Food Court",
        cuisines=["Healthy", "Indian", "Japanese", "Hawker", "Malay", "Peranakan"],
        dietary_options={D.VEGAN, D.VEGETARIAN, D.HALAL, D.PESCATARIAN, D.GLUTEN_FREE,
                         D.NUT_FREE, D.DAIRY_FREE, D.SEAFOOD_FREE},
        rating=4.4,
        eta_minutes=35,
        delivery_fee_cents=299,
    ),
]


# --------------------------------------------------------------------------- #
# Menus
# --------------------------------------------------------------------------- #
MENUS: dict[str, Menu] = {
    "green-bowl": Menu(
        merchant_id="green-bowl",
        items=[
            _item("green-bowl", "vegan-buddha", "Vegan Buddha Bowl", 1390,
                  tags=[D.VEGAN, D.VEGETARIAN, D.HALAL, D.DAIRY_FREE, D.NUT_FREE,
                        D.GLUTEN_FREE, D.SEAFOOD_FREE],
                  allergens=[A.SOY],
                  desc="Quinoa, chickpeas, roasted veg, tahini-free dressing."),
            _item("green-bowl", "gf-vegan-garden", "Gluten-Free Garden Bowl", 1490,
                  tags=[D.VEGAN, D.VEGETARIAN, D.HALAL, D.GLUTEN_FREE, D.DAIRY_FREE,
                        D.NUT_FREE, D.SEAFOOD_FREE],
                  desc="Mixed greens, avocado, edamame, citrus dressing."),
            _item("green-bowl", "chicken-caesar", "Grilled Chicken Caesar", 1590,
                  tags=[D.HALAL, D.NUT_FREE],
                  allergens=[A.DAIRY, A.GLUTEN, A.EGG, A.FISH],
                  desc="Halal grilled chicken, parmesan, croutons."),
            _item("green-bowl", "pescatarian-tuna", "Seared Tuna Nicoise", 1690,
                  tags=[D.PESCATARIAN, D.GLUTEN_FREE, D.NUT_FREE, D.DAIRY_FREE],
                  allergens=[A.FISH, A.EGG],
                  desc="Seared tuna, green beans, olives, egg."),
        ],
    ),
    "zaffron": Menu(
        merchant_id="zaffron",
        items=[
            _item("zaffron", "butter-chicken", "Butter Chicken Set", 1490,
                  tags=[D.HALAL],
                  allergens=[A.DAIRY, A.GLUTEN],
                  desc="Halal butter chicken with naan."),
            _item("zaffron", "dal-makhani", "Dal Makhani (V)", 1190,
                  tags=[D.HALAL, D.VEGETARIAN, D.NUT_FREE],
                  allergens=[A.DAIRY],
                  desc="Slow-cooked black lentils."),
            _item("zaffron", "veg-biryani", "Vegetable Biryani", 1290,
                  tags=[D.HALAL, D.VEGETARIAN, D.NUT_FREE, D.DAIRY_FREE],
                  allergens=[A.GLUTEN],
                  desc="Basmati rice with spiced vegetables."),
        ],
    ),
    "sushi-express": Menu(
        merchant_id="sushi-express",
        items=[
            _item("sushi-express", "salmon-set", "Salmon Sushi Set", 1580,
                  tags=[D.PESCATARIAN],
                  allergens=[A.FISH, A.SOY, A.GLUTEN],
                  desc="8 pieces assorted salmon sushi."),
            _item("sushi-express", "veg-maki", "Vegetable Maki Roll", 980,
                  tags=[D.VEGETARIAN, D.VEGAN, D.DAIRY_FREE],
                  allergens=[A.SOY, A.GLUTEN, A.SESAME],
                  desc="Cucumber and avocado rolls."),
        ],
    ),
    "tian-tian": Menu(
        merchant_id="tian-tian",
        items=[
            _item("tian-tian", "chicken-rice", "Hainanese Chicken Rice", 650,
                  tags=[D.NUT_FREE, D.DAIRY_FREE, D.SEAFOOD_FREE],
                  allergens=[A.SOY],
                  desc="Steamed chicken with fragrant rice."),
            _item("tian-tian", "roast-rice", "Roast Chicken Rice", 700,
                  tags=[D.NUT_FREE, D.DAIRY_FREE, D.SEAFOOD_FREE],
                  allergens=[A.SOY],
                  desc="Roast chicken with rice."),
        ],
    ),
    "nasi-padang": Menu(
        merchant_id="nasi-padang",
        items=[
            _item("nasi-padang", "rendang-set", "Beef Rendang Set", 850,
                  tags=[D.HALAL, D.DAIRY_FREE, D.SEAFOOD_FREE],
                  allergens=[A.PEANUTS], cuisine="Malay",
                  desc="Beef rendang with rice and sayur."),
            _item("nasi-padang", "ayam-set", "Ayam Penyet Set", 800,
                  tags=[D.HALAL, D.DAIRY_FREE, D.NUT_FREE, D.SEAFOOD_FREE],
                  allergens=[A.SOY], cuisine="Malay",
                  desc="Smashed fried chicken with rice."),
        ],
    ),
    "timbre-foodcourt": Menu(
        merchant_id="timbre-foodcourt",
        items=[
            _item("timbre-foodcourt", "quinoa-bowl", "Rainbow Quinoa Bowl", 1290,
                  tags=[D.VEGAN, D.VEGETARIAN, D.HALAL, D.GLUTEN_FREE, D.NUT_FREE,
                        D.DAIRY_FREE, D.SEAFOOD_FREE],
                  allergens=[A.SOY], cuisine="Healthy",
                  desc="Quinoa, roasted veg, chickpeas, citrus dressing."),
            _item("timbre-foodcourt", "butter-chicken", "Halal Butter Chicken Rice", 1490,
                  tags=[D.HALAL, D.SEAFOOD_FREE],
                  allergens=[A.DAIRY, A.GLUTEN], cuisine="Indian",
                  desc="Rich, mildly spiced halal butter chicken with basmati."),
            _item("timbre-foodcourt", "salmon-don", "Salmon Donburi", 1590,
                  tags=[D.PESCATARIAN, D.DAIRY_FREE, D.NUT_FREE],
                  allergens=[A.FISH, A.SOY], cuisine="Japanese",
                  desc="Seared salmon over rice with tobiko."),
            _item("timbre-foodcourt", "chicken-rice", "Hainanese Chicken Rice", 750,
                  tags=[D.NUT_FREE, D.DAIRY_FREE, D.SEAFOOD_FREE],
                  allergens=[A.SOY], cuisine="Hawker",
                  desc="Mild, comforting steamed chicken with fragrant rice."),
            _item("timbre-foodcourt", "nasi-lemak", "Nasi Lemak Ayam", 880,
                  tags=[D.HALAL],
                  allergens=[A.PEANUTS, A.FISH], cuisine="Malay",
                  desc="Coconut rice, sambal, fried chicken, ikan bilis, peanuts."),
            _item("timbre-foodcourt", "veg-laksa", "Vegetarian Laksa", 980,
                  tags=[D.VEGETARIAN, D.HALAL],
                  allergens=[A.GLUTEN, A.SOY], cuisine="Peranakan",
                  desc="Spicy coconut noodle soup with tofu and veg."),
        ],
    ),
}


def fresh_merchants() -> list[Merchant]:
    """Deep copies so a test/mock instance can't mutate the shared seed."""
    return [m.model_copy(deep=True) for m in MERCHANTS]


def fresh_menus() -> dict[str, Menu]:
    return {mid: menu.model_copy(deep=True) for mid, menu in MENUS.items()}
