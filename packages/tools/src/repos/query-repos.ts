import type { ToolDefinition } from "../types";
import { listRepoMonitors, getRepoMonitor } from "./repos-api";

export const queryRepos: ToolDefinition = {
  name: "queryRepos",
  mode: "read",
  owners: ["laksh", "edrick"],
  allowedAgents: ["main", "coder"],
  description:
    "Query the CVE monitoring service for registered repos, their tracked packages, and alert configuration.",
  promptPath: "packages/tools/src/repos/query-repos.prompt.md",
  async run(input) {
    const { monitorId, limit, offset } = input as {
      monitorId?: string;
      limit?: number;
      offset?: number;
    };

    try {
      if (monitorId) {
        const monitor = await getRepoMonitor(monitorId);
        return {
          ok: true,
          tool: "queryRepos",
          summary: `Fetched monitor ${monitor.monitorId} (${monitor.owner}/${monitor.repo})`,
          data: { monitors: [monitor], total: 1 },
        };
      }

      const result = await listRepoMonitors(limit, offset);
      return {
        ok: true,
        tool: "queryRepos",
        summary: `Found ${result.total} repo monitor(s)`,
        data: { monitors: result.repos, total: result.total },
      };
    } catch (error) {
      return {
        ok: false,
        tool: "queryRepos",
        summary: `Repos query failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
};
