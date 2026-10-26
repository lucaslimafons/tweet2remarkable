// Builds the EPUB for X posts without uploading: `tsx scripts/smoke-x.ts <outDir> <post url>...`
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildEpub } from "../src/convert/epub.ts";
import { postDocument } from "../src/convert/post.ts";
import { sanitizeTitle } from "../src/filename.ts";
import { fetchImage } from "../src/resolve/download.ts";
import { xStatusId } from "../src/resolve/url.ts";
import { createFxTwitterResolver } from "../src/resolve/x.ts";

const [outDir, ...urls] = process.argv.slice(2);
if (!outDir || urls.length === 0) throw new Error("usage: tsx scripts/smoke-x.ts <outDir> <post url>...");
await mkdir(outDir, { recursive: true });
const x = createFxTwitterResolver();

for (const url of urls) {
  const post = await x.getPost(xStatusId(url)!);
  const doc = postDocument(post);
  let images = 0;
  const epub = await buildEpub(doc, { fetchImage: (u) => fetchImage(u).then((img) => (images++, img)) });
  const path = join(outDir, `${sanitizeTitle(doc.title)}.epub`);
  await writeFile(path, epub);
  console.log(`${path}  (${Math.round(epub.length / 1024)} KB, ${doc.chapters.length} chapters, ${images} images, links: ${post.links.join(" ") || "none"})`);
}
