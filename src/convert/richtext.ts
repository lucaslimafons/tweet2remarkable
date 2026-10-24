// Plain text + styled ranges → XHTML fragments (EPUB content must be well-formed XML).

/** A styled range in UTF-16 units [start, end), the way JS strings index. */
export type Span =
  | { start: number; end: number; kind: "bold" | "italic" }
  | { start: number; end: number; kind: "link"; href: string; display?: string };

// XML 1.0 forbids most control characters even when escaped.
const INVALID_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

export function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Converts a [start, end) range counted in code points into UTF-16 indexes into `text`. */
export function codePointRangeToUtf16(text: string, start: number, end: number): [number, number] {
  let cp = 0;
  let from = text.length;
  let to = text.length;
  for (let i = 0; i <= text.length; ) {
    if (cp === start) from = i;
    if (cp === end) {
      to = i;
      break;
    }
    if (i === text.length) break;
    i += (text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
    cp++;
  }
  return [Math.min(from, to), to];
}

/**
 * Inline XHTML for `text`. Newlines are kept as "\n" and never end up inside a tag, so callers can
 * split the result into paragraphs. A link span replaces its text with `display` (e.g. t.co → real URL).
 */
export function renderInline(text: string, spans: readonly Span[]): string {
  const clamp = (n: number) => Math.max(0, Math.min(text.length, n));
  const valid = spans
    .map((s) => ({ ...s, start: clamp(s.start), end: clamp(s.end) }))
    .filter((s) => s.end > s.start);
  const links = valid.filter((s) => s.kind === "link");
  const styles = valid.filter((s) => s.kind !== "link");

  const cuts = new Set([0, text.length]);
  for (const s of valid) cuts.add(s.start).add(s.end);
  const points = [...cuts].sort((a, b) => a - b);

  let out = "";
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i]!, points[i + 1]!];
    const active = styles.filter((s) => s.start <= a && a < s.end).map((s) => s.kind);
    const link = links.find((l) => l.start <= a && a < l.end);
    if (link) {
      if (a === link.start) {
        const label = link.display ?? text.slice(link.start, link.end);
        out += wrap(`<a href="${escapeXml(link.href)}">${escapeXml(label)}</a>`, active);
      }
      continue;
    }
    for (const piece of text.slice(a, b).split(/(\n)/)) {
      out += piece === "\n" || piece === "" ? piece : wrap(escapeXml(piece), active);
    }
  }
  return out;
}

/** Text with blank-line paragraph breaks → <p> elements; single newlines become <br/>. */
export function renderParagraphs(text: string, spans: readonly Span[] = []): string {
  return renderInline(text, spans)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

function wrap(html: string, kinds: readonly string[]): string {
  let out = html;
  if (kinds.includes("italic")) out = `<em>${out}</em>`;
  if (kinds.includes("bold")) out = `<strong>${out}</strong>`;
  return out;
}
