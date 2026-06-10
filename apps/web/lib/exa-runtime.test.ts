import { describe, expect, test } from "bun:test";
import { normalizeBlockerQuery, normalizeExaVerdict } from "./exa-runtime";

describe("Exa verdict normalization", () => {
  test("keeps structured fields and fills safe fallbacks", () => {
    const verdict = normalizeExaVerdict({
      verdict: "fixable",
      blocker_validity: "fixable_implementation_issue",
      confidence: "high",
      evidence_url: "https://example.com/docs",
    });

    expect(verdict.verdict).toBe("fixable");
    expect(verdict.blocker_validity).toBe("fixable_implementation_issue");
    expect(verdict.confidence).toBe("high");
    expect(verdict.evidence_title).toBe("No evidence title returned");
    expect(verdict.recommended_next_step).toContain("Do not write evidence");
    expect(verdict.notion_note_suggestion).toContain("No Notion note");
    expect(verdict.slack_message_suggestion).toContain("No Slack nudge");
  });

  test("canonicalizes the HB-204 map blocker query", () => {
    expect(
      normalizeBlockerQuery(
        "How to make Google Maps embed iframe responsive using CSS aspect-ratio and container queries?",
      ),
    ).toBe("official docs responsive iframe aspect-ratio Google Maps embed mobile overflow");
  });
});
