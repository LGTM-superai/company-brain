import Exa from "exa-js";
import { requireEnv } from "./env";

export type ExaVerdict = {
  verdict: string;
  blocker_validity: string;
  confidence: string;
  evidence_url: string;
  evidence_title: string;
  summary: string;
  recommended_next_step: string;
  notion_note_suggestion: string;
  slack_message_suggestion: string;
};

const EXA_BETAS = ["agent-2026-05-07"];
const EXA_TIMEOUT_MS = 60_000;

export async function queryExaVerdict(query: string) {
  const normalizedQuery = normalizeBlockerQuery(query);

  try {
    const exa = new Exa(requireEnv("EXA_API_KEY"));
    const run = (await withTimeout(
      exa.beta.agent.runs.create({
        betas: EXA_BETAS,
        query: buildBlockerValidationPrompt(normalizedQuery),
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
      }),
      EXA_TIMEOUT_MS,
      "queryExa timed out while creating a run.",
    )) as { id: string };

    const completedRun = await withTimeout(
      exa.beta.agent.runs.pollUntilFinished(run.id, {
        betas: EXA_BETAS,
        pollInterval: 1000,
        timeoutMs: EXA_TIMEOUT_MS,
      }),
      EXA_TIMEOUT_MS + 1000,
      "queryExa timed out while polling a run.",
    );

    if (completedRun.status !== "completed") {
      return {
        ok: false as const,
        tool: "queryExa",
        message: `Tool failed: queryExa (${completedRun.status})`,
      };
    }

    const structured = (completedRun.output as { structured?: unknown } | undefined)?.structured;
    const verdict = normalizeExaVerdict(structured);

    return {
      ok: true as const,
      tool: "queryExa",
      query: normalizedQuery,
      verdict,
    };
  } catch (error) {
    return {
      ok: false as const,
      tool: "queryExa",
      message: "Tool failed: queryExa",
      error: error instanceof Error ? error.message : "Unknown Exa error.",
    };
  }
}

export function normalizeBlockerQuery(query: string) {
  const normalized = query.toLowerCase();

  if (
    normalized.includes("google maps") &&
    normalized.includes("iframe") &&
    (normalized.includes("aspect-ratio") || normalized.includes("responsive") || normalized.includes("overflow"))
  ) {
    return "official docs responsive iframe aspect-ratio Google Maps embed mobile overflow";
  }

  return query.trim();
}

export function normalizeExaVerdict(input: unknown): ExaVerdict {
  const value = isRecord(input) ? input : {};

  return {
    verdict: stringValue(value.verdict, "unknown"),
    blocker_validity: stringValue(value.blocker_validity, "unknown"),
    confidence: stringValue(value.confidence, "unknown"),
    evidence_url: stringValue(value.evidence_url, ""),
    evidence_title: stringValue(value.evidence_title, "No evidence title returned"),
    summary: stringValue(value.summary, "Exa did not return a structured summary."),
    recommended_next_step: stringValue(value.recommended_next_step, "Do not write evidence until this is verified."),
    notion_note_suggestion: stringValue(
      value.notion_note_suggestion,
      "No Notion note suggested until evidence is verified.",
    ),
    slack_message_suggestion: stringValue(
      value.slack_message_suggestion,
      "No Slack nudge suggested until evidence is verified.",
    ),
  };
}

function buildBlockerValidationPrompt(query: string) {
  return `
You are validating a technical blocker for LGTM's Harbor Bean Cafe landing-page sprint.

Sprint ticket:
- HB-204 Validate responsive Google Maps embed
- Reported blocker: map iframe overflows on mobile.
- External validation query from the Notion ticket: ${query}

Research credible web documentation, prioritizing official docs. Decide whether this blocker is:
- valid_blocker: work cannot proceed without outside/client/product input.
- fixable_implementation_issue: documentation shows a clear implementation path.
- partially_valid: there is a fix path, but the team still needs implementation/testing proof.
- unknown: evidence is too weak or unavailable.

Return one best evidence URL and title. The summary must explicitly answer:
1. Is this a real blocker or a fixable implementation issue?
2. What implementation guidance did the docs provide?
3. What should the agent ask the user to do next?

Do not invent evidence. If official docs are unavailable, say so and lower confidence.
Keep each field concise enough to display in a chat tool trace.
`.trim();
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
