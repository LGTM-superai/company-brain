import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { getConfig } from "../config.js";
import { upsertRepoMonitor, findByRepo } from "../db/repoMonitors.js";
import { createRepoMonitor } from "../exa/client.js";
import {
  getInstallationId,
  mintInstallationToken,
  getRepoInfo,
} from "../github/app.js";
import { fetchPackageJsonDeps } from "../github/packageJson.js";
import type { RegisterRepoRequest } from "../types.js";

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  let req: RegisterRepoRequest;
  try {
    req = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { owner, repo, slackChannelId, severityThreshold = "all" } = req;
  if (!owner || !repo || !slackChannelId) {
    return json(400, { error: "owner, repo, and slackChannelId are required" });
  }

  const cfg = await getConfig();

  // Check GitHub App is installed on this repo
  const installationId = await getInstallationId(owner, repo);
  if (!installationId) {
    return json(422, {
      error: "GitHub App not installed on this repository",
      installUrl: `https://github.com/apps/${cfg.githubAppSlug}/installations/new?suggested_target_id=${owner}`,
    });
  }

  // Reject forks
  const token = await mintInstallationToken(installationId);
  const repoInfo = await getRepoInfo(owner, repo, token);
  if (repoInfo.isFork) {
    return json(400, {
      error: "Fork repositories are not supported. Register the upstream repository.",
    });
  }

  // Fetch package.json deps
  let deps: Record<string, string>;
  try {
    deps = await fetchPackageJsonDeps(owner, repo, token);
  } catch (err: any) {
    return json(422, {
      error: `Could not read package.json: ${err.message}`,
    });
  }

  const packages = Object.keys(deps);
  if (packages.length === 0) {
    return json(422, { error: "No dependencies found in package.json" });
  }

  // Check if already registered
  const existing = await findByRepo(owner, repo);

  // Create Exa monitor (always create a new one; if updating, caller should delete old)
  const webhookUrl = `${cfg.apiBaseUrl}/exa/webhook/${owner}_${repo}`; // placeholder monitorId set after creation
  const { monitorId, webhookSecret } = await createRepoMonitor({
    owner,
    repo,
    packages,
    // We need the monitorId in the URL but we don't have it yet.
    // Use a pre-registration URL; after we get the ID we update it.
    // Exa generates the monitorId on creation, so we use a fixed-format URL
    // that the webhook handler parses from the path param.
    webhookUrl: `${cfg.apiBaseUrl}/exa/webhook/PLACEHOLDER`,
  });

  // The real webhook URL includes the actual monitorId
  const finalWebhookUrl = `${cfg.apiBaseUrl}/exa/webhook/${monitorId}`;

  // Persist monitor doc (with webhookSecret — one-time, must store immediately)
  await upsertRepoMonitor({
    owner,
    repo,
    repoUrl: repoInfo.cloneUrl,
    installationId,
    monitorId,
    webhookSecret,
    packages,
    defaultBranch: repoInfo.defaultBranch,
    slackChannelId,
    severityThreshold,
    createdAt: new Date(),
    status: "active",
  });

  return json(200, {
    ok: true,
    monitorId,
    packages: packages.length,
    webhookUrl: finalWebhookUrl,
    message: `Monitoring ${packages.length} packages for ${owner}/${repo}`,
  });
};
