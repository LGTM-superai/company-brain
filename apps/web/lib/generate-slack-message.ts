import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { PersonId } from "@company-brain/shared";
import { users } from "@company-brain/shared";

export type GeneratedSlackMessage = {
  text: string;
  targetUser: PersonId | null;
};

const SYSTEM_PROMPT = `You are a message composer for an AI assistant called "Company Brain". Given the user's request and conversation history, generate the Slack message to send.

Team members: ${users.map((u) => `${u.id} (${u.name}, ${u.role})`).join(", ")}

Rules:
- Write the message body only — no greetings like "Hi" or "Hey"
- Keep it short and professional (1-2 sentences max)
- Do NOT include any @mentions — the system handles tagging separately
- If the message targets a specific person, return their id in target_user

Respond with ONLY valid JSON:
{"text": "the message to send", "target_user": "personId or null"}`;

let _client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (!_client) {
    _client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION_NAME || "us-west-2",
    });
  }
  return _client;
}

export async function generateSlackMessage(
  userRequest: string,
  conversationHistory: string[],
): Promise<GeneratedSlackMessage> {
  const model = process.env.BRAIN_BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

  const historyContext = conversationHistory.length > 0
    ? `\nRecent conversation:\n${conversationHistory.slice(-4).map((m) => `- ${m}`).join("\n")}`
    : "";

  const client = getClient();
  const command = new InvokeModelCommand({
    modelId: model,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `${historyContext}\n\nUser request: "${userRequest}"` }],
    }),
  });

  try {
    const response = await client.send(command);
    const body = JSON.parse(new TextDecoder().decode(response.body));
    const text = body.content?.[0]?.text ?? "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { text: userRequest, targetUser: null };

    const parsed = JSON.parse(jsonMatch[0]);
    const targetUser = parsed.target_user && users.some((u) => u.id === parsed.target_user)
      ? (parsed.target_user as PersonId)
      : null;

    return {
      text: parsed.text || userRequest,
      targetUser,
    };
  } catch {
    return { text: userRequest, targetUser: null };
  }
}
