import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { stepCountIs, streamText, type ModelMessage } from "ai";
import { getRuntimeModel } from "../lib/ai-model";
import { getNotionDatabaseId, HARBOR_BEAN_PROJECT } from "../lib/notion-runtime";
import { createNotionMcpAgentRuntime } from "../lib/notion-mcp-runtime";
import { gmt8TodayFromNow } from "../lib/time";

const messages: ModelMessage[] = [];

try {
  const notion = await createNotionMcpAgentRuntime();

  console.log("LGTM Notion MCP agent chat");
  console.log(`Connected to ${notion.serverInfo.name} MCP server with ${notion.toolNames.length} tools.`);
  console.log(`Tools: ${notion.toolNames.join(", ")}`);
  console.log('Type a question, or "/exit" to quit.');
  console.log("");

  try {
    if (input.isTTY) {
      const rl = createInterface({ input, output });

      try {
        while (true) {
          const userInput = (await rl.question("you> ")).trim();

          if (shouldExit(userInput)) break;
          await runTurn(userInput, notion.tools);
        }
      } finally {
        rl.close();
      }
    } else {
      const pipedInput = await readStdinText();
      const lines = pipedInput
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        console.log(`you> ${line}`);
        if (shouldExit(line)) break;
        await runTurn(line, notion.tools);
      }
    }
  } finally {
    await notion.close();
  }
} catch (error) {
  console.error("");
  console.error("Could not start the Notion MCP agent chat.");
  console.error(error instanceof Error ? error.message : String(error));
  console.error("");
  console.error("Make sure the sidecar is running in another terminal:");
  console.error("  bun run notion:mcp");
  process.exitCode = 1;
}

function notionMcpSystemPrompt() {
  return `
You are LGTM Company Brain, a Notion MCP-native project-management agent.
Today is ${gmt8TodayFromNow(Date.now())} in GMT+8.

Primary workspace:
- Sprint board database_id: ${getNotionDatabaseId()}
- Default project: ${HARBOR_BEAN_PROJECT}
- The board properties are Name, Status, Project, Assignee, Due Date, and Priority.

You have many low-level Notion MCP tools. Use them deliberately.

Read workflow:
1. For project or ticket questions, first call API-retrieve-a-database with the sprint board database_id.
2. Use the first returned data_sources id as data_source_id. If no data_sources id is available, use the database_id.
3. Query tickets with API-query-data-source. For Harbor Bean, filter Project rich_text equals "${HARBOR_BEAN_PROJECT}".
4. If the user names a ticket code or title, also filter Name title contains the code or distinctive title words.
5. Do not filter Status for "Overdue" or "Blocked"; those are reasoning labels, not board status values.
6. For overdue or potential blocker questions, query all "${HARBOR_BEAN_PROJECT}" tickets, compare Due Date against today, then fetch body context for the relevant pages.
7. Fetch body context for relevant tickets with API-get-block-children using the page id as block_id.
8. Answer from the fetched Notion properties and body. Do not invent unseen ticket state.

Update workflow:
1. Always read the current page/ticket before mutating.
2. If the user asks to move a ticket and has not already clearly approved the exact change, ask for confirmation before calling API-patch-page.
3. If the user already clearly approved the exact change in the latest message, call API-patch-page with the page_id and the guarded property update.
4. For status moves, patch only properties.Status.status.name.
5. Do not delete, archive, move, create, or edit unrelated pages unless the user explicitly asks and the target is unambiguous.
6. After a successful mutation, report exactly what changed and say that the action should be audited in #company-brain-actions.

Recommended tool order:
- Broad status question: API-retrieve-a-database -> API-query-data-source -> API-get-block-children for relevant pages.
- Known ticket question: API-retrieve-a-database -> API-query-data-source -> API-get-block-children.
- Status update: API-retrieve-a-database -> API-query-data-source -> confirmation if needed -> API-patch-page.

Response style:
- Be concise.
- State the answer first.
- Include the evidence used, such as ticket code, status, due date, assignee, or body section.
- If a tool fails or the target is ambiguous, explain the failure and the next safest step.
`.trim();
}

async function runTurn(
  userInput: string,
  tools: Awaited<ReturnType<typeof createNotionMcpAgentRuntime>>["tools"],
) {
  if (!userInput) return;

  messages.push({ role: "user", content: userInput });

  const result = streamText({
    model: getRuntimeModel(),
    system: notionMcpSystemPrompt(),
    messages,
    tools,
    stopWhen: stepCountIs(8),
    maxOutputTokens: 1000,
    experimental_onToolCallStart: async (event) => {
      console.log("");
      console.log(`Tool called: ${event.toolCall.toolName}`);
      console.log(`Input: ${compactJson(event.toolCall.input)}`);
    },
    experimental_onToolCallFinish: async (event) => {
      if (event.success) {
        console.log(`Tool result: ${compactJson(event.output)}`);
        return;
      }

      console.log(`Tool failed: ${event.error instanceof Error ? event.error.message : String(event.error)}`);
    },
  });

  const [answer, response] = await Promise.all([result.text, result.response]);
  const trimmedAnswer = answer.trim();

  if (trimmedAnswer) {
    console.log("");
    console.log(`brain> ${trimmedAnswer}`);
  } else {
    console.log("");
    console.log("brain> No final text returned.");
  }

  messages.push(...response.messages);
  trimConversationHistory();
  console.log("");
}

function shouldExit(userInput: string) {
  return ["/exit", "/quit", "exit", "quit"].includes(userInput.toLowerCase());
}

async function readStdinText() {
  const chunks: Buffer[] = [];

  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function trimConversationHistory() {
  const maxMessages = 18;

  if (messages.length <= maxMessages) return;

  messages.splice(0, messages.length - maxMessages);
}

function compactJson(value: unknown) {
  const json = JSON.stringify(
    value,
    (_key, nestedValue) => {
      if (typeof nestedValue === "string" && nestedValue.length > 500) {
        return `${nestedValue.slice(0, 500)}...`;
      }

      return nestedValue;
    },
    2,
  );

  if (!json) return String(value);

  return json.length > 1800 ? `${json.slice(0, 1797)}...` : json;
}
