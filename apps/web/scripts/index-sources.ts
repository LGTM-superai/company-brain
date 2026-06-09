import { WebClient } from "@slack/web-api";
import Exa from "exa-js";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Client as NotionClient } from "@notionhq/client";
import { Octokit } from "@octokit/rest";
import { connectMongo, disconnectMongo } from "../lib/mongodb";
import { KnowledgeNodeModel } from "../lib/models";

type NodeInput = {
  nodeId: string;
  label: string;
  type: string;
  source: string;
  summary: string;
  links: string[];
  metadata?: Record<string, unknown>;
  sourceId?: string;
};

const HUB_IDS = ["company-brain", "slack", "github", "exa", "sprint-board", "notion-kb", "s3-store"];

function assignRingPositions(nodes: NodeInput[], radius: number, startAngle = -Math.PI / 2) {
  if (nodes.length === 0) return;
  const step = (2 * Math.PI) / nodes.length;
  nodes.forEach((n, i) => {
    const angle = startAngle + i * step;
    (n as any).x = Math.round((50 + radius * Math.cos(angle)) * 100) / 100;
    (n as any).y = Math.round((50 + radius * Math.sin(angle)) * 100) / 100;
  });
}

async function indexSlack(): Promise<NodeInput[]> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.log("  ⏭ SLACK_BOT_TOKEN not set, skipping Slack");
    return [];
  }

  const client = new WebClient(token);
  const nodes: NodeInput[] = [];

  const channelsRes = await client.conversations.list({
    types: "public_channel",
    limit: 10,
    exclude_archived: true,
  });

  const channels = channelsRes.channels ?? [];
  console.log(`  Found ${channels.length} Slack channels`);

  for (const ch of channels.slice(0, 8)) {
    const channelNodeId = `slack-ch-${ch.id}`;
    nodes.push({
      nodeId: channelNodeId,
      label: `#${ch.name}`,
      type: "channel",
      source: "slack",
      summary: ch.purpose?.value || ch.topic?.value || `Slack channel #${ch.name}`,
      links: ["slack"],
      sourceId: ch.id,
      metadata: { name: ch.name, memberCount: ch.num_members },
    });

    try {
      const historyRes = await client.conversations.history({
        channel: ch.id!,
        limit: 3,
      });

      for (const msg of (historyRes.messages ?? []).filter((m) => (m.text?.length ?? 0) > 20)) {
        const msgNodeId = `slack-msg-${ch.id}-${msg.ts}`;
        const text = msg.text ?? "";
        nodes.push({
          nodeId: msgNodeId,
          label: text.slice(0, 40) + (text.length > 40 ? "…" : ""),
          type: "message",
          source: "slack",
          summary: text.slice(0, 120),
          links: [channelNodeId],
          sourceId: msg.ts,
          metadata: { channel: ch.name, user: msg.user, ts: msg.ts },
        });
      }
    } catch {
      // May not have access to channel history
    }
  }

  return nodes;
}

async function indexGithub(): Promise<NodeInput[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log("  ⏭ GITHUB_TOKEN not set, skipping GitHub");
    return [];
  }

  const octokit = new Octokit({ auth: token });
  const nodes: NodeInput[] = [];

  const { data: repos } = await octokit.repos.listForAuthenticatedUser({
    sort: "updated",
    per_page: 5,
  });

  console.log(`  Found ${repos.length} GitHub repos`);

  for (const repo of repos.slice(0, 5)) {
    const repoNodeId = `gh-repo-${repo.name}`;
    nodes.push({
      nodeId: repoNodeId,
      label: repo.name,
      type: "repository",
      source: "github",
      summary: repo.description || `GitHub repository: ${repo.full_name}`,
      links: ["github"],
      sourceId: String(repo.id),
      metadata: { url: repo.html_url, language: repo.language, stars: repo.stargazers_count },
    });

    try {
      const { data: issues } = await octokit.issues.listForRepo({
        owner: repo.owner.login,
        repo: repo.name,
        state: "open",
        per_page: 3,
      });

      for (const issue of issues) {
        const issueNodeId = `gh-issue-${repo.name}-${issue.number}`;
        nodes.push({
          nodeId: issueNodeId,
          label: `#${issue.number} ${issue.title.slice(0, 30)}`,
          type: issue.pull_request ? "pull-request" : "issue",
          source: "github",
          summary: (issue.body ?? issue.title).slice(0, 120),
          links: [repoNodeId],
          sourceId: String(issue.id),
          metadata: { url: issue.html_url, state: issue.state, author: issue.user?.login },
        });
      }
    } catch {
      // May not have issue access
    }
  }

  return nodes;
}

