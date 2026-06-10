import { createMCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import { resolveAssignee } from "@company-brain/shared";
import { getEnv, requireEnv } from "./env";
import { HARBOR_BEAN_PROJECT, getNotionDatabaseId } from "./notion-runtime";
import { overdueInfo } from "./time";

const EXPECTED_NOTION_MCP_TOOLS = [
  "API-retrieve-a-database",
  "API-query-data-source",
  "API-get-block-children",
  "API-patch-page",
  "API-delete-a-block",
  "API-patch-block-children",
] as const;

type ExpectedNotionMcpTool = (typeof EXPECTED_NOTION_MCP_TOOLS)[number];

type McpToolSet = ToolSet;

type McpPage = {
  id?: string;
  url?: string;
  properties?: Record<string, unknown>;
};

type McpBlock = {
  id: string;
  type?: string;
  [key: string]: unknown;
};

type McpQueryTicketsInput = {
  project?: string;
  ticket?: string;
  includeBody?: boolean;
};

type McpMoveStatusInput = {
  ticket: string;
  currentStatus: string;
  newStatus: string;
};

type McpLatestAgentNoteInput = {
  ticket: string;
  note: string;
};

type McpAppendTicketNoteInput = {
  ticket: string;
  heading?: string;
  note: string;
};

export type McpTicketFieldValues = {
  name?: string;
  status?: string;
  project?: string;
  assignee?: string;
  dueDate?: string | null;
  priority?: string;
};

type McpUpdateTicketFieldsInput = {
  ticket: string;
  current?: McpTicketFieldValues;
  changes: McpTicketFieldValues;
};

type McpBodySection = {
  title: string;
  headingBlockId: string;
  headingIndex: number;
  endIndex: number;
  blockIds: string[];
  text: string;
};

export function expectedNotionMcpTools() {
  return [...EXPECTED_NOTION_MCP_TOOLS];
}

export async function createNotionMcpAgentRuntime() {
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: getNotionMcpUrl(),
      headers: {
        Authorization: `Bearer ${requireEnv("NOTION_MCP_AUTH_TOKEN")}`,
      },
      redirect: "error",
    },
    clientName: "company-brain-notion-mcp-agent",
  });

  const tools = await client.tools();

  return {
    client,
    tools,
    toolNames: Object.keys(tools).sort(),
    serverInfo: client.serverInfo,
    close: () => client.close(),
  };
}

export async function listNotionMcpTools() {
  return withNotionMcp(async (runtime) => {
    const definitions = await runtime.client.listTools();
    const names = definitions.tools.map((tool) => tool.name).sort();
    const missing = EXPECTED_NOTION_MCP_TOOLS.filter((tool) => !names.includes(tool));

    return {
      ok: missing.length === 0,
      source: "notion-mcp",
      server: runtime.client.serverInfo,
      count: names.length,
      expected: expectedNotionMcpTools(),
      missing,
      tools: names,
    };
  });
}

export async function queryMcpNotionTickets(input: McpQueryTicketsInput = {}) {
  return withNotionMcp(async (runtime) => {
    const dataSourceId = await getPrimaryDataSourceId(runtime);
    const project = input.project ?? HARBOR_BEAN_PROJECT;
    const includeBody = input.includeBody ?? true;
    const filters: unknown[] = [];

    if (project) {
      filters.push({ property: "Project", rich_text: { equals: project } });
    }

    if (input.ticket) {
      filters.push({ property: "Name", title: { contains: input.ticket } });
    }

    const response = await runtime.call("API-query-data-source", {
      data_source_id: dataSourceId,
      filter:
        filters.length === 0
          ? undefined
          : filters.length === 1
            ? filters[0]
            : { and: filters },
      sorts: [{ property: "Priority", direction: "ascending" }],
      page_size: 20,
    });

    const pages = resultsFromResponse(response).filter(isMcpPage);
    const tickets = await Promise.all(
      pages.map(async (page) => {
        const blocks = includeBody && page.id ? await getAllBlockChildren(runtime, page.id) : [];
        return normalizeMcpTicket(page, blocks);
      }),
    );

    return {
      ok: true,
      source: "notion-mcp",
      project,
      ticket: input.ticket,
      count: tickets.length,
      tickets,
      todayLocal: tickets[0]?.overdue.todayLocal ?? overdueInfo(null).todayLocal,
    };
  });
}

