import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArticleError, articleDocument, extractArticle, unwrapImageProxy } from "../src/convert/article.ts";
import { parseXml } from "./helpers.ts";

const html = (name: string) => readFileSync(join(import.meta.dirname, "fixtures/html", name), "utf8");
const URL_ = "https://blog.example.com/posts/plain-rag";

describe("extractArticle", () => {
  const article = extractArticle(html("blog.html"), URL_);

  it("finds title, byline, site and language", () => {
    expect(article).toMatchObject({
      title: "Why Plain RAG Still Wins",
      byline: "By Ada Example",
      siteName: "Example Engineering",
      lang: "en",
      url: URL_,
    });
  });

  it("keeps the article and drops page chrome", () => {
    expect(article.html).toContain("<h2>The setup</h2>");
    expect(article.html).toContain("<strong>why plain dense retrieval</strong>");
    for (const junk of ["Subscribe", "Buy our course", "Related:", "© Example", "<nav", "<form", "<iframe", "<script"]) {
      expect(article.html).not.toContain(junk);
    }
    // The page's own <h1> repeats the title, which the chapter already prints.
    expect(article.html).not.toContain("Why Plain RAG Still Wins");
  });

  it("makes links and lazy images absolute and strips unsafe URLs and attributes", () => {
    expect(article.html).toContain('<a href="https://blog.example.com/benchmarks#locomo">LoCoMo</a>');
    expect(article.html).toContain('<img src="https://blog.example.com/img/results.png" alt="Results chart"/>');
    expect(article.html).toContain('<img src="https://blog.example.com/img/diagram.jpg" alt="Diagram"/>');
    expect(article.html).not.toMatch(/javascript:|onclick|data:image|class=/);
    expect(article.html).toContain("<th colspan=\"2\">Score</th>");
    expect(article.html).toContain("retrieve(history, query) |&gt; rerank");
  });

  it("unwraps Next.js image proxy URLs to the original file", () => {
    expect(unwrapImageProxy("https://www.anthropic.com/_next/image?url=https%3A%2F%2Fcdn.example%2Fa.jpg&w=1920&q=75")).toBe(
      "https://cdn.example/a.jpg",
    );
    expect(unwrapImageProxy("https://site.example/_next/image?url=%2Fimg%2Fb.png&w=64")).toBe("https://site.example/img/b.png");
    expect(unwrapImageProxy("https://cdn.example/c.png")).toBe("https://cdn.example/c.png");
  });

  it("produces well-formed XHTML", () => {
    parseXml(`<div xmlns="http://www.w3.org/1999/xhtml">${article.html}</div>`, "application/xhtml+xml");
  });

  it("turns into a one-chapter document credited to the author", () => {
    const doc = articleDocument(article);
    expect(doc).toMatchObject({ title: "Why Plain RAG Still Wins", author: "By Ada Example", lang: "en", sourceUrl: URL_ });
    expect(doc.chapters[0]!.html).toMatch(/^<h1>Why Plain RAG Still Wins<\/h1>\n<p class="meta">By Ada Example · Example Engineering · <a href="https:\/\/blog.example.com\/posts\/plain-rag">original<\/a><\/p>/);
  });

  it("fails clearly on a paywalled or JavaScript-only page", () => {
    expect(() => extractArticle(html("paywall.html"), "https://paper.example/story")).toThrow(ArticleError);
    expect(() => extractArticle("<html><body><div id=root></div><script src=app.js></script></body></html>", "https://app.example/")).toThrow(
      "couldn't find an article on this page (paywall, login or JavaScript-only?)",
    );
  });
});
