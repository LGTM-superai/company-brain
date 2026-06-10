import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { connectMongo } from "../../../../lib/mongodb";
import { KBDocumentModel } from "../../../../lib/models";

const getS3 = () =>
  new S3Client({
    region: process.env.AWS_DEFAULT_REGION ?? "us-west-2",
  });

const getBucket = () => process.env.KB_S3_BUCKET ?? "company-brain-kb";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const title = formData.get("title") as string | null;
    const domain = formData.get("domain") as string | null;
    const sensitivity = formData.get("sensitivity") as string | null;
    const tags = formData.get("tags") as string | null;
    const summary = formData.get("summary") as string | null;
    const owner = formData.get("owner") as string | null;
    const team = formData.get("team") as string | null;

    if (!file || !title || !domain || !sensitivity) {
      return NextResponse.json(
        { error: "file, title, domain, and sensitivity are required" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const docId = `${domain}/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    const s3Key = `md/${sensitivity}/${docId}.md`;

    const s3 = getS3();
    await s3.send(new PutObjectCommand({
      Bucket: getBucket(),
      Key: s3Key,
      Body: buffer,
      ContentType: file.type || "text/markdown",
      Metadata: {
        title,
        domain,
        sensitivity,
        tags: tags ?? "",
      },
    }));

    await connectMongo();
    const doc = await KBDocumentModel.findOneAndUpdate(
      { key: docId },
      {
        $set: {
          key: docId,
          title,
          domain,
          sensitivity,
          tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
          summary: summary ?? "",
          owner: owner ?? undefined,
          team: team ?? undefined,
          s3Bucket: getBucket(),
          s3Key,
          contentType: file.type || "text/markdown",
          sizeBytes: buffer.length,
        },
      },
      { upsert: true, new: true },
    );

    return NextResponse.json({
      ok: true,
      document: {
        key: doc.key,
        title: doc.title,
        domain: doc.domain,
        sensitivity: doc.sensitivity,
        tags: doc.tags,
        s3Key,
      },
    });
  } catch (err) {
    console.error("[kb/upload POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 },
    );
  }
}
