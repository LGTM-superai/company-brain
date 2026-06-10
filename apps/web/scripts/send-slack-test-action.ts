import { getEnv, requireEnv } from "../lib/env";

const channel = getEnv("SLACK_ACTION_CHANNEL_ID") ?? "C0B9B3XNGAD";
const token = requireEnv("SLACK_BOT_TOKEN");
const text = process.argv.slice(2).join(" ").trim() || "test action";

const response = await fetch("https://slack.com/api/chat.postMessage", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=utf-8",
  },
  body: JSON.stringify({
    channel,
    text,
  }),
});

const payload = (await response.json()) as {
  ok?: boolean;
  error?: string;
  channel?: string;
  ts?: string;
  message?: { text?: string };
};

if (!payload.ok) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: payload.error ?? "unknown_error",
        channel,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      channel: payload.channel,
      ts: payload.ts,
      text: payload.message?.text,
    },
    null,
    2,
  ),
);