export async function moveMcpTicketStatus(input: McpMoveStatusInput) {
  return withNotionMcp(async (runtime) => {
    const ticketResult = await queryMcpNotionTicketsWithRuntime(runtime, {
      project: HARBOR_BEAN_PROJECT,
      ticket: input.ticket,
      includeBody: false,
    });

    if (ticketResult.tickets.length !== 1) {
      return {
        ok: false,
        source: "notion-mcp",
        reason: "ticket_lookup_failed",
        message: `Expected one Notion ticket for "${input.ticket}", found ${ticketResult.tickets.length}.`,
      };
    }

    const ticket = ticketResult.tickets[0];

    if (ticket.status !== input.currentStatus) {
      return {
        ok: false,
        source: "notion-mcp",
        reason: "current_state_guard_failed",
        message: `${ticket.code} is currently ${ticket.status}, not ${input.currentStatus}.`,
        ticket,
      };
    }

    await runtime.call("API-patch-page", {
      page_id: ticket.pageId,
      properties: {
        Status: {
          status: {
            name: input.newStatus,
          },
        },
      },
    });

    const verifyResult = await queryMcpNotionTicketsWithRuntime(runtime, {
      project: HARBOR_BEAN_PROJECT,
      ticket: input.ticket,
      includeBody: false,
    });

    const verified = verifyResult.tickets[0];

    if (!verified || normalizeComparableValue(verified.status) !== normalizeComparableValue(input.newStatus)) {
      return {
        ok: false,
        source: "notion-mcp",
        reason: "write_verification_failed",
        message: `Notion status move appeared to succeed but verification failed: status is ${verified?.status ?? "unknown"}, expected ${input.newStatus}.`,
        ticket,
      };
    }

    return {
      ok: true,
      source: "notion-mcp",
      action: "move_status",
      ticket: verified,
      previousStatus: input.currentStatus,
      newStatus: input.newStatus,
    };
  });
}

export async function updateMcpTicketFields(input: McpUpdateTicketFieldsInput) {
  return withNotionMcp(async (runtime) => {
    const ticketResult = await queryMcpNotionTicketsWithRuntime(runtime, {
      project: HARBOR_BEAN_PROJECT,
      ticket: input.ticket,
      includeBody: false,
    });

    if (ticketResult.tickets.length !== 1) {
      return {
        ok: false,
        source: "notion-mcp",
        reason: "ticket_lookup_failed",
        message: `Expected one Notion ticket for "${input.ticket}", found ${ticketResult.tickets.length}.`,
      };
    }

    const ticket = ticketResult.tickets[0];
    const changes = compactTicketFieldValues(input.changes);

    if (!Object.keys(changes).length) {
      return {
        ok: false,
        source: "notion-mcp",
        reason: "empty_changes",
        message: "Tool failed: updateNotion (no sprint-board field changes were provided).",
      };
    }

    const guard = ticketFieldGuard(ticket, input.current ?? {}, changes);

    if (!guard.ok) {
      return {
        ok: false,
        source: "notion-mcp",
        reason: "current_state_guard_failed",
        message: guard.message,
        ticket,
      };
    }

    await runtime.call("API-patch-page", {
      page_id: ticket.pageId,
      properties: notionPropertiesFromTicketFieldChanges(changes),
    });

    const verifyResult = await queryMcpNotionTicketsWithRuntime(runtime, {
      project: HARBOR_BEAN_PROJECT,
      ticket: input.ticket,
      includeBody: false,
    });

    const verified = verifyResult.tickets[0];
    const mismatch = verified ? verifyTicketFieldChanges(verified, changes) : null;

    if (!verified || mismatch) {
      return {
        ok: false,
        source: "notion-mcp",
        reason: "write_verification_failed",
        message: `Notion write appeared to succeed but verification failed: ${mismatch ?? "ticket not found on re-read"}.`,
        ticket,
      };
    }

    return {
      ok: true,
      source: "notion-mcp",
      action: "update_ticket_fields",
      ticket: verified,
      previous: ticketFieldSnapshot(ticket, changes),
      changes,
    };
  });
}

