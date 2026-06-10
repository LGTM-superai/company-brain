import { NextResponse } from "next/server";
import { WebClient } from "@slack/web-api";

let _slack: WebClient | null = null;
function getSlack() {
  if (!_slack) _slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  return _slack;
}

export async function GET() {
  try {
    const slack = getSlack();
    const all: { id: string; name: string }[] = [];
    let cursor: string | undefined;

    do {
      const result = await slack.conversations.list({
        exclude_archived: true,
        types: "public_channel",
        limit: 200,
        cursor,
      });
      console.log("[slack/channels] ok:", result.ok, "count:", result.channels?.length, "warning:", result.warning);
      for (const c of result.channels ?? []) {
        if (c.id && c.name) all.push({ id: c.id, name: c.name });
      }
      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    all.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ channels: all });
  } catch (err) {
    console.error("[slack/channels] error:", err);
    return NextResponse.json({ channels: [] });
  }
}
