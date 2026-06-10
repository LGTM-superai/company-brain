"""Domain models for the merchant integration.

Money is always represented as integer minor units (cents) plus a currency code
to avoid floating-point rounding errors — never use floats for money.

These pydantic models map 1:1 onto the kind of payloads a real buyer-side
ordering API (e.g. Uber Consumer Delivery) exchanges, so they double as the
FastAPI request/response schemas later.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
# Enums
# --------------------------------------------------------------------------- #
class DietaryTag(str, Enum):
    """Dietary capabilities a merchant/item can satisfy, or a person requires."""

    VEGETARIAN = "vegetarian"
    VEGAN = "vegan"
    HALAL = "halal"
    PESCATARIAN = "pescatarian"
    GLUTEN_FREE = "gluten_free"
    DAIRY_FREE = "dairy_free"
    NUT_FREE = "nut_free"
    SEAFOOD_FREE = "seafood_free"


class Allergen(str, Enum):
    """Allergens an item may contain (used to honour 'exclude_allergens')."""

    PEANUTS = "peanuts"
    TREE_NUTS = "tree_nuts"
    GLUTEN = "gluten"
    DAIRY = "dairy"
    EGG = "egg"
    SOY = "soy"
    SHELLFISH = "shellfish"
    FISH = "fish"
    SESAME = "sesame"


class OrderStatus(str, Enum):
    """Lifecycle of an order, in progression order."""

    CREATED = "created"
    CONFIRMED = "confirmed"
    PREPARING = "preparing"
    OUT_FOR_DELIVERY = "out_for_delivery"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"
    FAILED = "failed"


# Ordered status flow used by the mock to simulate progress.
STATUS_FLOW: list[OrderStatus] = [
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERED,
]


# --------------------------------------------------------------------------- #
# Money helper
# --------------------------------------------------------------------------- #
def format_money(cents: int, currency: str = "SGD") -> str:
    """Render integer minor units as a human string, e.g. 1250 -> 'SGD 12.50'."""
    return f"{currency} {cents / 100:.2f}"


# --------------------------------------------------------------------------- #
# Core models
# --------------------------------------------------------------------------- #
class GeoLocation(BaseModel):
    """A delivery location. Postal code is enough for the SG POC."""

    label: str = "Office"
    postal_code: str = "048621"  # Marina Bay-ish default
    address: str = "Company Brain HQ, Singapore"


class MenuItem(BaseModel):
    id: str
    merchant_id: str
    name: str
    description: str = ""
    price_cents: int = Field(ge=0)
    currency: str = "SGD"
    cuisine: str | None = None  # used to match a diner's cuisine preference
    dietary_tags: set[DietaryTag] = Field(default_factory=set)
    allergens: set[Allergen] = Field(default_factory=set)
    available: bool = True

    def satisfies(
        self,
        required_tags: set[DietaryTag],
        excluded_allergens: set[Allergen],
    ) -> bool:
        """True if this item meets every dietary requirement and excludes allergens."""
        if not self.available:
            return False
        if not required_tags.issubset(self.dietary_tags):
            return False
        if self.allergens & excluded_allergens:
            return False
        return True


class Menu(BaseModel):
    merchant_id: str
    items: list[MenuItem] = Field(default_factory=list)

    def item(self, item_id: str) -> MenuItem | None:
        return next((i for i in self.items if i.id == item_id), None)


class Merchant(BaseModel):
    id: str
    name: str
    cuisines: list[str] = Field(default_factory=list)
    # Dietary capabilities the merchant can cater to *somewhere* on its menu.
    dietary_options: set[DietaryTag] = Field(default_factory=set)
    rating: float = Field(ge=0, le=5, default=4.5)
    eta_minutes: int = 35
    min_order_cents: int = 0
    delivery_fee_cents: int = 0
    currency: str = "SGD"


class CartLine(BaseModel):
    item_id: str
    name: str
    unit_price_cents: int
    quantity: int = Field(ge=1, default=1)
    notes: str = ""

    @property
    def line_total_cents(self) -> int:
        return self.unit_price_cents * self.quantity


class Cart(BaseModel):
    id: str
    merchant_id: str
    currency: str = "SGD"
    lines: list[CartLine] = Field(default_factory=list)
    delivery_fee_cents: int = 0

    @property
    def subtotal_cents(self) -> int:
        return sum(line.line_total_cents for line in self.lines)

    @property
    def total_cents(self) -> int:
        return self.subtotal_cents + self.delivery_fee_cents


class OrderConstraints(BaseModel):
    """Constraints the agent derives from the company brain before ordering.

    e.g. union of the tech team's dietary needs + the per-head budget the
    requester authorised.
    """

    required_dietary: set[DietaryTag] = Field(default_factory=set)
    excluded_allergens: set[Allergen] = Field(default_factory=set)
    preferred_cuisines: list[str] = Field(default_factory=list)
    budget_per_head_cents: int | None = None
    headcount: int = 1


class PaymentAuthorization(BaseModel):
    """Simulates the agent's virtual Stripe card and its spending limit.

    In production this is enforced by Stripe Issuing spending_controls + the
    real-time authorization webhook. Here the mock enforces the cap so the POC
    can demonstrate a decline when an order exceeds the limit.
    """

    card_id: str
    authorized_by: str  # human who granted the agent this card
    limit_cents: int
    currency: str = "SGD"


class Order(BaseModel):
    id: str
    merchant_id: str
    cart: Cart
    status: OrderStatus = OrderStatus.CREATED
    currency: str = "SGD"
    total_cents: int = 0
    eta_minutes: int = 35
    payment_card_id: str | None = None
    external_ref: str | None = None  # provider's own order id
