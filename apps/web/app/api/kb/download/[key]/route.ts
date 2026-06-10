import { NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { connectMongo } from "../../../../../lib/mongodb";
import { KBDocumentModel } from "../../../../../lib/models";

const getS3 = () =>
  new S3Client({
    region: process.env.AWS_DEFAULT_REGION ?? "us-west-2",
  });

const getBucket = () => process.env.KB_S3_BUCKET ?? "company-brain-kb";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const decodedKey = decodeURIComponent(key);

  await connectMongo();
  const doc = await KBDocumentModel.findOne({ key: decodedKey }).lean();

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  try {
    const s3 = getS3();
    const command = new GetObjectCommand({
      Bucket: doc.s3Bucket ?? getBucket(),
      Key: doc.s3Key,
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });

    return NextResponse.json({
      ok: true,
      document: {
        key: doc.key,
        title: doc.title,
        domain: doc.domain,
        sensitivity: doc.sensitivity,
        contentType: doc.contentType,
        sizeBytes: doc.sizeBytes,
      },
      downloadUrl: url,
    });
  } catch (err) {
    console.error("[kb/download GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate download URL" },
      { status: 500 },
    );
  }
}
