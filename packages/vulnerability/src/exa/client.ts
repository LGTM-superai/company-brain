import Exa from "exa-js";
import { getConfig } from "../config.js";

let _exa: Exa | null = null;

export async function getExaClient(): Promise<Exa> {
  if (_exa) return _exa;
  const cfg = await getConfig();
  _exa = new Exa(cfg.exaApiKey);
  return _exa;
}

export async function createRepoMonitor(opts: {
  owner: string;
  repo: string;
  packages: string[];
  webhookUrl: string;
}): Promise<{ monitorId: string; webhookSecret: string }> {
  const exa = await getExaClient();

  const pkgList = opts.packages.slice(0, 50).join(", ");
  const query =
    `New CVE security vulnerability or security advisory affecting any of these npm packages: ${pkgList}. ` +
    `Sources: nvd.nist.gov, github.com/advisories, osv.dev, snyk.io`;

  const monitor = await (exa as any).monitors.create({
    name: `cve-watch:${opts.owner}/${opts.repo}`,
    search: {
      query,
      numResults: 25,
      contents: {
        text: true,
        summary: { query: "CVE id, affected npm package, severity, fixed version" },
      },
    },
    outputSchema: {
      type: "object",
      description: "Structured CVE advisory record",
      properties: {
        cveId: { type: "string", description: "CVE-YYYY-NNNNN or GHSA-... identifier" },
        package: { type: "string", description: "Affected npm package name" },
        severity: { type: "string", description: "critical/high/moderate/low" },
        affectedVersions: { type: "string" },
        summary: { type: "string" },
      },
      required: ["cveId"],
    },
    trigger: { type: "interval", period: "1d" },
    webhook: {
      url: opts.webhookUrl,
      events: ["monitor.run.completed"],
    },
  });

  return {
    monitorId: monitor.id as string,
    webhookSecret: (monitor as any).webhookSecret as string,
  };
}

export async function triggerMonitor(monitorId: string): Promise<void> {
  const exa = await getExaClient();
  await (exa as any).monitors.trigger(monitorId);
}

export async function deleteMonitor(monitorId: string): Promise<void> {
  const exa = await getExaClient();
  await (exa as any).monitors.delete(monitorId);
}
