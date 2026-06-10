# API Contract — `/repos`

- **Base URL:** `https://z39345gj9k.execute-api.us-west-2.amazonaws.com`
- **Content type:** `application/json` for all request and response bodies.
- **Auth:** None (API Gateway is public). See [Auth](#auth).

| Method | Path | Description |
|---|---|---|
| `POST` | `/repos` | Register a repo for CVE monitoring |
| `GET` | `/repos` | List registered repos (paginated) |
| `GET` | `/repos/{monitorId}` | Fetch a single registration |
| `PATCH` | `/repos/{monitorId}` | Update `slackChannelId`, `severityThreshold`, or `status` |
| `DELETE` | `/repos/{monitorId}` | Deregister a repo |

---

## Response shape

All endpoints return a `RepoMonitor` object (or array of them). Fields:

| Field | Type | Notes |
|---|---|---|
| `owner` | `string` | GitHub org/user login |
| `repo` | `string` | Repository name |
| `monitorId` | `string` | ID for this registration — use in GET/PATCH/DELETE |
| `packages` | `string[]` | npm packages being monitored |
| `slackChannelId` | `string` | Slack channel receiving alerts |
| `severityThreshold` | `"critical" \| "high" \| "moderate" \| "low" \| "all"` | Minimum severity to act on |
| `status` | `"active" \| "paused" \| "error"` | Monitor state |
| `createdAt` | `string` (ISO 8601) | Registration timestamp |

---

## `POST /repos` — Register a repository

Creates a CVE monitor for the repo. Reads `package.json` from the default branch to determine what packages to watch. Re-posting the same `owner`/`repo` updates the registration.

> The GitHub App must be installed on the repo before calling this. If not, the response includes an `installUrl`.

### Request body

| Field | Type | Required | Default |
|---|---|:---:|---|
| `owner` | `string` | ✅ | — |
| `repo` | `string` | ✅ | — |
| `slackChannelId` | `string` | ❌ | `"C0B8VPAUNN9"` |
| `severityThreshold` | `"critical" \| "high" \| "moderate" \| "low" \| "all"` | ❌ | `"all"` |

```json
{
  "owner": "myorg",
  "repo": "myapp",
  "slackChannelId": "C0123ABC456",
  "severityThreshold": "high"
}
```

### `200 OK`

```json
{
  "ok": true,
  "monitorId": "mon_abc123",
  "packages": 42,
  "message": "Monitoring 42 packages for myorg/myapp"
}
```

### Errors

| Status | Condition |
|---|---|
| `400` | Missing `owner` or `repo` |
| `400` | Repo is a fork |
| `422` | GitHub App not installed — redirect the user to `installUrl` to authorize the app |
| `422` | No `package.json` found or no dependencies in it |

The `422` for an uninstalled app looks like this — send the user to `installUrl`:

```json
{
  "error": "GitHub App not installed on this repository",
  "installUrl": "https://github.com/apps/lgtm-cve-bot/installations/new?suggested_target_id={owner}"
}
```

---

## `GET /repos` — List registrations

### Query parameters

| Param | Type | Default | Constraints |
|---|---|---|---|
| `limit` | `integer` | `20` | 1–100 |
| `offset` | `integer` | `0` | ≥ 0 |

### `200 OK`

```json
{
  "repos": [
    {
      "owner": "myorg",
      "repo": "myapp",
      "monitorId": "mon_abc123",
      "packages": ["react", "express"],
      "slackChannelId": "C0123ABC456",
      "severityThreshold": "all",
      "status": "active",
      "createdAt": "2026-06-10T12:00:00.000Z"
    }
  ],
  "count": 1,
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

### Errors

| Status | Condition |
|---|---|
| `400` | Non-integer `limit` or `offset` |

---

## `GET /repos/{monitorId}` — Fetch one

### `200 OK`

Single `RepoMonitor` object (same shape as items in the list response).

### Errors

| Status | Condition |
|---|---|
| `404` | Monitor not found |

---

## `PATCH /repos/{monitorId}` — Update

At least one field required. Only these three are mutable:

| Field | Type |
|---|---|
| `slackChannelId` | `string` |
| `severityThreshold` | `"critical" \| "high" \| "moderate" \| "low" \| "all"` |
| `status` | `"active" \| "paused"` |

```json
{ "status": "paused" }
```

### `200 OK`

```json
{
  "ok": true,
  "repo": {
    "owner": "myorg",
    "repo": "myapp",
    "monitorId": "mon_abc123",
    "packages": ["react", "express"],
    "slackChannelId": "C0123ABC456",
    "severityThreshold": "all",
    "status": "paused",
    "createdAt": "2026-06-10T12:00:00.000Z"
  }
}
```

### Errors

| Status | Condition |
|---|---|
| `400` | Empty body or no recognized fields |
| `400` | Invalid field value |
| `404` | Monitor not found |

---

## `DELETE /repos/{monitorId}` — Deregister

### `200 OK`

```json
{ "ok": true, "deleted": true }
```

### Errors

| Status | Condition |
|---|---|
| `404` | Monitor not found |

---

## Auth

No authentication today. Before exposing this beyond trusted callers, add an API Gateway API key (`x-api-key` header) or a Lambda authorizer.
