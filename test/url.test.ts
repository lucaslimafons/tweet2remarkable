import { describe, expect, it } from "vitest";
import { extractUrls, normalizeUrl, xStatusId } from "../src/resolve/url.ts";

describe("extractUrls", () => {
  it("reads url and text_link entities in order, deduplicated", () => {
    const text = "📄 see arxiv.org/abs/2610.30755 and this and https://arxiv.org/abs/2610.30755";
    const entities = [
      { type: "url", offset: text.indexOf("arxiv.org"), length: "arxiv.org/abs/2610.30755".length },
      { type: "text_link", offset: text.indexOf("this"), length: 4, url: "https://example.com/a.pdf" },
      { type: "url", offset: text.lastIndexOf("https"), length: "https://arxiv.org/abs/2610.30755".length },
      { type: "bold", offset: 0, length: 2 },
    ];
    expect(extractUrls(text, entities)).toEqual(["https://arxiv.org/abs/2610.30755", "https://example.com/a.pdf"]);
  });

  it("drops non-http schemes", () => {
    expect(extractUrls("x", [{ type: "text_link", offset: 0, length: 1, url: "tg://user?id=1" }])).toEqual([]);
  });
});

describe("normalizeUrl", () => {
  it.each([
    ["https://arxiv.org/abs/2610.30755", "https://arxiv.org/pdf/2610.30755"],
    ["https://www.arxiv.org/abs/2610.30755v2", "https://arxiv.org/pdf/2610.30755v2"],
    ["https://arxiv.org/pdf/2610.30755.pdf", "https://arxiv.org/pdf/2610.30755"],
    ["https://arxiv.org/html/2610.30755v1/", "https://arxiv.org/pdf/2610.30755v1"],
    [
      "https://drive.google.com/file/d/18f4SUfj-_RqV2FXhnryOkJvzhMiUaHP-/view?usp=sharing",
      "https://drive.usercontent.google.com/download?id=18f4SUfj-_RqV2FXhnryOkJvzhMiUaHP-&export=download&confirm=t",
    ],
    [
      "https://drive.google.com/open?id=abc_123&resourcekey=0-key",
      "https://drive.usercontent.google.com/download?id=abc_123&export=download&confirm=t&resourcekey=0-key",
    ],
    ["https://drive.google.com/uc?id=abc&export=download", "https://drive.usercontent.google.com/download?id=abc&export=download&confirm=t"],
    ["https://drive.google.com/drive/folders/abc", "https://drive.google.com/drive/folders/abc"],
    ["https://example.com/x.pdf", "https://example.com/x.pdf"],
  ])("%s → %s", (input, expected) => expect(normalizeUrl(input)).toBe(expected));
});

describe("xStatusId", () => {
  it.each([
    ["https://x.com/omarsar0/status/2113635562578178147?s=46", "2113635562578178147"],
    ["https://twitter.com/a/status/20", "20"],
    ["https://mobile.x.com/i/web/status/123", "123"],
    ["https://x.com/omarsar0", undefined],
    ["https://example.com/a/status/1", undefined],
  ])("%s", (input, expected) => expect(xStatusId(input)).toBe(expected));
});
