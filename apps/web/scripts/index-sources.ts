import { S3Client, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Client as NotionClient } from "@notionhq/client";
import { connectMongo, disconnectMongo } from "../lib/mongodb";
import { KnowledgeNodeModel } from "../lib/models";

type TagNode = {
  nodeId: string;
  label: string;
  type: "tag";
  source: "s3" | "notion" | "both";
  summary: string;
  links: string[];
  metadata: {
    documents: Array<{
      path: string;
      source: "s3" | "notion";
      title?: string;
    }>;
    weight: number;
  };
};

function tagToNodeId(tag: string): string {
  return `tag-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

async function extractS3Tags(): Promise<Map<string, { tags: string[]; path: string }>> {
  const bucket = process.env.KB_S3_BUCKET;
  const region = process.env.AWS_REGION_NAME || process.env.AWS_DEFAULT_REGION;
  if (!bucket) {
    console.log("  ⏭ KB_S3_BUCKET not set, skipping S3");
    return new Map();
  }

  const s3 = new S3Client({ region: region || "us-east-1" });
  const docTags = new Map<string, { tags: string[]; path: string }>();

  try {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 100 }));
    const objects = res.Contents ?? [];
    console.log(`  Found ${objects.length} S3 objects in ${bucket}`);

    for (const obj of objects) {
      if (!obj.Key) continue;

      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: obj.Key }));
        const userMeta = head.Metadata ?? {};

        // Tags can come from x-amz-meta-tags (comma-separated) or x-amz-meta-labels
        const rawTags = userMeta["tags"] || userMeta["labels"] || "";
        if (!rawTags) continue;

        const tags = rawTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);

        if (tags.length > 0) {
          docTags.set(obj.Key, { tags, path: obj.Key });
        }
      } catch {
        // Can't read metadata for this object
      }
    }
  } catch (e: any) {
    console.log(`  ⚠ S3 indexing failed: ${e.message}`);
  }

  return docTags;
}

async function extractNotionTags(): Promise<Map<string, { tags: string[]; path: string; title?: string }>> {
  const token = process.env.NOTION_API_KEY;
  if (!token) {
    console.log("  ⏭ NOTION_API_KEY not set, skipping Notion");
    return new Map();
  }

  const notion = new NotionClient({ auth: token });
  const docTags = new Map<string, { tags: string[]; path: string; title?: string }>();

  try {
    const searchRes = await notion.search({ page_size: 50 });
    console.log(`  Found ${searchRes.results.length} Notion pages/databases`);

    for (const item of searchRes.results) {
      if (item.object !== "page" || !("properties" in item)) continue;

      let title = "Untitled";
      const tags: string[] = [];

      for (const [, prop] of Object.entries((item as any).properties)) {
        const p = prop as any;
        if (p.type === "title") {
          title = p.title?.map((t: any) => t.plain_text).join("") || "Untitled";
        }
        // Extract from multi_select and select properties (Notion's tagging system)
        if (p.type === "multi_select") {
          for (const option of p.multi_select ?? []) {
            if (option.name) tags.push(option.name);
          }
        }
        if (p.type === "select" && p.select?.name) {
          tags.push(p.select.name);
        }
      }

      if (tags.length > 0) {
        docTags.set(item.id, { tags, path: (item as any).url || item.id, title });
      }
    }
  } catch (e: any) {
    console.log(`  ⚠ Notion indexing failed: ${e.message}`);
  }

  return docTags;
}

const EXCLUDED_TAG_PATTERNS = [
  /\bslack\b/i,
  /\bexa\b/i,
  /\bgithub\b/i,
  /\bstripe\b/i,
  /\bwebhook\b/i,
];

function isExcludedTag(tag: string): boolean {
  return EXCLUDED_TAG_PATTERNS.some((pattern) => pattern.test(tag));
}

function buildTagGraph(
  s3Docs: Map<string, { tags: string[]; path: string }>,
  notionDocs: Map<string, { tags: string[]; path: string; title?: string }>,
): TagNode[] {
  const tagMap = new Map<string, TagNode>();

  function ensureTag(tag: string, source: "s3" | "notion"): TagNode {
    const nodeId = tagToNodeId(tag);
    let existing = tagMap.get(nodeId);
    if (!existing) {
      existing = {
        nodeId,
        label: tag,
        type: "tag",
        source,
        summary: `Tag: ${tag}`,
        links: [],
        metadata: { documents: [], weight: 0 },
      };
      tagMap.set(nodeId, existing);
    } else if (existing.source !== source) {
      existing.source = "both";
    }
    return existing;
  }

  // Process S3 documents (exclude tags referencing external services)
  for (const [, doc] of s3Docs) {
    const tags = doc.tags.filter((t) => !isExcludedTag(t));
    for (const tag of tags) {
      const node = ensureTag(tag, "s3");
      node.metadata.documents.push({ path: doc.path, source: "s3" });
      node.metadata.weight++;
    }
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const a = tagToNodeId(tags[i]);
        const b = tagToNodeId(tags[j]);
        const nodeA = tagMap.get(a)!;
        const nodeB = tagMap.get(b)!;
        if (!nodeA.links.includes(b)) nodeA.links.push(b);
        if (!nodeB.links.includes(a)) nodeB.links.push(a);
      }
    }
  }

  // Process Notion documents (exclude tags referencing external services)
  for (const [, doc] of notionDocs) {
    const tags = doc.tags.filter((t) => !isExcludedTag(t));
    for (const tag of tags) {
      const node = ensureTag(tag, "notion");
      node.metadata.documents.push({ path: doc.path, source: "notion", title: doc.title });
      node.metadata.weight++;
    }
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const a = tagToNodeId(tags[i]);
        const b = tagToNodeId(tags[j]);
        const nodeA = tagMap.get(a)!;
        const nodeB = tagMap.get(b)!;
        if (!nodeA.links.includes(b)) nodeA.links.push(b);
        if (!nodeB.links.includes(a)) nodeB.links.push(a);
      }
    }
  }

  return Array.from(tagMap.values());
}

function layoutForceDirected(nodes: TagNode[]): void {
  if (nodes.length === 0) return;

  // Initialize positions randomly in a circle
  const positions = nodes.map((_, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    const radius = 30 + Math.random() * 10;
    return { x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) };
  });

  const nodeIndex = new Map(nodes.map((n, i) => [n.nodeId, i]));

  // Simple force-directed simulation
  for (let iter = 0; iter < 200; iter++) {
    const forces = positions.map(() => ({ fx: 0, fy: 0 }));

    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = 80 / (dist * dist);
        forces[i].fx += (dx / dist) * force;
        forces[i].fy += (dy / dist) * force;
        forces[j].fx -= (dx / dist) * force;
        forces[j].fy -= (dy / dist) * force;
      }
    }

    // Attraction along edges
    for (const node of nodes) {
      const i = nodeIndex.get(node.nodeId)!;
      for (const linkId of node.links) {
        const j = nodeIndex.get(linkId);
        if (j === undefined) continue;
        const dx = positions[j].x - positions[i].x;
        const dy = positions[j].y - positions[i].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = dist * 0.01;
        forces[i].fx += dx * force;
        forces[i].fy += dy * force;
      }
    }

    // Center gravity
    for (let i = 0; i < nodes.length; i++) {
      forces[i].fx += (50 - positions[i].x) * 0.005;
      forces[i].fy += (50 - positions[i].y) * 0.005;
    }

    // Apply forces with cooling
    const cooling = 1 - iter / 200;
    for (let i = 0; i < nodes.length; i++) {
      positions[i].x += forces[i].fx * cooling * 0.5;
      positions[i].y += forces[i].fy * cooling * 0.5;
      positions[i].x = Math.max(5, Math.min(95, positions[i].x));
      positions[i].y = Math.max(5, Math.min(95, positions[i].y));
    }
  }

  // Apply positions
  for (let i = 0; i < nodes.length; i++) {
    (nodes[i] as any).x = Math.round(positions[i].x * 100) / 100;
    (nodes[i] as any).y = Math.round(positions[i].y * 100) / 100;
  }
}

async function main() {
  await connectMongo();
  console.log("Connected to MongoDB\n");

  await KnowledgeNodeModel.deleteMany({});
  console.log("Cleared old knowledge nodes.\n");

  console.log("Extracting S3 tags...");
  const s3Docs = await extractS3Tags();
  console.log(`  → ${s3Docs.size} documents with tags\n`);

  console.log("Extracting Notion tags...");
  const notionDocs = await extractNotionTags();
  console.log(`  → ${notionDocs.size} documents with tags\n`);

  console.log("Building tag graph...");
  const tagNodes = buildTagGraph(s3Docs, notionDocs);
  console.log(`  → ${tagNodes.length} unique tags, ${tagNodes.reduce((sum, n) => sum + n.links.length, 0) / 2} edges\n`);

  console.log("Computing layout...");
  layoutForceDirected(tagNodes);

  for (const node of tagNodes) {
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

  console.log(`Done! Indexed ${tagNodes.length} tag nodes.`);
  await disconnectMongo();
}

main().catch(async (e) => {
  console.error("Fatal error:", e);
  await disconnectMongo();
  process.exit(1);
});
