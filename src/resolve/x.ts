// X posts, normalized away from any one data source. fxtwitter is the only implementation today;
// swapping in the official X API (or another resolver) means writing another `XResolver`.
import { codePointRangeToUtf16 } from "../convert/richtext.ts";
import type { Span } from "../convert/richtext.ts";
import { USER_AGENT } from "./download.ts";

export interface XPost {
  id: string;
  url: string;
  author: { name: string; handle: string };
  createdAt?: Date;
  lang?: string;
  /** Post text with links still shortened; `spans` carries styling and the expanded links (UTF-16 ranges). */
  text: string;
  spans: Span[];
  /** Expanded external links, in order (excludes links to x.com itself). */
  links: string[];
  photos: string[];
  hasVideo: boolean;
  article?: XArticle;
  quote?: XPost;
}

export interface XArticle {
  id: string;
  title: string;
  coverUrl?: string;
  blocks: DraftBlock[];
  /** Draft.js entities by key. */
  entities: Map<string, DraftEntity>;
  /** Image URL by media id, for MEDIA entities. */
  media: Map<string, string>;
}

export interface DraftBlock {
  type: string;
  text: string;
  inlineStyleRanges: { offset: number; length: number; style: string }[];
  entityRanges: { offset: number; length: number; key: number | string }[];
}

export interface DraftEntity {
  type: string;
  data: Record<string, unknown>;
}

export interface XResolver {
  getPost(id: string): Promise<XPost>;
}

export class XResolveError extends Error {
  override name = "XResolveError";
}

export function createFxTwitterResolver({ timeoutMs = 15_000 } = {}): XResolver {
  return {
    async getPost(id) {
      let res: Response;
      try {
        res = await fetch(`https://api.fxtwitter.com/status/${id}`, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { "user-agent": USER_AGENT },
        });
      } catch (err) {
        const timedOut = err instanceof Error && err.name === "TimeoutError";
        throw new XResolveError(timedOut ? "fxtwitter timed out" : "couldn't reach fxtwitter");
      }
      const body = (await res.json().catch(() => undefined)) as FxResponse | undefined;
      if (res.status === 404 || body?.code === 404) throw new XResolveError("post not found (deleted?)");
      if (res.status === 401 || body?.code === 401) throw new XResolveError("post is private");
      if (!res.ok || !body?.tweet) throw new XResolveError(`fxtwitter error (HTTP ${res.status})`);
      return parseFxTweet(body.tweet);
    },
  };
}

// --- fxtwitter JSON (only the fields we read; see docs/research.md) ---

interface FxResponse {
  code: number;
  message: string;
  tweet?: FxTweet;
}

interface FxFacet {
  type: string;
  indices: [number, number];
  original?: string;
  replacement?: string;
}

export interface FxTweet {
  id: string;
  url: string;
  text: string;
  raw_text?: { text: string; facets?: FxFacet[] };
  author: { name: string; screen_name: string };
  created_timestamp?: number;
  lang?: string | null;
  is_note_tweet?: boolean;
  media?: { photos?: { url: string }[]; videos?: unknown[] };
  quote?: FxTweet;
  article?: FxArticle;
}

interface FxArticle {
  id: string;
  title: string;
  cover_media?: { media_info?: { original_img_url?: string } };
  media_entities?: { media_id: string; media_info?: { original_img_url?: string } }[];
  content: {
    blocks: DraftBlock[];
    entityMap: { key: string; value: { type: string; data: Record<string, unknown> } }[] | Record<string, { type: string; data: Record<string, unknown> }>;
  };
}

const X_HOSTS = /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/;

export function parseFxTweet(tweet: FxTweet): XPost {
  const raw = tweet.raw_text ?? { text: tweet.text, facets: [] };
  // Long ("note") posts index by code point, regular posts by UTF-16 unit (as X's own API does).
  const toUtf16 = (a: number, b: number): [number, number] =>
    tweet.is_note_tweet ? codePointRangeToUtf16(raw.text, a, b) : [a, b];

  const spans: Span[] = [];
  const links: string[] = [];
  for (const facet of raw.facets ?? []) {
    const [start, end] = toUtf16(facet.indices[0], facet.indices[1]);
    if (facet.type === "bold" || facet.type === "italic") {
      spans.push({ start, end, kind: facet.type });
    } else if (facet.type === "url" && facet.replacement) {
      spans.push({ start, end, kind: "link", href: facet.replacement, display: facet.replacement });
      if (!isXLink(facet.replacement) && !links.includes(facet.replacement)) links.push(facet.replacement);
    }
    // "media" facets point at pic.x.com links fxtwitter has already removed from the text; skip them.
  }

  return {
    id: tweet.id,
    url: tweet.url,
    author: { name: tweet.author.name, handle: tweet.author.screen_name },
    createdAt: tweet.created_timestamp ? new Date(tweet.created_timestamp * 1000) : undefined,
    lang: tweet.lang ?? undefined,
    text: raw.text,
    spans,
    links,
    photos: (tweet.media?.photos ?? []).map((p) => p.url),
    hasVideo: (tweet.media?.videos?.length ?? 0) > 0,
    article: tweet.article ? parseArticle(tweet.article) : undefined,
    quote: tweet.quote ? parseFxTweet(tweet.quote) : undefined,
  };
}

function parseArticle(article: FxArticle): XArticle {
  const entityList = Array.isArray(article.content.entityMap)
    ? article.content.entityMap.map((e) => [e.key, e.value] as const)
    : Object.entries(article.content.entityMap);
  const media = new Map<string, string>();
  for (const m of article.media_entities ?? []) {
    if (m.media_info?.original_img_url) media.set(m.media_id, m.media_info.original_img_url);
  }
  return {
    id: article.id,
    title: article.title.trim(),
    coverUrl: article.cover_media?.media_info?.original_img_url,
    blocks: article.content.blocks,
    entities: new Map(entityList.map(([key, value]) => [String(key), { type: value.type, data: value.data ?? {} }])),
    media,
  };
}

function isXLink(href: string): boolean {
  try {
    return X_HOSTS.test(new URL(href).hostname);
  } catch {
    return true;
  }
}
