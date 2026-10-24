/** Subset of Telegram's MessageEntity that link extraction needs. */
export interface EntityLike {
  type: string;
  offset: number;
  length: number;
  url?: string;
}

/**
 * Links in the order they appear, deduplicated. Uses Telegram's entities rather than a regex:
 * offsets are UTF-16 code units, which is exactly how JS strings index.
 */
export function extractUrls(text: string, entities: readonly EntityLike[] = []): string[] {
  const urls: string[] = [];
  for (const entity of entities) {
    let raw: string | undefined;
    if (entity.type === "url") raw = text.slice(entity.offset, entity.offset + entity.length);
    else if (entity.type === "text_link") raw = entity.url;
    const url = raw && toHttpUrl(raw);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

function toHttpUrl(raw: string): string | undefined {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Rewrites links whose real document lives elsewhere (e.g. an arXiv abstract page → its PDF). */
export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  const host = url.hostname.replace(/^www\./, "");
  if (host === "arxiv.org" || host === "export.arxiv.org") {
    const match = url.pathname.match(/^\/(?:abs|html|pdf)\/(.+?)(?:\.pdf)?\/?$/);
    if (match) return `https://arxiv.org/pdf/${match[1]}`;
  }
  return url.href;
}

const X_HOSTS = new Set(["x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com"]);

/** Status id of an X/Twitter post link, or undefined. */
export function xStatusId(raw: string): string | undefined {
  const url = new URL(raw);
  if (!X_HOSTS.has(url.hostname.replace(/^www\./, ""))) return undefined;
  return url.pathname.match(/^\/(?:[^/]+|i\/web)\/status\/(\d+)/)?.[1];
}
