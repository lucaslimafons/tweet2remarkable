import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { parseFxTweet, type FxTweet, type XPost } from "../src/resolve/x.ts";

export function fixture(id: string): FxTweet {
  return JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/fxtwitter", `${id}.json`), "utf8")).tweet;
}

export const post = (id: string): XPost => parseFxTweet(fixture(id));

/** Example posts the bot was designed against (see docs/research.md). */
export const EXAMPLES = {
  shopifyQuotingArticle: "2113689331412156666",
  ragWithArxivLink: "2113635562578178147",
  harnessQuotingArticle: "2106451735715737913",
  articlePost: "2088611136027361368",
} as const;

/** Throws if `xml` isn't well-formed XML (EPUB content documents must be). */
export function parseXml(xml: string, contentType: "application/xhtml+xml" | "application/xml" = "application/xml"): Document {
  return new JSDOM(xml, { contentType }).window.document;
}

/** 1×1 transparent PNG. */
export const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"),
);
