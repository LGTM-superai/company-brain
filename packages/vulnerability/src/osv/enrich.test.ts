import { describe, it, expect, vi } from "vitest";
import { resolveCurrentVersion, enrichWithOsv } from "./enrich.js";

describe("resolveCurrentVersion", () => {
  it("resolves a caret range to its min version", () => {
    expect(resolveCurrentVersion("^4.17.0")).toBe("4.17.0");
  });

  it("resolves a tilde range", () => {
    expect(resolveCurrentVersion("~1.2.3")).toBe("1.2.3");
  });

  it("resolves an exact version", () => {
    expect(resolveCurrentVersion("4.17.21")).toBe("4.17.21");
  });

  it("returns null for dist-tags", () => {
    expect(resolveCurrentVersion("latest")).toBeNull();
    expect(resolveCurrentVersion("next")).toBeNull();
  });

  it("returns null for wildcard", () => {
    expect(resolveCurrentVersion("*")).toBeNull();
  });

  it("returns null for git URLs", () => {
    expect(resolveCurrentVersion("git+https://github.com/foo/bar.git")).toBeNull();
  });

  it("returns null for workspace specifiers", () => {
    expect(resolveCurrentVersion("workspace:*")).toBeNull();
  });

  it("returns null for file specifiers", () => {
    expect(resolveCurrentVersion("file:../local-pkg")).toBeNull();
  });
});

describe("enrichWithOsv (mocked fetch)", () => {
  it("returns a finding with patchedVersion when OSV returns a SEMVER range", async () => {
    const mockVuln = {
      vulns: [
        {
          id: "GHSA-35jh-r3h4-6jhm",
          aliases: ["CVE-2021-23337"],
          summary: "Prototype pollution in lodash",
          severity: [{ type: "CVSS_V3", score: "7.2" }],
          affected: [
            {
              package: { name: "lodash", ecosystem: "npm" },
              ranges: [
                {
                  type: "SEMVER",
                  events: [{ introduced: "0" }, { fixed: "4.17.21" }],
                },
              ],
            },
          ],
          references: [
            { type: "ADVISORY", url: "https://github.com/advisories/GHSA-35jh-r3h4-6jhm" },
          ],
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockVuln,
      })
    );

    const findings = await enrichWithOsv("lodash", "^4.17.0");
    expect(findings).toHaveLength(1);
    expect(findings[0].patchedVersion).toBe("4.17.21");
    expect(findings[0].cve).toBe("CVE-2021-23337");
    expect(findings[0].ghsa).toBe("GHSA-35jh-r3h4-6jhm");
    expect(findings[0].affected).toBe(true);

    vi.restoreAllMocks();
  });

  it("skips findings when the range upper bound is already patched (already-patched guard)", async () => {
    // Simulate a vuln fixed in 4.17.21; package.json range is ^4.17.21 (already safe upper bound)
    const mockVuln = {
      vulns: [
        {
          id: "GHSA-test",
          aliases: ["CVE-2021-99999"],
          summary: "Test vuln",
          affected: [
            {
              package: { name: "lodash", ecosystem: "npm" },
              ranges: [
                {
                  type: "SEMVER",
                  events: [{ introduced: "0" }, { fixed: "4.17.21" }],
                },
              ],
            },
          ],
          references: [],
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockVuln,
      })
    );

    // ^4.17.21 resolves to min 4.17.21, which is NOT in >=0 <4.17.21 — should be skipped
    const findings = await enrichWithOsv("lodash", "^4.17.21");
    expect(findings).toHaveLength(0);

    vi.restoreAllMocks();
  });

  it("returns empty array when no vulns found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ vulns: [] }),
      })
    );

    const findings = await enrichWithOsv("some-safe-pkg", "^1.0.0");
    expect(findings).toHaveLength(0);

    vi.restoreAllMocks();
  });

  it("returns no patchedVersion when no fixed event exists", async () => {
    const mockVuln = {
      vulns: [
        {
          id: "GHSA-nopatch",
          aliases: [],
          summary: "Unfixed vuln",
          affected: [
            {
              package: { name: "vulnpkg", ecosystem: "npm" },
              ranges: [
                {
                  type: "SEMVER",
                  events: [{ introduced: "0" }, { last_affected: "1.0.0" }],
                },
              ],
            },
          ],
          references: [],
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockVuln,
      })
    );

    const findings = await enrichWithOsv("vulnpkg", "^1.0.0");
    // No fixed event → patchedVersion is null
    expect(findings[0]?.patchedVersion).toBeNull();

    vi.restoreAllMocks();
  });
});
