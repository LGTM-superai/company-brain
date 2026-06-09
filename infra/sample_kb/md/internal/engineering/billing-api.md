---
doc_id: billing-api
title: Billing API — Authentication & Endpoints
summary: How internal services authenticate to and call the billing API.
domain: engineering
doc_types: [api-documentation]
tags: [api, billing, auth]
sensitivity: internal
s3_key_md: md/internal/engineering/billing-api.md
owner: wei@company.com
team: tech
status: active
---

# Billing API

Authenticate with an API key passed in the `BILLING_API_KEY` env var via the
`Authorization: Bearer` header. Base URL `https://billing.internal/v1`. Endpoints:
`/charges`, `/refunds`, `/customers`.
