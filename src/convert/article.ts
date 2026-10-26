// Web page HTML → readable article (Readability) → sanitized XHTML fragment for the EPUB.
import { isProbablyReaderable, Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import type { EpubDocument } from "./epub.ts";
import { escapeXml } from "./richtext.ts";

export interface WebArticle {
  title: string;
  byline?: string;
  siteName?: string;
  url: string;
  lang?: string;
  /** Sanitized, well-formed XHTML. */
  html: string;
}

export class ArticleError extends Error {
  override name = "ArticleError";
}

/** Below this much text a "readable" result is almost always a paywall, cookie wall or JS shell. */
const MIN_TEXT_LENGTH = 500;

export function extractArticle(html: string, url: string): WebArticle {
  // No scripts run and no subresources load: jsdom's defaults, kept explicit.
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole(), runScripts: undefined, resources: undefined });
  const doc = dom.window.document;
  const readerable = isProbablyReaderable(doc);
  const parsed = new Readability(doc, { charThreshold: MIN_TEXT_LENGTH }).parse();
  const text = parsed?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (!parsed?.content || text.length < MIN_TEXT_LENGTH || (!readerable && text.length < 2 * MIN_TEXT_LENGTH)) {
    throw new ArticleError("couldn't find an article on this page (paywall, login or JavaScript-only?)");
  }

  const content = new JSDOM(`<!doctype html><body>${parsed.content}</body>`, { url, virtualConsole: new VirtualConsole() });
  const body = content.window.document.body;
  const title = parsed.title?.trim() || new URL(url).hostname;
  // The chapter prints the title itself; drop the page's own copy of it.
  const firstHeading = body.querySelector("h1, h2");
  if (firstHeading && normalize(firstHeading.textContent) === normalize(title)) firstHeading.remove();
  return {
    title,
    byline: clean(parsed.byline),
    siteName: clean(parsed.siteName),
    url,
    lang: primaryLang(parsed.lang ?? doc.documentElement.lang),
    html: sanitizeChildren(body, url).trim(),
  };
}

export function articleDocument(article: WebArticle): EpubDocument {
  return {
    title: article.title,
    author: article.byline ?? article.siteName ?? new URL(article.url).hostname,
    lang: article.lang ?? "en",
    sourceUrl: article.url,
    chapters: [{ title: article.title, html: articleChapterHtml(article) }],
  };
}

export function articleChapterHtml(article: WebArticle): string {
  const site = article.siteName ?? new URL(article.url).hostname;
  const source = [article.byline !== site ? article.byline : undefined, site].filter(Boolean).map((s) => escapeXml(s!));
  return [
    `<h1>${escapeXml(article.title)}</h1>`,
    `<p class="meta">${source.join(" · ")} · <a href="${escapeXml(article.url)}">original</a></p>`,
    article.html,
  ].join("\n");
}

// --- sanitizer: DOM → XHTML string, allowlist only ---

const KEEP = new Set([
  "p", "br", "hr", "h2", "h3", "h4", "h5", "h6", "strong", "em", "u", "s", "sub", "sup", "small", "mark",
  "code", "pre", "kbd", "samp", "blockquote", "q", "cite", "ul", "ol", "li", "dl", "dt", "dd", "a", "img",
  "figure", "figcaption", "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td", "div", "section",
  "aside", "abbr", "time",
]);
const RENAME: Record<string, string> = { b: "strong", i: "em", strike: "s", del: "s", ins: "u", h1: "h2", article: "section" };
const DROP = new Set([
  "script", "style", "noscript", "template", "iframe", "frame", "object", "embed", "form", "input", "button",
  "select", "textarea", "svg", "math", "canvas", "video", "audio", "source", "track", "link", "meta", "head",
]);
const VOID = new Set(["br", "hr", "img"]);

function sanitizeChildren(node: Node, base: string): string {
  let out = "";
  for (const child of node.childNodes) out += sanitizeNode(child, base);
  return out;
}

function sanitizeNode(node: Node, base: string): string {
  if (node.nodeType === 3) return escapeXml(node.textContent ?? "");
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const raw = el.localName;
  if (DROP.has(raw)) return "";
  if (raw === "picture") {
    const img = el.querySelector("img");
    return img ? sanitizeNode(img, base) : "";
  }

  const tag = RENAME[raw] ?? raw;
  if (!KEEP.has(tag)) return sanitizeChildren(el, base); // unknown wrapper (span, font, …): keep its content

  const attrs: string[] = [];
  if (tag === "a") {
    const href = absolute(el.getAttribute("href"), base);
    if (!href) return sanitizeChildren(el, base);
    attrs.push(`href="${escapeXml(href)}"`);
  } else if (tag === "img") {
    const src = unwrapImageProxy(absolute(imageSource(el), base));
    if (!src) return "";
    attrs.push(`src="${escapeXml(src)}"`, `alt="${escapeXml(el.getAttribute("alt") ?? "")}"`);
  } else if (tag === "td" || tag === "th") {
    for (const name of ["colspan", "rowspan"]) {
      const value = el.getAttribute(name);
      if (value && /^\d{1,3}$/.test(value)) attrs.push(`${name}="${value}"`);
    }
  }

  const open = `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}`;
  if (VOID.has(tag)) return `${open}/>`;
  return `${open}>${sanitizeChildren(el, base)}</${tag}>`;
}

/** Real image URL, including lazy-loading patterns (data-src, srcset). */
function imageSource(img: Element): string | null {
  const candidates = [img.getAttribute("src"), img.getAttribute("data-src"), img.getAttribute("data-original")];
  const srcset = img.getAttribute("srcset") ?? img.getAttribute("data-srcset");
  if (srcset) candidates.push(srcset.split(",").at(-1)?.trim().split(/\s+/)[0] ?? null);
  return candidates.find((c) => c && !c.startsWith("data:")) ?? null;
}

/**
 * Next.js serves images through /_next/image?url=<original>, transcoded to WebP regardless of Accept,
 * which EPUB readers may not show. The original file is usually a plain JPEG/PNG.
 */
export function unwrapImageProxy(src: string | undefined): string | undefined {
  if (!src) return src;
  const url = new URL(src);
  const original = url.pathname.endsWith("/_next/image") ? url.searchParams.get("url") : null;
  return (original && absolute(original, url.href)) || src;
}

function absolute(value: string | null, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function normalize(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function clean(value: string | null | undefined): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

function primaryLang(lang: string | null | undefined): string | undefined {
  const primary = lang?.trim().toLowerCase().split(/[-_]/)[0];
  return primary && /^[a-z]{2,3}$/.test(primary) ? primary : undefined;
}
