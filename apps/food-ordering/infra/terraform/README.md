# Knowledge-base infrastructure (Terraform)

Provisions the S3 bucket that stores the company-brain knowledge base, the per-role
IAM users that enforce **content access by sensitivity tier**, and (opt-in) the
**Amazon DocumentDB** cluster used for the catalog/search.

## What it creates

- **One S3 bucket** with versioning, AES256 encryption, all public access blocked,
  TLS-only bucket policy, and lifecycle rules (archive `raw/`, expire old versions).
- **Three reader IAM users** — `company-brain-dev`, `-hr`, `-csuite` — each scoped by
  prefix to the tiers its role may read.
- **One ingest IAM user** — `company-brain-ingest` — write/read across all tiers (for
  the classification pipeline).
- **Access keys** for each user (Terraform outputs, marked sensitive).
- **(opt-in) Amazon DocumentDB** — a MongoDB-compatible cluster (subnet group, security
  group, instance) in your default VPC. Enable with `create_docdb = true` +
  `docdb_master_password`. Outputs: `docdb_endpoint`, `docdb_uri_template`. It's VPC-only,
  so connect from inside the VPC (or via a bastion/tunnel); the app needs the Amazon RDS
  CA bundle for TLS.

## Key layout

```
raw/<tier>/<yyyy>/<doc_id>.<ext>     immutable originals (provenance)
md/<tier>/<domain>/<doc_id>.md       derived Markdown the agent reads
tier ∈ { public, internal, confidential, restricted }
```

## Access matrix (the hard content boundary)

| Tier | dev | hr | csuite |
|---|:--:|:--:|:--:|
| `public/` | ✅ | ✅ | ✅ |
| `internal/` | ✅ | ✅ | ✅ |
| `confidential/` | – | – | ✅ |
| `restricted/` | – | ✅ | ✅ |

Reads are `s3:GetObject` on `md/<tier>/*` for the role's tiers; `s3:ListBucket` is
prefix-restricted to the same tiers. Re-classifying a doc's tier = move the object to
a new prefix.

## Usage

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # set a globally-unique bucket_name
terraform init
terraform plan
terraform apply
```

Requires AWS credentials with rights to manage S3 + IAM (env vars, `AWS_PROFILE`, etc.).

### Get the keys into the app

The per-role keys go into the Mongo `users` collection (POC auth: username → role → keys).

```bash
terraform output -json reader_access_keys   # { dev: {...}, hr: {...}, csuite: {...} }
terraform output -json ingest_access_key
```

## Security notes

- ⚠️ **`terraform.tfstate` contains the IAM secret keys in plaintext.** It's gitignored.
  For anything beyond a POC, use a remote backend (S3 + DynamoDB lock) with encryption,
  and prefer **STS AssumeRole** over long-lived user keys.
- The bucket is private and TLS-only; encryption defaults to SSE-S3. For per-tier key
  control, switch the `restricted` tier to `aws:kms` with a dedicated CMK.
- IAM is the **content** boundary. The Mongo metadata index is intentionally *not*
  access-filtered (titles are visible); content is gated here at S3.

## Teardown

```bash
terraform destroy
```

(`force_destroy = true` lets it delete a non-empty bucket.)