export async function updateMcpLatestAgentNote(input: McpLatestAgentNoteInput) {
  return withNotionMcp(async (runtime) => {
    const ticketResult = await queryMcpNotionTicketsWithRuntime(runtime, {
      project: HARBOR_BEAN_PROJECT,
      ticket: input.ticket,
      includeBody: false,
    });

    if (ticketResult.tickets.length !== 1) {
      return {
        ok: false,
        source: "notion-mcp",
        reason: "ticket_lookup_failed",
        message: `Expected one Notion ticket for "${input.ticket}", found ${ticketResult.tickets.length}.`,
      };
    }

    const ticket = ticketResult.tickets[0];
    const blocks = await getAllBlockChildren(runtime, ticket.pageId);
    const rewrite = buildLatestAgentNoteRewrite(blocks, input.note);

    if (!rewrite.ok) {
      return {
        ...rewrite,
        source: "notion-mcp",
      };
    }

    for (const blockId of rewrite.deleteBlockIds) {
      await runtime.call("API-delete-a-block", { block_id: blockId });
    }

    await runtime.call("API-patch-block-children", {
      block_id: ticket.pageId,
      after: rewrite.afterBlockId,
      children: rewrite.children,
    });

    return {
      ok: true,
      source: "notion-mcp",
      action: "record_latest_agent_note",
      ticket,
      note: input.note,
    };
  });
}

export async function appendMcpTicketNote(input: McpAppendTicketNoteInput) {
  return withNotionMcp(async (runtime) => {
    const ticketResult = await queryMcpNotionTicketsWithRuntime(runtime, {
      project: HARBOR_BEAN_PROJECT,
      ticket: input.ticket,
      includeBody: false,
    });

    if (ticketResult.tickets.length !== 1) {
      return {
        ok: false,
        source: "notion-mcp",
        reason: "ticket_lookup_failed",
        message: `Expected one Notion ticket for "${input.ticket}", found ${ticketResult.tickets.length}.`,
      };
    }

    const ticket = ticketResult.tickets[0];
    const heading = input.heading?.trim() || "Agent fix note";

    await runtime.call("API-patch-block-children", {
      block_id: ticket.pageId,
      children: [heading2Block(heading), paragraphBlock(input.note)],
    });

    const verifyBlocks = await getAllBlockChildren(runtime, ticket.pageId);
    const body = verifyBlocks.map(blockToMarkdown).filter(Boolean).join("\n");

    if (!body.includes(input.note.slice(0, 80))) {
      return {
        ok: false,
        source: "notion-mcp",
        reason: "write_verification_failed",
        message: `Notion append appeared to succeed but verification did not find the note on ${ticket.code}.`,
        ticket,
      };
    }

    return {
      ok: true,
      source: "notion-mcp",
      action: "append_ticket_note",
      ticket,
      heading,
      note: input.note,
    };
  });
}

async function queryMcpNotionTicketsWithRuntime(
  runtime: NotionMcpRuntime,
  input: McpQueryTicketsInput = {},
) {
  const dataSourceId = await getPrimaryDataSourceId(runtime);
  const project = input.project ?? HARBOR_BEAN_PROJECT;
  const includeBody = input.includeBody ?? true;
  const filters: unknown[] = [];

  if (project) {
    filters.push({ property: "Project", rich_text: { equals: project } });
  }

  if (input.ticket) {
    filters.push({ property: "Name", title: { contains: input.ticket } });
  }

  const response = await runtime.call("API-query-data-source", {
    data_source_id: dataSourceId,
    filter:
      filters.length === 0
        ? undefined
        : filters.length === 1
          ? filters[0]
          : { and: filters },
    sorts: [{ property: "Priority", direction: "ascending" }],
    page_size: 20,
  });

  const pages = resultsFromResponse(response).filter(isMcpPage);
  const tickets = await Promise.all(
    pages.map(async (page) => {
      const blocks = includeBody && page.id ? await getAllBlockChildren(runtime, page.id) : [];
      return normalizeMcpTicket(page, blocks);
    }),
  );

  return {
    ok: true,
    source: "notion-mcp",
    project,
    ticket: input.ticket,
    count: tickets.length,
    tickets,
  };
}

type NotionMcpRuntime = Awaited<ReturnType<typeof createNotionMcpRuntime>>;

async function createNotionMcpRuntime() {
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: getNotionMcpUrl(),
      headers: {
        Authorization: `Bearer ${requireEnv("NOTION_MCP_AUTH_TOKEN")}`,
      },
      redirect: "error",
    },
    clientName: "company-brain-notion-mcp-smoke",
  });

  const tools = await client.tools();

  return {
    client,
    tools,
    async call(toolName: ExpectedNotionMcpTool, input: Record<string, unknown>) {
      const tool = tools[toolName];

      if (!tool) {
        throw new Error(`Notion MCP tool ${toolName} is not available.`);
      }

      const result = await tool.execute(removeUndefined(input) as never, {
        toolCallId: `${toolName}-${Date.now()}`,
        messages: [],
      } as never);

      return unwrapMcpToolResult(result);
    },
  };
}

