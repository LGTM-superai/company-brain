import { describe, expect, test } from "bun:test";
import { normalizeBlockerQuery } from "./exa-runtime";

describe("Exa verdict normalization", () => {
  test("canonicalizes the HB-204 map blocker query", () => {
    expect(
      normalizeBlockerQuery(
        "How to make Google Maps embed iframe responsive using CSS aspect-ratio and container queries?",
      ),
    ).toBe("official docs responsive iframe aspect-ratio Google Maps embed mobile overflow");
  });
});
