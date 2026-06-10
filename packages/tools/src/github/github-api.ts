const GITHUB_API = "https://api.github.com";

function getHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Missing GITHUB_TOKEN env var");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: { ...getHeaders(), ...init?.headers },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export type GHRepo = {
  full_name: string;
  description: string | null;
  default_branch: string;
  open_issues_count: number;
  language: string | null;
};

export type GHIssue = {
  number: number;
  title: string;
  state: string;
  user: { login: string } | null;
  labels: Array<{ name: string }>;
  created_at: string;
  html_url: string;
};

export type GHPull = {
  number: number;
  title: string;
  state: string;
  user: { login: string } | null;
  head: { ref: string };
  base: { ref: string };
  created_at: string;
  html_url: string;
  draft: boolean;
};

export async function getRepo(owner: string, repo: string) {
  return ghFetch<GHRepo>(`/repos/${owner}/${repo}`);
}

export async function listIssues(owner: string, repo: string, state = "open", perPage = 10) {
  return ghFetch<GHIssue[]>(
    `/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}&sort=updated&direction=desc`,
  );
}

export async function listPulls(owner: string, repo: string, state = "open", perPage = 10) {
  return ghFetch<GHPull[]>(
    `/repos/${owner}/${repo}/pulls?state=${state}&per_page=${perPage}&sort=updated&direction=desc`,
  );
}

export async function createIssue(
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels?: string[],
) {
  return ghFetch<GHIssue>(`/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, labels }),
  });
}

export async function addComment(owner: string, repo: string, issueNumber: number, body: string) {
  return ghFetch<{ id: number; html_url: string }>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
}

export async function addLabels(owner: string, repo: string, issueNumber: number, labels: string[]) {
  return ghFetch<Array<{ name: string }>>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labels }),
    },
  );
}
