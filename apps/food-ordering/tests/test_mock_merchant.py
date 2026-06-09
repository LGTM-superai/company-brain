"""Tests for the mock merchant adapter and its constraint handling."""

import pytest

from merchant import (
    DietaryTag,
    GeoLocation,
    ItemUnavailable,
    MockMerchantAdapter,
    OrderConstraints,
    OrderStatus,
    PaymentAuthorization,
)
from merchant.adapter import MerchantNotFound, OrderNotFound, PaymentDeclined
from merchant.models import Allergen, CartLine


@pytest.fixture
def adapter() -> MockMerchantAdapter:
    return MockMerchantAdapter()


@pytest.fixture
def office() -> GeoLocation:
    return GeoLocation()


def test_discover_all_when_unconstrained(adapter, office):
    merchants = adapter.discover_merchants(office)
    assert len(merchants) == 6
    # Ranked best-first by rating.
    assert merchants[0].rating >= merchants[-1].rating


def test_discover_filters_halal(adapter, office):
    constraints = OrderConstraints(required_dietary={DietaryTag.HALAL})
    ids = {m.id for m in adapter.discover_merchants(office, constraints)}
    # Green Bowl, Zaffron, Nasi Padang and the food court can do halal; sushi/tian-tian cannot.
    assert ids == {"green-bowl", "zaffron", "nasi-padang", "timbre-foodcourt"}


def test_discover_filters_vegan_and_nut_free(adapter, office):
    constraints = OrderConstraints(
        required_dietary={DietaryTag.VEGAN, DietaryTag.NUT_FREE},
        excluded_allergens={Allergen.PEANUTS, Allergen.TREE_NUTS},
    )
    ids = {m.id for m in adapter.discover_merchants(office, constraints)}
    # Green Bowl and the food court each have a vegan+nut-free item; sushi veg maki
    # is vegan but that merchant lacks the NUT_FREE option flag.
    assert ids == {"green-bowl", "timbre-foodcourt"}


def test_discover_respects_budget(adapter, office):
    # A very low budget excludes merchants whose qualifying items cost more.
    cheap = OrderConstraints(
        required_dietary={DietaryTag.HALAL},
        budget_per_head_cents=900,
    )
    ids = {m.id for m in adapter.discover_merchants(office, cheap)}
    # Halal item <= SGD 9.00: Nasi Padang (ayam 800) and the food court (nasi lemak 880).
    assert ids == {"nasi-padang", "timbre-foodcourt"}


def test_build_cart_prices_from_menu(adapter):
    # Caller passes a wrong price; the adapter re-prices from the source menu.
    cart = adapter.build_cart(
        "tian-tian",
        [CartLine(item_id="tian-tian-chicken-rice", name="x", unit_price_cents=1, quantity=2)],
    )
    assert cart.lines[0].unit_price_cents == 650
    assert cart.subtotal_cents == 1300
    assert cart.total_cents == 1300 + 350  # + delivery fee


def test_build_cart_rejects_unknown_item(adapter):
    with pytest.raises(ItemUnavailable):
        adapter.build_cart("tian-tian", [CartLine(item_id="nope", name="x", unit_price_cents=1)])


def test_build_cart_rejects_unknown_merchant(adapter):
    with pytest.raises(MerchantNotFound):
        adapter.get_menu("does-not-exist")


def test_submit_order_confirms_under_limit(adapter):
    cart = adapter.build_cart(
        "tian-tian",
        [CartLine(item_id="tian-tian-chicken-rice", name="x", unit_price_cents=650)],
    )
    payment = PaymentAuthorization(card_id="vc_1", authorized_by="ceo", limit_cents=10_000)
    order = adapter.submit_order(cart, payment)
    assert order.status is OrderStatus.CONFIRMED
    assert order.total_cents == cart.total_cents
    assert order.payment_card_id == "vc_1"


def test_submit_order_declines_over_limit(adapter):
    cart = adapter.build_cart(
        "sushi-express",
        [CartLine(item_id="sushi-express-salmon-set", name="x", unit_price_cents=1580, quantity=5)],
    )
    payment = PaymentAuthorization(card_id="vc_1", authorized_by="ceo", limit_cents=1_000)
    with pytest.raises(PaymentDeclined):
        adapter.submit_order(cart, payment)


def test_order_status_lifecycle(adapter):
    cart = adapter.build_cart(
        "tian-tian",
        [CartLine(item_id="tian-tian-chicken-rice", name="x", unit_price_cents=650)],
    )
    payment = PaymentAuthorization(card_id="vc_1", authorized_by="ceo", limit_cents=10_000)
    order = adapter.submit_order(cart, payment)

    assert adapter.get_order_status(order.id).status is OrderStatus.CONFIRMED
    assert adapter.advance_order(order.id).status is OrderStatus.PREPARING
    assert adapter.advance_order(order.id).status is OrderStatus.OUT_FOR_DELIVERY
    assert adapter.advance_order(order.id).status is OrderStatus.DELIVERED
    # Terminal — stays delivered.
    assert adapter.advance_order(order.id).status is OrderStatus.DELIVERED


def test_get_unknown_order_raises(adapter):
    with pytest.raises(OrderNotFound):
        adapter.get_order_status("order_9999")


def test_reorder_rebuilds_cart(adapter):
    cart = adapter.build_cart(
        "zaffron",
        [CartLine(item_id="zaffron-veg-biryani", name="x", unit_price_cents=1290, quantity=2)],
    )
    payment = PaymentAuthorization(card_id="vc_1", authorized_by="ceo", limit_cents=10_000)
    order = adapter.submit_order(cart, payment)

    new_cart = adapter.reorder(order.id)
    assert new_cart.id != cart.id
    assert new_cart.merchant_id == "zaffron"
    assert new_cart.lines[0].item_id == "zaffron-veg-biryani"
    assert new_cart.lines[0].quantity == 2
    assert new_cart.total_cents == cart.total_cents
