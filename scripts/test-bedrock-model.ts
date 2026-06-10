import {
  BedrockRuntimeClient,
  type BedrockRuntimeClientConfig,
  ConverseCommand,
  ConverseStreamCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { GetCallerIdentityCommand, STSClient, type STSClientConfig } from "@aws-sdk/client-sts";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exit(code?: number): never;
};

const DEFAULT_MODEL_ID = "zai.glm-5";
const DEFAULT_PROMPT = "hi";
const DEFAULT_REGION = "us-west-2";

type Options = {
  authMode: "auto" | "bearer" | "sigv4";
  modelId: string;
  checkSts: boolean;
  preferEnvCredentials: boolean;
  profile?: string;
  prompt: string;
  region: string;
  stream: boolean;
};

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));

  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = process.argv.indexOf(`--${name}`);
  const next = process.argv[index + 1];

  if (index >= 0 && next && !next.startsWith("--")) {
    return next;
  }

  return undefined;
}

function printUsage(): void {
  console.log(`
Usage:
  bun run test:bedrock
  bun run test:bedrock -- --model nvidia.nemotron-nano-12b-v2 --region us-east-1 --prompt hi

Environment overrides:
  BRAIN_BEDROCK_MODEL Model id used by the brain app
  BEDROCK_MODEL_ID   Model id to invoke. Defaults to ${DEFAULT_MODEL_ID}
  BEDROCK_PROMPT     Prompt to send. Defaults to "${DEFAULT_PROMPT}"
  AWS_REGION         AWS region. Defaults to ${DEFAULT_REGION}
  AWS_DEFAULT_REGION Used when AWS_REGION is not set
  AWS_PROFILE        Optional profile used by the AWS SDK credential chain
  AWS_BEARER_TOKEN_BEDROCK Optional Bedrock bearer token. Also loaded from ~/.aws/credentials when present.
  BRAIN_BEDROCK_API_KEY Alias for AWS_BEARER_TOKEN_BEDROCK
  BEDROCK_API_KEY    Alias for AWS_BEARER_TOKEN_BEDROCK

Flags:
  --auth <mode>      Auth mode: auto, bearer, or sigv4. Defaults to auto
  --model <id>       Override the Bedrock model id
  --profile <name>   Override the AWS profile for this check
  --prefer-env-credentials Let AWS_* env credentials override --profile
  --region <region>  Override the AWS region
  --prompt <text>    Override the prompt
  --check-sts        Run aws sts GetCallerIdentity before invoking Bedrock
  --stream           Use ConverseStream instead of Converse
`);
}

function readOptions(): Options {
  const modelId =
    readFlag("model") ||
    process.env.BRAIN_BEDROCK_MODEL ||
    process.env.BEDROCK_MODEL_ID ||
    process.env.AWS_BEDROCK_MODEL_ID ||
    DEFAULT_MODEL_ID;

  const region =
    readFlag("region") ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    DEFAULT_REGION;

  const prompt = readFlag("prompt") || process.env.BEDROCK_PROMPT || DEFAULT_PROMPT;
  const profile = readFlag("profile") || process.env.AWS_PROFILE;
  const authFlag = readFlag("auth") || process.env.BEDROCK_AUTH_MODE || "auto";
  const authMode = authFlag === "bearer" || authFlag === "sigv4" ? authFlag : "auto";
  const checkSts = hasFlag("check-sts") || process.env.BEDROCK_CHECK_STS === "true";
  const preferEnvCredentials = hasFlag("prefer-env-credentials");
  const stream = hasFlag("stream") || process.env.BEDROCK_STREAM === "true";

  return { authMode, modelId, checkSts, preferEnvCredentials, profile, prompt, region, stream };
}

function getErrorDetails(error: unknown): {
  name: string;
  message: string;
  httpStatusCode?: number;
  requestId?: string;
} {
  const candidate = error as {
    name?: string;
    message?: string;
    $metadata?: {
      httpStatusCode?: number;
      requestId?: string;
    };
  };

  return {
    name: candidate.name || "UnknownError",
    message: candidate.message || String(error),
    httpStatusCode: candidate.$metadata?.httpStatusCode,
    requestId: candidate.$metadata?.requestId,
  };
}

