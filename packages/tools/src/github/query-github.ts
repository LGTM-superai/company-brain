import type { ToolDefinition } from "../types";
import { getRepo, listIssues, listPulls } from "./github-api";

export const queryGithub: ToolDefinition = {
  name: "queryGithub",
  mode: "read",
  owners: ["edrick", "darren"],
  allowedAgents: ["searcher", "coder"],
  description:
    "Read GitHub repositories, issues, pull requests, branches, files, and review context.",
  promptPath: "packages/tools/src/github/query-github.prompt.md",
  async run(input) {
    const { owner, repo, type, state, limit } = input as {
      owner: string;
      repo: string;
      type?: "repo" | "issues" | "pulls";
      state?: "open" | "closed" | "all";
      limit?: number;
    };

    if (!owner || !repo) {
      return {
        ok: false,
        tool: "queryGithub",
        summary: "Missing required fields: owner and repo",
      };
    }

    try {
      const queryType = type ?? "repo";

      if (queryType === "issues") {
        const issues = await listIssues(owner, repo, state ?? "open", limit ?? 10);
        return {
          ok: true,
          tool: "queryGithub",
          summary: `Found ${issues.length} issue(s) for ${owner}/${repo}`,
          data: {
            owner,
            repo,
            type: "issues",
            items: issues.map((i) => ({
              number: i.number,
              title: i.title,
              state: i.state,
              author: i.user?.login ?? "unknown",
              labels: i.labels.map((l) => l.name),
              createdAt: i.created_at,
              url: i.html_url,
            })),
          },
        };
      }

      if (queryType === "pulls") {
        const pulls = await listPulls(owner, repo, state ?? "open", limit ?? 10);
        return {
          ok: true,
          tool: "queryGithub",
          summary: `Found ${pulls.length} PR(s) for ${owner}/${repo}`,
          data: {
            owner,
            repo,
            type: "pulls",
            items: pulls.map((p) => ({
              number: p.number,
              title: p.title,
              state: p.state,
              draft: p.draft,
              author: p.user?.login ?? "unknown",
              head: p.head.ref,
              base: p.base.ref,
              createdAt: p.created_at,
              url: p.html_url,
            })),
          },
        };
      }

      const repoInfo = await getRepo(owner, repo);
      return {
        ok: true,
        tool: "queryGithub",
        summary: `Fetched repo info for ${repoInfo.full_name}`,
        data: {
          owner,
          repo,
          type: "repo",
          info: {
            fullName: repoInfo.full_name,
            description: repoInfo.description,
            defaultBranch: repoInfo.default_branch,
            openIssues: repoInfo.open_issues_count,
            language: repoInfo.language,
          },
        },
      };
    } catch (error) {
      return {
        ok: false,
        tool: "queryGithub",
        summary: `GitHub query failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
};
