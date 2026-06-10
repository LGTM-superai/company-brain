import { NextResponse } from "next/server";
import { users } from "@company-brain/shared";
import { SESSION_COOKIE } from "../../../../lib/session";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { userId?: string };
  const userId = body.userId;

  if (!userId || !users.some((u) => u.id === userId)) {
    return NextResponse.json({ error: "Invalid user." }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true, userId });
  response.cookies.set(SESSION_COOKIE, userId, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  });

  return response;
}