async function withNotionMcp<T>(handler: (runtime: NotionMcpRuntime) => Promise<T>) {
  const runtime = await createNotionMcpRuntime();

  try {
    return await handler(runtime);
  } finally {
    await runtime.client.close();
  }
}

function getNotionMcpUrl() {
  const configuredUrl = getEnv("NOTION_MCP_URL");

  if (configuredUrl) {
    return configuredUrl;
  }

  const host = getEnv("NOTION_MCP_HOST") ?? "127.0.0.1";
  const port = getEnv("NOTION_MCP_PORT") ?? "3333";
  return `http://${host}:${port}/mcp`;
}

async function getPrimaryDataSourceId(runtime: NotionMcpRuntime) {
  const database = await runtime.call("API-retrieve-a-database", {
    database_id: getNotionDatabaseId(),
  });
  const dataSources = objectValue(database).data_sources;

  if (Array.isArray(dataSources)) {
    const firstDataSource = dataSources.find((item) => objectValue(item).id);
    const id = objectValue(firstDataSource).id;

    if (typeof id === "string") {
      return id;
    }
  }

  return getNotionDatabaseId();
}

async function getAllBlockChildren(runtime: NotionMcpRuntime, blockId: string) {
  const blocks: McpBlock[] = [];
  let startCursor: string | undefined;

  do {
    const response = await runtime.call("API-get-block-children", {
      block_id: blockId,
      page_size: 100,
      start_cursor: startCursor,
    });

    blocks.push(...resultsFromResponse(response).filter(isMcpBlock));
    const nextCursor = objectValue(response).next_cursor;
    startCursor = typeof nextCursor === "string" ? nextCursor : undefined;
  } while (startCursor);

  return blocks;
}

function unwrapMcpToolResult(result: unknown) {
  const value = objectValue(result);

  if (value.isError) {
    throw new Error(textFromMcpContent(result) || "Notion MCP tool returned an error.");
  }

  if ("structuredContent" in value) {
    return value.structuredContent;
  }

  const text = textFromMcpContent(result);
  if (!text) {
    return result;
  }

  const parsed = parseLooseJson(text);
  const parsedValue = objectValue(parsed);

  if (parsedValue.object === "error") {
    throw new Error(typeof parsedValue.message === "string" ? parsedValue.message : text);
  }

  return parsed;
}

function textFromMcpContent(result: unknown) {
  const content = objectValue(result).content;

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      const value = objectValue(part);
      return value.type === "text" && typeof value.text === "string" ? value.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function parseLooseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const objectStart = text.indexOf("{");
    const objectEnd = text.lastIndexOf("}");

    if (objectStart >= 0 && objectEnd > objectStart) {
      try {
        return JSON.parse(text.slice(objectStart, objectEnd + 1));
      } catch {
        return text;
      }
    }

    const arrayStart = text.indexOf("[");
    const arrayEnd = text.lastIndexOf("]");

    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      try {
        return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
      } catch {
        return text;
      }
    }

    return text;
  }
}

function resultsFromResponse(response: unknown) {
  const results = objectValue(response).results;
  return Array.isArray(results) ? results : [];
}

function normalizeMcpTicket(page: McpPage, blocks: McpBlock[]) {
  const properties = objectValue(page.properties);
  const name = titleProperty(properties.Name);
  const dueDate = dateProperty(properties["Due Date"]);
  const sections = extractMcpBodySections(blocks);

  return {
    pageId: String(page.id ?? ""),
    url: typeof page.url === "string" ? page.url : undefined,
    code: ticketCodeFromName(name),
    name,
    status: statusProperty(properties.Status),
    project: richTextProperty(properties.Project),
    assignee: richTextProperty(properties.Assignee),
    dueDate,
    priority: selectProperty(properties.Priority),
    body: blocks.map(blockToMarkdown).filter(Boolean).join("\n"),
    sections,
    overdue: overdueInfo(dueDate),
  };
}

function extractMcpBodySections(blocks: McpBlock[]) {
  const sections: McpBodySection[] = [];
  let current: McpBodySection | undefined;

  blocks.forEach((block, index) => {
    if (block.type === "heading_2") {
      if (current) {
        current.endIndex = index - 1;
        sections.push(current);
      }

      current = {
        title: richTextFromBlock(block),
        headingBlockId: block.id,
        headingIndex: index,
        endIndex: blocks.length - 1,
        blockIds: [],
        text: "",
      };
      return;
    }

    if (!current) return;

    const markdown = blockToMarkdown(block);
    current.blockIds.push(block.id);
    current.text = [current.text, markdown].filter(Boolean).join("\n");
  });

  if (current) {
    sections.push(current);
  }

  return sections;
}

