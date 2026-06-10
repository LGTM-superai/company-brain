import { describe, expect, test } from "bun:test";
import { gmt8TodayFromNow, overdueInfo } from "./time";

describe("GMT+8 date helpers", () => {
  test("converts Date.now-style timestamps to GMT+8 calendar dates", () => {
    expect(gmt8TodayFromNow(Date.parse("2026-06-08T18:00:00.000Z"))).toBe("2026-06-09");
  });

  test("marks HB-101 overdue by four days on June 9 2026 GMT+8", () => {
    const result = overdueInfo("2026-06-05", Date.parse("2026-06-09T04:00:00.000Z"));

    expect(result.isOverdue).toBe(true);
    expect(result.daysOverdue).toBe(4);
    expect(result.todayLocal).toBe("2026-06-09");
  });
});
