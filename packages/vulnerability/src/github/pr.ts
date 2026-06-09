import { Octokit } from "@octokit/rest";

export async function findExistingPr(
  owner: string,
  repo: string,
  headBranch: string,
  token: string
): Promise<string | null> {
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.pulls.list({
    owner,
    repo,
    head: `${owner}:${headBranch}`,
    state: "open",
  });
  return data[0]?.html_url ?? null;
}

export async function createPr(
  owner: string,
  repo: string,
  opts: {
    head: string;
    base: string;
    title: string;
    body: string;
    token: string;
  }
): Promise<string> {
  const octokit = new Octokit({ auth: opts.token });
  const { data } = await octokit.pulls.create({
    owner,
    repo,
    head: opts.head,
    base: opts.base,
    title: opts.title,
    body: opts.body,
  });
  return data.html_url;
}