function buildLatestAgentNoteRewrite(blocks: McpBlock[], note: string) {
  const sections = extractMcpBodySections(blocks);
  const latest = findUniqueSection(sections, "Latest agent note");

  if (latest.state === "ambiguous") {
    return {
      ok: false as const,
      reason: "ambiguous_section",
      message: "Latest agent note appears more than once, so updateNotion did not mutate the page.",
    };
  }

  if (latest.section) {
    return {
      ok: true as const,
      afterBlockId: latest.section.headingBlockId,
      deleteBlockIds: latest.section.blockIds,
      children: [paragraphBlock(note)],
    };
  }

  const agentFlow = findUniqueSection(sections, "Agent flow");
  const acceptance = findUniqueSection(sections, "Acceptance checks");

  if (agentFlow.state === "ambiguous" || acceptance.state === "ambiguous") {
    return {
      ok: false as const,
      reason: "ambiguous_section",
      message: "Agent flow or Acceptance checks is ambiguous, so updateNotion did not mutate the page.",
    };
  }

  if (!agentFlow.section || !acceptance.section || agentFlow.section.headingIndex >= acceptance.section.headingIndex) {
    return {
      ok: false as const,
      reason: "missing_controlled_sections",
      message:
        "Could not find Agent flow followed by Acceptance checks, so updateNotion did not mutate the page.",
    };
  }

  const insertAfter = blocks[acceptance.section.headingIndex - 1];

  if (!insertAfter) {
    return {
      ok: false as const,
      reason: "missing_insert_position",
      message: "Could not identify a safe insertion point for Latest agent note.",
    };
  }

  return {
    ok: true as const,
    afterBlockId: insertAfter.id,
    deleteBlockIds: [],
    children: [heading2Block("Latest agent note"), paragraphBlock(note)],
  };
}

function findUniqueSection(sections: McpBodySection[], title: string) {
  const matches = sections.filter((section) => normalizeSectionTitle(section.title) === normalizeSectionTitle(title));

  if (matches.length > 1) {
    return { state: "ambiguous" as const };
  }

  return { state: "ok" as const, section: matches[0] };
}

function blockToMarkdown(block: McpBlock) {
  const text = richTextFromBlock(block);

  if (!text) return "";

  switch (block.type) {
    case "heading_2":
      return `## ${text}`;
    case "bulleted_list_item":
      return `- ${text}`;
    case "numbered_list_item":
      return `1. ${text}`;
    case "paragraph":
      return text;
    default:
      return text;
  }
}

function richTextFromBlock(block: McpBlock) {
  const type = block.type;
  if (!type) return "";

  const body = objectValue(block[type]);
  const richText = body.rich_text;
  return richTextToPlain(Array.isArray(richText) ? richText : []);
}

function titleProperty(property: unknown) {
  const title = objectValue(property).title;
  return richTextToPlain(Array.isArray(title) ? title : []);
}

function richTextProperty(property: unknown) {
  const richText = objectValue(property).rich_text;
  return richTextToPlain(Array.isArray(richText) ? richText : []);
}

function statusProperty(property: unknown) {
  const status = objectValue(objectValue(property).status).name;
  return typeof status === "string" ? status : "";
}

function selectProperty(property: unknown) {
  const select = objectValue(objectValue(property).select).name;
  return typeof select === "string" ? select : "";
}

function dateProperty(property: unknown) {
  const start = objectValue(objectValue(property).date).start;
  return typeof start === "string" ? start.slice(0, 10) : null;
}

function richTextToPlain(items: unknown[]) {
  return items
    .map((item) => {
      const value = objectValue(item);
      const text = objectValue(value.text);
      const content =
        typeof value.plain_text === "string"
          ? value.plain_text
          : typeof text.content === "string"
            ? text.content
            : "";
      const href =
        typeof value.href === "string"
          ? value.href
          : typeof objectValue(text.link).url === "string"
            ? objectValue(text.link).url
            : "";

      return href ? `${content} (${href})` : content;
    })
    .join("");
}

function ticketCodeFromName(name: string) {
  return name.match(/\b[A-Z]{2}-\d{3}\b/)?.[0] ?? "";
}

