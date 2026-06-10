import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { getEnv } from "./env";

export type RoutedTools = {
  tools: string[];
  reasoning: string;
};

const AVAILABLE_TOOLS = [
  { name: "queryNotion", description: "Search Notion for company docs, project info, meeting notes" },
  { name: "querySlack", description: "Search Slack channels for messages, updates, announcements" },
  { name: "queryGithub", description: "Search GitHub repos, PRs, issues, code" },
  { name: "queryExa", description: "Search the public web for verification, research, CVEs, or news" },
  { name: "queryRepos", description: "Check repo dependency monitors and CVE alerts" },
  { name: "updateNotion", description: "Update existing Notion sprint board ticket fields or agent notes" },
  { name: "createNotionTicket", description: "Create a new ticket on the Notion sprint board" },
  { name: "updateSlack", description: "Send Slack messages or notifications" },
  { name: "updateGithub", description: "Create PRs, issues, or push code changes" },
  { name: "makePayment", description: "Set or distribute budget to projects via Stripe virtual cards" },
  { name: "buySomething", description: "Order food, plan a team lunch or dinner — reads dietary profiles, searches restaurants via Exa, charges via Stripe. Use for any food/meal/dinner/lunch/catering request." },
] as const;

const SYSTEM_PROMPT = `You are a tool router for an AI assistant called "Company Brain". Given the user's message and conversation history, decide which tools should be called to fulfill the request.

Available tools:
${AVAILABLE_TOOLS.map((t) => `- ${t.name}: ${t.description}`).join("\n")}

Rules:
- Always include at least one query tool (queryNotion or querySlack) for context gathering unless the request is purely about external web search or payments.
- Only include "update" tools if the user explicitly asks to send, post, move, assign, create, or change something.
- Only include queryExa if the user asks about public/external information, fact-checking, vulnerabilities, or news.
- Only include queryRepos if the user asks about dependency monitoring, CVEs in their repos, or package vulnerabilities.
- Include makePayment if the user mentions budget, allocate, distribute funds, or set spending limits for projects.
- Include buySomething if the user mentions ordering food, team lunch, team dinner, planning a meal, catering, dinner, lunch, or any food-related request.
- Return 1-4 tools max. Fewer is better.

Respond with ONLY valid JSON in this format:
{"tools": ["toolName1", "toolName2"], "reasoning": "one sentence why"}`;

let _client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (!_client) {
    _client = new BedrockRuntimeClient({
      region: getEnv("AWS_REGION_NAME") ?? getEnv("AWS_DEFAULT_REGION") ?? "us-west-2",
    });
  }
  return _client;
}

export async function routeMessage(
  message: string,
  conversationHistory: string[],
): Promise<RoutedTools> {
  const model = getEnv("BRAIN_BEDROCK_MODEL") ?? "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

  const historyContext = conversationHistory.length > 0
    ? `\n\nRecent conversation:\n${conversationHistory.slice(-6).map((m) => `- ${m}`).join("\n")}`
    : "";

  const userPrompt = `${historyContext}\n\nCurrent message: "${message}"\n\nWhich tools should be called?`;

  const client = getClient();
  const command = new InvokeModelCommand({
    modelId: model,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  try {
    const response = await client.send(command);
    const body = JSON.parse(new TextDecoder().decode(response.body));
    const text = body.content?.[0]?.text ?? "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallbackRoute(message);

    const parsed = JSON.parse(jsonMatch[0]) as RoutedTools;
    const validTools = parsed.tools.filter((t) =>
      AVAILABLE_TOOLS.some((at) => at.name === t)
    );

    if (validTools.length === 0) return fallbackRoute(message);

    return { tools: validTools, reasoning: parsed.reasoning || "" };
  } catch {
    return fallbackRoute(message);
  }
}

function fallbackRoute(message: string): RoutedTools {
  const lower = message.toLowerCase();
  const tools: string[] = ["queryNotion", "querySlack"];

  if (/github|code|pr|issue|repo/i.test(lower)) tools.push("queryGithub");
  if (/verify|fact.?check|cve|vulnerability|news|docs|tutorial/i.test(lower)) tools.push("queryExa");
  if (/move|update|send|assign|change|post/i.test(lower)) {
    tools.push("updateNotion", "updateSlack");
  }
  if (/create.*ticket|new.*ticket|add.*task|file.*ticket/i.test(lower)) {
    tools.push("createNotionTicket");
  }
  if (/budget|allocat|distribute.*fund|spending.*limit/i.test(lower)) {
    tools.push("makePayment");
  }
  if (/order.*food|team.*lunch|team.*dinner|cater|meal|dinner|lunch.*for|food.*for/i.test(lower)) {
    tools.push("buySomething");
  }

  return { tools, reasoning: "Fallback regex routing (Bedrock unavailable)" };
}
