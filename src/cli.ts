// Send one link to the reMarkable without Telegram: `pnpm send <url>`.
// Handy for checking the resolve → convert → rmapi path in isolation.
import { formatResult } from "./bot.ts";
import { normalizeFolder } from "./config.ts";
import { loadDotEnv } from "./env.ts";
import { processUrl } from "./pipeline.ts";
import { createRmapi } from "./remarkable/rmapi.ts";
import { createFxTwitterResolver } from "./resolve/x.ts";

loadDotEnv();
const url = process.argv[2];
if (!url) {
  console.error("usage: pnpm send <url>");
  process.exit(2);
}

const folder = normalizeFolder(process.env.REMARKABLE_FOLDER ?? "/Inbox");
const rmapi = createRmapi({ bin: process.env.RMAPI_BIN ?? "rmapi", configPath: process.env.RMAPI_CONFIG || undefined });
const result = await processUrl(url, { rmapi, x: createFxTwitterResolver(), folder, maxDownloadBytes: 50 * 1024 * 1024 });

console.log(formatResult(result, folder));
process.exit(result.failed.length === 0 && result.sent.length > 0 ? 0 : 1);
