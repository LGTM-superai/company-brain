import Exa from "exa-js";
import { requireEnv } from "../lib/env";
import { queryExaVerdict } from "../lib/exa-runtime";

const queries = [
  {
    label: "ticket-body query",
    query: "official docs responsive iframe aspect-ratio Google Maps embed mobile overflow",
  },
  {
    label: "stricter official-docs query",
    query:
      "Official documentation for fixing a mobile overflow issue caused by a fixed-width embedded Google Maps iframe. Look for CSS aspect-ratio, responsive iframe, width 100%, or Google Maps Embed API docs.",
  },
];

for (const item of queries) {
  const result = await queryExaVerdict(item.query);

  console.log(
    JSON.stringify(
      {
        label: item.label,
        query: item.query,
        result,
      },
      null,
      2,
    ),
  );
}

const exa = new Exa(requireEnv("EXA_API_KEY"));

for (const item of queries) {
  const run = (await exa.beta.agent.runs.create({
    betas: ["agent-2026-05-07"],
    query: item.query,
      outputSchema: {
        type: "object",
        properties: {
          verdict: { type: "string" },
          blocker_validity: { type: "string" },
          confidence: { type: "string" },
          evidence_url: { type: "string" },
          evidence_title: { type: "string" },
          summary: { type: "string" },
          recommended_next_step: { type: "string" },
          notion_note_suggestion: { type: "string" },
          slack_message_suggestion: { type: "string" },
        },
        required: [
          "verdict",
          "blocker_validity",
          "confidence",
          "evidence_url",
          "evidence_title",
          "summary",
          "recommended_next_step",
          "notion_note_suggestion",
          "slack_message_suggestion",
        ],
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
          label: `${item.label} long-poll`,
          query: item.query,
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
          label: `${item.label} long-poll`,
          query: item.query,
          runId: run.id,
          ok: false,
          error: error instanceof Error ? error.message : "Unknown Exa error.",
        },
        null,
        2,
      ),
    );
  }
}
