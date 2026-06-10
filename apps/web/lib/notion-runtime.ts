import { Client } from "@notionhq/client";
import { getEnv, requireEnv } from "./env";
import { overdueInfo } from "./time";

export const HARBOR_BEAN_PROJECT = "Harbor Bean Cafe";
export const NOTION_DATABASE_ID_FALLBACK = "37a8701d81fb80f6bdf1fc4188be5e10";

export const DEMO_TICKETS = [
  {
    code: "HB-101",
    name: "HB-101 Collect final reservation link from Harbor Bean",
    pageId: "37a8701d-81fb-811a-9e8a-c37e63fc3f80",
    status: "Not started",
    assignee: "Carlos Vincent Frasenda",
    priority: "P0",
    dueDate: "2026-06-05",
    body: [
      {
        title: "Context",
        lines: ["Harbor Bean cannot launch the primary reservation CTA until the final booking URL is confirmed."],
      },
      {
        title: "Why this ticket exists",
        lines: [
          "The due date is June 5, 2026. As of June 9, 2026, this is overdue and can be treated as potentially blocked until Carlos confirms client response.",
        ],
      },
      {
        title: "Agent flow",
        lines: [
          "queryNotion identifies this as P0, Not started, and overdue.",
          "The agent marks it as potentially blocked, explains Carlos owns follow-up, and can write a Latest agent note when asked.",
          "updateNotion may clear the blocker once the reservation URL is received.",
        ],
      },
      {
        title: "Acceptance checks",
        lines: [
          "Reservation URL is present in the ticket body.",
          "CTA copy and destination are verified before launch.",
        ],
      },
      {
        title: "Demo prompt",
        lines: ["Record that HB-101 is potentially blocked and needs Carlos follow-up."],
      },
    ],
  },
  {
    code: "HB-201",
    name: "HB-201 Build hero and opening-hours section",
    pageId: "37a8701d-81fb-8198-9313-eae153979ad5",
    status: "In progress",
    assignee: "Edrick Kesuma",
    priority: "P1",
    dueDate: "2026-06-11",
    body: [
      {
        title: "Context",
        lines: ["The landing page needs a polished hero section and current opening-hours content before review."],
      },
      {
        title: "Agent flow",
        lines: [
          "Status moves require a second-turn approval.",
          "The agent first queries the current status, asks for confirmation, then updates from In progress to In review after approval.",
        ],
      },
      {
        title: "Acceptance checks",
        lines: [
          "Hero section renders on mobile and desktop.",
          "Opening hours are copied from the approved Harbor Bean source.",
        ],
      },
      {
        title: "Demo prompt",
        lines: ["Move HB-201 to In review."],
      },
    ],
  },
  {
    code: "HB-204",
    name: "HB-204 Validate responsive Google Maps embed",
    pageId: "37a8701d-81fb-819c-99aa-c8901021be60",
    status: "In progress",
    assignee: "Edrick Kesuma",
    priority: "P0",
    dueDate: "2026-06-10",
    body: [
      {
        title: "Context",
        lines: ["The embedded map has been reported as overflowing on mobile widths."],
      },
      {
        title: "Agent flow",
        lines: [
          "queryNotion fetches the blocker context from this body.",
          "queryExa validates whether official docs suggest a responsive iframe/aspect-ratio fix.",
          "The agent answers only by default and does not mutate Notion unless asked to record evidence.",
        ],
      },
      {
        title: "External validation query",
        lines: ["official docs responsive iframe aspect-ratio Google Maps embed mobile overflow"],
      },
      {
        title: "Acceptance checks",
        lines: [
          "Map does not overflow at common mobile widths.",
          "Evidence URL is recorded only when the user asks to save it.",
        ],
      },
      {
        title: "Demo prompt",
        lines: ["Is the map issue a real blocker or fixable based on docs?"],
      },
    ],
  },
  {
    code: "HB-301",
    name: "HB-301 Sync latest menu photo metadata to knowledge vault",
    pageId: "37a8701d-81fb-81dd-aca1-e74dfd9c606f",
    status: "In review",
    assignee: "Darren Prasetya",
    priority: "P2",
    dueDate: "2026-06-11",
    body: [
      {
        title: "Context",
        lines: ["Marketing assets should remain discoverable from the company brain without moving teams out of Notion."],
      },
      {
        title: "Agent flow",
        lines: ["The agent can summarize whether the image metadata is ready, but this is background context for v1."],
      },
      {
        title: "Acceptance checks",
        lines: ["Menu image source URL is linked.", "Metadata is present for title, owner, and last verified date."],
      },
    ],
  },
  {
    code: "HB-501",
    name: "HB-501 Confirm launch deposit approval source",
    pageId: "37a8701d-81fb-818d-8e16-d3aa2e867e7b",
    status: "Not started",
    assignee: "Carlos Vincent Frasenda",
    priority: "P1",
    dueDate: "2026-06-12",
    body: [
      {
        title: "Context",
        lines: ["Launch deposit/payment work must wait for a verified approval source."],
      },
      {
        title: "Agent flow",
        lines: [
          "The agent may identify that payment approval is incomplete.",
          "No payment or external mutation should happen without human approval.",
        ],
      },
      {
        title: "Acceptance checks",
        lines: ["Approval source is linked in Notion.", "Payment action remains gated until approved."],
      },
    ],
  },
] as const;

