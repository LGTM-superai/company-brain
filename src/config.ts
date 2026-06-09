import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-west-2" });

// Module-level cache — reused across warm Lambda invocations
const cache = new Map<string, string>();

async function getSecret(name: string): Promise<string> {
  const cached = cache.get(name);
  if (cached) return cached;

  const cmd = new GetSecretValueCommand({ SecretId: name });
  const res = await client.send(cmd);
  const value = res.SecretString ?? "";
  cache.set(name, value);
  return value;
}

export interface Config {
  exaApiKey: string;
  githubAppId: string;
  githubAppPrivateKey: string;
  slackBotToken: string;
  vercelToken: string;
  vercelTeamId: string;
  vercelProjectId: string;
  docdbUser: string;
  docdbPass: string;
  docdbEndpoint: string;
  apiBaseUrl: string;
  sqsQueueUrl: string;
  githubAppSlug: string;
}

let _config: Config | null = null;

export async function getConfig(): Promise<Config> {
  if (_config) return _config;

  const PREFIX = "lgtm/cve";

  const [
    exaApiKey,
    githubAppId,
    githubAppPrivateKey,
    slackBotToken,
    vercelToken,
    vercelTeamId,
    vercelProjectId,
    docdbUser,
    docdbPass,
    docdbEndpoint,
  ] = await Promise.all([
    getSecret(`${PREFIX}/exa-api-key`),
    getSecret(`${PREFIX}/github-app-id`),
    getSecret(`${PREFIX}/github-app-private-key`),
    getSecret(`${PREFIX}/slack-bot-token`),
    getSecret(`${PREFIX}/vercel-token`),
    getSecret(`${PREFIX}/vercel-team-id`),
    getSecret(`${PREFIX}/vercel-project-id`),
    getSecret(`${PREFIX}/docdb-user`),
    getSecret(`${PREFIX}/docdb-pass`),
    getSecret(`${PREFIX}/docdb-endpoint`),
  ]);

  _config = {
    exaApiKey,
    githubAppId,
    githubAppPrivateKey,
    slackBotToken,
    vercelToken,
    vercelTeamId,
    vercelProjectId,
    docdbUser,
    docdbPass,
    docdbEndpoint,
    // Non-sensitive env vars set directly on the Lambda
    apiBaseUrl: process.env.API_BASE_URL ?? "",
    sqsQueueUrl: process.env.SQS_QUEUE_URL ?? "",
    githubAppSlug: process.env.GITHUB_APP_SLUG ?? "lgtm-cve-bot",
  };

  return _config;
}
