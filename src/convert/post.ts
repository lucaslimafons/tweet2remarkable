// X post (+ quoted post, + X Article) → an EPUB-ready document.
import type { XArticle, XPost } from "../resolve/x.ts";
import { articleChapterHtml, type WebArticle } from "./article.ts";
import { renderArticle } from "./draft.ts";
import type { EpubDocument } from "./epub.ts";
import { escapeXml, renderParagraphs } from "./richtext.ts";

const TITLE_MAX = 90;

/** `webArticles`: readable pages the post links to, appended after the post (and its X Article). */
export function postDocument(post: XPost, webArticles: readonly WebArticle[] = []): EpubDocument {
  const article = post.article ?? post.quote?.article;
  const articleAuthor = post.article ? post : post.quote;
  const chapters = [];

  if (hasOwnText(post) || post.photos.length > 0 || !post.article) {
    chapters.push({ title: `Post by @${post.author.handle}`, html: renderPost(post) });
  }
  if (article && articleAuthor) {
    chapters.push({ title: article.title, html: renderArticleChapter(article, articleAuthor, !chapters.length) });
  }
  for (const web of webArticles) chapters.push({ title: web.title, html: articleChapterHtml(web) });

  return {
    title: documentTitle(post, webArticles),
    author: article && articleAuthor ? articleAuthor.author.name : post.author.name,
    lang: post.lang && /^[a-z]{2,3}$/.test(post.lang) ? post.lang : "en",
    sourceUrl: post.url,
    chapters,
  };
}

export function documentTitle(post: XPost, webArticles: readonly WebArticle[] = []): string {
  if (post.article) return post.article.title;
  // A short comment on an article (quoted, or the one page it links to): the article is what's worth reading.
  const shortComment = plainText(post).length < 200;
  if (post.quote?.article && shortComment) return post.quote.article.title;
  if (webArticles.length === 1 && shortComment) return webArticles[0]!.title;
  return firstLine(post) || `Post by @${post.author.handle}`;
}

function renderPost(post: XPost): string {
  const parts = [`<h1>${escapeXml(post.author.name)}</h1>`, meta(post), renderParagraphs(post.text, post.spans)];
  parts.push(...photos(post));
  if (post.hasVideo) parts.push(`<p class="note">This post has a video: <a href="${escapeXml(post.url)}">watch on X</a>.</p>`);

  const quote = post.quote;
  if (quote && !quote.article) {
    parts.push(
      `<blockquote class="quote">`,
      `<p class="meta">Quoting ${escapeXml(quote.author.name)} (@${escapeXml(quote.author.handle)}) · <a href="${escapeXml(quote.url)}">view on X</a></p>`,
      renderParagraphs(quote.text, quote.spans),
      ...photos(quote),
      `</blockquote>`,
    );
  }

  const links = [...post.links, ...(quote?.links ?? []).filter((l) => !post.links.includes(l))];
  if (links.length) {
    parts.push(
      `<h3>Links</h3>`,
      `<ul class="links">${links.map((l) => `<li><a href="${escapeXml(l)}">${escapeXml(l)}</a></li>`).join("")}</ul>`,
    );
  }
  return parts.filter(Boolean).join("\n");
}

function renderArticleChapter(article: XArticle, author: XPost, withSource: boolean): string {
  return [
    `<h1>${escapeXml(article.title)}</h1>`,
    `<p class="meta">${escapeXml(author.author.name)} (@${escapeXml(author.author.handle)})${withSource ? ` · <a href="${escapeXml(author.url)}">view on X</a>` : ""}</p>`,
    article.coverUrl ? `<figure><img src="${escapeXml(article.coverUrl)}" alt=""/></figure>` : "",
    renderArticle(article),
  ]
    .filter(Boolean)
    .join("\n");
}

function meta(post: XPost): string {
  const date = post.createdAt ? ` · ${post.createdAt.toISOString().slice(0, 10)}` : "";
  return `<p class="meta">@${escapeXml(post.author.handle)}${date} · <a href="${escapeXml(post.url)}">view on X</a></p>`;
}

function photos(post: XPost): string[] {
  return post.photos.map((src) => `<figure><img src="${escapeXml(src)}" alt=""/></figure>`);
}

/** Post text without its links (a post that only shares an article link has no text of its own). */
function plainText(post: XPost): string {
  let text = post.text;
  for (const span of [...post.spans].filter((s) => s.kind === "link").sort((a, b) => b.start - a.start)) {
    text = text.slice(0, span.start) + text.slice(span.end);
  }
  return text.replace(/https?:\/\/\S+/g, "").trim();
}

function hasOwnText(post: XPost): boolean {
  return plainText(post).length > 0;
}

function firstLine(post: XPost): string {
  const line = plainText(post).split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (line.length <= TITLE_MAX) return line;
  const cut = line.slice(0, TITLE_MAX);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : TITLE_MAX).trimEnd()}…`;
}
