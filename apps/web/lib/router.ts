import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

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
  { name: "updateNotion", description: "Create or update Notion pages/databases" },
  { name: "updateSlack", description: "Send Slack messages or notifications" },
  { name: "updateGithub", description: "Create PRs, issues, or push code changes" },
  { name: "makePayment", description: "Process a payment transaction" },
  { name: "buySomething", description: "Purchase items or services" },
] as const;

const SYSTEM_PROMPT = `You are a tool router for an AI assistant called "Company Brain". Given the user's message and conversation history, decide which tools should be called to fulfill the request.

Available tools:
${AVAILABLE_TOOLS.map((t) => `- ${t.name}: ${t.description}`).join("\n")}

Rules:
- Always include at least one query tool (queryNotion or querySlack) for context gathering unless the request is purely about external web search or payments.
- Only include "update" tools if the user explicitly asks to send, post, move, assign, create, or change something.
- Only include queryExa if the user asks about public/external information, fact-checking, vulnerabilities, or news.
- Only include queryRepos if the user asks about dependency monitoring, CVEs in their repos, or package vulnerabilities.
- Only include payment tools if the user explicitly mentions paying, buying, or purchasing.
- Return 1-4 tools max. Fewer is better.

Respond with ONLY valid JSON in this format:
{"tools": ["toolName1", "toolName2"], "reasoning": "one sentence why"}`;

let _client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (!_client) {
    _client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION_NAME || "us-west-2",
    });
  }
  return _client;
}

export async function routeMessage(
  message: string,
  conversationHistory: string[],
): Promise<RoutedTools> {
  const model = process.env.BRAIN_BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

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

  return { tools, reasoning: "Fallback regex routing (Bedrock unavailable)" };
}
