// Runs the full pipeline but saves the files locally instead of uploading:
// `pnpm preview <url>...` (writes to ./preview, or $PREVIEW_DIR).
import { copyFile, mkdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { formatResult } from "./bot.ts";
import { processUrl } from "./pipeline.ts";
import type { Rmapi } from "./remarkable/rmapi.ts";
import { createFxTwitterResolver } from "./resolve/x.ts";

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error("usage: pnpm preview <url>...");
  process.exit(2);
}

const outDir = resolve(process.env.PREVIEW_DIR ?? "preview");
await mkdir(outDir, { recursive: true });
const localRmapi: Rmapi = {
  put: async (path) => {
    await copyFile(path, join(outDir, basename(path)));
    return basename(path, extname(path));
  },
  mkdirp: async () => {},
  version: async () => "local",
};

let ok = true;
for (const url of urls) {
  const result = await processUrl(url, { rmapi: localRmapi, x: createFxTwitterResolver(), folder: outDir, maxDownloadBytes: 50 * 1024 * 1024 });
  console.log(`${url}\n${formatResult(result, outDir)}\n`);
  ok &&= result.failed.length === 0;
}
process.exit(ok ? 0 : 1);
