// Send one link to the reMarkable without Telegram: `pnpm send <url>`.
// Handy for checking the download → rmapi path in isolation.
import { normalizeFolder } from "./config.ts";
import { loadDotEnv } from "./env.ts";
import { processUrl } from "./pipeline.ts";
import { createRmapi } from "./remarkable/rmapi.ts";

loadDotEnv();
const url = process.argv[2];
if (!url) {
  console.error("usage: pnpm send <url>");
  process.exit(2);
}

const folder = normalizeFolder(process.env.REMARKABLE_FOLDER ?? "/Inbox");
const rmapi = createRmapi({ bin: process.env.RMAPI_BIN ?? "rmapi", configPath: process.env.RMAPI_CONFIG || undefined });
const result = await processUrl(url, { rmapi, folder, maxDownloadBytes: 50 * 1024 * 1024 });

console.log(result.ok ? `Sent: ${result.fileName} → ${folder}` : `Failed: ${result.error}`);
process.exit(result.ok ? 0 : 1);
