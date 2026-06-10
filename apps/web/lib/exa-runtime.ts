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

const EXA_TIMEOUT_MS = 30_000;

export async function queryExaVerdict(query: string) {
  const normalizedQuery = normalizeBlockerQuery(query);

  try {
    const exa = new Exa(requireEnv("EXA_API_KEY"));

    const response = await withTimeout(
      exa.searchAndContents(normalizedQuery, {
        numResults: 3,
        text: { maxCharacters: 800 },
        livecrawl: "auto",
      }),
      EXA_TIMEOUT_MS,
      "queryExa timed out.",
    );

    const verdict = buildVerdictFromResults(normalizedQuery, response.results ?? []);

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

function buildVerdictFromResults(query: string, results: { title?: string | null; url?: string | null; text?: string | null }[]): ExaVerdict {
  const top = results[0];
  const hasEvidence = Boolean(top?.text && top.text.length > 50);

  const isFixable = hasEvidence && /aspect-ratio|responsive|overflow|css|viewport/i.test(top?.text ?? "");

  return {
    verdict: isFixable
      ? "Documentation shows a clear implementation path for responsive iframe embedding."
      : hasEvidence
        ? "Evidence found but requires team verification."
        : "Insufficient evidence found.",
    blocker_validity: isFixable ? "fixable_implementation_issue" : hasEvidence ? "partially_valid" : "unknown",
    confidence: isFixable ? "high" : hasEvidence ? "medium" : "low",
    evidence_url: top?.url ?? "",
    evidence_title: top?.title ?? "No evidence title returned",
    summary: top?.text?.slice(0, 500) ?? "Exa did not return a structured summary.",
    recommended_next_step: isFixable
      ? "Apply the CSS fix from the documentation and verify on mobile."
      : "Review the search results and validate manually.",
    notion_note_suggestion: hasEvidence
      ? `Exa validation: ${isFixable ? "fixable_implementation_issue" : "partially_valid"}. Evidence: ${top?.url ?? "none"}`
      : "No Notion note suggested until evidence is verified.",
    slack_message_suggestion: hasEvidence
      ? `Blocker validation complete for ${query} — ${isFixable ? "fixable via docs" : "needs team review"}. See: ${top?.url ?? ""}`
      : "No Slack nudge suggested until evidence is verified.",
  };
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
