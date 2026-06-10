"""Role → sensitivity access model (canonical copy; mirrors infra/terraform/iam.tf).

In production S3 IAM is the hard boundary; this mirrors it so the app can pre-check
and so the *local* backend (no AWS) enforces the same rules for testing.
"""

from __future__ import annotations

ALL_TIERS = ("public", "internal", "confidential", "restricted")

# Keep in sync with local.role_tiers in infra/terraform/iam.tf.
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
    return tier_of_key(key) in ROLE_TIERS.get(role, set())
