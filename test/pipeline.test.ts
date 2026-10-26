import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { processUrl, type PipelineDeps } from "../src/pipeline.ts";
import { XResolveError, type XResolver } from "../src/resolve/x.ts";
import { EXAMPLES, PNG, post } from "./helpers.ts";

/** pdf: a PDF · blog/paywall: that HTML fixture · other: a zip · unlisted: plain text · Error: thrown. */
type Page = "pdf" | "blog" | "paywall" | "other" | Error;
const fixtureHtml = (name: string) => readFileSync(join(import.meta.dirname, "fixtures/html", `${name}.html`), "utf8");

function setup(pages: Record<string, Page> = {}, resolver?: XResolver) {
  const uploads: { name: string; ext: string; bytes: Buffer }[] = [];
  const fetched: string[] = [];
  const deps: PipelineDeps = {
    folder: "/Inbox",
    maxDownloadBytes: 1e6,
    x: resolver ?? { getPost: async (id) => post(id) },
    rmapi: {
      put: async (path) => {
        uploads.push({ name: basename(path, extname(path)), ext: extname(path), bytes: await readFile(path) });
        return basename(path, extname(path));
      },
      mkdirp: async () => {},
      version: async () => "test",
    },
    fetch: async (url, { dir }) => {
      fetched.push(url);
      const page = pages[url];
      if (page instanceof Error) throw page;
      if (page === "pdf") {
        const path = `${dir}/${basename(new URL(url).pathname)}.pdf`;
        await writeFile(path, "%PDF-1.4");
        return { kind: "pdf", path, title: basename(path, ".pdf"), finalUrl: url };
      }
      if (page === "blog" || page === "paywall") return { kind: "html", html: fixtureHtml(page), finalUrl: url };
      return { kind: "other", contentType: page === "other" ? "application/zip" : "text/plain", finalUrl: url };
    },
    fetchImage: async () => ({ data: PNG, mediaType: "image/png" }),
  };
  return { deps, uploads, fetched };
}

const xUrl = (id: string) => `https://x.com/someone/status/${id}?s=20`;

describe("processUrl with X posts", () => {
  it("post linking a paper: sends just the PDF (arXiv abs rewritten), not the post", async () => {
    const { deps, uploads, fetched } = setup({ "https://arxiv.org/pdf/2610.30755": "pdf" });
    const result = await processUrl(xUrl(EXAMPLES.ragWithArxivLink), deps);
    expect(fetched).toEqual([
      "https://arxiv.org/pdf/2610.30755",
      "https://academy.dair.ai/papers/is-complex-agentic-memory-always-needed-naive-rag-is-stronger-than-we-thought-2610.30755",
    ]);
    expect(result).toEqual({ url: xUrl(EXAMPLES.ragWithArxivLink), sent: ["2610.30755.pdf"], failed: [] });
    expect(uploads.map((u) => u.ext)).toEqual([".pdf"]);
  });

  it("post quoting an X Article: one EPUB with the post and the article", async () => {
    const { deps, uploads } = setup();
    const result = await processUrl(xUrl(EXAMPLES.harnessQuotingArticle), deps);
    expect(result.failed).toEqual([]);
    expect(result.sent).toHaveLength(1);
    expect(result.sent[0]).toMatch(/^NVIDIA and MIT researchers.*\.epub$/);
    const files = unzipSync(uploads[0]!.bytes);
    expect(Object.keys(files)).toContain("OEBPS/chapter-2.xhtml");
  });

  it("post whose links are all web pages still arrives, as an EPUB", async () => {
    const { deps, uploads } = setup();
    const result = await processUrl(xUrl(EXAMPLES.ragWithArxivLink), deps);
    expect(result.sent).toEqual([expect.stringMatching(/^RAG is so back!\.epub$/)]);
    expect(uploads[0]!.ext).toBe(".epub");
  });

  it("a failing link is reported but doesn't stop the post", async () => {
    const { deps } = setup({ "https://arxiv.org/pdf/2610.30755": new Error("HTTP 503 from arxiv.org") });
    const result = await processUrl(xUrl(EXAMPLES.ragWithArxivLink), deps);
    expect(result.failed).toEqual([{ what: "https://arxiv.org/abs/2610.30755", error: "HTTP 503 from arxiv.org" }]);
    expect(result.sent).toEqual(["RAG is so back!.epub"]);
  });

  it("reports a post that can't be read", async () => {
    const { deps } = setup({}, { getPost: async () => Promise.reject(new XResolveError("post not found (deleted?)")) });
    const result = await processUrl(xUrl("1"), deps);
    expect(result).toEqual({
      url: xUrl("1"),
      sent: [],
      failed: [{ what: xUrl("1"), error: "couldn't read the post: post not found (deleted?)" }],
    });
  });
});

describe("processUrl with plain links", () => {
  it("turns a web article into an EPUB named after it", async () => {
    const { deps, uploads } = setup({ "https://blog.example.com/plain-rag": "blog" });
    const result = await processUrl("https://blog.example.com/plain-rag", deps);
    expect(result).toEqual({ url: "https://blog.example.com/plain-rag", sent: ["Why Plain RAG Still Wins.epub"], failed: [] });
    const chapter = strFromU8(unzipSync(uploads[0]!.bytes)["OEBPS/chapter-1.xhtml"]!);
    expect(chapter).toContain("<h2>The setup</h2>");
    expect(chapter).toContain('src="images/img-1.png"');
  });

  it("explains an unreadable page instead of sending junk", async () => {
    const { deps, uploads } = setup({ "https://paper.example/story": "paywall" });
    const result = await processUrl("https://paper.example/story", deps);
    expect(result.failed).toEqual([
      { what: "https://paper.example/story", error: "couldn't find an article on this page (paywall, login or JavaScript-only?)" },
    ]);
    expect(uploads).toEqual([]);
  });

  it("rejects other content types", async () => {
    const { deps } = setup({ "https://example.com/a.zip": "other" });
    const result = await processUrl("https://example.com/a.zip", deps);
    expect(result.failed[0]!.error).toBe("Not a PDF or a web page (application/zip).");
  });
});

describe("processUrl with X posts linking web articles", () => {
  it("appends a readable linked page to the post's EPUB and skips unreadable ones", async () => {
    const shortPost = { ...post(EXAMPLES.ragWithArxivLink), text: "Worth a read https://t.co/a https://t.co/b", spans: [] };
    shortPost.links = ["https://blog.example.com/plain-rag", "https://paper.example/story"];
    const { deps, uploads } = setup(
      { "https://blog.example.com/plain-rag": "blog", "https://paper.example/story": "paywall" },
      { getPost: async () => shortPost },
    );
    const result = await processUrl(xUrl("1"), deps);
    // Short comment + one readable article: the article names the document.
    expect(result).toEqual({ url: xUrl("1"), sent: ["Why Plain RAG Still Wins.epub"], failed: [] });
    const files = unzipSync(uploads[0]!.bytes);
    expect(strFromU8(files["OEBPS/chapter-1.xhtml"]!)).toContain("Post by @omarsar0");
    expect(strFromU8(files["OEBPS/chapter-2.xhtml"]!)).toContain("<h1>Why Plain RAG Still Wins</h1>");
    expect(files["OEBPS/chapter-3.xhtml"]).toBeUndefined();
  });
});
