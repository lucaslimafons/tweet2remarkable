import { describe, expect, it } from "vitest";
import { codePointRangeToUtf16, escapeXml, renderInline, renderParagraphs } from "../src/convert/richtext.ts";

describe("codePointRangeToUtf16", () => {
  it("accounts for astral characters", () => {
    const text = "a😀b😀c";
    expect(codePointRangeToUtf16(text, 2, 4)).toEqual([3, 6]); // "b😀"
    expect(text.slice(3, 6)).toBe("b😀");
  });

  it("is the identity for BMP-only text and clamps past the end", () => {
    expect(codePointRangeToUtf16("hello", 1, 3)).toEqual([1, 3]);
    expect(codePointRangeToUtf16("hi", 1, 10)).toEqual([1, 2]);
  });
});

describe("renderInline", () => {
  it("nests overlapping bold/italic and replaces link text with its display", () => {
    const text = "see https://t.co/x now";
    const html = renderInline(text, [
      { start: 0, end: 22, kind: "bold" },
      { start: 4, end: 18, kind: "link", href: "https://a.com/?q=1&r=2", display: "https://a.com/?q=1&r=2" },
    ]);
    expect(html).toBe(
      '<strong>see </strong><strong><a href="https://a.com/?q=1&amp;r=2">https://a.com/?q=1&amp;r=2</a></strong><strong> now</strong>',
    );
  });

  it("never puts a newline inside a tag", () => {
    expect(renderInline("one\ntwo", [{ start: 0, end: 7, kind: "italic" }])).toBe("<em>one</em>\n<em>two</em>");
  });

  it("escapes markup and strips characters XML forbids", () => {
    expect(escapeXml('<b>"&"</b>\u0007')).toBe("&lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;");
  });
});

describe("renderParagraphs", () => {
  it("splits on blank lines and keeps single breaks", () => {
    expect(renderParagraphs("a\nb\n\n\nc")).toBe("<p>a<br/>b</p>\n<p>c</p>");
  });
});
