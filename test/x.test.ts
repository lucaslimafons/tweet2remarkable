import { describe, expect, it } from "vitest";
import { parseFxTweet } from "../src/resolve/x.ts";
import { EXAMPLES, fixture, post } from "./helpers.ts";

describe("parseFxTweet (real examples)", () => {
  it("long post linking an arXiv paper: expanded external links, photo, no article", () => {
    const p = post(EXAMPLES.ragWithArxivLink);
    expect(p.author.handle).toBe("omarsar0");
    expect(p.links).toEqual([
      "https://arxiv.org/abs/2610.30755",
      "https://academy.dair.ai/papers/is-complex-agentic-memory-always-needed-naive-rag-is-stronger-than-we-thought-2610.30755",
    ]);
    expect(p.photos).toEqual(["https://pbs.twimg.com/media/HVUkV3ubMAENLbG.jpg?name=orig"]);
    expect(p.article).toBeUndefined();
    // Link spans cover exactly the t.co text they replace.
    for (const span of p.spans.filter((s) => s.kind === "link")) {
      expect(p.text.slice(span.start, span.end)).toMatch(/^https:\/\/t\.co\//);
    }
  });

  it("post quoting an X Article: article comes from the quote, x.com links are not external", () => {
    const p = post(EXAMPLES.shopifyQuotingArticle);
    expect(p.article).toBeUndefined();
    expect(p.links).toEqual([]);
    expect(p.quote?.article?.title).toBe(
      "How to Design an Agent Harness: six decisions that turn a model into a worker you can leave alone",
    );
    expect(p.quote?.links).toEqual([]);
    expect(p.quote?.article?.media.size).toBeGreaterThan(0);
  });

  it("bold and italic facets land on the right text", () => {
    const p = post(EXAMPLES.harnessQuotingArticle);
    const styled = p.spans.filter((s) => s.kind !== "link").map((s) => p.text.slice(s.start, s.end));
    expect(styled[0]).toMatch(/^NVIDIA and MIT researchers/);
    expect(styled[1]).toBe("The shift:");
  });

  it("the article post itself carries the article at the top level", () => {
    const p = post(EXAMPLES.articlePost);
    expect(p.article?.title).toMatch(/^How to Design an Agent Harness/);
    expect(p.article?.blocks.length).toBeGreaterThan(10);
  });

  it("maps note-post facets from code points to UTF-16 (emoji before a link)", () => {
    const base = fixture(EXAMPLES.ragWithArxivLink);
    const text = "🚀🚀 read https://t.co/abc now";
    const p = parseFxTweet({
      ...base,
      quote: undefined,
      is_note_tweet: true,
      raw_text: {
        text,
        // Code points: each 🚀 counts once.
        facets: [{ type: "url", indices: [8, 24], original: "https://t.co/abc", replacement: "https://example.com/x.pdf" }],
      },
    });
    const span = p.spans[0]!;
    expect(text.slice(span.start, span.end)).toBe("https://t.co/abc");
    expect(p.links).toEqual(["https://example.com/x.pdf"]);
  });
});