function explainBedrockFailure(error: unknown, options: Options): string {
  const { name, message } = getErrorDetails(error);
  const profile = options.profile || process.env.AWS_PROFILE;

  if (/api key is valid/i.test(message)) {
    return "Bedrock reached the service, but the Bedrock bearer/API key is invalid or expired. Replace AWS_BEARER_TOKEN_BEDROCK/BRAIN_BEDROCK_API_KEY with a valid key, or remove it and use valid AWS credentials.";
  }

  switch (name) {
    case "CredentialsProviderError":
      if (/session has expired|reauthenticate/i.test(message)) {
        return profile
          ? `The AWS login session for profile "${profile}" has expired. Run: aws login --profile ${profile}`
          : "The AWS login session has expired. Run aws login for the profile you want to use, then retry with --profile.";
      }

      return "The AWS SDK could not load usable credentials. Configure AWS_PROFILE, refresh AWS login/SSO, or update your shared credentials file.";
    case "InvalidClientTokenId":
    case "UnrecognizedClientException":
    case "InvalidSignatureException":
      return "AWS credentials were found, but AWS rejected them. Check the active profile, access keys, session token, and system clock.";
    case "ExpiredTokenException":
      return "The AWS session token is expired. Refresh SSO/session credentials and retry.";
    case "AccessDeniedException":
      return "AWS authenticated you, but the principal is not allowed to invoke this Bedrock model. Check IAM permissions and Bedrock model access.";
    case "ResourceNotFoundException":
      return "The model id was not found in this region. Try another AWS region or confirm the exact Bedrock model id.";
    case "ValidationException":
      return "Bedrock rejected the request. This can mean the model is unavailable in the region, access is not enabled, or this model does not support the selected API shape.";
    case "ThrottlingException":
      return "Bedrock throttled the request. Access exists, but the account or model is currently rate limited.";
    case "ModelNotReadyException":
      return "Bedrock found the model, but it is not ready yet. Retry in a minute.";
    default:
      return "The request failed before a successful model response was returned.";
  }
}

function createHttpHandler(): NodeHttpHandler {
  return new NodeHttpHandler({
    requestTimeout: 60_000,
    connectionTimeout: 10_000,
  });
}

function readSharedCredentialValue(profile: string, key: string): string | undefined {
  const credentialFile =
    process.env.AWS_SHARED_CREDENTIALS_FILE || join(homedir(), ".aws", "credentials");

  if (!existsSync(credentialFile)) {
    return undefined;
  }

  const content = readFileSync(credentialFile, "utf8");
  const sectionNames = [profile, `profile ${profile}`];
  let inSection = false;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }

    const section = trimmed.match(/^\[(.+)]$/);

    if (section) {
      inSection = sectionNames.includes(section[1].trim());
      continue;
    }

    if (!inSection) {
      continue;
    }

    const separator = trimmed.indexOf("=");

    if (separator < 0) {
      continue;
    }

    const entryKey = trimmed.slice(0, separator).trim();
    const entryValue = trimmed.slice(separator + 1).trim();

    if (entryKey.toLowerCase() === key.toLowerCase()) {
      return entryValue;
    }
  }

  return undefined;
}

function loadBedrockBearerToken(options: Options): string | undefined {
  if (options.authMode === "sigv4") {
    return undefined;
  }

  if (process.env.AWS_BEARER_TOKEN_BEDROCK) {
    return "AWS_BEARER_TOKEN_BEDROCK";
  }

  if (process.env.BRAIN_BEDROCK_API_KEY) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = process.env.BRAIN_BEDROCK_API_KEY;
    return "BRAIN_BEDROCK_API_KEY";
  }

  if (process.env.BEDROCK_API_KEY) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = process.env.BEDROCK_API_KEY;
    return "BEDROCK_API_KEY";
  }

  const profile = options.profile || "default";
  const token = readSharedCredentialValue(profile, "AWS_BEARER_TOKEN_BEDROCK");

  if (!token) {
    return undefined;
  }

  process.env.AWS_BEARER_TOKEN_BEDROCK = token;
  return `~/.aws/credentials [${profile}]`;
}

function getAuthSchemePreference(options: Options, bearerTokenSource: string | undefined): string[] | undefined {
  if (options.authMode === "bearer") {
    return ["httpBearerAuth"];
  }

  if (options.authMode === "sigv4") {
    return ["sigv4"];
  }

  return bearerTokenSource ? ["httpBearerAuth"] : undefined;
}

