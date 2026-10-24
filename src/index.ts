import { GrammyError, HttpError } from "grammy";
import { createBot } from "./bot.ts";
import { loadConfig } from "./config.ts";
import { loadDotEnv } from "./env.ts";
import { errorMessage, log, registerSecret } from "./log.ts";
import { processUrl } from "./pipeline.ts";
import { createRmapi } from "./remarkable/rmapi.ts";
import { createFxTwitterResolver } from "./resolve/x.ts";

loadDotEnv();
const config = loadConfig();
registerSecret(config.telegramToken);

const rmapi = createRmapi({ bin: config.rmapiBin, configPath: config.rmapiConfig });
const x = createFxTwitterResolver();

// Validate the reMarkable side before accepting any message: binary present, paired, folder exists.
try {
  log.info(`rmapi ${await rmapi.version()}`);
  await rmapi.mkdirp(config.remarkableFolder);
} catch (err) {
  log.error("reMarkable preflight failed (is rmapi installed and paired? see README)", err);
  process.exit(1);
}

const bot = createBot(config.telegramToken, {
  allowedChatId: config.allowedChatId,
  folder: config.remarkableFolder,
  processUrl: (url) =>
    processUrl(url, { rmapi, x, folder: config.remarkableFolder, maxDownloadBytes: config.maxDownloadBytes }),
});

bot.catch(({ error }) => {
  const kind = error instanceof GrammyError ? "Telegram API" : error instanceof HttpError ? "Telegram network" : "handler";
  log.error(`${kind} error`, errorMessage(error));
});

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

await bot.start({
  drop_pending_updates: false,
  onStart: (me) => log.info(`polling as @${me.username}, uploading to ${config.remarkableFolder}`),
});
