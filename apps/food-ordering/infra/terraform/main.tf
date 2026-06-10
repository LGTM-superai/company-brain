provider "aws" {
  region = var.aws_region
}

# ──────────────────────────────────────────────────────────────────────────────
# Knowledge-base bucket
#
# Layout (sensitivity is high in the key so prefix-based IAM is trivial):
#   raw/<tier>/<yyyy>/<doc_id>.<ext>     immutable originals (provenance)
#   md/<tier>/<domain>/<doc_id>.md       derived Markdown the agent reads
# where <tier> ∈ {public, internal, confidential, restricted}
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_s3_bucket" "brain" {
  bucket        = var.bucket_name
  force_destroy = var.force_destroy
  tags          = var.tags
}

# Disable ACLs entirely — access is governed by IAM + bucket policy only.
resource "aws_s3_bucket_ownership_controls" "brain" {
  bucket = aws_s3_bucket.brain.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Block all public access. This bucket is never public.
resource "aws_s3_bucket_public_access_block" "brain" {
  bucket                  = aws_s3_bucket.brain.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning: history + recover from bad re-ingests / deletions.
resource "aws_s3_bucket_versioning" "brain" {
  bucket = aws_s3_bucket.brain.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Encryption at rest (SSE-S3 / AES256). Swap to aws:kms with a CMK later for the
# restricted tier if you want per-tier key control.
resource "aws_s3_bucket_server_side_encryption_configuration" "brain" {
  bucket = aws_s3_bucket.brain.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# Lifecycle: archive cold originals, and expire old noncurrent versions.
resource "aws_s3_bucket_lifecycle_configuration" "brain" {
  bucket     = aws_s3_bucket.brain.id
  depends_on = [aws_s3_bucket_versioning.brain]

  rule {
    id     = "raw-archival"
    status = "Enabled"
    filter {
      prefix = "raw/"
    }
    transition {
      days          = var.raw_ia_transition_days
      storage_class = "STANDARD_IA"
    }
    transition {
      days          = var.raw_glacier_transition_days
      storage_class = "GLACIER"
    }
  }

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }
  }
}

# Belt-and-suspenders: deny any non-TLS access to the bucket.
data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.brain.arn, "${aws_s3_bucket.brain.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "brain" {
  bucket = aws_s3_bucket.brain.id
  policy = data.aws_iam_policy_document.bucket.json
}