export type NotionBodySection = {
  title: string;
  headingBlockId: string;
  headingIndex: number;
  endIndex: number;
  blockIds: string[];
  text: string;
};

export type SprintTicket = {
  pageId: string;
  url?: string;
  code: string;
  name: string;
  status: string;
  project: string;
  assignee: string;
  dueDate: string | null;
  priority: string;
  body: string;
  sections: NotionBodySection[];
  overdue: ReturnType<typeof overdueInfo>;
};

type NotionBlock = {
  id: string;
  type?: string;
  [key: string]: unknown;
};

type QueryNotionInput = {
  project?: string;
  ticket?: string;
  includeBody?: boolean;
};

type UpdateLatestNoteInput = {
  ticket: string;
  note: string;
};

type MoveStatusInput = {
  ticket: string;
  currentStatus: string;
  newStatus: string;
};

let notionClient: Client | undefined;

export function getNotionClient() {
  notionClient ??= new Client({ auth: requireEnv("NOTION_TOKEN") });
  return notionClient;
}

export function getNotionDatabaseId() {
  return getEnv("NOTION_DATABASE_ID") ?? NOTION_DATABASE_ID_FALLBACK;
}

export async function queryNotionTickets(input: QueryNotionInput = {}) {
  const notion = getNotionClient();
  const dataSourceId = await getPrimaryDataSourceId();
  const project = input.project ?? HARBOR_BEAN_PROJECT;
  const includeBody = input.includeBody ?? true;
  const filters: unknown[] = [];

  if (project) {
    filters.push({ property: "Project", rich_text: { equals: project } });
  }

  if (input.ticket) {
    filters.push({ property: "Name", title: { contains: input.ticket } });
  }

  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
    filter:
      filters.length === 0
        ? undefined
        : filters.length === 1
          ? (filters[0] as never)
          : ({ and: filters } as never),
    sorts: [{ property: "Priority", direction: "ascending" }],
    page_size: 20,
    result_type: "page",
  });

  const pages = response.results.filter((page: unknown) => isNotionPage(page));
  const tickets = await Promise.all(
    pages.map(async (page: Record<string, unknown>) => {
      const blocks = includeBody ? await listRootBlocks(String(page.id)) : [];
      return normalizeTicket(page as Record<string, unknown>, blocks);
    }),
  );

  return {
    ok: true,
    source: "notion",
    project,
    ticket: input.ticket,
    tickets,
    todayLocal: tickets[0]?.overdue.todayLocal ?? overdueInfo(null).todayLocal,
  };
}

async function getPrimaryDataSourceId() {
  const database = (await getNotionClient().databases.retrieve({
    database_id: getNotionDatabaseId(),
  })) as Record<string, unknown>;
  const dataSources = database.data_sources as Array<{ id?: string }> | undefined;
  return dataSources?.[0]?.id ?? getNotionDatabaseId();
}

function isNotionPage(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && "properties" in value && "id" in value;
}

export async function updateLatestAgentNote(input: UpdateLatestNoteInput) {
  const ticket = await findSingleTicket(input.ticket);
  const blocks = await listRootBlocks(ticket.pageId);
  const rewrite = buildLatestAgentNoteRewrite(blocks, input.note);

  if (!rewrite.ok) {
    return rewrite;
  }

  for (const blockId of rewrite.deleteBlockIds) {
    await getNotionClient().blocks.delete({ block_id: blockId });
  }

  await getNotionClient().blocks.children.append({
    block_id: ticket.pageId,
    after: rewrite.afterBlockId,
    children: rewrite.children as never,
  });

  return {
    ok: true,
    action: "record_latest_agent_note",
    ticket: compactTicket(ticket),
    note: input.note,
  };
}

export async function moveTicketStatus(input: MoveStatusInput) {
  const ticket = await findSingleTicket(input.ticket);

  const guard = statusMoveGuard(ticket.status, input.currentStatus);

  if (!guard.ok) {
    return {
      ok: false,
      reason: "current_state_guard_failed",
      message: `${ticket.code} is currently ${ticket.status}, not ${input.currentStatus}.`,
      ticket: compactTicket(ticket),
    };
  }

  await getNotionClient().pages.update({
    page_id: ticket.pageId,
    properties: {
      Status: {
        status: {
          name: input.newStatus,
        },
      },
    },
  });

  return {
    ok: true,
    action: "move_status",
    ticket: { ...compactTicket(ticket), status: input.newStatus },
    previousStatus: input.currentStatus,
    newStatus: input.newStatus,
  };
}

