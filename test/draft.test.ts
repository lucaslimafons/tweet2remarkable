import { describe, expect, it } from "vitest";
import { renderArticle } from "../src/convert/draft.ts";
import type { XArticle } from "../src/resolve/x.ts";
import { EXAMPLES, parseXml, post } from "./helpers.ts";

const wellFormed = (html: string) => parseXml(`<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`, "application/xhtml+xml");

function article(blocks: XArticle["blocks"], entities: [string, string, Record<string, unknown>][] = []): XArticle {
  return {
    id: "1",
    title: "T",
    blocks,
    entities: new Map(entities.map(([key, type, data]) => [key, { type, data }])),
    media: new Map([["m1", "https://pbs.twimg.com/media/a.png"]]),
  };
}
const block = (type: string, text: string, extra: Partial<XArticle["blocks"][number]> = {}) => ({
  type,
  text,
  inlineStyleRanges: [],
  entityRanges: [],
  ...extra,
});

describe("renderArticle", () => {
  it("renders headings, grouped lists, quotes, links, media, dividers and code", () => {
    const html = renderArticle(
      article(
        [
          block("header-one", "Intro"),
          block("unstyled", "Hello 😀 world", {
            inlineStyleRanges: [{ offset: 8, length: 5, style: "Bold" }],
            entityRanges: [{ offset: 0, length: 5, key: 2 }],
          }),
          block("unordered-list-item", "one"),
          block("unordered-list-item", "two"),
          block("blockquote", "quoted"),
          block("atomic", " ", { entityRanges: [{ offset: 0, length: 1, key: 0 }] }),
          block("atomic", " ", { entityRanges: [{ offset: 0, length: 1, key: 1 }] }),
          block("atomic", " ", { entityRanges: [{ offset: 0, length: 1, key: 3 }] }),
          block("unstyled", ""),
        ],
        [
          ["0", "MEDIA", { mediaItems: [{ mediaId: "m1" }] }],
          ["1", "DIVIDER", {}],
          ["2", "LINK", { url: "https://example.com" }],
          ["3", "MARKDOWN", { markdown: "```\nx < y\n```" }],
        ],
      ),
    );
    expect(html).toBe(
      [
        "<h2>Intro</h2>",
        '<p><a href="https://example.com">Hello</a> 😀 <strong>world</strong></p>',
        "<ul>",
        "<li>one</li>",
        "<li>two</li>",
        "</ul>",
        "<blockquote><p>quoted</p></blockquote>",
        '<figure><img src="https://pbs.twimg.com/media/a.png" alt=""/></figure>',
        "<hr/>",
        "<pre><code>x &lt; y</code></pre>",
      ].join("\n"),
    );
    wellFormed(html);
  });

  it("renders both real example articles to well-formed XHTML with their images", () => {
    for (const id of [EXAMPLES.shopifyQuotingArticle, EXAMPLES.harnessQuotingArticle]) {
      const a = post(id).quote!.article!;
      const html = renderArticle(a);
      wellFormed(html);
      expect(html.match(/<img /g)?.length).toBeGreaterThan(0);
      expect(html).not.toContain("undefined");
    }
  });
});
