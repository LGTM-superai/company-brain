"""The `MerchantAdapter` interface — the only contract the rest of Company Brain
depends on for buyer-side food ordering.

The method set mirrors the Uber Consumer Delivery API flow, which is the most
complete real buyer-side ordering contract available today:

    discover_merchants -> get_menu -> build_cart -> submit_order
                                                 -> get_order_status
                                                 -> reorder

Any concrete provider (the mock here, a future Uber Consumer Delivery adapter,
or a CaterSpot/Grain corporate-catering adapter) implements this interface, so
the agent and the spending-policy layer never change when the backend swaps.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from .models import (
    Cart,
    CartLine,
    GeoLocation,
    Menu,
    Merchant,
    Order,
    OrderConstraints,
    PaymentAuthorization,
)


# --------------------------------------------------------------------------- #
# Errors
# --------------------------------------------------------------------------- #
class MerchantError(Exception):
    """Base class for all merchant-adapter errors."""


class MerchantNotFound(MerchantError):
    pass


class ItemUnavailable(MerchantError):
    pass


class PaymentDeclined(MerchantError):
    """Raised when the order total exceeds the card's authorized limit."""


class OrderNotFound(MerchantError):
    pass


# --------------------------------------------------------------------------- #
# Interface
# --------------------------------------------------------------------------- #
class MerchantAdapter(ABC):
    @abstractmethod
    def discover_merchants(
        self,
        location: GeoLocation,
        constraints: OrderConstraints | None = None,
    ) -> list[Merchant]:
        """Find merchants that can deliver to `location`.

        If `constraints` are given, only merchants whose menus can satisfy the
        required dietary tags are returned, ranked best-first.
        """

    @abstractmethod
    def get_menu(self, merchant_id: str) -> Menu:
        """Return the full menu for a merchant. Raises `MerchantNotFound`."""

    @abstractmethod
    def build_cart(self, merchant_id: str, lines: list[CartLine]) -> Cart:
        """Validate item availability, price the lines, and return a priced cart.

        Raises `MerchantNotFound` or `ItemUnavailable`.
        """

    @abstractmethod
    def submit_order(self, cart: Cart, payment: PaymentAuthorization) -> Order:
        """Place the order, charging `payment`.

        Raises `PaymentDeclined` if `cart.total_cents` exceeds the card limit.
        """

    @abstractmethod
    def get_order_status(self, order_id: str) -> Order:
        """Return the current state of a placed order. Raises `OrderNotFound`."""

    @abstractmethod
    def reorder(self, order_id: str) -> Cart:
        """Rebuild a fresh, re-priced cart from a past order's line items."""
