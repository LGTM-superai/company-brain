export interface RepoMonitor {
  owner: string;
  repo: string;
  repoUrl: string;
  installationId: number;
  monitorId: string;
  webhookSecret: string;
  packages: string[];
  defaultBranch: string;
  slackChannelId: string;
  severityThreshold: "critical" | "high" | "moderate" | "low" | "all";
  createdAt: Date;
  status: "active" | "paused" | "error";
}

export type CveStatus =
  | "processing"
  | "pr_opened"
  | "notified"
  | "no_fix"
  | "error"
  | "skipped";

export interface CveRecord {
  repo: string; // "owner/name"
  cveId: string; // CVE-YYYY-NNNNN or GHSA-...
  ghsaId?: string;
  package: string;
  currentVersion: string;
  vulnerableRange?: string;
  patchedVersion?: string;
  severity?: string;
  advisoryUrl?: string;
  status: CveStatus;
  skipReason?: string;
  lockedUntil?: Date;
  prUrl?: string;
  branch?: string;
  slackTs?: string;
  sandboxId?: string;
  error?: string;
  createdAt: Date;
  processedAt?: Date;
}

export interface OsvFinding {
  package: string;
  currentVersion: string;
  cve: string | null;
  ghsa: string;
  vulnerableRange: string | null;
  patchedVersion: string | null;
  severity: string;
  advisoryUrl: string;
  summary: string;
  affected: boolean;
}

export interface CveJobMessage {
  monitorId: string;
  owner: string;
  repo: string;
  repoUrl: string;
  installationId: number;
  slackChannelId: string;
  defaultBranch: string;
  cveId: string;
  ghsaId?: string;
  package: string;
  advisoryUrl: string;
  rawSummary?: string;
}

export interface RegisterRepoRequest {
  owner: string;
  repo: string;
  slackChannelId: string;
  severityThreshold?: RepoMonitor["severityThreshold"];
}
