const REPOS_API_BASE = "https://z39345gj9k.execute-api.us-west-2.amazonaws.com";

export type RepoMonitorResponse = {
  owner: string;
  repo: string;
  monitorId: string;
  packages: string[];
  slackChannelId: string;
  severityThreshold: "critical" | "high" | "moderate" | "low" | "all";
  status: "active" | "paused" | "error";
  createdAt: string;
};

type ListReposResponse = {
  repos: RepoMonitorResponse[];
  count: number;
  total: number;
  limit: number;
  offset: number;
};

export async function listRepoMonitors(limit = 20, offset = 0): Promise<ListReposResponse> {
  const url = `${REPOS_API_BASE}/repos?limit=${limit}&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Repos API returned ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<ListReposResponse>;
}

export async function getRepoMonitor(monitorId: string): Promise<RepoMonitorResponse> {
  const url = `${REPOS_API_BASE}/repos/${monitorId}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Repos API returned ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<RepoMonitorResponse>;
}
