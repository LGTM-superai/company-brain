import Exa from "exa-js";

const EXA_BETAS = ["agent-2026-05-07"];
const EXA_TIMEOUT_MS = 20_000;

export type ExaSearchItem = {
  title: string;
  url: string;
  summary: string;
  published_date: string;
};

export async function searchExa(query: string): Promise<ExaSearchItem[]> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) throw new Error("Missing required env var: EXA_API_KEY");

  const exa = new Exa(apiKey);

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
    "Exa search timed out while creating a run.",
  )) as { id: string };

  const completedRun = await withTimeout(
    exa.beta.agent.runs.pollUntilFinished(run.id, {
      betas: EXA_BETAS,
      pollInterval: 500,
      timeoutMs: EXA_TIMEOUT_MS,
    }),
    EXA_TIMEOUT_MS + 1000,
    "Exa search timed out while polling.",
  );

  if (completedRun.status !== "completed") {
    throw new Error(`Exa run failed with status: ${completedRun.status}`);
  }

  const structured = (completedRun.output as { structured?: unknown } | undefined)?.structured;
  return normalizeResults(structured);
}

function normalizeResults(input: unknown): ExaSearchItem[] {
  const value = isRecord(input) ? input : {};
  const results = Array.isArray(value.results) ? value.results : [];
  return results.map((item: unknown) => {
    const r = isRecord(item) ? item : {};
    return {
      title: str(r.title, "Untitled"),
      url: str(r.url, ""),
      summary: str(r.summary, "No summary available."),
      published_date: str(r.published_date, ""),
    };
  });
}

function str(value: unknown, fallback: string) {
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
