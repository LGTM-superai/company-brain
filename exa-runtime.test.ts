import { describe, expect, test } from "bun:test";
import { normalizeExaVerdict } from "./exa-runtime";

describe("Exa verdict normalization", () => {
  test("keeps structured fields and fills safe fallbacks", () => {
    const verdict = normalizeExaVerdict({
      verdict: "fixable",
      confidence: "high",
      evidence_url: "https://example.com/docs",
    });

    expect(verdict.verdict).toBe("fixable");
    expect(verdict.confidence).toBe("high");
    expect(verdict.evidence_title).toBe("No evidence title returned");
    expect(verdict.recommended_next_step).toContain("Do not write evidence");
  });
});
