import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { connectMongo } from "./mongodb";
import { KBDocumentModel } from "./models";

let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: process.env.AWS_DEFAULT_REGION ?? process.env.AWS_REGION_NAME ?? "us-west-2",
    });
  }
  return _s3;
}

function getBucket(): string {
  return process.env.KB_S3_BUCKET ?? "company-brain-kb";
}

const ROLE_ACCESS: Record<string, string[]> = {
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

function getAccessLevels(username?: string): string[] {
  if (!username) return ["public"];
  const role = USER_ROLES[username.toLowerCase()] ?? "engineer";
  return ROLE_ACCESS[role] ?? ["public"];
}

export async function searchDocuments(opts: {
  query?: string;
  domain?: string;
  tags?: string[];
  username?: string;
  limit?: number;
}) {
  await connectMongo();

  const allowedLevels = getAccessLevels(opts.username);
  const limit = opts.limit ?? 10;

  const baseFilter: Record<string, unknown> = {
    sensitivity: { $in: allowedLevels },
  };
  if (opts.domain) baseFilter.domain = opts.domain;
  if (opts.tags?.length) baseFilter.tags = { $in: opts.tags };

  let docs: any[] = [];

  if (opts.query) {
    const words = opts.query.trim().split(/\s+/).filter((w) => w.length >= 2);

    if (words.length > 0) {
      const wordPatterns = words.map((word) => {
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return {
          $or: [
            { title: { $regex: escaped, $options: "i" } },
            { summary: { $regex: escaped, $options: "i" } },
            { tags: { $regex: escaped, $options: "i" } },
            { key: { $regex: escaped, $options: "i" } },
          ],
        };
      });

      // Try strict match first (all words must appear)
      const strictFilter = { ...baseFilter, $and: wordPatterns };
      docs = await KBDocumentModel.find(strictFilter).limit(limit).lean();

      // Fall back to fuzzy: any word matches, ranked by match count
      if (docs.length === 0) {
        const fuzzyFilter = { ...baseFilter, $or: wordPatterns.map((p) => p.$or).flat() };
        const candidates = await KBDocumentModel.find(fuzzyFilter).limit(limit * 3).lean();

        docs = rankByRelevance(candidates, words).slice(0, limit);
      }

      // Still nothing — try prefix matching (e.g. "dietary" matches "diet")
      if (docs.length === 0) {
        const prefixes = words
          .filter((w) => w.length >= 4)
          .map((w) => w.slice(0, Math.max(4, Math.ceil(w.length * 0.6))));

        if (prefixes.length > 0) {
          const prefixPatterns = prefixes.map((p) => {
            const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return [
              { title: { $regex: escaped, $options: "i" } },
              { summary: { $regex: escaped, $options: "i" } },
              { tags: { $regex: escaped, $options: "i" } },
              { key: { $regex: escaped, $options: "i" } },
            ];
          }).flat();

          const prefixFilter = { ...baseFilter, $or: prefixPatterns };
          const candidates = await KBDocumentModel.find(prefixFilter).limit(limit * 3).lean();
          docs = rankByRelevance(candidates, words).slice(0, limit);
        }
      }
    }
  } else {
    docs = await KBDocumentModel.find(baseFilter).limit(limit).lean();
  }

  // If no results from DB, try to discover unindexed S3 objects and index them
  if (docs.length === 0 && opts.query) {
    const discovered = await discoverAndIndexS3Objects(opts.query, allowedLevels);
    if (discovered > 0) {
      docs = await KBDocumentModel.find(baseFilter).limit(limit).lean();
    }
  }

  return {
    ok: true,
    tool: "queryKnowledgeBase",
    summary: `Found ${docs.length} document(s)${opts.query ? ` matching "${opts.query}"` : ""}.`,
    data: {
      documents: docs.map((doc) => ({
        key: doc.key,
        title: doc.title,
        domain: doc.domain,
        sensitivity: doc.sensitivity,
        tags: doc.tags,
        summary: doc.summary,
        owner: doc.owner,
        team: doc.team,
        contentType: doc.contentType,
        downloadUrl: `/api/kb/download/${encodeURIComponent(doc.key)}`,
      })),
    },
  };
}

function rankByRelevance(docs: any[], queryWords: string[]): any[] {
  const scored = docs.map((doc) => {
    let score = 0;
    const searchable = [doc.title, doc.summary, doc.key, ...(doc.tags ?? [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    for (const word of queryWords) {
      const lower = word.toLowerCase();
      if (searchable.includes(lower)) {
        score += 2;
        if (doc.title?.toLowerCase().includes(lower)) score += 3;
      } else {
        const prefix = lower.slice(0, Math.max(4, Math.ceil(lower.length * 0.6)));
        if (searchable.includes(prefix)) score += 1;
      }
    }

    return { doc, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.doc);
}

export async function fetchDocumentContent(key: string, username?: string) {
  await connectMongo();

  const doc = await KBDocumentModel.findOne({ key }).lean();
  if (!doc) {
    return { ok: false, tool: "queryKnowledgeBase", summary: `Document "${key}" not found.` };
  }

  const allowedLevels = getAccessLevels(username);
  if (!allowedLevels.includes(doc.sensitivity)) {
    return {
      ok: false,
      tool: "queryKnowledgeBase",
      summary: `Access denied. "${doc.title}" requires ${doc.sensitivity}-level access.`,
    };
  }

  try {
    const s3 = getS3();
    const response = await s3.send(new GetObjectCommand({
      Bucket: doc.s3Bucket,
      Key: doc.s3Key,
    }));

    const body = await response.Body?.transformToString("utf-8");

    return {
      ok: true,
      tool: "queryKnowledgeBase",
      summary: `Retrieved "${doc.title}" (${doc.domain}, ${doc.sensitivity}).`,
      data: {
        key: doc.key,
        title: doc.title,
        domain: doc.domain,
        sensitivity: doc.sensitivity,
        content: body?.slice(0, 8000) ?? "",
        contentType: doc.contentType,
      },
    };
  } catch (err) {
    return {
      ok: false,
      tool: "queryKnowledgeBase",
      summary: `Failed to fetch from S3: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

async function discoverAndIndexS3Objects(query: string, allowedLevels: string[]): Promise<number> {
  try {
    const s3 = getS3();
    const response = await s3.send(new ListObjectsV2Command({
      Bucket: getBucket(),
      MaxKeys: 200,
    }));

    const objects = response.Contents ?? [];
    if (objects.length === 0) return 0;

    // Find objects not yet indexed in MongoDB
    const allKeys = objects.map((o) => o.Key).filter(Boolean) as string[];
    const existingDocs = await KBDocumentModel.find({ s3Key: { $in: allKeys } }).select("s3Key").lean();
    const indexedKeys = new Set(existingDocs.map((d) => d.s3Key));
    const unindexed = objects.filter((o) => o.Key && !indexedKeys.has(o.Key));

    if (unindexed.length === 0) return 0;

    // Index untracked S3 objects by inferring metadata from the key
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
    const prefixes = words
      .filter((w) => w.length >= 4)
      .map((w) => w.slice(0, Math.max(4, Math.ceil(w.length * 0.6))));
    let indexed = 0;

    for (const obj of unindexed) {
      const s3Key = obj.Key!;
      const filename = s3Key.split("/").pop() ?? s3Key;
      const keyLower = s3Key.toLowerCase();

      // Match if any word or prefix appears in the key
      const relevant =
        words.some((w) => keyLower.includes(w)) ||
        prefixes.some((p) => keyLower.includes(p));
      if (!relevant) continue;

      // Infer metadata from path structure: md/{sensitivity}/{domain}/filename or md/{sensitivity}/filename
      const parts = s3Key.split("/");
      let sensitivity = "internal";
      let domain = "general";

      if (parts[0] === "md" && parts.length >= 3) {
        sensitivity = parts[1] ?? "internal";
        if (parts.length >= 4) {
          domain = parts[2] ?? "general";
        }
      }

      if (!allowedLevels.includes(sensitivity)) continue;

      const title = filename
        .replace(/\.[^.]+$/, "")
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      const docKey = s3Key.replace(/\.[^.]+$/, "").replace(/^md\/[^/]+\//, "");

      await KBDocumentModel.findOneAndUpdate(
        { s3Key },
        {
          $setOnInsert: {
            key: docKey,
            title,
            domain,
            sensitivity,
            tags: words,
            summary: `Auto-indexed from S3: ${s3Key}`,
            s3Bucket: getBucket(),
            s3Key,
            contentType: filename.endsWith(".md") ? "text/markdown" : "application/octet-stream",
            sizeBytes: obj.Size ?? 0,
          },
        },
        { upsert: true },
      );
      indexed++;
    }

    return indexed;
  } catch {
    return 0;
  }
}

export async function listBucketDocuments(prefix?: string) {
  try {
    const s3 = getS3();
    const response = await s3.send(new ListObjectsV2Command({
      Bucket: getBucket(),
      Prefix: prefix ?? "",
      MaxKeys: 50,
    }));

    const objects = (response.Contents ?? []).map((obj) => ({
      key: obj.Key ?? "",
      size: obj.Size ?? 0,
      lastModified: obj.LastModified?.toISOString() ?? "",
    }));

    return {
      ok: true,
      tool: "queryKnowledgeBase",
      summary: `Listed ${objects.length} object(s) in S3 bucket${prefix ? ` (prefix: ${prefix})` : ""}.`,
      data: { bucket: getBucket(), prefix, objects },
    };
  } catch (err) {
    return {
      ok: false,
      tool: "queryKnowledgeBase",
      summary: `S3 list failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
