import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifyExaSignature, isValidCveId, parseWebhookCandidates } from "./webhook.js";

describe("isValidCveId", () => {
  it("accepts CVE format", () => {
    expect(isValidCveId("CVE-2021-23337")).toBe(true);
    expect(isValidCveId("CVE-2024-12345")).toBe(true);
  });

  it("accepts GHSA format", () => {
    expect(isValidCveId("GHSA-35jh-r3h4-6jhm")).toBe(true);
  });

  it("rejects invalid IDs", () => {
    expect(isValidCveId("not-a-cve")).toBe(false);
    expect(isValidCveId("CVE-abc-123")).toBe(false);
    expect(isValidCveId("")).toBe(false);
  });
});

describe("verifyExaSignature", () => {
  const secret = "test-webhook-secret";

  function makeHeader(body: string): string {
    const t = String(Math.floor(Date.now() / 1000));
    const signed = `${t}.${body}`;
    const v1 = crypto.createHmac("sha256", secret).update(signed).digest("hex");
    return `t=${t},v1=${v1}`;
  }

  it("returns true for a valid signature", () => {
    const body = JSON.stringify({ monitorId: "mon_123", runId: "run_1" });
    const header = makeHeader(body);
    expect(verifyExaSignature(body, header, secret)).toBe(true);
  });

  it("returns false for a tampered body", () => {
    const body = JSON.stringify({ monitorId: "mon_123" });
    const header = makeHeader(body);
    const tamperedBody = JSON.stringify({ monitorId: "mon_456" }); // different
    expect(verifyExaSignature(tamperedBody, header, secret)).toBe(false);
  });

  it("returns false for wrong secret", () => {
    const body = "test body";
    const header = makeHeader(body);
    expect(verifyExaSignature(body, header, "wrong-secret")).toBe(false);
  });

  it("returns false for malformed header", () => {
    expect(verifyExaSignature("body", "not-valid-header", secret)).toBe(false);
    expect(verifyExaSignature("body", "", secret)).toBe(false);
  });
});

describe("parseWebhookCandidates", () => {
  const repoCtx = {
    owner: "myorg",
    repo: "myapp",
    repoUrl: "https://github.com/myorg/myapp.git",
    installationId: 12345,
    slackChannelId: "C0123",
    defaultBranch: "main",
  };

  it("extracts CVE from outputSchema content", () => {
    const payload = {
      monitorId: "mon_1",
      runId: "run_1",
      output: {
        content: {
          cveId: "CVE-2021-23337",
          package: "lodash",
          severity: "high",
        },
        results: [{ title: "Lodash CVE", url: "https://nvd.nist.gov/vuln/detail/CVE-2021-23337" }],
      },
    };

    const candidates = parseWebhookCandidates(payload, repoCtx);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].cveId).toBe("CVE-2021-23337");
    expect(candidates[0].package).toBe("lodash");
  });

  it("extracts CVE from result title when no structured content", () => {
    const payload = {
      monitorId: "mon_1",
      runId: "run_1",
      output: {
        content: undefined,
        results: [
          {
            title: "Security Advisory: CVE-2024-55555 affects axios",
            url: "https://github.com/advisories/GHSA-test",
          },
        ],
      },
    };

    const candidates = parseWebhookCandidates(payload, repoCtx);
    expect(candidates.some((c) => c.cveId === "CVE-2024-55555")).toBe(true);
  });

  it("deduplicates CVEs found in both content and title", () => {
    const payload = {
      monitorId: "mon_1",
      runId: "run_1",
      output: {
        content: { cveId: "CVE-2021-23337", package: "lodash" },
        results: [
          { title: "CVE-2021-23337 advisory", url: "https://example.com" },
        ],
      },
    };

    const candidates = parseWebhookCandidates(payload, repoCtx);
    const cveIds = candidates.map((c) => c.cveId);
    expect(new Set(cveIds).size).toBe(cveIds.length); // no duplicates
  });

  it("returns empty when no valid CVE IDs found", () => {
    const payload = {
      monitorId: "mon_1",
      runId: "run_1",
      output: {
        content: { cveId: "not-a-cve" },
        results: [{ title: "Some random article", url: "https://example.com" }],
      },
    };

    const candidates = parseWebhookCandidates(payload, repoCtx);
    expect(candidates).toHaveLength(0);
  });
});
