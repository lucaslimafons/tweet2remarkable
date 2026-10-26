// Minimal EPUB 3 writer (with an EPUB 2 toc.ncx for older readers).
// Chapters are XHTML body fragments; remote <img src> are downloaded and embedded.
import { randomUUID } from "node:crypto";
import { strToU8, zipSync, type Zippable } from "fflate";
import { escapeXml } from "./richtext.ts";

export interface EpubChapter {
  title: string;
  /** Well-formed XHTML body content. */
  html: string;
}

export interface EpubDocument {
  title: string;
  author: string;
  lang: string;
  sourceUrl?: string;
  chapters: EpubChapter[];
}

export interface FetchedImage {
  data: Uint8Array;
  mediaType: string;
}

export interface EpubOptions {
  fetchImage: (url: string) => Promise<FetchedImage>;
  maxImages?: number;
  concurrency?: number;
}

const IMAGE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif" };
const IMG_TAG = /<img src="([^"]+)"([^>]*)\/>/g;

export async function buildEpub(doc: EpubDocument, { fetchImage, maxImages = 40, concurrency = 4 }: EpubOptions): Promise<Uint8Array> {
  const sources = [...new Set(doc.chapters.flatMap((c) => [...c.html.matchAll(IMG_TAG)].map((m) => m[1]!)))].slice(0, maxImages);
  const images = await embedImages(sources, fetchImage, concurrency);

  const chapters = doc.chapters.map((chapter, i) => ({
    ...chapter,
    file: `chapter-${i + 1}.xhtml`,
    html: chapter.html.replace(IMG_TAG, (_tag, src: string, rest: string) => {
      const image = images.get(src);
      // Missing image (failed, unsupported or over the cap): keep a link so nothing silently disappears.
      return image ? `<img src="${image.file}"${rest}/>` : `<a href="${src}">[image]</a>`;
    }),
  }));

  const id = `urn:uuid:${randomUUID()}`;
  const files: Zippable = {
    // Must be the first entry and stored uncompressed (EPUB OCF).
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(CONTAINER),
    "OEBPS/content.opf": strToU8(contentOpf(doc, id, chapters, [...images.values()])),
    "OEBPS/nav.xhtml": strToU8(navXhtml(doc, chapters)),
    "OEBPS/toc.ncx": strToU8(tocNcx(doc, id, chapters)),
    "OEBPS/style.css": strToU8(STYLE),
  };
  for (const chapter of chapters) files[`OEBPS/${chapter.file}`] = strToU8(page(doc.lang, chapter.title, chapter.html));
  for (const image of images.values()) files[`OEBPS/${image.file}`] = [image.data, { level: 0 }];
  return zipSync(files, { level: 6 });
}

interface EmbeddedImage {
  file: string;
  id: string;
  mediaType: string;
  data: Uint8Array;
}

async function embedImages(
  sources: string[],
  fetchImage: EpubOptions["fetchImage"],
  concurrency: number,
): Promise<Map<string, EmbeddedImage>> {
  const results = new Map<string, EmbeddedImage>();
  let next = 0;
  async function worker() {
    while (next < sources.length) {
      const index = next++;
      const src = sources[index]!;
      try {
        const { data, mediaType } = await fetchImage(unescapeXml(src));
        const ext = IMAGE_EXT[mediaType];
        if (ext) results.set(src, { file: `images/img-${index + 1}.${ext}`, id: `img-${index + 1}`, mediaType, data });
      } catch {
        // Left out; the chapter falls back to a link.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
  return results;
}

function unescapeXml(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

const STYLE = `body { font-family: serif; line-height: 1.5; margin: 0 1em; }
h1 { font-size: 1.5em; line-height: 1.25; margin: 1em 0 0.25em; }
h2 { font-size: 1.25em; margin-top: 1.5em; }
h3 { font-size: 1.1em; margin-top: 1.25em; }
p { margin: 0 0 0.8em; }
.meta { font-size: 0.85em; color: #555; margin-bottom: 1.25em; }
.note { font-style: italic; }
figure { margin: 1em 0; text-align: center; }
img { max-width: 100%; height: auto; }
blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #999; }
pre { white-space: pre-wrap; font-family: monospace; font-size: 0.85em; background: #f2f2f2; padding: 0.6em; }
ul.links li { word-break: break-all; }
`;

type Chapter = EpubChapter & { file: string };

function page(lang: string, title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head>
<meta charset="UTF-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<section>
${body}
</section>
</body>
</html>
`;
}

function contentOpf(doc: EpubDocument, id: string, chapters: Chapter[], images: EmbeddedImage[]): string {
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${doc.lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${id}</dc:identifier>
    <dc:title>${escapeXml(doc.title)}</dc:title>
    <dc:creator>${escapeXml(doc.author)}</dc:creator>
    <dc:language>${doc.lang}</dc:language>
${doc.sourceUrl ? `    <dc:source>${escapeXml(doc.sourceUrl)}</dc:source>\n` : ""}    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
${chapters.map((c, i) => `    <item id="chapter-${i + 1}" href="${c.file}" media-type="application/xhtml+xml"/>`).join("\n")}
${images.map((img) => `    <item id="${img.id}" href="${img.file}" media-type="${img.mediaType}"/>`).join("\n")}
  </manifest>
  <spine toc="ncx">
${chapters.map((_, i) => `    <itemref idref="chapter-${i + 1}"/>`).join("\n")}
  </spine>
</package>
`;
}

function navXhtml(doc: EpubDocument, chapters: Chapter[]): string {
  const items = chapters.map((c) => `<li><a href="${c.file}">${escapeXml(c.title)}</a></li>`).join("\n");
  return page(doc.lang, doc.title, `<nav epub:type="toc" id="toc">\n<h1>Contents</h1>\n<ol>\n${items}\n</ol>\n</nav>`);
}

function tocNcx(doc: EpubDocument, id: string, chapters: Chapter[]): string {
  const points = chapters
    .map(
      (c, i) => `    <navPoint id="nav-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(c.title)}</text></navLabel>
      <content src="${c.file}"/>
    </navPoint>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${id}"/></head>
  <docTitle><text>${escapeXml(doc.title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`;
}
