import crypto from "node:crypto";
import type { CveJobMessage } from "../types.js";

const CVE_RE = /^CVE-\d{4}-\d+$/;
const GHSA_RE = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i;

export function isValidCveId(id: string): boolean {
  return CVE_RE.test(id) || GHSA_RE.test(id);
}

/**
 * Verify the Exa-Signature header.
 * Header format: "t=<timestamp>,v1=<hex>"
 * Signed string: "<timestamp>.<rawBody>"
 */
export function verifyExaSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string
): boolean {
  try {
    const parts = Object.fromEntries(
      signatureHeader.split(",").map((p) => p.split("=") as [string, string])
    );
    const t = parts["t"];
    const v1 = parts["v1"];
    if (!t || !v1) return false;

    const signed = `${t}.${rawBody}`;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(signed)
      .digest("hex");

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}

export interface ExaWebhookPayload {
  monitorId: string;
  runId: string;
  output?: {
    results?: Array<{ title: string; url: string; publishedDate?: string }>;
    content?: Record<string, unknown>;
    grounding?: unknown;
  };
}

/**
 * Parse Exa monitor.run.completed webhook into candidate CVE job messages.
 * The outputSchema on the monitor asks for {cveId, package, severity, ...}.
 * Each result that has a valid CVE/GHSA id becomes one SQS job message.
 */
export function parseWebhookCandidates(
  payload: ExaWebhookPayload,
  repoContext: {
    owner: string;
    repo: string;
    repoUrl: string;
    installationId: number;
    slackChannelId: string;
    defaultBranch: string;
  }
): CveJobMessage[] {
  const candidates: CveJobMessage[] = [];

  const content = payload.output?.content as
    | { cveId?: string; package?: string; severity?: string; summary?: string }
    | undefined;

  const results = payload.output?.results ?? [];

  // Primary: structured outputSchema content
  if (content?.cveId && isValidCveId(content.cveId)) {
    candidates.push({
      monitorId: payload.monitorId,
      ...repoContext,
      cveId: content.cveId,
      package: content.package ?? "",
      advisoryUrl: results[0]?.url ?? `https://osv.dev/`,
      rawSummary: content.summary,
    });
  }

  // Fallback: scan results titles/urls for CVE/GHSA ids
  for (const result of results) {
    const matches = result.title.match(/CVE-\d{4}-\d+|GHSA-[a-z0-9-]+/gi) ?? [];
    for (const match of matches) {
      if (isValidCveId(match) && !candidates.find((c) => c.cveId === match)) {
        candidates.push({
          monitorId: payload.monitorId,
          ...repoContext,
          cveId: match,
          package: content?.package ?? "",
          advisoryUrl: result.url,
        });
      }
    }
  }

  return candidates;
}
