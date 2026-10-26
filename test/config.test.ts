import { describe, expect, it } from "vitest";
import { loadConfig, normalizeFolder } from "../src/config.ts";
import { sanitizeTitle } from "../src/filename.ts";

describe("loadConfig", () => {
  it("refuses to start without ALLOWED_CHAT_ID", () => {
    expect(() => loadConfig({ TELEGRAM_BOT_TOKEN: "t" })).toThrow("ALLOWED_CHAT_ID");
  });

  it("rejects a non-numeric chat id", () => {
    expect(() => loadConfig({ TELEGRAM_BOT_TOKEN: "t", ALLOWED_CHAT_ID: "@me" })).toThrow("integer");
  });

  it("applies defaults", () => {
    expect(loadConfig({ TELEGRAM_BOT_TOKEN: "t", ALLOWED_CHAT_ID: "-100123" })).toMatchObject({
      allowedChatId: -100123,
      remarkableFolder: "/Inbox",
      rmapiBin: "rmapi",
    });
  });
});

describe("helpers", () => {
  it("normalizes folders", () => {
    expect(normalizeFolder("Inbox/")).toBe("/Inbox");
    expect(normalizeFolder("/")).toBe("/");
    expect(normalizeFolder("//Tweet2remarkable//sub/")).toBe("/Tweet2remarkable/sub");
  });

  it("sanitizes titles for the reMarkable", () => {
    expect(sanitizeTitle('  How to: "Agents"/Harness?\n')).toBe("How to- -Agents--Harness-");
    expect(sanitizeTitle("...")).toBe("Untitled");
    expect(sanitizeTitle("The most useful paper this year.")).toBe("The most useful paper this year");
    expect(sanitizeTitle("Cut at a word…")).toBe("Cut at a word…");
    expect(sanitizeTitle("a".repeat(300))).toHaveLength(120);
  });
});
