import { existsSync } from "node:fs";
import { resolve } from "node:path";

const notionToken = process.env.NOTION_TOKEN;
const authToken = process.env.NOTION_MCP_AUTH_TOKEN;
const host = process.env.NOTION_MCP_HOST ?? "127.0.0.1";
const port = process.env.NOTION_MCP_PORT ?? "3333";

if (!notionToken) {
  console.error("NOTION_TOKEN is not set.");
  process.exit(1);
}

if (!authToken) {
  console.error("NOTION_MCP_AUTH_TOKEN is not set.");
  process.exit(1);
}

const executable = findNotionMcpExecutable();

if (!executable) {
  console.error("Could not find @notionhq/notion-mcp-server. Run bun i first.");
  process.exit(1);
}

console.log(`Starting Notion MCP at http://${host}:${port}/mcp`);

const child = Bun.spawn(
  [
    executable.command,
    ...executable.prefixArgs,
    "--transport",
    "http",
    "--host",
    host,
    "--port",
    port,
  ],
  {
    env: {
      ...process.env,
      AUTH_TOKEN: authToken,
      NOTION_TOKEN: notionToken,
    },
    stdout: "inherit",
    stderr: "inherit",
  },
);

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));

const exitCode = await child.exited;
process.exit(exitCode ?? 0);

function findNotionMcpExecutable() {
  const cli = resolve(process.cwd(), "node_modules", "@notionhq", "notion-mcp-server", "bin", "cli.mjs");

  if (existsSync(cli)) {
    return { command: process.execPath, prefixArgs: [cli] };
  }

  const candidates =
    process.platform === "win32"
      ? ["notion-mcp-server.exe", "notion-mcp-server.cmd", "notion-mcp-server.bunx"]
      : ["notion-mcp-server"];

  for (const candidate of candidates) {
    const binary = resolve(process.cwd(), "node_modules", ".bin", candidate);

    if (existsSync(binary)) {
      return { command: binary, prefixArgs: [] as string[] };
    }
  }

  return null;
}
