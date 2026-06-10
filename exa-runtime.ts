import Exa from "exa-js";
import { requireEnv } from "./env";

export type ExaVerdict = {
  verdict: string;
  confidence: string;
  evidence_url: string;
  evidence_title: string;
  summary: string;
  recommended_next_step: string;
};

export type ExaSearchItem = {
  title: string;
  url: string;
  summary: string;
  published_date: string;
};

export type ExaCVEResult = {
  cve_id: string;
  severity: string;
  affected_packages: string[];
  summary: string;
  mitigation: string;
  patch_url: string;
};

export type ExaNewsArticle = {
  title: string;
  source: string;
  url: string;
  published_date: string;
  summary: string;
};

const EXA_BETAS = ["agent-2026-05-07"];
const EXA_TIMEOUT_MS = 20_000;

export async function queryExaVerdict(query: string) {
  try {
    const exa = new Exa(requireEnv("EXA_API_KEY"));
    const run = (await withTimeout(
      exa.beta.agent.runs.create({
        betas: EXA_BETAS,
        query,
        outputSchema: {
          type: "object",
          properties: {
            verdict: { type: "string" },
            confidence: { type: "string" },
            evidence_url: { type: "string" },
            evidence_title: { type: "string" },
            summary: { type: "string" },
            recommended_next_step: { type: "string" },
          },
          required: [
            "verdict",
            "confidence",
            "evidence_url",
            "evidence_title",
            "summary",
            "recommended_next_step",
          ],
        },
      }),
      EXA_TIMEOUT_MS,
      "queryExa timed out while creating a run.",
    )) as { id: string };

    const completedRun = await withTimeout(
      exa.beta.agent.runs.pollUntilFinished(run.id, {
        betas: EXA_BETAS,
        pollInterval: 500,
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
      query,
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

export async function queryExaSearch(query: string) {
  try {
    const exa = new Exa(requireEnv("EXA_API_KEY"));
    const run = (await withTimeout(
      exa.beta.agent.runs.create({
        betas: EXA_BETAS,
        query: `${query} (return max 3 results)`,
        outputSchema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              maxItems: 3,
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  url: { type: "string" },
                  summary: { type: "string" },
                  published_date: { type: "string" },
                },
                required: ["title", "url", "summary", "published_date"],
              },
            },
          },
          required: ["results"],
        },
      }),
      EXA_TIMEOUT_MS,
      "queryExaSearch timed out while creating a run.",
    )) as { id: string };

    const completedRun = await withTimeout(
      exa.beta.agent.runs.pollUntilFinished(run.id, {
        betas: EXA_BETAS,
        pollInterval: 500,
        timeoutMs: EXA_TIMEOUT_MS,
      }),
      EXA_TIMEOUT_MS + 1000,
      "queryExaSearch timed out while polling a run.",
    );

    if (completedRun.status !== "completed") {
      return { ok: false as const, tool: "queryExa", message: `Tool failed: queryExaSearch (${completedRun.status})` };
    }

    const structured = (completedRun.output as { structured?: unknown } | undefined)?.structured;
    const results = normalizeExaSearchResults(structured);
    return { ok: true as const, tool: "queryExa", query, results };
  } catch (error) {
    return { ok: false as const, tool: "queryExa", message: "Tool failed: queryExaSearch", error: error instanceof Error ? error.message : "Unknown Exa error." };
  }
}

export async function queryExaCVE(query: string) {
  try {
    const exa = new Exa(requireEnv("EXA_API_KEY"));
    const run = (await withTimeout(
      exa.beta.agent.runs.create({
        betas: EXA_BETAS,
        query: `Security vulnerability details: ${query}`,
        outputSchema: {
          type: "object",
          properties: {
            cve_id: { type: "string" },
            severity: { type: "string" },
            affected_packages: { type: "array", items: { type: "string" } },
            summary: { type: "string" },
            mitigation: { type: "string" },
            patch_url: { type: "string" },
          },
          required: ["cve_id", "severity", "affected_packages", "summary", "mitigation", "patch_url"],
        },
      }),
      EXA_TIMEOUT_MS,
      "queryExaCVE timed out while creating a run.",
    )) as { id: string };

    const completedRun = await withTimeout(
      exa.beta.agent.runs.pollUntilFinished(run.id, {
        betas: EXA_BETAS,
        pollInterval: 500,
        timeoutMs: EXA_TIMEOUT_MS,
      }),
      EXA_TIMEOUT_MS + 1000,
      "queryExaCVE timed out while polling a run.",
    );

    if (completedRun.status !== "completed") {
      return { ok: false as const, tool: "queryExa", message: `Tool failed: queryExaCVE (${completedRun.status})` };
    }

    const structured = (completedRun.output as { structured?: unknown } | undefined)?.structured;
    const result = normalizeExaCVE(structured);
    return { ok: true as const, tool: "queryExa", query, result };
  } catch (error) {
    return { ok: false as const, tool: "queryExa", message: "Tool failed: queryExaCVE", error: error instanceof Error ? error.message : "Unknown Exa error." };
  }
}

