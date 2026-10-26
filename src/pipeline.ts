import { mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { articleDocument, extractArticle, type WebArticle } from "./convert/article.ts";
import { buildEpub, type EpubDocument } from "./convert/epub.ts";
import { postDocument } from "./convert/post.ts";
import { sanitizeTitle } from "./filename.ts";
import { errorMessage } from "./log.ts";
import type { Rmapi } from "./remarkable/rmapi.ts";
import { fetchDocument, fetchImage, sniffDocumentType, type Fetched } from "./resolve/download.ts";
import { normalizeUrl, xStatusId } from "./resolve/url.ts";
import type { XResolver } from "./resolve/x.ts";

export interface PipelineDeps {
  rmapi: Rmapi;
  x: XResolver;
  folder: string;
  maxDownloadBytes: number;
  fetch?: typeof fetchDocument;
  fetchImage?: typeof fetchImage;
}

/** What one shared link turned into. A link can produce several files (e.g. an X post with a PDF link). */
export interface ItemResult {
  url: string;
  sent: string[];
  failed: { what: string; error: string }[];
}

/** Web pages linked from one post that get appended to its EPUB. */
const MAX_WEB_ARTICLES_PER_POST = 3;

/** The Bot API's getFile only serves files up to 20 MB. */
export const MAX_BOT_FILE_BYTES = 20 * 1024 * 1024;

/** A file sent to the bot. `download` writes it to a local path. */
export interface IncomingFile {
  name: string;
  size?: number;
  download(path: string): Promise<void>;
}

/** A PDF or EPUB sent as a file → uploaded unchanged. Never throws. */
export async function processFile(file: IncomingFile, deps: PipelineDeps): Promise<ItemResult> {
  const result: ItemResult = { url: file.name, sent: [], failed: [] };
  const fail = (error: string) => (result.failed.push({ what: file.name, error }), result);

  if (file.size && file.size > MAX_BOT_FILE_BYTES) {
    const mb = Math.round((file.size / 1024 / 1024) * 10) / 10;
    return fail(`The file is ${mb} MB; Telegram only lets bots download files up to 20 MB. Send a link to it instead.`);
  }
  const ext = extname(file.name).toLowerCase();
  if (ext && ext !== ".pdf" && ext !== ".epub") return fail("Only PDF and EPUB files are supported.");

  const dir = await mkdtemp(join(tmpdir(), "t2rm-"));
  try {
    const incoming = join(dir, "incoming");
    await file.download(incoming);
    // Trust the bytes, not the name.
    const type = sniffDocumentType(await readHead(incoming));
    if (!type) return fail("This isn't a PDF or EPUB file.");
    const path = join(dir, `${sanitizeTitle(basename(file.name, extname(file.name)))}.${type}`);
    await rename(incoming, path);
    await upload(path, type, file.name, deps, result);
  } catch (err) {
    fail(errorMessage(err));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return result;
}

async function readHead(path: string): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(1024), 0, 1024, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** One shared link → documents on the reMarkable. Never throws: failures come back in the result. */
export async function processUrl(url: string, deps: PipelineDeps): Promise<ItemResult> {
  const result: ItemResult = { url, sent: [], failed: [] };
  const dir = await mkdtemp(join(tmpdir(), "t2rm-"));
  try {
    const postId = xStatusId(url);
    if (postId) await sendXPost(postId, dir, deps, result);
    else await sendLink(url, dir, deps, result);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return result;
}

async function sendXPost(id: string, dir: string, deps: PipelineDeps, result: ItemResult): Promise<void> {
  let post;
  try {
    post = await deps.x.getPost(id);
  } catch (err) {
    result.failed.push({ what: result.url, error: `couldn't read the post: ${errorMessage(err)}` });
    return;
  }

  // PDFs linked from the post (or the post it quotes) go up as PDFs; web pages may join the post's EPUB.
  const pages: { url: string; html: string }[] = [];
  for (const link of new Set([...post.links, ...(post.quote?.links ?? [])])) {
    const fetched = await fetchLink(link, dir, deps, result);
    if (fetched?.kind === "pdf") await upload(fetched.path, "pdf", link, deps, result);
    else if (fetched?.kind === "html") pages.push({ url: fetched.finalUrl, html: fetched.html });
  }

  // The post becomes an EPUB when there's an X Article to read, or when no PDF was sent.
  const hasXArticle = !!(post.article ?? post.quote?.article);
  if (!hasXArticle && result.sent.length > 0) return;

  const webArticles: WebArticle[] = [];
  for (const page of pages.slice(0, MAX_WEB_ARTICLES_PER_POST)) {
    try {
      webArticles.push(extractArticle(page.html, page.url));
    } catch {
      // Not readable (paywall, app shell…): it stays in the post's list of links.
    }
  }
  await sendEpub(postDocument(post, webArticles), "the post as EPUB", dir, deps, result, { first: true });
}

async function sendLink(url: string, dir: string, deps: PipelineDeps, result: ItemResult): Promise<void> {
  const fetched = await fetchLink(url, dir, deps, result);
  if (!fetched) return;
  if (fetched.kind === "pdf") return upload(fetched.path, "pdf", url, deps, result);
  if (fetched.kind === "other") {
    result.failed.push({ what: url, error: `Not a PDF or a web page (${fetched.contentType}).` });
    return;
  }
  let article: WebArticle;
  try {
    article = extractArticle(fetched.html, fetched.finalUrl);
  } catch (err) {
    result.failed.push({ what: url, error: errorMessage(err) });
    return;
  }
  await sendEpub(articleDocument(article), url, dir, deps, result);
}

async function fetchLink(url: string, dir: string, deps: PipelineDeps, result: ItemResult): Promise<Fetched | undefined> {
  try {
    return await (deps.fetch ?? fetchDocument)(normalizeUrl(url), { dir, maxBytes: deps.maxDownloadBytes });
  } catch (err) {
    result.failed.push({ what: url, error: errorMessage(err) });
    return undefined;
  }
}

async function sendEpub(
  doc: EpubDocument,
  what: string,
  dir: string,
  deps: PipelineDeps,
  result: ItemResult,
  { first = false } = {},
): Promise<void> {
  let path: string;
  try {
    const epub = await buildEpub(doc, { fetchImage: deps.fetchImage ?? ((u) => fetchImage(u)) });
    path = join(dir, `${sanitizeTitle(doc.title)}.epub`);
    await writeFile(path, epub);
  } catch (err) {
    result.failed.push({ what, error: `couldn't build the EPUB: ${errorMessage(err)}` });
    return;
  }
  await upload(path, "epub", what, deps, result, { first });
}

async function upload(
  path: string,
  ext: "pdf" | "epub",
  what: string,
  deps: PipelineDeps,
  result: ItemResult,
  { first = false } = {},
): Promise<void> {
  try {
    const name = `${await deps.rmapi.put(path, deps.folder)}.${ext}`;
    if (first) result.sent.unshift(name);
    else result.sent.push(name);
  } catch (err) {
    result.failed.push({ what, error: errorMessage(err) });
  }
}
