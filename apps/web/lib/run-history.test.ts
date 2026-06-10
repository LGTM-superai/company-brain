import { describe, expect, test } from "bun:test";
import { isApprovalMessage } from "./run-history";

describe("pending approval parsing", () => {
  test("accepts clear second-turn approvals", () => {
    expect(isApprovalMessage("Yes, approve the HB-201 move.")).toBe(true);
    expect(isApprovalMessage("go ahead")).toBe(true);
  });

  test("rejects non-approval status questions", () => {
    expect(isApprovalMessage("What is blocking launch?")).toBe(false);
  });
});