function notionPropertiesFromTicketFieldChanges(changes: McpTicketFieldValues) {
  const properties: Record<string, unknown> = {};

  if (changes.name !== undefined) {
    properties.Name = { title: [{ type: "text", text: { content: changes.name } }] };
  }

  if (changes.status !== undefined) {
    properties.Status = { status: { name: changes.status } };
  }

  if (changes.project !== undefined) {
    properties.Project = { rich_text: [{ type: "text", text: { content: changes.project } }] };
  }

  if (changes.assignee !== undefined) {
    properties.Assignee = { rich_text: [{ type: "text", text: { content: changes.assignee } }] };
  }

  if (changes.dueDate !== undefined) {
    properties["Due Date"] = { date: changes.dueDate ? { start: changes.dueDate } : null };
  }

  if (changes.priority !== undefined) {
    properties.Priority = { select: { name: changes.priority } };
  }

  return properties;
}

function ticketFieldGuard(ticket: ReturnType<typeof normalizeMcpTicket>, current: McpTicketFieldValues, changes: McpTicketFieldValues) {
  for (const field of Object.keys(changes) as Array<keyof McpTicketFieldValues>) {
    const expected = current[field];

    if (expected === undefined) {
      continue;
    }

    const actual = ticket[field];

    if (normalizeComparableValue(actual) !== normalizeComparableValue(expected)) {
      return {
        ok: false as const,
        message: `${ticket.code} ${field} is currently ${formatFieldValue(actual)}, not ${formatFieldValue(expected)}.`,
      };
    }
  }

  return { ok: true as const };
}

function ticketFieldSnapshot(ticket: ReturnType<typeof normalizeMcpTicket>, changes: McpTicketFieldValues) {
  const snapshot: McpTicketFieldValues = {};

  for (const field of Object.keys(changes) as Array<keyof McpTicketFieldValues>) {
    snapshot[field] = ticket[field] as never;
  }

  return snapshot;
}

function applyTicketFieldChanges(ticket: ReturnType<typeof normalizeMcpTicket>, changes: McpTicketFieldValues) {
  return {
    ...ticket,
    ...(changes.name !== undefined ? { name: changes.name, code: ticketCodeFromName(changes.name) } : {}),
    ...(changes.status !== undefined ? { status: changes.status } : {}),
    ...(changes.project !== undefined ? { project: changes.project } : {}),
    ...(changes.assignee !== undefined ? { assignee: changes.assignee } : {}),
    ...(changes.dueDate !== undefined ? { dueDate: changes.dueDate } : {}),
    ...(changes.priority !== undefined ? { priority: changes.priority } : {}),
  };
}

function compactTicketFieldValues(values: McpTicketFieldValues) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as McpTicketFieldValues;
}

function formatFieldValue(value: unknown) {
  return value === null || value === "" || value === undefined ? "empty" : String(value);
}

function normalizeSectionTitle(title: string) {
  return title.trim().toLowerCase();
}

function normalizeComparableValue(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function heading2Block(content: string) {
  return {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ type: "text", text: { content } }],
    },
  };
}

function paragraphBlock(content: string) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: content.slice(0, 1900) } }],
    },
  };
}

function removeUndefined(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function isMcpPage(value: unknown): value is McpPage {
  return typeof value === "object" && value !== null && "properties" in value && "id" in value;
}

function isMcpBlock(value: unknown): value is McpBlock {
  return typeof value === "object" && value !== null && typeof objectValue(value).id === "string";
}

function objectValue(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function verifyTicketFieldChanges(
  ticket: ReturnType<typeof normalizeMcpTicket>,
  changes: McpTicketFieldValues,
): string | null {
  for (const field of Object.keys(changes) as Array<keyof McpTicketFieldValues>) {
    const expected = changes[field];
    if (expected === undefined) continue;
    const actual = ticket[field];

    if (field === "assignee") {
      const canonicalActual = resolveAssignee(String(actual ?? "")) ?? normalizeComparableValue(actual);
      const canonicalExpected = resolveAssignee(String(expected)) ?? normalizeComparableValue(expected);
      if (canonicalActual.toLowerCase() !== canonicalExpected.toLowerCase()) {
        return `${field} is "${formatFieldValue(actual)}", expected "${formatFieldValue(expected)}"`;
      }
    } else if (normalizeComparableValue(actual) !== normalizeComparableValue(expected)) {
      return `${field} is "${formatFieldValue(actual)}", expected "${formatFieldValue(expected)}"`;
    }
  }
  return null;
}
