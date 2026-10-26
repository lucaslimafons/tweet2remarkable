// X Article (Draft.js raw content) → XHTML body fragment.
import type { DraftBlock, XArticle } from "../resolve/x.ts";
import { codePointRangeToUtf16, escapeXml, renderInline, type Span } from "./richtext.ts";

const LIST_TAGS: Record<string, string> = { "unordered-list-item": "ul", "ordered-list-item": "ol" };
const HEADING_TAGS: Record<string, string> = { "header-one": "h2", "header-two": "h3", "header-three": "h4" };

export function renderArticle(article: XArticle): string {
  const out: string[] = [];
  let openList: string | undefined;

  for (const block of article.blocks) {
    const listTag = LIST_TAGS[block.type];
    if (openList && listTag !== openList) {
      out.push(`</${openList}>`);
      openList = undefined;
    }
    if (listTag) {
      if (!openList) out.push(`<${(openList = listTag)}>`);
      out.push(`<li>${inline(block, article)}</li>`);
      continue;
    }

    const heading = HEADING_TAGS[block.type];
    if (heading) {
      if (block.text.trim()) out.push(`<${heading}>${inline(block, article)}</${heading}>`);
    } else if (block.type === "blockquote") {
      out.push(`<blockquote><p>${inline(block, article)}</p></blockquote>`);
    } else if (block.type === "code-block") {
      out.push(`<pre><code>${escapeXml(block.text)}</code></pre>`);
    } else if (block.type === "atomic") {
      const html = renderAtomic(block, article);
      if (html) out.push(html);
    } else if (block.text.trim()) {
      out.push(`<p>${inline(block, article)}</p>`);
    }
  }
  if (openList) out.push(`</${openList}>`);
  return out.join("\n");
}

function inline(block: DraftBlock, article: XArticle): string {
  // Draft.js counts offsets in code points; spans are UTF-16.
  const range = (offset: number, length: number) => codePointRangeToUtf16(block.text, offset, offset + length);
  const spans: Span[] = [];
  for (const r of block.inlineStyleRanges) {
    const style = r.style.toLowerCase();
    if (style !== "bold" && style !== "italic") continue;
    const [start, end] = range(r.offset, r.length);
    spans.push({ start, end, kind: style });
  }
  for (const r of block.entityRanges) {
    const entity = article.entities.get(String(r.key));
    const href = entity?.type === "LINK" ? entity.data.url : undefined;
    if (typeof href !== "string") continue;
    const [start, end] = range(r.offset, r.length);
    spans.push({ start, end, kind: "link", href });
  }
  return renderInline(block.text, spans).trim().replace(/\n/g, "<br/>");
}

function renderAtomic(block: DraftBlock, article: XArticle): string | undefined {
  const key = block.entityRanges[0]?.key;
  const entity = key === undefined ? undefined : article.entities.get(String(key));
  switch (entity?.type) {
    case "DIVIDER":
      return "<hr/>";
    case "MEDIA": {
      const items = (entity.data.mediaItems as { mediaId?: string }[] | undefined) ?? [];
      const imgs = items
        .map((item) => (item.mediaId ? article.media.get(item.mediaId) : undefined))
        .filter((src): src is string => !!src)
        .map((src) => `<figure><img src="${escapeXml(src)}" alt=""/></figure>`);
      return imgs.join("\n") || undefined;
    }
    case "MARKDOWN": {
      const markdown = typeof entity.data.markdown === "string" ? entity.data.markdown : "";
      const code = markdown.replace(/^\s*```[^\n]*\n?/, "").replace(/\n?```\s*$/, "");
      return `<pre><code>${escapeXml(code)}</code></pre>`;
    }
    default:
      return undefined;
  }
}
