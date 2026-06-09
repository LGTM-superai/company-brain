import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { getConfig } from "../config.js";

export async function getAppOctokit(): Promise<Octokit> {
  const cfg = await getConfig();
  const auth = createAppAuth({
    appId: cfg.githubAppId,
    privateKey: cfg.githubAppPrivateKey,
  });
  return new Octokit({ authStrategy: createAppAuth, auth: { appId: cfg.githubAppId, privateKey: cfg.githubAppPrivateKey } });
}

export async function getInstallationId(
  owner: string,
  repo: string
): Promise<number | null> {
  const octokit = await getAppOctokit();
  try {
    const { data } = await octokit.apps.getRepoInstallation({ owner, repo });
    return data.id;
  } catch (err: any) {
    if (err.status === 404) return null;
    throw err;
  }
}

export async function mintInstallationToken(
  installationId: number
): Promise<string> {
  const cfg = await getConfig();
  const auth = createAppAuth({
    appId: cfg.githubAppId,
    privateKey: cfg.githubAppPrivateKey,
  });
  const result = await auth({
    type: "installation",
    installationId,
  });
  return result.token;
}

export async function getRepoInfo(
  owner: string,
  repo: string,
  token: string
): Promise<{ defaultBranch: string; isFork: boolean; cloneUrl: string }> {
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.repos.get({ owner, repo });
  return {
    defaultBranch: data.default_branch,
    isFork: data.fork,
    cloneUrl: data.clone_url,
  };
}
