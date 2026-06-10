import type { ToolDefinition } from "../types";
import { createIssue, addComment, addLabels } from "./github-api";

export const updateGithub: ToolDefinition = {
  name: "updateGithub",
  mode: "write",
  owners: ["edrick", "darren"],
  allowedAgents: ["updater", "coder"],
  description:
    "Update GitHub issues, PR metadata, labels, comments, or branches after approval.",
  promptPath: "packages/tools/src/github/update-github.prompt.md",
  async run(input) {
    const { owner, repo, action, issueNumber, title, body, labels } = input as {
      owner: string;
      repo: string;
      action: "createIssue" | "comment" | "label";
      issueNumber?: number;
      title?: string;
      body?: string;
      labels?: string[];
    };

    if (!owner || !repo || !action) {
      return {
        ok: false,
        tool: "updateGithub",
        summary: "Missing required fields: owner, repo, action",
      };
    }

    try {
      if (action === "createIssue") {
        if (!title) {
          return { ok: false, tool: "updateGithub", summary: "Missing title for createIssue" };
        }
        const issue = await createIssue(owner, repo, title, body ?? "", labels);
        return {
          ok: true,
          tool: "updateGithub",
          summary: `Created issue #${issue.number}: ${issue.title}`,
          data: { url: issue.html_url, number: issue.number },
        };
      }

      if (action === "comment") {
        if (!issueNumber || !body) {
          return { ok: false, tool: "updateGithub", summary: "Missing issueNumber or body for comment" };
        }
        const comment = await addComment(owner, repo, issueNumber, body);
        return {
          ok: true,
          tool: "updateGithub",
          summary: `Added comment to #${issueNumber}`,
          data: { url: comment.html_url, id: comment.id },
        };
      }

      if (action === "label") {
        if (!issueNumber || !labels?.length) {
          return { ok: false, tool: "updateGithub", summary: "Missing issueNumber or labels" };
        }
        const result = await addLabels(owner, repo, issueNumber, labels);
        return {
          ok: true,
          tool: "updateGithub",
          summary: `Added label(s) ${labels.join(", ")} to #${issueNumber}`,
          data: { labels: result.map((l) => l.name) },
        };
      }

      return { ok: false, tool: "updateGithub", summary: `Unknown action: ${action}` };
    } catch (error) {
      return {
        ok: false,
        tool: "updateGithub",
        summary: `GitHub update failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
};
