# queryRepos

Query the CVE monitoring service to list registered repositories and their tracked packages.

## When to use

- User asks about monitored repos, CVE alerts, or package vulnerabilities
- User wants to know which repos are registered for CVE monitoring
- User asks about dependency security for specific repos

## Input

- `monitorId` (optional): fetch a specific monitor by ID
- `limit` (optional): max results (1–100, default 20)
- `offset` (optional): pagination offset

## Output

Returns an array of repo monitors with: owner, repo, monitorId, packages, slackChannelId, severityThreshold, status, createdAt.
