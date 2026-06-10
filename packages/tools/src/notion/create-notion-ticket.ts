import type { ToolDefinition } from "../types";
import { getNotionClient, getNotionDatabaseId, HARBOR_BEAN_PROJECT } from "./notion-api";

type BodySection = {
  title: string;
  lines: string[];
};

type CreateTicketInput = {
  name: string;
  project?: string;
  status?: string;
  assignee?: string;
  priority?: string;
  dueDate?: string;
  body?: BodySection[];
};

export const createNotionTicket: ToolDefinition = {
  name: "createNotionTicket",
  mode: "write",
  owners: ["edrick"],
  allowedAgents: ["updater"],
  description:
    "Create a new ticket on the Notion sprint board with standard fields and optional body sections.",
  promptPath: "packages/tools/src/notion/create-notion-ticket.prompt.md",
  async run(input) {
    const {
      name,
      project = HARBOR_BEAN_PROJECT,
      status = "Not started",
      assignee,
      priority = "P1",
      dueDate,
      body,
    } = input as CreateTicketInput;

    if (!name) {
      return {
        ok: false,
        tool: "createNotionTicket",
        summary: "Missing required field: name",
      };
    }

    try {
      const notion = getNotionClient();
      const databaseId = getNotionDatabaseId();

      const properties: Record<string, unknown> = {
        Name: { title: [{ type: "text", text: { content: name } }] },
        Project: { rich_text: [{ type: "text", text: { content: project } }] },
        Status: { status: { name: status } },
        Priority: { select: { name: priority } },
      };

      if (assignee) {
        properties.Assignee = { rich_text: [{ type: "text", text: { content: assignee } }] };
      }

      if (dueDate) {
        properties["Due Date"] = { date: { start: dueDate } };
      }

      const children = body
        ? body.flatMap((section) => [
            {
              object: "block" as const,
              type: "heading_2" as const,
              heading_2: {
                rich_text: [{ type: "text" as const, text: { content: section.title } }],
              },
            },
            ...section.lines.map((line) => ({
              object: "block" as const,
              type: "paragraph" as const,
              paragraph: {
                rich_text: [{ type: "text" as const, text: { content: line.slice(0, 1900) } }],
              },
            })),
          ])
        : undefined;

      const page = await notion.pages.create({
        parent: { database_id: databaseId },
        properties: properties as never,
        ...(children ? { children: children as never } : {}),
      });

      const pageId = (page as { id: string }).id;
      const url = (page as { url?: string }).url;

      return {
        ok: true,
        tool: "createNotionTicket",
        summary: `Created ticket "${name}" in ${project}`,
        data: { pageId, url, name, project, status, assignee, priority, dueDate },
      };
    } catch (error) {
      return {
        ok: false,
        tool: "createNotionTicket",
        summary: `Failed to create ticket: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
};
