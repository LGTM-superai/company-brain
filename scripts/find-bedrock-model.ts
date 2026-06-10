import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { readFileSync } from "node:fs";

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  stdout: {
    write(chunk: string): boolean;
  };
};

type BedrockModelSummary = {
  id: string;
  provider?: string;
  name?: string;
  input?: string[];
  output?: string[];
  inference?: string[];
  streaming?: boolean;
};

type Options = {
  count: number;
  listPath: string;
  maxAttempts: number;
  prompt: string;
  region: string;
  stopOnNon403: boolean;
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

function readOptions(): Options {
  return {
    count: Number(readFlag("count") || process.env.BEDROCK_FIND_COUNT || 1),
    listPath: readFlag("list") || "bedrock_models_list.txt",
    maxAttempts: Number(readFlag("max") || process.env.BEDROCK_FIND_MAX || 0),
    prompt: readFlag("prompt") || process.env.BEDROCK_PROMPT || "hi",
    region: readFlag("region") || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-west-2",
    stopOnNon403: hasFlag("stop-on-non-403"),
  };
}

function readModels(path: string): BedrockModelSummary[] {
  const models = JSON.parse(readFileSync(path, "utf8")) as BedrockModelSummary[];

  return models.filter((model) => {
    const supportsTextInput = model.input?.includes("TEXT");
    const supportsTextOutput = model.output?.includes("TEXT");

    return model.id && supportsTextInput && supportsTextOutput;
  });
}

function prioritizeModels(models: BedrockModelSummary[]): BedrockModelSummary[] {
  const preferredModelId = process.env.BRAIN_BEDROCK_MODEL || process.env.BEDROCK_MODEL_ID;

  if (!preferredModelId) {
    return models;
  }

  return [...models].sort((a, b) => {
    if (a.id === preferredModelId) {
      return -1;
    }

    if (b.id === preferredModelId) {
      return 1;
    }

    return 0;
  });
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

function is403(error: unknown): boolean {
  const details = getErrorDetails(error);

  return details.httpStatusCode === 403;
}

async function tryModel(
  client: BedrockRuntimeClient,
  model: BedrockModelSummary,
  prompt: string,
): Promise<string> {
  const input: ConverseCommandInput = {
    modelId: model.id,
    messages: [
      {
        role: "user",
        content: [{ text: prompt }],
      },
    ],
    inferenceConfig: {
      maxTokens: 1,
    },
  };
  const response = await client.send(new ConverseCommand(input));
  const content = response.output?.message?.content || [];

  return content
    .map((block) => ("text" in block ? block.text || "" : ""))
    .join("")
    .trim();
}

async function main(): Promise<void> {
  const options = readOptions();
  const models = prioritizeModels(readModels(options.listPath));
  const maxAttempts = options.maxAttempts > 0 ? Math.min(options.maxAttempts, models.length) : models.length;
  const client = new BedrockRuntimeClient({
    region: options.region,
    authSchemePreference: ["sigv4"],
    requestHandler: new NodeHttpHandler({
      requestTimeout: 60_000,
      connectionTimeout: 10_000,
    }),
  });

  console.log(`Region: ${options.region}`);
  console.log(`Prompt: ${JSON.stringify(options.prompt)}`);
  console.log(`Auth: SigV4`);
  console.log(`Text models to try: ${models.length}`);
  console.log(`Max attempts: ${maxAttempts}`);
  console.log(`Successes wanted: ${options.count}`);
  console.log("");

  const successes: Array<{ model: BedrockModelSummary; response: string }> = [];

  for (let index = 0; index < maxAttempts; index += 1) {
    const model = models[index];
    const label = `${model.id}${model.provider ? ` (${model.provider})` : ""}`;

    process.stdout.write(`[${index + 1}/${maxAttempts}] ${label} ... `);

    try {
      const text = await tryModel(client, model, options.prompt);

      console.log("SUCCESS");
      successes.push({ model, response: text });

      if (successes.length >= options.count) {
        console.log("");
        console.log(`Found ${successes.length} invokable model(s):`);

        for (const success of successes) {
          console.log(`- ${success.model.id} (${success.model.name || "unknown"})`);
          console.log(`  Response: ${success.response || "(no text returned)"}`);
        }

        return;
      }
    } catch (error) {
      const details = getErrorDetails(error);

      console.log(`${details.httpStatusCode || "no-status"} ${details.name}`);

      if (!is403(error)) {
        console.log(`Message: ${details.message}`);

        if (details.requestId) {
          console.log(`AWS request id: ${details.requestId}`);
        }

        if (options.stopOnNon403) {
          console.log("");
          console.log(`First non-403 model: ${model.id}`);
          process.exit(2);
        }
      }
    }
  }

  console.log("");
  if (successes.length > 0) {
    console.log(`Found only ${successes.length} invokable model(s):`);

    for (const success of successes) {
      console.log(`- ${success.model.id} (${success.model.name || "unknown"})`);
      console.log(`  Response: ${success.response || "(no text returned)"}`);
    }

    process.exit(2);
  }

  console.log("No successful model invocation found in the attempted list.");
  process.exit(1);
}

await main();
