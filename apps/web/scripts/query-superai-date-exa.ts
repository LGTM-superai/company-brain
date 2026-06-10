import Exa from "exa-js";
import { requireEnv } from "../lib/env";

const exa = new Exa(requireEnv("EXA_API_KEY"));
const query = "SuperAI event date 2026 official event dates Singapore";

const run = (await exa.beta.agent.runs.create({
  betas: ["agent-2026-05-07"],
  query,
  outputSchema: {
    type: "object",
    properties: {
      event_name: { type: "string" },
      event_dates: { type: "string" },
      location: { type: "string" },
      evidence_url: { type: "string" },
      evidence_title: { type: "string" },
      summary: { type: "string" },
    },
    required: ["event_name", "event_dates", "location", "evidence_url", "evidence_title", "summary"],
  },
})) as { id: string };

try {
  const completedRun = await exa.beta.agent.runs.pollUntilFinished(run.id, {
    betas: ["agent-2026-05-07"],
    pollInterval: 1000,
    timeoutMs: 60_000,
  });

  console.log(
    JSON.stringify(
      {
        ok: completedRun.status === "completed",
        runId: run.id,
        status: completedRun.status,
        output: completedRun.output?.structured ?? completedRun.output,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        runId: run.id,
        error: error instanceof Error ? error.message : "Unknown Exa error.",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
