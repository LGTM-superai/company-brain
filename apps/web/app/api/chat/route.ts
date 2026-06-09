import { NextResponse } from "next/server";
import type { AgentEvent } from "@company-brain/shared";

export async function POST() {
  const events: AgentEvent[] = [
    { type: "tool_call", tool: "queryNotionSprintBoard" },
    { type: "tool_call", tool: "querySlack" },
    {
      type: "assistant_message",
      content: "Chat route scaffold. Replace this with the streaming agent runner.",
    },
    { type: "done" },
  ];

  return NextResponse.json({ events });
}
