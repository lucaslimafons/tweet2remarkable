// Debug helper: shows what Readability and the sanitizer keep for a page. `tsx scripts/debug-article.ts <url>`
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { extractArticle } from "../src/convert/article.ts";
import { fetchDocument, fetchImage } from "../src/resolve/download.ts";

const url = process.argv[2]!;
const fetched = await fetchDocument(url, { dir: await mkdtemp(join(tmpdir(), "t2rm-dbg-")), maxBytes: 5e7 });
if (fetched.kind !== "html") throw new Error(`not html: ${fetched.kind}`);
const parsed = new Readability(new JSDOM(fetched.html, { url, virtualConsole: new VirtualConsole() }).window.document).parse();
console.log("readability textContent chars:", parsed?.textContent?.length, "content chars:", parsed?.content?.length);
const tags = new Map<string, number>();
for (const m of parsed?.content?.matchAll(/<([a-z0-9-]+)/g) ?? []) tags.set(m[1]!, (tags.get(m[1]!) ?? 0) + 1);
console.log("tags in readability content:", Object.fromEntries([...tags].sort((a, b) => b[1] - a[1]).slice(0, 15)));
const article = extractArticle(fetched.html, fetched.finalUrl);
console.log("sanitized chars:", article.html.length, "| byline:", article.byline, "| site:", article.siteName);
for (const [, src] of article.html.matchAll(/<img src="([^"]+)"/g)) {
  const real = src.replace(/&amp;/g, "&");
  try {
    const img = await fetchImage(real);
    console.log("img ok", img.mediaType, real.slice(0, 100));
  } catch (err) {
    const res = await fetch(real).catch(() => undefined);
    console.log("img FAIL", (err as Error).message, "| served as:", res?.headers.get("content-type"), real.slice(0, 100));
  }
}
