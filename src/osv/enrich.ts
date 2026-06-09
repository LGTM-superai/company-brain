import semver from "semver";
import type { OsvFinding } from "../types.js";

interface OsvRange {
  type: "SEMVER" | "ECOSYSTEM" | "GIT";
  events: Array<{ introduced?: string; fixed?: string; last_affected?: string }>;
}

interface OsvAffected {
  package?: { name: string; ecosystem: string };
  ranges?: OsvRange[];
  database_specific?: { last_known_affected_version_range?: string };
}

interface OsvVuln {
  id: string;
  aliases?: string[];
  summary?: string;
  severity?: Array<{ type: string; score: string }>;
  affected?: OsvAffected[];
  references?: Array<{ type: string; url: string }>;
}

/**
 * Resolve the floor of a semver range from package.json.
 * Returns null for unresolvable specifiers (dist-tags, git URLs, workspace:, etc.).
 */
export function resolveCurrentVersion(rangeStr: string): string | null {
  // Skip non-semver specifiers
  if (
    /^(latest|next|beta|alpha|canary|rc)$/i.test(rangeStr) ||
    rangeStr.startsWith("git") ||
    rangeStr.startsWith("http") ||
    rangeStr.startsWith("file:") ||
    rangeStr.startsWith("workspace:") ||
    rangeStr.startsWith("link:") ||
    rangeStr === "*"
  ) {
    return null;
  }

  const min = semver.minVersion(rangeStr);
  return min?.version ?? null;
}

/**
 * Check if the minimum version of a package.json range is already >= the patched version.
 * If even the floor of the range is already patched, we won't generate a PR.
 * e.g. "^4.17.21" with patchedVersion "4.17.21" → min=4.17.21 >= 4.17.21 → skip.
 * e.g. "^4.17.0"  with patchedVersion "4.17.21" → min=4.17.0  < 4.17.21  → proceed.
 */
function isRangeAlreadyPatched(
  packageRange: string,
  patchedVersion: string
): boolean {
  const min = semver.minVersion(packageRange);
  if (!min) return false;
  return semver.gte(min.version, patchedVersion);
}

export async function enrichWithOsv(
  packageName: string,
  packageRange: string
): Promise<OsvFinding[]> {
  const currentVersion = resolveCurrentVersion(packageRange);
  if (!currentVersion) {
    return []; // unresolvable version specifier
  }

  const res = await fetch("https://api.osv.dev/v1/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      package: { name: packageName, ecosystem: "npm" },
      version: currentVersion,
    }),
  });

  if (!res.ok) {
    throw new Error(`OSV query failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { vulns?: OsvVuln[] };
  const vulns = data.vulns ?? [];

  return vulns.flatMap((vuln): OsvFinding[] => {
    const cve = vuln.aliases?.find((a) => a.startsWith("CVE-")) ?? null;
    const ghsa = vuln.id;

    let patchedVersion: string | null = null;
    let vulnerableRange: string | null = null;
    let foundAffectedRange = false;

    for (const aff of vuln.affected ?? []) {
      if (aff.package?.name !== packageName) continue;

      for (const r of aff.ranges ?? []) {
        if (r.type !== "SEMVER" && r.type !== "ECOSYSTEM") continue;

        const introduced =
          r.events.find((e) => e.introduced)?.introduced ?? "0.0.0";
        const fixed = r.events.find((e) => e.fixed)?.fixed ?? null;

        if (!fixed) {
          // Check last_affected to detect "no patch yet" for current version
          const lastAffected =
            r.events.find((e) => e.last_affected)?.last_affected ?? null;
          if (lastAffected) {
            const noFixRange = `>=${introduced} <=${lastAffected}`;
            if (
              semver.satisfies(currentVersion, noFixRange, {
                includePrerelease: true,
              })
            ) {
              foundAffectedRange = true;
              vulnerableRange = noFixRange;
            }
          }
          continue;
        }

        const candidate = `>=${introduced} <${fixed}`;
        if (
          semver.satisfies(currentVersion, candidate, {
            includePrerelease: true,
          })
        ) {
          foundAffectedRange = true;
          if (!patchedVersion || semver.lt(fixed, patchedVersion)) {
            patchedVersion = fixed;
            vulnerableRange = candidate;
          }
        }
      }
    }

    // database_specific fallback when no structured range matched
    if (!foundAffectedRange) {
      const dbRange =
        vuln.affected?.[0]?.database_specific
          ?.last_known_affected_version_range ?? null;
      if (dbRange) {
        vulnerableRange = dbRange;
        // If we can't parse it as semver, assume affected (conservative)
        const parseable = semver.validRange(dbRange);
        if (
          !parseable ||
          semver.satisfies(currentVersion, dbRange, { includePrerelease: true })
        ) {
          foundAffectedRange = true;
        }
      }
    }

    // Current version is not in any known vulnerable range — skip
    if (!foundAffectedRange) return [];

    // Already-patched guard: if package.json floor is already >= the fix, no PR needed
    if (patchedVersion && isRangeAlreadyPatched(packageRange, patchedVersion)) {
      return []; // range_already_patched
    }

    const severity =
      vuln.severity?.find((s) => s.type === "CVSS_V3")?.score ?? "unknown";

    const advisoryUrl =
      vuln.references?.find(
        (r) =>
          r.url.includes("nvd.nist.gov") ||
          r.url.includes("github.com/advisories") ||
          r.url.includes("osv.dev")
      )?.url ?? `https://osv.dev/vulnerability/${ghsa}`;

    return [
      {
        package: packageName,
        currentVersion,
        cve,
        ghsa,
        vulnerableRange,
        patchedVersion,
        severity,
        advisoryUrl,
        summary: vuln.summary ?? "",
        affected: true,
      },
    ];
  });
}
