import { describe, expect, test } from "bun:test";
import { buildLatestAgentNoteRewrite, extractBodySections, statusMoveGuard } from "./notion-runtime";

describe("Notion sprint body helpers", () => {
  test("extracts supported heading_2 and paragraph sections", () => {
    const sections = extractBodySections([
      heading("a", "Agent flow"),
      paragraph("b", "queryNotion reads the board."),
      heading("c", "Acceptance checks"),
      paragraph("d", "The launch checklist passes."),
    ]);

    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("Agent flow");
    expect(sections[0].text).toContain("queryNotion");
  });

  test("inserts Latest agent note after Agent flow and before Acceptance checks", () => {
    const rewrite = buildLatestAgentNoteRewrite(
      [
        heading("a", "Agent flow"),
        paragraph("b", "Existing flow."),
        heading("c", "Acceptance checks"),
      ],
      "Potentially blocked as of June 9, 2026.",
    );

    expect(rewrite.ok).toBe(true);
    if (!rewrite.ok) return;
    expect(rewrite.afterBlockId).toBe("b");
    expect(rewrite.children).toHaveLength(2);
  });

  test("aborts if a controlled section is ambiguous", () => {
    const rewrite = buildLatestAgentNoteRewrite(
      [
        heading("a", "Agent flow"),
        heading("b", "Agent flow"),
        heading("c", "Acceptance checks"),
      ],
      "Do not write this.",
    );

    expect(rewrite.ok).toBe(false);
  });

  test("guards status moves against stale current state", () => {
    expect(statusMoveGuard("In progress", "In progress").ok).toBe(true);
    expect(statusMoveGuard("In review", "In progress").ok).toBe(false);
  });
});

function heading(id: string, content: string) {
  return {
    id,
    type: "heading_2",
    heading_2: {
      rich_text: [{ plain_text: content }],
    },
  };
}

function paragraph(id: string, content: string) {
  return {
    id,
    type: "paragraph",
    paragraph: {
      rich_text: [{ plain_text: content }],
    },
  };
}
