import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { verifyExaSignature, parseWebhookCandidates } from "../exa/webhook.js";
import { findByMonitorId } from "../db/repoMonitors.js";
import { getConfig } from "../config.js";
import type { CveJobMessage } from "../types.js";

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? "us-west-2" });

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  // monitorId comes from the path parameter (trusted), not the body
  const monitorId = event.pathParameters?.monitorId;
  if (!monitorId) {
    return json(400, { error: "Missing monitorId path parameter" });
  }

  // Look up the repo monitor to get the webhook secret
  const monitor = await findByMonitorId(monitorId);
  if (!monitor) {
    // Return 200 to avoid Exa disabling the webhook on repeated 4xx
    console.warn(`Unknown monitorId: ${monitorId}`);
    return json(200, { ok: true });
  }

  // Get raw body — check isBase64Encoded for HTTP API payload v2.0
  let rawBody: string;
  if (event.isBase64Encoded) {
    rawBody = Buffer.from(event.body ?? "", "base64").toString("utf8");
  } else {
    rawBody = event.body ?? "";
  }

  // Verify HMAC signature BEFORE parsing the payload
  const sigHeader = event.headers["exa-signature"] ?? event.headers["Exa-Signature"] ?? "";
  if (!sigHeader) {
    return json(401, { error: "Missing Exa-Signature header" });
  }

  const valid = verifyExaSignature(rawBody, sigHeader, monitor.webhookSecret);
  if (!valid) {
    return json(401, { error: "Invalid signature" });
  }

  // Now safe to parse
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const candidates = parseWebhookCandidates(
    { monitorId, runId: payload.runId ?? "", output: payload.output },
    {
      owner: monitor.owner,
      repo: monitor.repo,
      repoUrl: monitor.repoUrl,
      installationId: monitor.installationId,
      slackChannelId: monitor.slackChannelId,
      defaultBranch: monitor.defaultBranch,
    }
  );

  const cfg = await getConfig();

  // Enqueue each candidate as a separate SQS message
  const enqueued: string[] = [];
  for (const candidate of candidates) {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: cfg.sqsQueueUrl,
        MessageBody: JSON.stringify(candidate),
        // Deduplication via MessageDeduplicationId would require FIFO queue;
        // for standard queue we rely on DB-level dedup in the worker.
        MessageGroupId: undefined,
      })
    );
    enqueued.push(candidate.cveId);
  }

  console.log(
    `[${monitor.owner}/${monitor.repo}] Enqueued ${enqueued.length} CVE candidates: ${enqueued.join(", ")}`
  );

  return json(200, { ok: true, enqueued: enqueued.length });
};
