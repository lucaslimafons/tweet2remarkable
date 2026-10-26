import { Bot, type BotConfig, type Context } from "grammy";
import type { MessageEntity } from "grammy/types";
import { MAX_BOT_FILE_BYTES, type IncomingFile, type ItemResult } from "./pipeline.ts";
import { downloadTo } from "./resolve/download.ts";
import { extractUrls } from "./resolve/url.ts";

export interface BotDeps {
  allowedChatId: number;
  folder: string;
  processUrl: (url: string) => Promise<ItemResult>;
  processFile: (file: IncomingFile) => Promise<ItemResult>;
  /** Where Telegram serves files from (overridable for tests or a local Bot API server). */
  fileApiRoot?: string;
}

const HELP =
  "Share a post from X, a web article or a link to a PDF, or send me a PDF/EPUB file, and I'll put it on your reMarkable.";

export function createBot(token: string, deps: BotDeps, config?: BotConfig<Context>): Bot {
  const bot = new Bot(token, config);
  const fileApiRoot = deps.fileApiRoot ?? "https://api.telegram.org";

  // Only the owner's chat gets through; everyone else is ignored silently.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.id === deps.allowedChatId) await next();
  });

  bot.command(["start", "help"], (ctx) => ctx.reply(HELP));

  bot.on("message:document", async (ctx) => {
    const { document, caption, caption_entities } = ctx.msg;
    await ctx.replyWithChatAction("upload_document");
    const result = await deps.processFile({
      name: document.file_name ?? "document",
      size: document.file_size,
      download: async (path) => {
        const file = await ctx.getFile();
        if (!file.file_path) throw new Error("Telegram didn't return the file");
        // The URL embeds the bot token: never log it or put it in an error.
        await downloadTo(`${fileApiRoot}/file/bot${token}/${file.file_path}`, path, { maxBytes: MAX_BOT_FILE_BYTES });
      },
    });
    await replyTo(ctx, result);
    // A caption can carry links too; those go through the normal link flow.
    await sendLinks(ctx, extractUrls(caption ?? "", caption_entities ?? []));
  });

  bot.on(["message:text", "message:caption"], async (ctx) => {
    const message = ctx.msg;
    const entities: MessageEntity[] = message.entities ?? message.caption_entities ?? [];
    const urls = extractUrls(message.text ?? message.caption ?? "", entities);
    if (urls.length === 0) return ctx.reply(`No link found. ${HELP}`);
    await ctx.replyWithChatAction("upload_document");
    await sendLinks(ctx, urls);
  });

  // One item at a time: keeps rmapi calls serial and replies in the same order as the links.
  async function sendLinks(ctx: Context, urls: string[]): Promise<void> {
    for (const url of urls) await replyTo(ctx, await deps.processUrl(url));
  }

  async function replyTo(ctx: Context, result: ItemResult): Promise<void> {
    await ctx.reply(formatResult(result, deps.folder), {
      reply_parameters: ctx.msg ? { message_id: ctx.msg.message_id } : undefined,
      link_preview_options: { is_disabled: true },
    });
  }

  return bot;
}

export function formatResult(result: ItemResult, folder: string): string {
  const lines: string[] = [];
  if (result.sent.length === 1) lines.push(`Sent: ${result.sent[0]} → ${folder}`);
  else if (result.sent.length > 1) lines.push(`Sent to ${folder}:`, ...result.sent.map((f) => `• ${f}`));
  for (const f of result.failed) lines.push(`Failed: ${f.what}\n${f.error}`);
  return lines.join("\n") || `Nothing to send from ${result.url}`;
}