async function indexExa(): Promise<NodeInput[]> {
  const key = process.env.EXA_API_KEY;
  if (!key) {
    console.log("  ⏭ EXA_API_KEY not set, skipping Exa");
    return [];
  }

  const exa = new Exa(key);
  const nodes: NodeInput[] = [];

  const queries = [
    "LGTM landing page studio",
    "cafe landing page design best practices",
    "high-converting landing pages for restaurants",
  ];

  for (const query of queries) {
    try {
      const results = await exa.search(query, {
        numResults: 3,
        type: "neural",
      });

      console.log(`  Exa "${query.slice(0, 30)}…" → ${results.results.length} results`);

      for (const result of results.results) {
        const nodeId = `exa-${result.id || Buffer.from(result.url).toString("base64").slice(0, 12)}`;
        nodes.push({
          nodeId,
          label: (result.title ?? result.url).slice(0, 40),
          type: "web-result",
          source: "exa",
          summary: (result.text ?? result.title ?? result.url).slice(0, 120),
          links: ["exa"],
          sourceId: result.id,
          metadata: { url: result.url, title: result.title, publishedDate: result.publishedDate },
        });
      }
    } catch (e: any) {
      console.log(`  ⚠ Exa query "${query.slice(0, 20)}…" failed: ${e.message}`);
    }
  }

  return nodes;
}

async function indexNotion(): Promise<NodeInput[]> {
  const token = process.env.NOTION_API_KEY;
  if (!token) {
    console.log("  ⏭ NOTION_API_KEY not set, skipping Notion");
    return [];
  }

  const notion = new NotionClient({ auth: token });
  const nodes: NodeInput[] = [];

  try {
    const searchRes = await notion.search({ page_size: 12 });
    console.log(`  Found ${searchRes.results.length} Notion pages/databases`);

    for (const item of searchRes.results) {
      const objType = item.object as string;
      const isPage = objType === "page";
      const isDb = objType === "database";
      if (!isPage && !isDb) continue;

      let title = "Untitled";
      if (isDb && "title" in item) {
        title = (item as any).title?.map((t: any) => t.plain_text).join("") || "Untitled DB";
      } else if (isPage && "properties" in item) {
        const titleProp = Object.values((item as any).properties).find(
          (p: any) => p.type === "title",
        ) as any;
        title = titleProp?.title?.map((t: any) => t.plain_text).join("") || "Untitled Page";
      }

      const nodeId = `notion-${item.id.replace(/-/g, "").slice(0, 12)}`;
      nodes.push({
        nodeId,
        label: title.slice(0, 40),
        type: isDb ? "database" : "page",
        source: "notion",
        summary: `Notion ${isDb ? "database" : "page"}: ${title}`,
        links: ["notion-kb"],
        sourceId: item.id,
        metadata: { url: (item as any).url, type: objType },
      });
    }
  } catch (e: any) {
    console.log(`  ⚠ Notion indexing failed: ${e.message}`);
  }

  return nodes;
}

