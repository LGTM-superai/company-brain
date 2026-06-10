import { NextResponse } from "next/server";
import { connectMongo } from "../../../../lib/mongodb";
import { ConversationModel, MessageModel } from "../../../../lib/models";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;

  await connectMongo();

  await Promise.all([
    ConversationModel.deleteOne({ conversationId }),
    MessageModel.deleteMany({ conversationId }),
  ]);

  return NextResponse.json({ ok: true });
}