function honorExplicitProfile(options: Options): boolean {
  if (!options.profile || options.preferEnvCredentials || !process.env.AWS_ACCESS_KEY_ID) {
    return false;
  }

  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
  delete process.env.AWS_SECURITY_TOKEN;
  return true;
}

async function assertAwsIdentity(options: Options): Promise<void> {
  const config: STSClientConfig = {
    region: options.region,
    profile: options.profile,
    requestHandler: createHttpHandler(),
  };
  const client = new STSClient(config);
  const identity = await client.send(new GetCallerIdentityCommand({}));

  console.log(`AWS identity: ${identity.Arn || identity.UserId || "(resolved)"}`);

  if (identity.Account) {
    console.log(`AWS account: ${identity.Account}`);
  }
}

function extractText(response: ConverseCommandOutput): string {
  const content = response.output?.message?.content;

  if (!content) {
    return "";
  }

  return content
    .map((block) => ("text" in block ? block.text || "" : ""))
    .join("")
    .trim();
}

async function callConverse(client: BedrockRuntimeClient, input: ConverseCommandInput): Promise<string> {
  const response = await client.send(new ConverseCommand(input));
  return extractText(response);
}

async function callConverseStream(
  client: BedrockRuntimeClient,
  input: ConverseCommandInput,
): Promise<string> {
  const response = await client.send(new ConverseStreamCommand(input));
  let text = "";

  for await (const event of response.stream || []) {
    const delta = event.contentBlockDelta?.delta;

    if (delta && "text" in delta) {
      text += delta.text || "";
    }
  }

  return text.trim();
}

async function main(): Promise<void> {
  if (hasFlag("help") || hasFlag("h")) {
    printUsage();
    return;
  }

  const options = readOptions();
  const input: ConverseCommandInput = {
    modelId: options.modelId,
    messages: [
      {
        role: "user",
        content: [{ text: options.prompt }],
      },
    ],
    inferenceConfig: {
      maxTokens: 64,
    },
  };

  console.log("Testing Bedrock model access...");
  console.log(`Model: ${options.modelId}`);
  console.log(`Region: ${options.region}`);
  console.log(`Prompt: ${JSON.stringify(options.prompt)}`);
  console.log(`API: ${options.stream ? "ConverseStream" : "Converse"}`);
  console.log(`Transport: ${options.stream ? "HTTP/2" : "HTTP/1.1"}`);
  console.log(`Auth mode: ${options.authMode}`);
  console.log(`AWS profile: ${options.profile || "(default credential chain)"}`);
  const ignoredEnvCredentials = honorExplicitProfile(options);
  const bearerTokenSource = loadBedrockBearerToken(options);
  console.log(
    `Env SigV4 credentials: ${process.env.AWS_ACCESS_KEY_ID ? "present" : "not found"}${
      process.env.AWS_SESSION_TOKEN ? " with session token" : ""
    }`,
  );
  if (ignoredEnvCredentials) {
    console.log("Ignored env SigV4 credentials because --profile was passed.");
  }
  console.log(`Bedrock bearer token: ${bearerTokenSource ? `present from ${bearerTokenSource}` : "not found"}`);

  try {
    if (options.checkSts) {
      console.log("\nChecking AWS credentials with STS...");
      await assertAwsIdentity(options);
    }

    console.log("\nInvoking Bedrock...");
    const config: BedrockRuntimeClientConfig = {
      region: options.region,
      profile: options.profile,
      authSchemePreference: getAuthSchemePreference(options, bearerTokenSource),
      requestHandler: options.stream
        ? undefined
        : createHttpHandler(),
    };
    const client = new BedrockRuntimeClient(config);

    const text = options.stream
      ? await callConverseStream(client, input)
      : await callConverse(client, input);

    console.log("\nSUCCESS: Bedrock accepted the request and returned a model response.");
    console.log(`Response: ${text || "(no text content returned)"}`);
  } catch (error) {
    const details = getErrorDetails(error);

    console.error("\nFAILED: Could not complete the Bedrock access check.");
    console.error(`Reason: ${explainBedrockFailure(error, options)}`);
    console.error(`Error: ${details.name}: ${details.message}`);

    if (details.httpStatusCode) {
      console.error(`HTTP status: ${details.httpStatusCode}`);
    }

    if (details.requestId) {
      console.error(`AWS request id: ${details.requestId}`);
    }

    process.exit(1);
  }
}

await main();
