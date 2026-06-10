import { Client } from "@notionhq/client";
import { getEnv } from "./env";

type AccessLevel = "public" | "internal" | "confidential" | "restricted";

const ROLE_ACCESS: Record<string, AccessLevel[]> = {
  admin: ["public", "internal", "confidential", "restricted"],
  "lead developer": ["public", "internal", "confidential"],
  "design lead": ["public", "internal", "confidential"],
  "coder agent owner": ["public", "internal"],
  "pm/ops": ["public", "internal", "confidential"],
  engineer: ["public", "internal"],
  intern: ["public"],
};

const USER_ROLES: Record<string, string> = {
  edrick: "lead developer",
  laksh: "design lead",
  darren: "coder agent owner",
  carlos: "pm/ops",
  admin: "admin",
};

function getUserAccessLevels(username?: string): AccessLevel[] {
  if (!username) return ["public"];
  const role = USER_ROLES[username.toLowerCase()] ?? "engineer";
  return ROLE_ACCESS[role] ?? ["public"];
}

let _notion: Client | null = null;

function getNotion(): Client | null {
  if (_notion) return _notion;
  const token = getEnv("NOTION_TOKEN") ?? getEnv("NOTION_API_KEY");
  if (!token) return null;
  _notion = new Client({ auth: token });
  return _notion;
}

export type NotionKBDocument = {
  id: string;
  title: string;
  url: string;
  domain?: string;
  sensitivity: AccessLevel;
  tags: string[];
  summary?: string;
  source: "notion";
};

export async function searchNotionKB(opts: {
  query?: string;
  domain?: string;
  tags?: string[];
  username?: string;
  limit?: number;
}): Promise<{
  ok: true;
  tool: "queryKnowledgeBase";
  source: "notion";
  summary: string;
  data: { documents: NotionKBDocument[] };
  accessDenied: NotionKBDocument[];
}> {
  const notion = getNotion();
  if (!notion) {
    return {
      ok: true,
      tool: "queryKnowledgeBase",
      source: "notion",
      summary: "Notion not configured (NOTION_TOKEN missing). Skipped.",
      data: { documents: [] },
      accessDenied: [],
    };
  }

  const allowedLevels = getUserAccessLevels(opts.username);
  const limit = opts.limit ?? 10;

  try {
    const searchRes = await notion.search({
      query: opts.query ?? "",
      page_size: Math.min(limit * 2, 50),
      filter: { property: "object", value: "page" },
    });

    const documents: NotionKBDocument[] = [];
    const accessDenied: NotionKBDocument[] = [];

    for (const page of searchRes.results) {
      if (page.object !== "page" || !("properties" in page)) continue;

      const props = (page as any).properties ?? {};
      let title = "Untitled";
      const tags: string[] = [];
      let domain: string | undefined;
      let sensitivity: AccessLevel = "internal";

      for (const [key, prop] of Object.entries(props)) {
        const p = prop as any;
        if (p.type === "title") {
          title = p.title?.map((t: any) => t.plain_text).join("") || "Untitled";
        }
        if (p.type === "multi_select") {
          for (const option of p.multi_select ?? []) {
            if (option.name) tags.push(option.name);
          }
        }
        if (p.type === "select" && p.select?.name) {
          const val = p.select.name.toLowerCase();
          if (key.toLowerCase().includes("domain") || key.toLowerCase().includes("category")) {
            domain = val;
          } else if (key.toLowerCase().includes("sensitivity") || key.toLowerCase().includes("access")) {
            if (["public", "internal", "confidential", "restricted"].includes(val)) {
              sensitivity = val as AccessLevel;
            }
          } else {
            tags.push(p.select.name);
          }
        }
      }

      if (opts.domain && domain && domain !== opts.domain) continue;
      if (opts.tags?.length && !opts.tags.some((t) => tags.includes(t))) continue;

      const doc: NotionKBDocument = {
        id: page.id,
        title,
        url: (page as any).url ?? `https://notion.so/${page.id.replace(/-/g, "")}`,
        domain,
        sensitivity,
        tags,
        source: "notion",
      };

      if (!allowedLevels.includes(sensitivity)) {
        accessDenied.push(doc);
      } else {
        documents.push(doc);
      }

      if (documents.length >= limit) break;
    }

    return {
      ok: true,
      tool: "queryKnowledgeBase",
      source: "notion",
      summary: `Found ${documents.length} Notion page(s)${opts.query ? ` matching "${opts.query}"` : ""}.${accessDenied.length ? ` ${accessDenied.length} denied.` : ""}`,
      data: { documents },
      accessDenied,
    };
  } catch (err) {
    return {
      ok: true,
      tool: "queryKnowledgeBase",
      source: "notion",
      summary: `Notion search failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      data: { documents: [] },
      accessDenied: [],
    };
  }
}

export async function fetchNotionPageContent(pageId: string, username?: string) {
  const notion = getNotion();
  if (!notion) {
    return { ok: false as const, tool: "queryKnowledgeBase", summary: "Notion not configured." };
  }

  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    const props = (page as any).properties ?? {};
    let title = "Untitled";
    let sensitivity: AccessLevel = "internal";

    for (const [key, prop] of Object.entries(props)) {
      const p = prop as any;
      if (p.type === "title") {
        title = p.title?.map((t: any) => t.plain_text).join("") || "Untitled";
      }
      if (p.type === "select" && p.select?.name) {
        const val = p.select.name.toLowerCase();
        if ((key.toLowerCase().includes("sensitivity") || key.toLowerCase().includes("access")) &&
            ["public", "internal", "confidential", "restricted"].includes(val)) {
          sensitivity = val as AccessLevel;
        }
      }
    }

    const allowedLevels = getUserAccessLevels(username);
    if (!allowedLevels.includes(sensitivity)) {
      return {
        ok: false as const,
        tool: "queryKnowledgeBase",
        summary: `Access denied. "${title}" requires ${sensitivity}-level access.`,
      };
    }

    const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
    const content = blocks.results
      .map((block: any) => {
        const type = block.type;
        const data = block[type];
        if (!data?.rich_text) return "";
        return data.rich_text.map((t: any) => t.plain_text).join("");
      })
      .filter(Boolean)
      .join("\n");

    return {
      ok: true as const,
      tool: "queryKnowledgeBase",
      summary: `Retrieved "${title}" from Notion.`,
      data: {
        id: pageId,
        title,
        sensitivity,
        content: content.slice(0, 8000),
        source: "notion" as const,
      },
    };
  } catch (err) {
    return {
      ok: false as const,
      tool: "queryKnowledgeBase",
      summary: `Failed to fetch Notion page: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
