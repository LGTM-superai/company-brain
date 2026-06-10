import Exa from "exa-js";
import { getEnv } from "../env";

const EXA_TIMEOUT_MS = 30_000;

export type ExaSearchItem = {
  title: string;
  url: string;
  summary: string;
  published_date: string;
};

export async function searchExa(query: string): Promise<ExaSearchItem[]> {
  const apiKey = getEnv("EXA_API_KEY");
  if (!apiKey) throw new Error("Missing required env var: EXA_API_KEY");

  const exa = new Exa(apiKey);

  const response = await withTimeout(
    exa.searchAndContents(query, {
      numResults: 3,
      text: { maxCharacters: 500 },
      livecrawl: "auto",
    }),
    EXA_TIMEOUT_MS,
    "Exa search timed out.",
  );

  return normalizeResults(response.results);
}

function normalizeResults(results: unknown): ExaSearchItem[] {
  if (!Array.isArray(results)) return [];
  return results.map((item: unknown) => {
    const r = isRecord(item) ? item : {};
    return {
      title: str(r.title, "Untitled"),
      url: str(r.url, ""),
      summary: str(r.text, "No summary available."),
      published_date: str(r.publishedDate, ""),
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
