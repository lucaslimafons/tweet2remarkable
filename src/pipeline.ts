import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorMessage } from "./log.ts";
import type { Rmapi } from "./remarkable/rmapi.ts";
import { fetchDocument } from "./resolve/download.ts";
import { normalizeUrl, xStatusId } from "./resolve/url.ts";

export interface PipelineDeps {
  rmapi: Rmapi;
  folder: string;
  maxDownloadBytes: number;
  fetch?: typeof fetchDocument;
}

export type ItemResult =
  | { url: string; ok: true; fileName: string }
  | { url: string; ok: false; error: string };

/** One shared link → one document on the reMarkable. Never throws: failures come back as results. */
export async function processUrl(url: string, deps: PipelineDeps): Promise<ItemResult> {
  if (xStatusId(url)) return { url, ok: false, error: "Links to X posts aren't supported yet." };

  const dir = await mkdtemp(join(tmpdir(), "t2rm-"));
  try {
    const fetched = await (deps.fetch ?? fetchDocument)(normalizeUrl(url), { dir, maxBytes: deps.maxDownloadBytes });
    if (fetched.kind !== "pdf") {
      return { url, ok: false, error: `Not a PDF (${fetched.contentType}). Only direct PDF links are supported for now.` };
    }
    const name = await deps.rmapi.put(fetched.path, deps.folder);
    return { url, ok: true, fileName: `${name}.pdf` };
  } catch (err) {
    return { url, ok: false, error: errorMessage(err) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
