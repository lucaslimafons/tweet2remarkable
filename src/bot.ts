import { Bot, type BotConfig, type Context } from "grammy";
import type { ItemResult } from "./pipeline.ts";
import { extractUrls } from "./resolve/url.ts";

export interface BotDeps {
  allowedChatId: number;
  folder: string;
  processUrl: (url: string) => Promise<ItemResult>;
}

const HELP =
  "Share a link to a PDF (e.g. an arXiv paper) and I'll send it to your reMarkable.";

export function createBot(token: string, deps: BotDeps, config?: BotConfig<Context>): Bot {
  const bot = new Bot(token, config);

  // Only the owner's chat gets through; everyone else is ignored silently.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.id === deps.allowedChatId) await next();
  });

  bot.command(["start", "help"], (ctx) => ctx.reply(HELP));

  bot.on("message:document", (ctx) => ctx.reply("Sending files directly isn't supported yet. Share a link instead."));

  bot.on(["message:text", "message:caption"], async (ctx) => {
    const message = ctx.msg;
    const urls = extractUrls(message.text ?? message.caption ?? "", message.entities ?? message.caption_entities ?? []);
    if (urls.length === 0) return ctx.reply(`No link found. ${HELP}`);

    await ctx.replyWithChatAction("upload_document");
    // One item at a time: keeps rmapi calls serial and replies in the same order as the links.
    for (const url of urls) {
      const result = await deps.processUrl(url);
      await ctx.reply(formatResult(result, deps.folder), {
        reply_parameters: { message_id: message.message_id },
        link_preview_options: { is_disabled: true },
      });
    }
  });

  return bot;
}

export function formatResult(result: ItemResult, folder: string): string {
  return result.ok ? `Sent: ${result.fileName} → ${folder}` : `Failed: ${result.url}\n${result.error}`;
}
