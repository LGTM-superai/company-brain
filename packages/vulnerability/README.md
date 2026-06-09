# lgtm-vulnerability

CVE-monitor auto-PR service. Watches npm packages in any GitHub repo via [Exa monitors](https://exa.ai/docs/reference/monitors-api-guide-for-coding-agents), deduplicates findings in AWS DocumentDB, and opens GitHub pull requests via the Claude Agent SDK running in a Vercel Sandbox.

## Architecture

```
POST /repos  →  registerRepo Lambda  →  GitHub App (read package.json)
                                     →  Exa: create 1 monitor per repo
                                     →  DocumentDB: repo_monitors

Exa fires  →  POST /exa/webhook/{monitorId}  →  exaWebhook Lambda (verify HMAC)
                                              →  SQS cve-jobs

SQS  →  worker Lambda (≤15 min):
  1. OSV.dev: get vulnerableRange + patchedVersion
  2. DocumentDB: claim CVE (lease-based dedup)
  3. Vercel Sandbox: clone repo → Claude Agent SDK → git push
  4. GitHub: open PR
  5. Slack: post CVE + PR button
  6. DocumentDB: update status
```

## Prerequisites

- AWS account with DocumentDB cluster running (see `lgtm-iac`)
- [GitHub App](https://docs.github.com/en/apps/creating-github-apps/creating-github-apps/creating-a-github-app) created with permissions:
  - Repository: **Contents** (Read & Write), **Pull requests** (Read & Write), **Metadata** (Read)
- Slack app with `chat:write` scope, bot invited to the target channel
- Exa AI account and API key
- Anthropic API key
- Vercel account (Pro plan recommended for sandbox duration ≤5h; Hobby max 45min)

## Setup

### 1. Create the GitHub App

1. Go to [GitHub Developer Settings → GitHub Apps](https://github.com/settings/apps/new)
2. Set app name, homepage URL
3. Permissions: Repository → Contents (R/W), Pull requests (R/W), Metadata (Read)
4. Generate and download a private key
5. Note the **App ID** and **App slug**

### 2. Deploy Infrastructure (lgtm-iac)

```bash
cd ../lgtm-iac

# Build the Lambda zips first
cd ../lgtm-vulnerability && npm install && npm run build && cd ../lgtm-iac

# First apply: seeds secrets and creates infra (API_BASE_URL not yet known)
terraform apply \
  -var="cve_exa_api_key=YOUR_EXA_KEY" \
  -var="cve_github_app_id=123456" \
  -var='cve_github_app_private_key=-----BEGIN RSA PRIVATE KEY-----\n...' \
  -var="cve_slack_bot_token=xoxb-..." \
  -var="cve_anthropic_api_key=sk-ant-..." \
  -var="cve_vercel_token=..." \
  -var="cve_vercel_team_id=team_..." \
  -var="cve_vercel_project_id=prj_..." \
  -var="docdb_master_password=YOUR_DOCDB_PASS" \
  -var="cve_github_app_slug=your-app-slug"

# Capture the API base URL
export API_BASE_URL=$(terraform output -raw api_base_url)
echo "API_BASE_URL: $API_BASE_URL"

# Second apply: wire API_BASE_URL into Lambda env vars
terraform apply \
  ... (same vars as above) \
  -var="cve_api_base_url=$API_BASE_URL"
```

### 3. Install GitHub App on a repository

Before calling `POST /repos`, the GitHub App must be installed on the target repository:

```
https://github.com/apps/YOUR-APP-SLUG/installations/new
```

Select the repositories you want to monitor, grant the requested permissions.

### 4. Register a repository

```bash
curl -X POST $API_BASE_URL/repos \
  -H "Content-Type: application/json" \
  -d '{
    "owner": "myorg",
    "repo": "myapp",
    "slackChannelId": "C0123ABC456"
  }'
```

Response:
```json
{
  "ok": true,
  "monitorId": "mon_xxx",
  "packages": 42,
  "message": "Monitoring 42 packages for myorg/myapp"
}
```

The service now polls for CVEs daily. When a new one appears, it will:
1. Open a PR on `myorg/myapp` with the fix
2. Post a Slack message to `C0123ABC456` with the CVE details and PR link

## Environment Variables (Lambda)

These are set automatically by Terraform but documented here for local dev:

| Variable | Description |
|---|---|
| `API_BASE_URL` | Public API Gateway URL (used in Exa webhook URLs) |
| `SQS_QUEUE_URL` | CVE jobs SQS queue URL |
| `GITHUB_APP_SLUG` | GitHub App slug (for install link in 422 responses) |
| `AWS_REGION` | AWS region (`us-west-2`) |

## Secrets (AWS Secrets Manager at `lgtm/cve/*`)

| Secret | Description |
|---|---|
| `lgtm/cve/exa-api-key` | Exa AI API key |
| `lgtm/cve/github-app-id` | GitHub App numeric ID |
| `lgtm/cve/github-app-private-key` | GitHub App PEM private key |
| `lgtm/cve/slack-bot-token` | Slack bot token (`xoxb-...`) |
| `lgtm/cve/anthropic-api-key` | Anthropic API key for Claude Agent SDK |
| `lgtm/cve/vercel-token` | Vercel access token |
| `lgtm/cve/vercel-team-id` | Vercel team ID |
| `lgtm/cve/vercel-project-id` | Vercel project ID |
| `lgtm/cve/docdb-user` | DocumentDB username |
| `lgtm/cve/docdb-pass` | DocumentDB password |
| `lgtm/cve/docdb-endpoint` | DocumentDB internal cluster endpoint |

## Local Development

```bash
# Install deps
npm install
npm install -D fastify dotenv tsx

# Create .env file
cat > .env <<EOF
AWS_REGION=us-west-2
API_BASE_URL=https://YOUR-NGROK-URL
SQS_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/326453986795/lgtm-cve-jobs
GITHUB_APP_SLUG=your-app-slug
EOF

# Run dev server
npm run dev

# Expose webhook publicly
ngrok http 3000
# Then update API_BASE_URL to the ngrok URL in .env
```

## Testing

```bash
# Unit tests
npm test

# Test a specific module
npx vitest run src/osv/enrich.test.ts

# Manually trigger an Exa monitor (requires EXA_API_KEY env var)
node -e "
import('./src/exa/client.js').then(m => m.triggerMonitor('mon_YOUR_ID'))
"
```

## Known Limitations (v1)

- **Direct dependencies only**: `package.json` `dependencies` + `devDependencies`. Transitive deps (lockfile) not scanned.
- **Version ranges**: Without a lockfile, `semver.minVersion(range)` is used as the current version. This can produce false-positive PRs for ranges whose upper bound is already patched — the empty-diff guard catches most cases.
- **Required-signed-commits**: Repos requiring GPG-signed commits are not supported (push will fail with a clear error in Slack).
- **Fork repos**: Rejected at registration (`POST /repos`).
- **Lambda 15-min cap**: Very large repos may need Step Functions escalation (not in v1).
