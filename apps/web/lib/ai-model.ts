import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createGateway } from "@ai-sdk/gateway";
import type { LanguageModel } from "ai";
import { getEnv } from "./env";

export type RuntimeModelProvider = "bedrock" | "vercel-ai-gateway";

export type RuntimeModelConfig = {
  provider: RuntimeModelProvider;
  modelId: string;
};

export function getRuntimeModel(): LanguageModel {
  const config = getRuntimeModelConfig();

  if (config.provider === "vercel-ai-gateway") {
    const gatewayKey = optionalEnv("AI_GATEWAY_API_KEY", "VERCEL_AI_GATEWAY_API_KEY");
    const gateway = createGateway(gatewayKey ? { apiKey: gatewayKey } : undefined);
    return gateway(config.modelId) as LanguageModel;
  }

  const bedrock = createAmazonBedrock({
    region: optionalEnv("AWS_REGION", "AWS_DEFAULT_REGION", "AWS_REGION_NAME") ?? "us-west-2",
    apiKey: optionalEnv("AWS_BEARER_TOKEN_BEDROCK", "BRAIN_BEDROCK_API_KEY", "BEDROCK_API_KEY"),
    accessKeyId: optionalEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: optionalEnv("AWS_SECRET_ACCESS_KEY"),
    sessionToken: optionalEnv("AWS_SESSION_TOKEN"),
  });

  return bedrock(config.modelId) as LanguageModel;
}

export function getRuntimeModelConfig(): RuntimeModelConfig {
  const provider = getRuntimeModelProvider();
  return {
    provider,
    modelId: getModelId(provider),
  };
}

export function getRuntimeModelProvider(): RuntimeModelProvider {
  const rawProvider = optionalEnv("AI_MODEL_PROVIDER", "AI_PROVIDER") ?? "bedrock";
  const provider = rawProvider.toLowerCase();

  if (provider === "bedrock" || provider === "aws-bedrock" || provider === "aws") {
    return "bedrock";
  }

  if (
    provider === "vercel-ai-gateway" ||
    provider === "ai-gateway" ||
    provider === "gateway" ||
    provider === "vercel"
  ) {
    return "vercel-ai-gateway";
  }

  throw new Error(
    `AI_MODEL_PROVIDER must be "bedrock" or "vercel-ai-gateway". Received "${rawProvider}".`,
  );
}

function getModelId(provider: RuntimeModelProvider) {
  const modelId =
    provider === "bedrock"
      ? optionalEnv("BEDROCK_MODEL_ID", "BRAIN_BEDROCK_MODEL", "AI_MODEL")
      : optionalEnv("AI_GATEWAY_MODEL", "VERCEL_AI_GATEWAY_MODEL", "AI_MODEL");

  if (!modelId) {
    throw new Error(
      provider === "bedrock"
        ? "BEDROCK_MODEL_ID or AI_MODEL is not set for AI_MODEL_PROVIDER=bedrock."
        : "AI_GATEWAY_MODEL or AI_MODEL is not set for AI_MODEL_PROVIDER=vercel-ai-gateway.",
    );
  }

  return modelId;
}

function optionalEnv(...keys: string[]) {
  for (const key of keys) {
    const value = getEnv(key)?.trim();

    if (value) {
      return value;
    }
  }

  return undefined;
}
