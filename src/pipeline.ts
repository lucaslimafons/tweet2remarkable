import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEpub } from "./convert/epub.ts";
import { postDocument } from "./convert/post.ts";
import { sanitizeTitle } from "./filename.ts";
import { errorMessage } from "./log.ts";
import type { Rmapi } from "./remarkable/rmapi.ts";
import { fetchDocument, fetchImage } from "./resolve/download.ts";
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

/** One shared link → documents on the reMarkable. Never throws: failures come back in the result. */
export async function processUrl(url: string, deps: PipelineDeps): Promise<ItemResult> {
  const result: ItemResult = { url, sent: [], failed: [] };
  const dir = await mkdtemp(join(tmpdir(), "t2rm-"));
  try {
    const postId = xStatusId(url);
    if (postId) await sendXPost(postId, dir, deps, result);
    else await sendLink(url, dir, deps, result, { notPdfIsError: true });
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

  // Links in the post (and the post it quotes) that point to PDFs go up as PDFs.
  const links = [...new Set([...post.links, ...(post.quote?.links ?? [])])];
  for (const link of links) await sendLink(link, dir, deps, result, { notPdfIsError: false });

  // The post itself becomes an EPUB when there's an article to read, or when nothing else was sent.
  const hasArticle = !!(post.article ?? post.quote?.article);
  if (!hasArticle && result.sent.length > 0) return;
  try {
    const doc = postDocument(post);
    const epub = await buildEpub(doc, { fetchImage: deps.fetchImage ?? ((u) => fetchImage(u)) });
    const path = join(dir, `${sanitizeTitle(doc.title)}.epub`);
    await writeFile(path, epub);
    result.sent.unshift(`${await deps.rmapi.put(path, deps.folder)}.epub`);
  } catch (err) {
    result.failed.push({ what: "the post as EPUB", error: errorMessage(err) });
  }
}

async function sendLink(
  url: string,
  dir: string,
  deps: PipelineDeps,
  result: ItemResult,
  { notPdfIsError }: { notPdfIsError: boolean },
): Promise<void> {
  try {
    const fetched = await (deps.fetch ?? fetchDocument)(normalizeUrl(url), { dir, maxBytes: deps.maxDownloadBytes });
    if (fetched.kind === "pdf") {
      result.sent.push(`${await deps.rmapi.put(fetched.path, deps.folder)}.pdf`);
    } else if (notPdfIsError) {
      result.failed.push({ what: url, error: `Not a PDF (${fetched.contentType}). Web articles aren't supported yet.` });
    }
  } catch (err) {
    result.failed.push({ what: url, error: errorMessage(err) });
  }
}
