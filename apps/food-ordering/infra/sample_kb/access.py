"""Local model of the S3 prefix-based IAM policy (mirrors infra/terraform/iam.tf).

This is the same role→tier matrix the real IAM policies enforce. The app can use it
as a pre-check, but S3 remains the hard boundary in production.
"""

from __future__ import annotations

ALL_TIERS = ("public", "internal", "confidential", "restricted")

# Must stay in sync with `local.role_tiers` in infra/terraform/iam.tf.
ROLE_TIERS: dict[str, set[str]] = {
    "dev": {"public", "internal"},
    "hr": {"public", "internal", "restricted"},
    "csuite": {"public", "internal", "confidential", "restricted"},
}


def tier_of_key(key: str) -> str:
    """Extract the sensitivity tier from an `md/<tier>/...` S3 key."""
    parts = key.split("/")
    if len(parts) >= 2 and parts[0] == "md" and parts[1] in ALL_TIERS:
        return parts[1]
    raise ValueError(f"not a valid md/<tier>/... key: {key!r}")


def can_read(role: str, key: str) -> bool:
    """True if `role` is allowed to GetObject this `md/<tier>/...` key."""
    return tier_of_key(key) in ROLE_TIERS.get(role, set())
