import type { SQSEvent } from "aws-lambda";
import { enrichWithOsv, resolveCurrentVersion } from "../osv/enrich.js";
import { claimCve, updateCveStatus } from "../db/cves.js";
import { mintInstallationToken } from "../github/app.js";
import { fetchPackageJsonDeps } from "../github/packageJson.js";
import { runAgentFix } from "../sandbox/runAgentFix.js";
import { findExistingPr, createPr } from "../github/pr.js";
import { postCveAlert, postNoFix, postError } from "../slack/notify.js";
import type { CveJobMessage } from "../types.js";

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    let msg: CveJobMessage;
    try {
      msg = JSON.parse(record.body) as CveJobMessage;
    } catch {
      console.error("Invalid SQS message body:", record.body);
      continue;
    }

    await processCveJob(msg);
  }
};

async function processCveJob(msg: CveJobMessage): Promise<void> {
  const repoStr = `${msg.owner}/${msg.repo}`;
  console.log(`[${repoStr}] Processing ${msg.cveId}`);

  // 1. Fetch package.json to get the version range for this package
  let token: string;
  try {
    token = await mintInstallationToken(msg.installationId);
  } catch (err: any) {
    console.error(`[${repoStr}] Failed to mint installation token:`, err.message);
    return;
  }

  let deps: Record<string, string>;
  try {
    deps = await fetchPackageJsonDeps(msg.owner, msg.repo, token);
  } catch (err: any) {
    console.error(`[${repoStr}] Failed to fetch package.json:`, err.message);
    return;
  }

  const packageRange = deps[msg.package];
  if (!packageRange) {
    console.log(`[${repoStr}] Package ${msg.package} not in package.json, skipping`);
    return;
  }

  const currentVersion = resolveCurrentVersion(packageRange);
  if (!currentVersion) {
    console.log(
      `[${repoStr}] Unresolvable version range "${packageRange}" for ${msg.package}, skipping`
    );
    await claimCve({
      repo: repoStr,
      cveId: msg.cveId,
      ghsaId: msg.ghsaId,
      package: msg.package,
      currentVersion: packageRange,
      advisoryUrl: msg.advisoryUrl,
    });
    await updateCveStatus(repoStr, msg.cveId, {
      status: "skipped",
      skipReason: "unresolvable_version",
    });
    return;
  }

  // 2. Enrich via OSV to get the patched version
  let findings;
  try {
    findings = await enrichWithOsv(msg.package, packageRange);
  } catch (err: any) {
    console.error(`[${repoStr}] OSV enrichment failed:`, err.message);
    return;
  }

  if (findings.length === 0) {
    console.log(
      `[${repoStr}] No actionable OSV findings for ${msg.package}@${currentVersion}`
    );
    return;
  }

  const finding = findings[0]; // take the first/most severe

  // If no fix is available
  if (!finding.patchedVersion) {
    const claimed = await claimCve({
      repo: repoStr,
      cveId: msg.cveId,
      ghsaId: finding.ghsa,
      package: msg.package,
      currentVersion,
      advisoryUrl: finding.advisoryUrl,
    });

    if (!claimed) {
      console.log(`[${repoStr}] ${msg.cveId} already claimed, skipping`);
      return;
    }

    await updateCveStatus(repoStr, msg.cveId, {
      status: "no_fix",
      severity: finding.severity,
      vulnerableRange: finding.vulnerableRange ?? undefined,
      advisoryUrl: finding.advisoryUrl,
    });

    await postNoFix({
      channelId: msg.slackChannelId,
      cveId: msg.cveId,
      severity: finding.severity,
      pkg: msg.package,
      currentVersion,
      advisoryUrl: finding.advisoryUrl,
      repo: repoStr,
    });
    return;
  }

  // 3. Claim the CVE with a re-claimable lease (dedup + timeout recovery)
  const claimed = await claimCve({
    repo: repoStr,
    cveId: msg.cveId,
    ghsaId: finding.ghsa,
    package: msg.package,
    currentVersion,
    vulnerableRange: finding.vulnerableRange ?? undefined,
    patchedVersion: finding.patchedVersion,
    severity: finding.severity,
    advisoryUrl: finding.advisoryUrl,
  });

  if (!claimed) {
    console.log(`[${repoStr}] ${msg.cveId} already claimed (in-flight or done), skipping`);
    return;
  }

  // 4. Run the agent fix in a Vercel Sandbox
  let fixResult;
  try {
    fixResult = await runAgentFix({
      owner: msg.owner,
      repo: msg.repo,
      repoUrl: msg.repoUrl,
      installToken: token,
      defaultBranch: msg.defaultBranch,
      pkg: msg.package,
      currentVersion,
      patchedVersion: finding.patchedVersion,
      cveId: msg.cveId,
      advisoryUrl: finding.advisoryUrl,
    });
  } catch (err: any) {
    const errMsg = err.message ?? String(err);
    console.error(`[${repoStr}] Sandbox error for ${msg.cveId}:`, errMsg);
    await updateCveStatus(repoStr, msg.cveId, {
      status: "error",
      error: errMsg,
    });
    await postError({
      channelId: msg.slackChannelId,
      cveId: msg.cveId,
      pkg: msg.package,
      repo: repoStr,
      error: errMsg,
    });
    return;
  }

  if (!fixResult.success) {
    await updateCveStatus(repoStr, msg.cveId, {
      status: "skipped",
      skipReason: fixResult.error ?? "empty_diff",
      sandboxId: fixResult.sandboxId,
    });
    console.log(`[${repoStr}] Agent produced no changes for ${msg.cveId}`);
    return;
  }

  // 5. Check for existing PR (idempotency on retry)
  let prUrl = await findExistingPr(msg.owner, msg.repo, fixResult.branch, token);

  if (!prUrl) {
    const prBody =
      `## Security Fix: ${msg.cveId}\n\n` +
      `**Package:** \`${msg.package}\`\n` +
      `**Upgrade:** \`${currentVersion}\` → \`${finding.patchedVersion}\`\n` +
      `**Severity:** ${finding.severity}\n` +
      `**Advisory:** ${finding.advisoryUrl}\n\n` +
      `### Agent Summary\n${fixResult.summary}\n\n` +
      `---\n_Auto-generated by [LGTM CVE Bot](https://github.com/apps/${process.env.GITHUB_APP_SLUG ?? "lgtm-cve-bot"})_`;

    try {
      prUrl = await createPr(msg.owner, msg.repo, {
        head: fixResult.branch,
        base: msg.defaultBranch,
        title: `fix(security): upgrade ${msg.package} to ${finding.patchedVersion} (${msg.cveId})`,
        body: prBody,
        token,
      });
    } catch (err: any) {
      const errMsg = err.message ?? String(err);
      console.error(`[${repoStr}] PR creation failed:`, errMsg);
      await updateCveStatus(repoStr, msg.cveId, {
        status: "error",
        error: `PR creation failed: ${errMsg}`,
        sandboxId: fixResult.sandboxId,
        branch: fixResult.branch,
      });
      return;
    }
  }

  // 6. Post Slack notification
  const slackTs = await postCveAlert({
    channelId: msg.slackChannelId,
    cveId: msg.cveId,
    severity: finding.severity,
    pkg: msg.package,
    currentVersion,
    patchedVersion: finding.patchedVersion,
    advisoryUrl: finding.advisoryUrl,
    prUrl,
    repo: repoStr,
  });

  // 7. Mark done
  await updateCveStatus(repoStr, msg.cveId, {
    status: "pr_opened",
    prUrl,
    branch: fixResult.branch,
    slackTs,
    sandboxId: fixResult.sandboxId,
    processedAt: new Date(),
  });

  console.log(`[${repoStr}] ✓ ${msg.cveId} → PR: ${prUrl}`);
}
