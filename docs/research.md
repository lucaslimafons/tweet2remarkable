# Research notes (2026-10-24)

What was verified before writing code, so later phases start from facts rather than assumptions.

## fxtwitter (`https://api.fxtwitter.com/status/<id>`)

Checked against the three real example posts saved in `test/fixtures/fxtwitter/`.

| Post | What it is | Where the content lives |
|---|---|---|
| `2113689331412156666` (@undefinedKi) | Long post + image, quoting an **X Article** | `tweet.text`, `tweet.media.photos`, `tweet.quote.article` |
| `2113635562578178147` (@omarsar0) | Long post + image linking an arXiv paper | `tweet.raw_text.facets[type=url].replacement` → `arxiv.org/abs/…` |
| `2106451735715737913` (@0xCodila) | Long post (bold/italic) + image, quoting an **X Article** | same as the first; the "15-page PDF" it mentions is not linked anywhere |

- **Expanded links** are in `tweet.raw_text.facets` with `type: "url"` and the real URL in `replacement`
  (the public wiki doesn't document this). `tweet.text` already has t.co links expanded.
- **Long posts** (`is_note_tweet: true`) come back in full.
- **X Articles** come back complete under `quote.article` (or `article` when the article post itself is shared):
  `title`, `preview_text`, `cover_media`, `media_entities`, and `content` in **Draft.js** format
  (`blocks` + `entityMap`).
  - Block types seen: `unstyled`, `header-one`, `header-two`, `unordered-list-item`, `blockquote`, `atomic`.
  - Inline styles: `Bold`, `Italic`.
  - Entities (`entityMap` is a list of `{key, value}`; `entityRanges[].key` matches `key`):
    `LINK` (`data.url`), `MEDIA` (`data.mediaItems[].mediaId` → `media_entities[].media_info.original_img_url`),
    `DIVIDER`, `MARKDOWN` (`data.markdown`, fenced code).
  - That's everything needed to render the article (with images) into an EPUB without scraping x.com.
- **Sharing the article's own post** (`2088611136027361368`): the article is at `tweet.article` and the post text
  is just the `x.com/i/article/…` link.
- **Offsets:** `raw_text.facets[].indices` are passed through from X: **code points** for long ("note") posts,
  **UTF-16 units** for regular posts (per fxtwitter's `twitter-text-indices.ts`). Draft.js ranges in articles are
  code points. Both are converted to UTF-16 before rendering.
- `bold`/`italic`/`url` facet indices are accurate; `media` facet indices are stale (they point at `pic.x.com`
  links fxtwitter already removed from the text) and are ignored.
- **Threads:** there is no thread/conversation field, only `replying_to_status` (the parent). None of the examples
  is a thread; still unverified.
- Quoted posts are nested full objects (`tweet.quote`).
- Not rate-limited officially, but the maintainers ask for an identifying User-Agent and may block floods.

## rmapi (`ddvk/rmapi` v0.0.35, 2026-08-19)

From the v0.0.35 source and the real binary:

- `-ni` disables the one-time-code prompt; unpaired → `missing token, not asking, aborting`, exit 1.
- Command errors exit 1 (ishell returns the command's error to `main`).
- `put` without flags fails with `entry already exists …` on a name clash. `--force` recreates the document and
  **drops annotations**; `--content-only` swaps the PDF and keeps them.
- `mkdir` on an existing path prints `entry already exists` and exits 0; the parent must exist.
- The config stores a long-lived `devicetoken`; `usertoken` is re-derived from it on each run, so a read-only
  secret copied to a writable path is fine.
- Release checksums match GitHub's published asset digests (pinned in `scripts/install-rmapi.sh`).

## Web articles (phase 3, 2026-10-26)

Checked with `pnpm preview` against Paul Graham, Anthropic, Joel on Software, Dan Luu and the dair.ai page from the
@omarsar0 post; all EPUBs pass EPUBCheck 5.4.0 with 0 errors / 0 warnings.

- **Next.js image proxy** (`/_next/image?url=…`, e.g. anthropic.com) returns WebP even with
  `Accept: image/png,image/jpeg` (it sends `Vary: Accept` but ignores it). The sanitizer unwraps the `url` param to
  the original JPEG/PNG. WebP is allowed by EPUB 3.3 but not embedded, since reMarkable support is unconfirmed.
- Readability returns *something* for almost any page, so a result under 500 characters of text (or under 1000 when
  `isProbablyReaderable` says no) is treated as "no article" — paywalls, login walls and JS-only app shells
  (e.g. an x.com profile) fail with a clear message instead of an empty EPUB.
- Some sites expose a junk byline (Joel on Software: "About the author."); it only affects the meta line.

## Hosting (for later)

Northflank Sandbox fits (always on, no sleep, Dockerfile deploys, secret files, nf-compute-20 = 0.2 vCPU /
512 MiB ≈ $5.40/mo inside the $20/mo allowance). Unconfirmed: whether a card is required (pricing page says no,
docs say every user must add one for verification), which plans/regions free projects may use, build-minute
limits. Runner-up: Oracle Always Free (idle reclamation risk unless upgraded to pay-as-you-go).