export async function queryExaNews(query: string) {
  try {
    const exa = new Exa(requireEnv("EXA_API_KEY"));
    const run = (await withTimeout(
      exa.beta.agent.runs.create({
        betas: EXA_BETAS,
        query: `Recent news and articles (max 3): ${query}`,
        outputSchema: {
          type: "object",
          properties: {
            articles: {
              type: "array",
              maxItems: 3,
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  source: { type: "string" },
                  url: { type: "string" },
                  published_date: { type: "string" },
                  summary: { type: "string" },
                },
                required: ["title", "source", "url", "published_date", "summary"],
              },
            },
          },
          required: ["articles"],
        },
      }),
      EXA_TIMEOUT_MS,
      "queryExaNews timed out while creating a run.",
    )) as { id: string };

    const completedRun = await withTimeout(
      exa.beta.agent.runs.pollUntilFinished(run.id, {
        betas: EXA_BETAS,
        pollInterval: 500,
        timeoutMs: EXA_TIMEOUT_MS,
      }),
      EXA_TIMEOUT_MS + 1000,
      "queryExaNews timed out while polling a run.",
    );

    if (completedRun.status !== "completed") {
      return { ok: false as const, tool: "queryExa", message: `Tool failed: queryExaNews (${completedRun.status})` };
    }

    const structured = (completedRun.output as { structured?: unknown } | undefined)?.structured;
    const articles = normalizeExaNews(structured);
    return { ok: true as const, tool: "queryExa", query, articles };
  } catch (error) {
    return { ok: false as const, tool: "queryExa", message: "Tool failed: queryExaNews", error: error instanceof Error ? error.message : "Unknown Exa error." };
  }
}

export function normalizeExaSearchResults(input: unknown): ExaSearchItem[] {
  const value = isRecord(input) ? input : {};
  const results = Array.isArray(value.results) ? value.results : [];
  return results.map((item: unknown) => {
    const r = isRecord(item) ? item : {};
    return {
      title: stringValue(r.title, "Untitled"),
      url: stringValue(r.url, ""),
      summary: stringValue(r.summary, "No summary available."),
      published_date: stringValue(r.published_date, ""),
    };
  });
}

export function normalizeExaCVE(input: unknown): ExaCVEResult {
  const value = isRecord(input) ? input : {};
  return {
    cve_id: stringValue(value.cve_id, "Unknown CVE"),
    severity: stringValue(value.severity, "unknown"),
    affected_packages: Array.isArray(value.affected_packages)
      ? value.affected_packages.filter((p: unknown) => typeof p === "string")
      : [],
    summary: stringValue(value.summary, "No summary available."),
    mitigation: stringValue(value.mitigation, "No mitigation info returned."),
    patch_url: stringValue(value.patch_url, ""),
  };
}

export function normalizeExaNews(input: unknown): ExaNewsArticle[] {
  const value = isRecord(input) ? input : {};
  const articles = Array.isArray(value.articles) ? value.articles : [];
  return articles.map((item: unknown) => {
    const a = isRecord(item) ? item : {};
    return {
      title: stringValue(a.title, "Untitled"),
      source: stringValue(a.source, "Unknown source"),
      url: stringValue(a.url, ""),
      published_date: stringValue(a.published_date, ""),
      summary: stringValue(a.summary, "No summary available."),
    };
  });
}

export function normalizeExaVerdict(input: unknown): ExaVerdict {
  const value = isRecord(input) ? input : {};

  return {
    verdict: stringValue(value.verdict, "unknown"),
    confidence: stringValue(value.confidence, "unknown"),
    evidence_url: stringValue(value.evidence_url, ""),
    evidence_title: stringValue(value.evidence_title, "No evidence title returned"),
    summary: stringValue(value.summary, "Exa did not return a structured summary."),
    recommended_next_step: stringValue(value.recommended_next_step, "Do not write evidence until this is verified."),
  };
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
