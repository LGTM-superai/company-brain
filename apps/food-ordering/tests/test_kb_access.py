"""Tests for the S3 prefix-based access model (mirrors infra/terraform/iam.tf)."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "infra" / "sample_kb"))
from access import ROLE_TIERS, can_read, tier_of_key  # noqa: E402


def test_matrix_matches_terraform():
    assert ROLE_TIERS["dev"] == {"public", "internal"}
    assert ROLE_TIERS["hr"] == {"public", "internal", "restricted"}
    assert ROLE_TIERS["csuite"] == {"public", "internal", "confidential", "restricted"}


def test_dev_reads_only_public_internal():
    assert can_read("dev", "md/public/company/x.md")
    assert can_read("dev", "md/internal/engineering/x.md")
    assert not can_read("dev", "md/confidential/business/x.md")
    assert not can_read("dev", "md/restricted/people/x.md")


def test_hr_reads_restricted_not_confidential():
    assert can_read("hr", "md/restricted/people/x.md")
    assert can_read("hr", "md/internal/product/x.md")
    assert not can_read("hr", "md/confidential/business/x.md")


def test_csuite_reads_all_tiers():
    for tier in ("public", "internal", "confidential", "restricted"):
        assert can_read("csuite", f"md/{tier}/d/x.md")


def test_unknown_role_reads_nothing():
    assert not can_read("intern", "md/public/company/x.md")


def test_bad_key_raises():
    with pytest.raises(ValueError):
        tier_of_key("raw/public/2026/x.pdf")  # not an md/<tier> key
    with pytest.raises(ValueError):
        tier_of_key("md/topsecret/x.md")  # unknown tier
