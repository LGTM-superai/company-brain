/**
 * This file is uploaded INTO the Vercel Sandbox and executed by Node.
 * It receives task params via environment variables set by the host Lambda:
 *   TASK_PKG, TASK_CURRENT, TASK_PATCHED, TASK_CVE_ID, TASK_ADVISORY_URL, TASK_CWD
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

const pkg = process.env.TASK_PKG;
const currentVersion = process.env.TASK_CURRENT;
const patchedVersion = process.env.TASK_PATCHED;
const cveId = process.env.TASK_CVE_ID;
const advisoryUrl = process.env.TASK_ADVISORY_URL;
const cwd = process.env.TASK_CWD ?? "/vercel/sandbox";

if (!pkg || !patchedVersion || !cveId) {
  console.error(JSON.stringify({ error: "Missing required env vars" }));
  process.exit(1);
}

const prompt =
  `Upgrade the npm package \`${pkg}\` from \`${currentVersion}\` to \`${patchedVersion}\` ` +
  `to fix security vulnerability ${cveId} (${advisoryUrl}).\n\n` +
  `Steps:\n` +
  `1. Edit \`package.json\` to set \`${pkg}\` to exactly \`${patchedVersion}\` (or a range like \`^${patchedVersion}\`).\n` +
  `2. Run \`npm install\` to update the lockfile.\n` +
  `3. If there are test scripts in package.json, run them. Do not fail if there are no tests.\n` +
  `4. Summarize what you changed.\n\n` +
  `Do not modify any other files unless npm install requires it.`;

const abort = new AbortController();
// 10-minute wall-clock cap inside the sandbox (sandbox itself is capped at 12m by the host)
setTimeout(() => abort.abort(), 10 * 60_000);

let summary = "";

try {
  const run = query({
    prompt,
    options: {
      cwd,
      model: "claude-sonnet-4-6",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
      maxTurns: 30,
      settingSources: [],
      abortController: abort,
    },
  });

  for await (const msg of run) {
    if (msg.type === "result") {
      if (msg.subtype === "success") {
        summary = msg.result ?? "";
      } else {
        console.error(JSON.stringify({ error: `Agent failed: ${msg.subtype}`, details: msg.errors }));
        process.exit(2);
      }
    }
  }
} catch (err) {
  console.error(JSON.stringify({ error: String(err) }));
  process.exit(3);
}

// Output the summary as JSON so the host Lambda can capture it
console.log(JSON.stringify({ success: true, summary }));
