import { users, type PersonId } from "@company-brain/shared";
import { getSlackClient, CHANNELS, type SlackChannel } from "./client";

export type SendMessageInput = {
  channel: SlackChannel;
  text: string;
  tagUser?: PersonId;
};

function resolveUserMention(personId: PersonId): string {
  if (personId === "everyone") return "<!channel>";
  const user = users.find((u) => u.id === personId);
  return user?.slackId ? `<@${user.slackId}>` : `@${personId}`;
}

export async function sendSlackMessage(input: SendMessageInput) {
  const client = getSlackClient();
  const channelName = CHANNELS[input.channel];

  let text = input.text;
  if (input.tagUser) {
    text = `${resolveUserMention(input.tagUser)} ${text}`;
  }

  const result = await client.chat.postMessage({
    channel: channelName,
    text,
    unfurl_links: false,
  });

  return {
    ok: result.ok,
    channel: channelName,
    ts: result.ts,
  };
}
