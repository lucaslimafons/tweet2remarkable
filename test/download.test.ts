import { createServer, type Server } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fetchDocument } from "../src/resolve/download.ts";

let server: Server;
let base: string;
let dir: string;
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

beforeAll(async () => {
  server = createServer((req, res) => {
    switch (req.url) {
      case "/redirect":
        res.writeHead(302, { location: "/files/My%20Paper.pdf" }).end();
        break;
      case "/files/My%20Paper.pdf":
        res.writeHead(200, { "content-type": "application/octet-stream" }).end(PDF);
        break;
      case "/download":
        res
          .writeHead(200, { "content-type": "application/pdf", "content-disposition": `attachment; filename="Report: Q3.pdf"` })
          .end(PDF);
        break;
      case "/article":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<html></html>");
        break;
      case "/fake.pdf":
        res.writeHead(200, { "content-type": "application/pdf" }).end("<html>login</html>");
        break;
      case "/big.pdf":
        res.writeHead(200, { "content-type": "application/pdf", "content-length": String(10 * 1024 * 1024) });
        res.end();
        break;
      case "/stream.pdf":
        res.writeHead(200, { "content-type": "application/pdf" }).end(Buffer.concat([PDF, Buffer.alloc(4096)]));
        break;
      case "/slow.pdf":
        res.writeHead(200, { "content-type": "application/pdf" });
        res.write(PDF); // never ends
        break;
      default:
        res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "t2rm-dl-"));
});

const opts = () => ({ dir, maxBytes: 1024 * 1024, timeoutMs: 2000 });

describe("fetchDocument", () => {
  it("follows redirects and names the file from the URL", async () => {
    const result = await fetchDocument(`${base}/redirect`, opts());
    expect(result).toMatchObject({ kind: "pdf", title: "My Paper", finalUrl: `${base}/files/My%20Paper.pdf` });
    if (result.kind === "pdf") expect(await readFile(result.path)).toEqual(PDF);
  });

  it("prefers content-disposition and sanitizes it", async () => {
    expect(await fetchDocument(`${base}/download`, opts())).toMatchObject({ kind: "pdf", title: "Report- Q3" });
  });

  it("reports HTML without downloading it", async () => {
    expect(await fetchDocument(`${base}/article`, opts())).toEqual({
      kind: "other",
      contentType: "text/html",
      finalUrl: `${base}/article`,
    });
  });

  it("rejects a 'PDF' that is really HTML", async () => {
    await expect(fetchDocument(`${base}/fake.pdf`, opts())).rejects.toThrow("not a PDF");
  });

  it("rejects by content-length before downloading", async () => {
    await expect(fetchDocument(`${base}/big.pdf`, opts())).rejects.toThrow("file is 10 MB, over the 1 MB limit");
  });

  it("enforces the limit while streaming", async () => {
    await expect(fetchDocument(`${base}/stream.pdf`, { ...opts(), maxBytes: 1024 })).rejects.toThrow("over the");
  });

  it("times out a body that never finishes", async () => {
    await expect(fetchDocument(`${base}/slow.pdf`, { ...opts(), timeoutMs: 300 })).rejects.toThrow("timed out after 0.3s");
  });

  it("reports HTTP errors", async () => {
    await expect(fetchDocument(`${base}/missing`, opts())).rejects.toThrow("HTTP 404 from 127.0.0.1");
  });
});
