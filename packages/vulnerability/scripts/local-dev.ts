/**
 * Local dev shim: runs all three Lambda handlers as Fastify HTTP routes.
 * Pair with `ngrok http 3000` to expose the Exa webhook publicly.
 *
 * Usage:
 *   npm run dev
 *
 * Required env vars (see README for full list):
 *   AWS_REGION, API_BASE_URL, SQS_QUEUE_URL, GITHUB_APP_SLUG
 *   + all lgtm/cve/* secrets in AWS Secrets Manager (or set them locally via .env)
 */

import "dotenv/config"; // npm install dotenv --save-dev
// @ts-ignore — fastify may not be installed; install separately: npm i fastify --save-dev
import Fastify from "fastify";
import { handler as registerRepoHandler } from "../src/handlers/registerRepo.js";
import { handler as exaWebhookHandler } from "../src/handlers/exaWebhook.js";

const app = Fastify({ logger: true });

function mockApiGwEvent(req: any, body: string, pathParams = {}) {
  return {
    version: "2.0",
    routeKey: req.routerPath,
    rawPath: req.url,
    rawQueryString: "",
    headers: req.headers,
    pathParameters: pathParams,
    queryStringParameters: {},
    requestContext: {} as any,
    body,
    isBase64Encoded: false,
  };
}

app.post("/repos", async (req, reply) => {
  const event = mockApiGwEvent(req, JSON.stringify(req.body));
  const result = await registerRepoHandler(event as any);
  return reply
    .code((result as any).statusCode ?? 200)
    .type("application/json")
    .send((result as any).body);
});

app.post("/exa/webhook/:monitorId", async (req, reply) => {
  const event = mockApiGwEvent(req, JSON.stringify(req.body), {
    monitorId: (req.params as any).monitorId,
  });
  const result = await exaWebhookHandler(event as any);
  return reply
    .code((result as any).statusCode ?? 200)
    .type("application/json")
    .send((result as any).body);
});

app.get("/health", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
console.log(`\nDev server running on http://localhost:${port}`);
console.log(`Expose webhook: ngrok http ${port}`);
console.log(`Then set API_BASE_URL=https://<ngrok-subdomain>.ngrok.io\n`);
