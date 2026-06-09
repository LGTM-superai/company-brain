import { Sandbox } from "@vercel/sandbox";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));

const SANDBOX_TIMEOUT_MS = 12 * 60 * 1000; // 12 minutes

export interface AgentFixResult {
  success: boolean;
  diff: string;
  summary: string;
  branch: string;
  sandboxId?: string;
  error?: string;
}

export async function runAgentFix(opts: {
  owner: string;
  repo: string;
  repoUrl: string;
  installToken: string;
  defaultBranch: string;
  pkg: string;
  currentVersion: string;
  patchedVersion: string;
  cveId: string;
  advisoryUrl: string;
}): Promise<AgentFixResult> {
  const branch = `fix/cve-${opts.cveId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-${Date.now()}`;

  let sandbox: Sandbox | undefined;
  try {
    // Create sandbox with git source — clones into /vercel/sandbox automatically
    sandbox = await Sandbox.create({
      runtime: "node24",
      timeout: SANDBOX_TIMEOUT_MS,
      persistent: false, // ephemeral — don't pay for snapshot storage
      source: {
        type: "git",
        url: `https://github.com/${opts.owner}/${opts.repo}.git`,
        username: "x-access-token",
        password: opts.installToken,
        depth: 1,
        revision: opts.defaultBranch,
      },
      env: {
        // Bedrock credentials — forwarded from Lambda env (IAM role on prod, static key on local dev)
        CLAUDE_CODE_USE_BEDROCK: "1",
        AWS_REGION: process.env.AWS_REGION ?? "us-west-2",
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID!,
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY!,
        // Session token present only on Lambda (temporary role creds); absent for local IAM user
        ...(process.env.AWS_SESSION_TOKEN
          ? { AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN }
          : {}),
        ANTHROPIC_DEFAULT_SONNET_MODEL: "us.anthropic.claude-sonnet-4-6",
        // Task params for the agent-runner
        TASK_PKG: opts.pkg,
        TASK_CURRENT: opts.currentVersion,
        TASK_PATCHED: opts.patchedVersion,
        TASK_CVE_ID: opts.cveId,
        TASK_ADVISORY_URL: opts.advisoryUrl,
        TASK_CWD: "/vercel/sandbox",
      },
    });

    // 1. Immediately scrub the install token from .git/config so the agent cannot read it
    const scrub = await sandbox.runCommand("git", [
      "remote",
      "set-url",
      "origin",
      `https://github.com/${opts.owner}/${opts.repo}.git`,
    ]);
    if (scrub.exitCode !== 0) {
      throw new Error(`git remote scrub failed: ${await scrub.stderr()}`);
    }

    // 2. Install the Claude Agent SDK in the sandbox
    const install = await sandbox.runCommand("npm", [
      "install",
      "-g",
      "@anthropic-ai/claude-agent-sdk",
    ]);
    if (install.exitCode !== 0) {
      throw new Error(
        `claude-agent-sdk install failed: ${await install.stderr()}`
      );
    }

    // 3. Upload the agent runner script
    const runnerSource = readFileSync(
      join(__dirname, "agent-runner.mjs")
    );
    await sandbox.writeFiles([
      {
        path: "/tmp/agent-runner.mjs",
        content: runnerSource,
      },
    ]);

    // 4. Run the agent
    const agentRun = await sandbox.runCommand("node", [
      "/tmp/agent-runner.mjs",
    ]);

    if (agentRun.exitCode !== 0) {
      const errOut = await agentRun.stderr();
      throw new Error(`Agent exited ${agentRun.exitCode}: ${errOut}`);
    }

    const agentStdout = await agentRun.stdout();
    let summary = "";
    try {
      const parsed = JSON.parse(agentStdout.trim().split("\n").pop() ?? "{}");
      summary = parsed.summary ?? "";
    } catch {
      summary = agentStdout.slice(0, 500);
    }

    // 5. Check if there are actual changes
    const statusCheck = await sandbox.runCommand("git", [
      "status",
      "--porcelain",
    ]);
    const changedFiles = (await statusCheck.stdout()).trim();
    if (!changedFiles) {
      return {
        success: false,
        diff: "",
        summary: "Agent made no changes",
        branch,
        sandboxId: (sandbox as any).id,
        error: "empty_diff",
      };
    }

    // 6. Capture diff before committing
    const diffCmd = await sandbox.runCommand("git", ["diff"]);
    const diff = await diffCmd.stdout();

    // 7. Commit on a new branch (re-attach token only for push, never logged)
    const gitSteps: [string, string[]][] = [
      ["git", ["config", "user.email", "cve-bot@lgtm.app"]],
      ["git", ["config", "user.name", "LGTM CVE Bot"]],
      ["git", ["checkout", "-b", branch]],
      ["git", ["add", "-A"]],
      [
        "git",
        [
          "commit",
          "-m",
          `fix: upgrade ${opts.pkg} to ${opts.patchedVersion} (${opts.cveId})`,
        ],
      ],
    ];

    for (const [cmd, args] of gitSteps) {
      const r = await sandbox.runCommand(cmd, args);
      if (r.exitCode !== 0) {
        const stderr = await r.stderr();
        throw new Error(`${cmd} ${args.join(" ")} failed: ${stderr}`);
      }
    }

    // Push with token re-attached only on this one command (never stored in config)
    const pushUrl = `https://x-access-token:${opts.installToken}@github.com/${opts.owner}/${opts.repo}.git`;
    const push = await sandbox.runCommand("git", [
      "push",
      pushUrl,
      `${branch}:${branch}`,
    ]);
    if (push.exitCode !== 0) {
      const stderr = await push.stderr();
      throw new Error(`git push failed: ${stderr}`);
    }

    return {
      success: true,
      diff,
      summary,
      branch,
      sandboxId: (sandbox as any).id,
    };
  } finally {
    if (sandbox) {
      try {
        await sandbox.stop();
      } catch {
        // best-effort cleanup
      }
    }
  }
}