async function indexS3(): Promise<NodeInput[]> {
  const bucket = process.env.KB_S3_BUCKET;
  const region = process.env.AWS_REGION_NAME || process.env.AWS_DEFAULT_REGION;
  if (!bucket) {
    console.log("  ⏭ KB_S3_BUCKET not set, skipping S3");
    return [];
  }

  const s3 = new S3Client({ region: region || "us-east-1" });
  const nodes: NodeInput[] = [];

  // Ensure an S3 hub node exists
  nodes.push({
    nodeId: "s3-store",
    label: "S3 Storage",
    type: "storage-source",
    source: "s3",
    summary: `AWS S3 bucket: ${bucket}`,
    links: ["company-brain"],
  });

  try {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 20 }));
    const objects = res.Contents ?? [];
    console.log(`  Found ${objects.length} S3 objects in ${bucket}`);

    for (const obj of objects) {
      if (!obj.Key) continue;
      const fileName = obj.Key.split("/").pop() || obj.Key;
      const nodeId = `s3-${Buffer.from(obj.Key).toString("base64").slice(0, 16)}`;
      nodes.push({
        nodeId,
        label: fileName.slice(0, 40),
        type: "document",
        source: "s3",
        summary: `S3 object: ${obj.Key} (${formatBytes(obj.Size ?? 0)})`,
        links: ["s3-store"],
        sourceId: obj.Key,
        metadata: { key: obj.Key, size: obj.Size, lastModified: obj.LastModified?.toISOString() },
      });
    }
  } catch (e: any) {
    console.log(`  ⚠ S3 indexing failed: ${e.message}`);
  }

  return nodes;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  await connectMongo();
  console.log("Connected to MongoDB\n");

  // Clear all existing knowledge nodes — we rebuild from real sources only
  await KnowledgeNodeModel.deleteMany({});
  console.log("Cleared old knowledge nodes.\n");

  console.log("Indexing Slack...");
  const slackNodes = await indexSlack();
  console.log(`  → ${slackNodes.length} nodes\n`);

  console.log("Indexing GitHub...");
  const githubNodes = await indexGithub();
  console.log(`  → ${githubNodes.length} nodes\n`);

  console.log("Indexing Exa...");
  const exaNodes = await indexExa();
  console.log(`  → ${exaNodes.length} nodes\n`);

  console.log("Indexing Notion...");
  const notionNodes = await indexNotion();
  console.log(`  → ${notionNodes.length} nodes\n`);

  console.log("Indexing S3...");
  const s3Nodes = await indexS3();
  console.log(`  → ${s3Nodes.length} nodes\n`);

  // Build hub nodes for each active source
  const hubs: NodeInput[] = [];
  hubs.push({
    nodeId: "company-brain",
    label: "Company Brain",
    type: "agent-router",
    source: "internal",
    summary: "Central hub routing to all indexed knowledge sources.",
    links: [],
  });

  if (slackNodes.length > 0) {
    hubs.push({
      nodeId: "hub-slack",
      label: "Slack",
      type: "source-hub",
      source: "slack",
      summary: `${slackNodes.filter((n) => n.type === "channel").length} channels indexed from Slack workspace.`,
      links: ["company-brain"],
    });
    slackNodes.forEach((n) => {
      if (n.type === "channel") n.links = [...n.links.filter((l) => l !== "slack"), "hub-slack"];
    });
    hubs[0].links.push("hub-slack");
  }

  if (githubNodes.length > 0) {
    hubs.push({
      nodeId: "hub-github",
      label: "GitHub",
      type: "source-hub",
      source: "github",
      summary: `${githubNodes.filter((n) => n.type === "repository").length} repositories indexed from GitHub.`,
      links: ["company-brain"],
    });
    githubNodes.forEach((n) => {
      if (n.type === "repository") n.links = [...n.links.filter((l) => l !== "github"), "hub-github"];
    });
    hubs[0].links.push("hub-github");
  }

  if (exaNodes.length > 0) {
    hubs.push({
      nodeId: "hub-exa",
      label: "Exa",
      type: "source-hub",
      source: "exa",
      summary: `${exaNodes.length} web results from Exa search.`,
      links: ["company-brain"],
    });
    exaNodes.forEach((n) => {
      n.links = [...n.links.filter((l) => l !== "exa"), "hub-exa"];
    });
    hubs[0].links.push("hub-exa");
  }

  if (notionNodes.length > 0) {
    hubs.push({
      nodeId: "hub-notion",
      label: "Notion",
      type: "source-hub",
      source: "notion",
      summary: `${notionNodes.length} pages/databases indexed from Notion.`,
      links: ["company-brain"],
    });
    notionNodes.forEach((n) => {
      n.links = [...n.links.filter((l) => l !== "notion-kb"), "hub-notion"];
    });
    hubs[0].links.push("hub-notion");
  }

  // Remove the standalone s3-store node from s3Nodes since we create it as a hub
  const s3DataNodes = s3Nodes.filter((n) => n.nodeId !== "s3-store");
  if (s3DataNodes.length > 0) {
    hubs.push({
      nodeId: "hub-s3",
      label: "S3 Storage",
      type: "source-hub",
      source: "s3",
      summary: `${s3DataNodes.length} objects indexed from S3.`,
      links: ["company-brain"],
    });
    s3DataNodes.forEach((n) => {
      n.links = [...n.links.filter((l) => l !== "s3-store"), "hub-s3"];
    });
    hubs[0].links.push("hub-s3");
  }

  // Assign positions
  // Ring 0: company-brain center
  (hubs[0] as any).x = 50;
  (hubs[0] as any).y = 50;

  // Ring 1: source hubs
  const sourceHubs = hubs.slice(1);
  assignRingPositions(sourceHubs, 18);

  // Ring 2: mid-level (channels, repos, databases)
  const ring2 = [
    ...slackNodes.filter((n) => n.type === "channel"),
    ...githubNodes.filter((n) => n.type === "repository"),
    ...notionNodes.filter((n) => n.type === "database"),
  ];
  assignRingPositions(ring2, 33);

  // Ring 3: leaf nodes (messages, issues, results, pages, documents)
  const ring3 = [
    ...slackNodes.filter((n) => n.type === "message"),
    ...githubNodes.filter((n) => n.type !== "repository"),
    ...exaNodes,
    ...notionNodes.filter((n) => n.type === "page"),
    ...s3DataNodes,
  ];
  assignRingPositions(ring3, 46);

  const allNodes = [...hubs, ...slackNodes, ...githubNodes, ...exaNodes, ...notionNodes, ...s3DataNodes];

  // Insert all nodes
  for (const node of allNodes) {
    await KnowledgeNodeModel.updateOne(
      { nodeId: node.nodeId },
      {
        $set: {
          ...node,
          x: (node as any).x ?? 50,
          y: (node as any).y ?? 50,
          indexedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  console.log(`Done! Indexed ${allNodes.length} knowledge nodes from real sources.`);
  await disconnectMongo();
}

main().catch(async (e) => {
  console.error("Fatal error:", e);
  await disconnectMongo();
  process.exit(1);
});
