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
  const filter: Record<string, unknown> = {
    sensitivity: { $in: allowedLevels },
  };

  if (opts.domain) filter.domain = opts.domain;
  if (opts.tags?.length) filter.tags = { $in: opts.tags };
  if (opts.query) {
    filter.$or = [
      { title: { $regex: opts.query, $options: "i" } },
      { summary: { $regex: opts.query, $options: "i" } },
      { tags: { $regex: opts.query, $options: "i" } },
    ];
  }

  const docs = await KBDocumentModel.find(filter)
    .limit(opts.limit ?? 10)
    .lean();

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
        downloadUrl: `/api/kb/download/${encodeURIComponent(doc.key)}`,
      })),
    },
  };
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
