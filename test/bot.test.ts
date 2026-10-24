import type { Update, UserFromGetMe } from "grammy/types";
import { describe, expect, it } from "vitest";
import { createBot, formatResult } from "../src/bot.ts";
import type { ItemResult } from "../src/pipeline.ts";

const OWNER = 111;
const botInfo: UserFromGetMe = {
  id: 1,
  is_bot: true,
  first_name: "t2rm",
  username: "t2rm_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

function setup(results: Record<string, ItemResult> = {}) {
  const apiCalls: { method: string; payload: Record<string, unknown> }[] = [];
  const processed: string[] = [];
  const bot = createBot(
    "123:TEST",
    {
      allowedChatId: OWNER,
      folder: "/Inbox",
      processUrl: async (url) => {
        processed.push(url);
        return results[url] ?? { url, sent: ["doc.pdf"], failed: [] };
      },
    },
    { botInfo },
  );
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true } as never;
  });
  const replies = () => apiCalls.filter((c) => c.method === "sendMessage").map((c) => c.payload.text);
  return { bot, apiCalls, processed, replies };
}

let updateId = 0;
function message(chatId: number, text: string, entities: { type: string; offset: number; length: number }[] = []): Update {
  return {
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: chatId, type: "private", first_name: "x" },
      from: { id: chatId, is_bot: false, first_name: "x" },
      text,
      entities: entities as never,
    },
  };
}

const urlEntity = (text: string, url: string) => ({ type: "url", offset: text.indexOf(url), length: url.length });

describe("bot", () => {
  it("ignores other chats completely", async () => {
    const { bot, apiCalls, processed } = setup();
    const text = "https://arxiv.org/abs/1";
    await bot.handleUpdate(message(999, text, [urlEntity(text, text)]));
    expect(processed).toEqual([]);
    expect(apiCalls).toEqual([]);
  });

  it("processes every link and replies per item", async () => {
    const a = "https://arxiv.org/abs/1";
    const b = "https://example.com/page";
    const text = `${a} and ${b}`;
    const { bot, processed, replies } = setup({
      [a]: { url: a, sent: ["1.pdf"], failed: [] },
      [b]: { url: b, sent: [], failed: [{ what: b, error: "Not a PDF (text/html)." }] },
    });
    await bot.handleUpdate(message(OWNER, text, [urlEntity(text, a), urlEntity(text, b)]));
    expect(processed).toEqual([a, b]);
    expect(replies()).toEqual(["Sent: 1.pdf → /Inbox", `Failed: ${b}\nNot a PDF (text/html).`]);
  });

  it("lists every file a link produced, plus partial failures", () => {
    const text = formatResult(
      { url: "u", sent: ["Agent Harness.epub", "2610.30755v1.pdf"], failed: [{ what: "https://x/a.pdf", error: "HTTP 403" }] },
      "/Inbox",
    );
    expect(text).toBe("Sent to /Inbox:\n• Agent Harness.epub\n• 2610.30755v1.pdf\nFailed: https://x/a.pdf\nHTTP 403");
  });

  it("says so when there is no link", async () => {
    const { bot, replies } = setup();
    await bot.handleUpdate(message(OWNER, "hello"));
    expect(replies()[0]).toMatch(/^No link found/);
  });
});
