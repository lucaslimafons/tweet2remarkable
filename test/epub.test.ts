import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildEpub } from "../src/convert/epub.ts";
import { documentTitle, postDocument } from "../src/convert/post.ts";
import { EXAMPLES, parseXml, PNG, post } from "./helpers.ts";

const okImages = async () => ({ data: PNG, mediaType: "image/png" });

describe("postDocument", () => {
  it("titles a long post by its first line, and a bare article share by the article", () => {
    expect(documentTitle(post(EXAMPLES.shopifyQuotingArticle))).toBe(
      "Shopify just published the internal setup behind its AI agent. The one that got 7x faster…",
    );
    expect(documentTitle(post(EXAMPLES.articlePost))).toMatch(/^How to Design an Agent Harness/);
  });

  it("puts the post first and the quoted article second", () => {
    const doc = postDocument(post(EXAMPLES.harnessQuotingArticle));
    expect(doc.chapters.map((c) => c.title)).toEqual([
      "Post by @0xCodila",
      "Loop Engineering: The Karpathy Method - and the workflow that just made it 5x better",
    ]);
    expect(doc.author).toBe("codila");
  });

  it("skips the post chapter when the post is only a link to its article", () => {
    expect(postDocument(post(EXAMPLES.articlePost)).chapters).toHaveLength(1);
  });

  it("lists the external links of a post", () => {
    expect(postDocument(post(EXAMPLES.ragWithArxivLink)).chapters[0]!.html).toContain(
      '<li><a href="https://arxiv.org/abs/2610.30755">https://arxiv.org/abs/2610.30755</a></li>',
    );
  });
});

describe("buildEpub", () => {
  it("produces a valid-looking EPUB for every example", async () => {
    for (const id of Object.values(EXAMPLES)) {
      const zip = await buildEpub(postDocument(post(id)), { fetchImage: okImages });

      // OCF: first entry is an uncompressed "mimetype".
      const view = new DataView(zip.buffer, zip.byteOffset);
      expect(view.getUint16(8, true)).toBe(0);
      expect(strFromU8(zip.subarray(30, 38))).toBe("mimetype");

      const files = unzipSync(zip);
      expect(strFromU8(files.mimetype!)).toBe("application/epub+zip");
      const opf = parseXml(strFromU8(files["OEBPS/content.opf"]!));
      parseXml(strFromU8(files["OEBPS/toc.ncx"]!));
      parseXml(strFromU8(files["META-INF/container.xml"]!));

      const hrefs = [...opf.querySelectorAll("manifest > item")].map((i) => i.getAttribute("href")!);
      for (const href of hrefs) expect(files[`OEBPS/${href}`], href).toBeDefined();

      for (const name of Object.keys(files).filter((f) => f.endsWith(".xhtml"))) {
        const doc = parseXml(strFromU8(files[name]!), "application/xhtml+xml");
        for (const img of doc.querySelectorAll("img")) {
          expect(hrefs).toContain(img.getAttribute("src"));
        }
      }
    }
  });

  it("falls back to a link when an image can't be fetched", async () => {
    const zip = await buildEpub(
      { title: "T", author: "A", lang: "en", chapters: [{ title: "C", html: '<figure><img src="https://x/a.png?x=1&amp;y=2" alt=""/></figure>' }] },
      { fetchImage: async () => Promise.reject(new Error("HTTP 404")) },
    );
    const chapter = strFromU8(unzipSync(zip)["OEBPS/chapter-1.xhtml"]!);
    expect(chapter).toContain('<a href="https://x/a.png?x=1&amp;y=2">[image]</a>');
    parseXml(chapter, "application/xhtml+xml");
  });

  it("embeds each distinct image once and fetches it with the unescaped URL", async () => {
    const fetched: string[] = [];
    const html = '<img src="https://x/a.png?x=1&amp;y=2" alt=""/><img src="https://x/a.png?x=1&amp;y=2" alt=""/>';
    const files = unzipSync(
      await buildEpub(
        { title: "T", author: "A", lang: "en", chapters: [{ title: "C", html }] },
        { fetchImage: async (u) => (fetched.push(u), okImages()) },
      ),
    );
    expect(fetched).toEqual(["https://x/a.png?x=1&y=2"]);
    expect(Object.keys(files).filter((f) => f.startsWith("OEBPS/images/"))).toEqual(["OEBPS/images/img-1.png"]);
  });
});
