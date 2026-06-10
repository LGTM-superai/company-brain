"""Merchant integration for Company Brain — agentic food ordering.

This package exposes a single `MerchantAdapter` interface (modeled on the Uber
Consumer Delivery API contract: discover -> menu -> cart -> submit -> status ->
reorder) and a `MockMerchantAdapter` POC implementation seeded with Singapore
restaurants.

The agent and the spending-policy layer only ever touch `MerchantAdapter`, so a
real provider (Uber Consumer Delivery, a CaterSpot/Grain partnership, etc.) can
be swapped in later with zero changes upstream.
"""

from .adapter import (
    ItemUnavailable,
    MerchantAdapter,
    MerchantError,
    MerchantNotFound,
    OrderNotFound,
    PaymentDeclined,
)
from .mock import MockMerchantAdapter
from .planning import Assignment, Diner, TeamPlan, plan_team_order
from .models import (
    Cart,
    CartLine,
    DietaryTag,
    GeoLocation,
    Menu,
    MenuItem,
    Merchant,
    Order,
    OrderConstraints,
    OrderStatus,
    PaymentAuthorization,
    format_money,
)

__all__ = [
    "MerchantAdapter",
    "MockMerchantAdapter",
    "MerchantError",
    "MerchantNotFound",
    "ItemUnavailable",
    "PaymentDeclined",
    "OrderNotFound",
    "Merchant",
    "Menu",
    "MenuItem",
    "Cart",
    "CartLine",
    "Order",
    "OrderStatus",
    "OrderConstraints",
    "PaymentAuthorization",
    "DietaryTag",
    "GeoLocation",
    "format_money",
    "Diner",
    "Assignment",
    "TeamPlan",
    "plan_team_order",
]
