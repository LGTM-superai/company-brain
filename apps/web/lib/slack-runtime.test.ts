import { describe, expect, test } from "bun:test";
import { defaultSlackChannelPurpose, routeSlackChannelPurposes, withSlackMentions } from "./slack-runtime";

describe("Slack routing helpers", () => {
  test("routes announcement questions to announcements", () => {
    expect(routeSlackChannelPurposes("What events are coming up in June?")).toContain("announcements");
  });

  test("routes ticket and blocker questions to engineering", () => {
    expect(routeSlackChannelPurposes("What is blocking HB-204?")).toContain("engineering");
  });

  test("routes vulnerability questions to vulnerability monitoring", () => {
    expect(routeSlackChannelPurposes("Any CVE fixes or vulnerability reports today?")).toContain(
      "vulnerability-monitoring",
    );
  });

  test("routes audit questions to company brain actions", () => {
    expect(routeSlackChannelPurposes("What did Company Brain do earlier?")).toContain(
      "company-brain-actions",
    );
  });

  test("chooses engineering for ticket-related Slack writes", () => {
    expect(defaultSlackChannelPurpose({ text: "Can you check ticket HB-204?" })).toBe("engineering");
  });

  test("prefixes unique Slack mentions", () => {
    expect(withSlackMentions("Please check HB-204.", ["U123", "U123", "U456"])).toBe(
      "<@U123> <@U456> Please check HB-204.",
    );
  });
});
