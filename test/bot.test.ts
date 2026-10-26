import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { Update, UserFromGetMe } from "grammy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBot, formatResult } from "../src/bot.ts";
import { processFile, type ItemResult } from "../src/pipeline.ts";

const TOKEN = "123:TEST";
const OWNER = 111;
const PDF = Buffer.from("%PDF-1.7\n%test\n");
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

// Stands in for api.telegram.org/file/bot<token>/<path>.
let fileServer: Server;
let fileApiRoot: string;
const served: string[] = [];
beforeAll(async () => {
  fileServer = createServer((req, res) => {
    served.push(req.url ?? "");
    if (req.url === `/file/bot${TOKEN}/documents/paper.pdf`) return res.writeHead(200).end(PDF);
    if (req.url === `/file/bot${TOKEN}/documents/renamed.pdf`) return res.writeHead(200).end("<html>not a pdf</html>");
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => fileServer.listen(0, "127.0.0.1", resolve));
  const address = fileServer.address();
  fileApiRoot = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(() => {
  fileServer.close();
});

function setup(results: Record<string, ItemResult> = {}) {
  const apiCalls: { method: string; payload: Record<string, unknown> }[] = [];
  const processed: string[] = [];
  const uploads: { name: string; bytes: Buffer }[] = [];
  const pipelineDeps = {
    folder: "/Inbox",
    maxDownloadBytes: 1e6,
    x: { getPost: () => Promise.reject(new Error("unused")) },
    rmapi: {
      put: async (path: string) => {
        uploads.push({ name: basename(path), bytes: await readFile(path) });
        return basename(path, extname(path));
      },
      mkdirp: async () => {},
      version: async () => "test",
    },
  };
  const bot = createBot(
    TOKEN,
    {
      allowedChatId: OWNER,
      folder: "/Inbox",
      fileApiRoot,
      processUrl: async (url) => {
        processed.push(url);
        return results[url] ?? { url, sent: ["doc.pdf"], failed: [] };
      },
      processFile: (file) => processFile(file, pipelineDeps),
    },
    { botInfo },
  );
  bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as Record<string, unknown>;
    apiCalls.push({ method, payload: p });
    if (method === "getFile") {
      return { ok: true, result: { file_id: p.file_id, file_unique_id: "u", file_path: `documents/${p.file_id}` } } as never;
    }
    return { ok: true, result: true } as never;
  });
  const replies = () => apiCalls.filter((c) => c.method === "sendMessage").map((c) => c.payload.text);
  return { bot, apiCalls, processed, uploads, replies };
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

/** A document message; `fileId` doubles as the path on the fake file server. */
function documentMessage(chatId: number, fileName: string, fileId: string, fileSize?: number, caption?: string): Update {
  return {
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: chatId, type: "private", first_name: "x" },
      from: { id: chatId, is_bot: false, first_name: "x" },
      document: { file_id: fileId, file_unique_id: fileId, file_name: fileName, file_size: fileSize },
      caption,
      caption_entities: caption ? [{ type: "url", offset: 0, length: caption.length }] : undefined,
    },
  };
}

const urlEntity = (text: string, url: string) => ({ type: "url", offset: text.indexOf(url), length: url.length });

describe("bot: links", () => {
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

describe("bot: files", () => {
  it("downloads a PDF from Telegram and uploads it under its own name", async () => {
    const { bot, uploads, replies } = setup();
    await bot.handleUpdate(documentMessage(OWNER, "Attention Is All You Need.pdf", "paper.pdf", PDF.length));
    expect(uploads).toEqual([{ name: "Attention Is All You Need.pdf", bytes: PDF }]);
    expect(replies()).toEqual(["Sent: Attention Is All You Need.pdf → /Inbox"]);
  });

  it("refuses files over 20 MB without downloading them", async () => {
    const { bot, apiCalls, replies } = setup();
    await bot.handleUpdate(documentMessage(OWNER, "big.pdf", "paper.pdf", 25 * 1024 * 1024));
    expect(apiCalls.some((c) => c.method === "getFile")).toBe(false);
    expect(replies()).toEqual([
      "Failed: big.pdf\nThe file is 25 MB; Telegram only lets bots download files up to 20 MB. Send a link to it instead.",
    ]);
  });

  it("rejects other file types by name, and fakes by content", async () => {
    const { bot, uploads, replies } = setup();
    await bot.handleUpdate(documentMessage(OWNER, "notes.docx", "paper.pdf", 10));
    await bot.handleUpdate(documentMessage(OWNER, "renamed.pdf", "renamed.pdf", 10));
    expect(uploads).toEqual([]);
    expect(replies()).toEqual([
      "Failed: notes.docx\nOnly PDF and EPUB files are supported.",
      "Failed: renamed.pdf\nThis isn't a PDF or EPUB file.",
    ]);
  });

  it("never leaks the bot token in an error", async () => {
    const { bot, replies } = setup();
    await bot.handleUpdate(documentMessage(OWNER, "gone.pdf", "missing.pdf", 10));
    expect(replies()).toEqual(["Failed: gone.pdf\ndownload failed (HTTP 404)"]);
    expect(served.at(-1)).toContain(TOKEN); // the token was used to fetch…
    expect(replies().join("")).not.toContain(TOKEN); // …but never shown
  });

  it("also sends links found in the file's caption", async () => {
    const { bot, processed, replies } = setup();
    await bot.handleUpdate(documentMessage(OWNER, "a.pdf", "paper.pdf", PDF.length, "https://example.com/b.pdf"));
    expect(processed).toEqual(["https://example.com/b.pdf"]);
    expect(replies()).toEqual(["Sent: a.pdf → /Inbox", "Sent: doc.pdf → /Inbox"]);
  });
});
