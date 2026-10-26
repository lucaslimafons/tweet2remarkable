import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sanitizeTitle } from "../filename.ts";

export const USER_AGENT = "tweet2remarkable/0.1";

export type Fetched =
  | { kind: "pdf"; path: string; title: string; finalUrl: string }
  | { kind: "other"; contentType: string; finalUrl: string };

export interface FetchOptions {
  /** Directory the downloaded file is written to. */
  dir: string;
  maxBytes: number;
  timeoutMs?: number;
}

export class DownloadError extends Error {
  override name = "DownloadError";
}

/**
 * Follows redirects and, when the target is a PDF, streams it to `dir`.
 * Anything else is reported back by content type without downloading the body.
 */
export async function fetchDocument(url: string, { dir, maxBytes, timeoutMs = 60_000 }: FetchOptions): Promise<Fetched> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": USER_AGENT, accept: "application/pdf,text/html;q=0.9,*/*;q=0.8" },
    });
  } catch (err) {
    throw new DownloadError(describeFetchError(err, timeoutMs));
  }

  const finalUrl = res.url || url;
  if (!res.ok) {
    await res.body?.cancel();
    throw new DownloadError(`HTTP ${res.status} from ${new URL(finalUrl).hostname}`);
  }

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!isPdfResponse(contentType, finalUrl)) {
    await res.body?.cancel();
    return { kind: "other", contentType: contentType.split(";")[0] || "unknown", finalUrl };
  }

  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new DownloadError(`file is ${formatMb(declared)}, over the ${formatMb(maxBytes)} limit`);
  }
  if (!res.body) throw new DownloadError("empty response");

  const title = titleFromResponse(res, finalUrl);
  const path = join(dir, `${title}.pdf`);
  try {
    await pipeline(Readable.fromWeb(res.body as never), limitAndSniff(maxBytes), createWriteStream(path));
  } catch (err) {
    await rm(path, { force: true });
    throw err instanceof DownloadError ? err : new DownloadError(describeFetchError(err, timeoutMs));
  }
  return { kind: "pdf", path, title, finalUrl };
}

function isPdfResponse(contentType: string, finalUrl: string): boolean {
  if (contentType.includes("application/pdf")) return true;
  const generic = !contentType || contentType.includes("octet-stream") || contentType.includes("binary");
  return generic && new URL(finalUrl).pathname.toLowerCase().endsWith(".pdf");
}

/** Enforces the byte limit while streaming and checks the PDF signature in the first KB. */
function limitAndSniff(maxBytes: number): Transform {
  let seen = 0;
  let head = Buffer.alloc(0);
  let sniffed = false;
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      seen += chunk.length;
      if (seen > maxBytes) return done(new DownloadError(`file is over the ${formatMb(maxBytes)} limit`));
      if (!sniffed) {
        head = Buffer.concat([head, chunk]).subarray(0, 1024);
        if (head.includes("%PDF-")) sniffed = true;
        else if (head.length >= 1024) return done(new DownloadError("link says PDF but the content is not a PDF"));
      }
      done(null, chunk);
    },
    flush(done) {
      done(sniffed ? null : new DownloadError("link says PDF but the content is not a PDF"));
    },
  });
}

function titleFromResponse(res: Response, finalUrl: string): string {
  const disposition = res.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/)?.[1];
  const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/)?.[1];
  const fromUrl = new URL(finalUrl).pathname.split("/").filter(Boolean).at(-1);
  const raw = safeDecode(encoded ?? plain ?? fromUrl ?? "document");
  return sanitizeTitle(raw.replace(/\.pdf$/i, ""));
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function describeFetchError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return `timed out after ${timeoutMs / 1000}s`;
  }
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
  return cause ?? (err instanceof Error ? err.message : String(err));
}

function formatMb(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

/** Downloads an image for embedding. The type comes from the file's magic bytes, not the header. */
export async function fetchImage(
  url: string,
  { maxBytes = 15 * 1024 * 1024, timeoutMs = 20_000 } = {},
): Promise<{ data: Uint8Array; mediaType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": USER_AGENT } });
  if (!res.ok) {
    await res.body?.cancel();
    throw new DownloadError(`HTTP ${res.status}`);
  }
  if (Number(res.headers.get("content-length")) > maxBytes) {
    await res.body?.cancel();
    throw new DownloadError("image too large");
  }
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.length > maxBytes) throw new DownloadError("image too large");
  const mediaType = sniffImageType(data);
  if (!mediaType) throw new DownloadError("unsupported image type");
  return { data, mediaType };
}

export function sniffImageType(data: Uint8Array): string | undefined {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "image/gif";
  return undefined;
}
