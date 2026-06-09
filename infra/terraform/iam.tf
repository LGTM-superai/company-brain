# ──────────────────────────────────────────────────────────────────────────────
# Role → sensitivity access matrix (the hard content boundary).
#
#   tier          dev   hr    csuite
#   public        ✓     ✓     ✓
#   internal      ✓     ✓     ✓
#   confidential  –     –     ✓
#   restricted    –     ✓     ✓
#
# For the POC each role is one IAM user with read access to md/<tier>/* for its
# allowed tiers. The user's access keys are looked up (by username) and used by
# the agent, so S3 enforces what content the agent can read.
# ──────────────────────────────────────────────────────────────────────────────
locals {
  role_tiers = {
    dev    = ["public", "internal"]
    hr     = ["public", "internal", "restricted"]
    csuite = ["public", "internal", "confidential", "restricted"]
  }
}

# ---- Reader IAM users (one per role) ----------------------------------------
data "aws_iam_policy_document" "reader" {
  for_each = local.role_tiers

  statement {
    sid       = "ReadMarkdownObjects"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = [for t in each.value : "${aws_s3_bucket.brain.arn}/md/${t}/*"]
  }

  statement {
    sid       = "ListAllowedPrefixes"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.brain.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = [for t in each.value : "md/${t}/*"]
    }
  }
}

resource "aws_iam_policy" "reader" {
  for_each = local.role_tiers
  name     = "company-brain-read-${each.key}"
  policy   = data.aws_iam_policy_document.reader[each.key].json
  tags     = var.tags
}

resource "aws_iam_user" "reader" {
  for_each = local.role_tiers
  name     = "company-brain-${each.key}"
  tags     = var.tags
}

resource "aws_iam_user_policy_attachment" "reader" {
  for_each   = local.role_tiers
  user       = aws_iam_user.reader[each.key].name
  policy_arn = aws_iam_policy.reader[each.key].arn
}

resource "aws_iam_access_key" "reader" {
  for_each = local.role_tiers
  user     = aws_iam_user.reader[each.key].name
}

# ---- Ingest IAM user (the classification pipeline: write across all tiers) ---
data "aws_iam_policy_document" "ingest" {
  statement {
    sid     = "WriteReadAllTiers"
    effect  = "Allow"
    actions = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = [
      "${aws_s3_bucket.brain.arn}/raw/*",
      "${aws_s3_bucket.brain.arn}/md/*",
    ]
  }

  statement {
    sid       = "ListBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.brain.arn]
  }
}

resource "aws_iam_policy" "ingest" {
  name   = "company-brain-ingest"
  policy = data.aws_iam_policy_document.ingest.json
  tags   = var.tags
}

resource "aws_iam_user" "ingest" {
  name = "company-brain-ingest"
  tags = var.tags
}

resource "aws_iam_user_policy_attachment" "ingest" {
  user       = aws_iam_user.ingest.name
  policy_arn = aws_iam_policy.ingest.arn
}

resource "aws_iam_access_key" "ingest" {
  user = aws_iam_user.ingest.name
}
