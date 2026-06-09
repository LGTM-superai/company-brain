"""`MockMerchantAdapter` — an in-memory POC implementation of `MerchantAdapter`.

Deterministic (counter-based ids, no randomness) so tests and demos are stable.
It enforces the payment limit on `submit_order` to demonstrate the spending
guardrail that Stripe Issuing would enforce in production.
"""

from __future__ import annotations

from .adapter import (
    ItemUnavailable,
    MerchantAdapter,
    MerchantNotFound,
    OrderNotFound,
    PaymentDeclined,
)
from .models import (
    STATUS_FLOW,
    Cart,
    CartLine,
    GeoLocation,
    Menu,
    Merchant,
    Order,
    OrderConstraints,
    OrderStatus,
    PaymentAuthorization,
)
from .seed_data import fresh_menus, fresh_merchants


class MockMerchantAdapter(MerchantAdapter):
    def __init__(self) -> None:
        self._merchants: list[Merchant] = fresh_merchants()
        self._menus: dict[str, Menu] = fresh_menus()
        self._orders: dict[str, Order] = {}
        self._seq = 0

    # ----------------------------------------------------------------- ids
    def _next_id(self, prefix: str) -> str:
        self._seq += 1
        return f"{prefix}_{self._seq:04d}"

    # --------------------------------------------------------------- lookup
    def _merchant(self, merchant_id: str) -> Merchant:
        m = next((m for m in self._merchants if m.id == merchant_id), None)
        if m is None:
            raise MerchantNotFound(merchant_id)
        return m

    # ------------------------------------------------------------- discover
    def discover_merchants(
        self,
        location: GeoLocation,
        constraints: OrderConstraints | None = None,
    ) -> list[Merchant]:
        results = list(self._merchants)

        if constraints:
            required = constraints.required_dietary
            if required:
                # Keep merchants whose menu has at least one item per required
                # tag that actually satisfies the full constraint set — i.e. it
                # can genuinely cater to someone with these needs.
                results = [
                    m for m in results
                    if self._can_satisfy(m.id, constraints)
                ]
            if constraints.preferred_cuisines:
                pref = {c.lower() for c in constraints.preferred_cuisines}
                results.sort(
                    key=lambda m: any(c.lower() in pref for c in m.cuisines),
                    reverse=True,
                )

        # Best rated first (stable within the cuisine-preference ordering).
        results.sort(key=lambda m: m.rating, reverse=True)
        return results

    def _can_satisfy(self, merchant_id: str, constraints: OrderConstraints) -> bool:
        menu = self._menus.get(merchant_id)
        if not menu:
            return False
        return any(
            item.satisfies(constraints.required_dietary, constraints.excluded_allergens)
            and (
                constraints.budget_per_head_cents is None
                or item.price_cents <= constraints.budget_per_head_cents
            )
            for item in menu.items
        )

    # ----------------------------------------------------------------- menu
    def get_menu(self, merchant_id: str) -> Menu:
        self._merchant(merchant_id)  # raises if unknown
        return self._menus[merchant_id]

    # ----------------------------------------------------------------- cart
    def build_cart(self, merchant_id: str, lines: list[CartLine]) -> Cart:
        merchant = self._merchant(merchant_id)
        menu = self._menus[merchant_id]

        priced: list[CartLine] = []
        for line in lines:
            item = menu.item(line.item_id)
            if item is None:
                raise ItemUnavailable(f"{line.item_id} not on {merchant_id} menu")
            if not item.available:
                raise ItemUnavailable(f"{item.name} is sold out")
            # Re-price from the source menu rather than trusting the caller.
            priced.append(
                CartLine(
                    item_id=item.id,
                    name=item.name,
                    unit_price_cents=item.price_cents,
                    quantity=line.quantity,
                    notes=line.notes,
                )
            )

        return Cart(
            id=self._next_id("cart"),
            merchant_id=merchant_id,
            currency=merchant.currency,
            lines=priced,
            delivery_fee_cents=merchant.delivery_fee_cents,
        )

    # ---------------------------------------------------------------- order
    def submit_order(self, cart: Cart, payment: PaymentAuthorization) -> Order:
        merchant = self._merchant(cart.merchant_id)

        if cart.total_cents > payment.limit_cents:
            raise PaymentDeclined(
                f"order {cart.total_cents}c exceeds card {payment.card_id} "
                f"limit {payment.limit_cents}c"
            )

        order_id = self._next_id("order")
        order = Order(
            id=order_id,
            merchant_id=cart.merchant_id,
            cart=cart,
            status=OrderStatus.CONFIRMED,
            currency=cart.currency,
            total_cents=cart.total_cents,
            eta_minutes=merchant.eta_minutes,
            payment_card_id=payment.card_id,
            external_ref=self._next_id("ext"),
        )
        self._orders[order_id] = order
        return order

    def get_order_status(self, order_id: str) -> Order:
        order = self._orders.get(order_id)
        if order is None:
            raise OrderNotFound(order_id)
        return order

    # ------------------------------------------------------------- reorder
    def reorder(self, order_id: str) -> Cart:
        order = self.get_order_status(order_id)
        lines = [
            CartLine(
                item_id=line.item_id,
                name=line.name,
                unit_price_cents=line.unit_price_cents,
                quantity=line.quantity,
                notes=line.notes,
            )
            for line in order.cart.lines
        ]
        return self.build_cart(order.merchant_id, lines)

    # ---------------------------------------------- demo-only progress helper
    def advance_order(self, order_id: str) -> Order:
        """Advance an order one step along the status flow (POC simulation)."""
        order = self.get_order_status(order_id)
        if order.status in STATUS_FLOW:
            idx = STATUS_FLOW.index(order.status)
            if idx + 1 < len(STATUS_FLOW):
                order.status = STATUS_FLOW[idx + 1]
        return order