export function statusMoveGuard(actualStatus: string, expectedStatus: string) {
  return {
    ok: actualStatus === expectedStatus,
    actualStatus,
    expectedStatus,
  };
}

export async function resetHarborBeanTickets() {
  const notion = getNotionClient();

  for (const ticket of DEMO_TICKETS) {
    await notion.pages.update({
      page_id: ticket.pageId,
      properties: {
        Name: { title: [{ text: { content: ticket.name } }] },
        Project: { rich_text: [{ text: { content: HARBOR_BEAN_PROJECT } }] },
        Assignee: { rich_text: [{ text: { content: ticket.assignee } }] },
        "Due Date": { date: { start: ticket.dueDate } },
        Priority: { select: { name: ticket.priority } },
        Status: { status: { name: ticket.status } },
      },
    });

    const blocks = await listRootBlocks(ticket.pageId);
    for (const block of blocks) {
      await notion.blocks.delete({ block_id: block.id });
    }

    await notion.blocks.children.append({
      block_id: ticket.pageId,
      children: ticket.body.flatMap((section) => [
        heading2Block(section.title),
        ...section.lines.map((line) => paragraphBlock(line)),
      ]) as never,
    });
  }
}

export function normalizeTicket(page: Record<string, unknown>, blocks: NotionBlock[] = []): SprintTicket {
  const properties = (page.properties ?? {}) as Record<string, unknown>;
  const name = titleProperty(properties.Name);
  const dueDate = dateProperty(properties["Due Date"]);
  const sections = extractBodySections(blocks);

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

export async function listRootBlocks(blockId: string) {
  const blocks: NotionBlock[] = [];
  let startCursor: string | undefined;

  do {
    const response = await getNotionClient().blocks.children.list({
      block_id: blockId,
      start_cursor: startCursor,
      page_size: 100,
    });

    blocks.push(...(response.results as NotionBlock[]));
    startCursor = response.next_cursor ?? undefined;
  } while (startCursor);

  return blocks;
}

export function extractBodySections(blocks: NotionBlock[]): NotionBodySection[] {
  const sections: NotionBodySection[] = [];
  let current: NotionBodySection | undefined;

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

export function buildLatestAgentNoteRewrite(blocks: NotionBlock[], note: string) {
  const sections = extractBodySections(blocks);
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

function findUniqueSection(sections: NotionBodySection[], title: string) {
  const matches = sections.filter((section) => normalizeSectionTitle(section.title) === normalizeSectionTitle(title));

  if (matches.length > 1) {
    return { state: "ambiguous" as const };
  }

  return { state: "ok" as const, section: matches[0] };
}

async function findSingleTicket(ticket: string) {
  const result = await queryNotionTickets({ project: HARBOR_BEAN_PROJECT, ticket, includeBody: true });

  if (result.tickets.length !== 1) {
    throw new Error(`Expected one Notion ticket for "${ticket}", found ${result.tickets.length}.`);
  }

  return result.tickets[0];
}

function compactTicket(ticket: SprintTicket) {
  return {
    pageId: ticket.pageId,
    code: ticket.code,
    name: ticket.name,
    status: ticket.status,
    assignee: ticket.assignee,
    dueDate: ticket.dueDate,
    priority: ticket.priority,
    overdue: ticket.overdue,
    url: ticket.url,
  };
}

function ticketCodeFromName(name: string) {
  return name.match(/\b[A-Z]{2}-\d{3}\b/)?.[0] ?? "";
}

function titleProperty(property: unknown) {
  const value = property as { title?: Array<{ plain_text?: string; text?: { content?: string } }> };
  return richTextToPlain(value?.title ?? []);
}

function richTextProperty(property: unknown) {
  const value = property as { rich_text?: Array<{ plain_text?: string; text?: { content?: string } }> };
  return richTextToPlain(value?.rich_text ?? []);
}

function statusProperty(property: unknown) {
  const value = property as { status?: { name?: string } };
  return value?.status?.name ?? "";
}

function selectProperty(property: unknown) {
  const value = property as { select?: { name?: string } };
  return value?.select?.name ?? "";
}

function dateProperty(property: unknown) {
  const value = property as { date?: { start?: string } | null };
  return value?.date?.start?.slice(0, 10) ?? null;
}

function blockToMarkdown(block: NotionBlock) {
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

function richTextFromBlock(block: NotionBlock) {
  const type = block.type;
  if (!type) return "";

  const body = block[type] as { rich_text?: Array<RichTextLike> } | undefined;
  return richTextToPlain(body?.rich_text ?? []);
}

type RichTextLike = {
  plain_text?: string;
  href?: string | null;
  text?: {
    content?: string;
    link?: { url?: string } | null;
  };
};

function richTextToPlain(items: RichTextLike[]) {
  return items
    .map((item) => {
      const content = item.plain_text ?? item.text?.content ?? "";
      const href = item.href ?? item.text?.link?.url;
      return href ? `${content} (${href})` : content;
    })
    .join("");
}

function normalizeSectionTitle(title: string) {
  return title.trim().toLowerCase();
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
