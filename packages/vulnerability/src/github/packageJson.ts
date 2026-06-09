import { Octokit } from "@octokit/rest";

export async function fetchPackageJsonDeps(
  owner: string,
  repo: string,
  token: string
): Promise<Record<string, string>> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path: "package.json",
  });

  if (Array.isArray(data) || data.type !== "file") {
    throw new Error(`${owner}/${repo}: package.json is not a file`);
  }

  const content = Buffer.from(data.content, "base64").toString("utf8");
  const pkg = JSON.parse(content) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  return {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
}
