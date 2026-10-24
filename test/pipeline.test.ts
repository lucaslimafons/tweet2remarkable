import { readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { processUrl, type PipelineDeps } from "../src/pipeline.ts";
import type { Fetched } from "../src/resolve/download.ts";
import { XResolveError, type XResolver } from "../src/resolve/x.ts";
import { EXAMPLES, PNG, post } from "./helpers.ts";

function setup(pages: Record<string, Fetched["kind"] | Error> = {}, resolver?: XResolver) {
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
      const page = pages[url] ?? "other";
      if (page instanceof Error) throw page;
      if (page === "pdf") {
        const path = `${dir}/${basename(new URL(url).pathname)}.pdf`;
        await writeFile(path, "%PDF-1.4");
        return { kind: "pdf", path, title: basename(path, ".pdf"), finalUrl: url };
      }
      return { kind: "other", contentType: "text/html", finalUrl: url };
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
  it("rejects a web page for now", async () => {
    const { deps } = setup();
    const result = await processUrl("https://example.com/post", deps);
    expect(result.failed[0]!.error).toBe("Not a PDF (text/html). Web articles aren't supported yet.");
  });
});
