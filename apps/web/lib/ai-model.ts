import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createGateway } from "@ai-sdk/gateway";
import type { LanguageModel } from "ai";
import { getEnv } from "./env";

export function getRuntimeModel(): LanguageModel {
  const modelId = getEnv("AI_MODEL") ?? getEnv("BEDROCK_MODEL_ID");

  if (!modelId) {
    throw new Error("AI_MODEL is not set.");
  }

  const gatewayKey = getEnv("AI_GATEWAY_API_KEY") ?? getEnv("VERCEL_AI_GATEWAY_API_KEY");

  if (gatewayKey || modelId.includes("/")) {
    return createGateway(gatewayKey ? { apiKey: gatewayKey } : undefined)(modelId) as LanguageModel;
  }

  const bedrock = createAmazonBedrock({
    region: getEnv("AWS_DEFAULT_REGION") ?? "us-west-2",
    apiKey: getEnv("AWS_BEARER_TOKEN_BEDROCK"),
    accessKeyId: getEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: getEnv("AWS_SECRET_ACCESS_KEY"),
    sessionToken: getEnv("AWS_SESSION_TOKEN"),
  });

  return bedrock(modelId) as LanguageModel;
}
