// Fetches real links through the download step only (no upload): `tsx scripts/smoke-download.ts <url>...`
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchDocument } from "../src/resolve/download.ts";
import { normalizeUrl } from "../src/resolve/url.ts";

const dir = await mkdtemp(join(tmpdir(), "t2rm-smoke-"));
for (const url of process.argv.slice(2)) {
  try {
    console.log(url, "→", JSON.stringify(await fetchDocument(normalizeUrl(url), { dir, maxBytes: 50 * 1024 * 1024 })));
  } catch (err) {
    console.log(url, "→ ERROR", (err as Error).message);
  }
}
