# tweet2remarkable

A personal Telegram bot: share a link (or, soon, a post from X) to the bot from your phone's share sheet and it
lands on your reMarkable at the next sync. Single user by design.

**Status: phase 1.** Direct PDF links (arXiv abstract links are rewritten to the PDF). X posts, HTML articles → EPUB
and files sent to the bot come next.

## How it works

```
Telegram (long polling) → owner-only filter → links from message entities
  → download (redirects, 50 MB cap, %PDF- check, timeouts) → rmapi put → reply per link
```

Uploads go through [rmapi](https://github.com/ddvk/rmapi) (the maintained `ddvk` fork), pinned to a fixed release and
run with `-ni`, so it fails instead of hanging when it isn't paired. There is no official reMarkable API; rmapi is
reverse-engineered and can break, and upload errors are always reported in the chat.

## Setup (macOS or Linux)

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm rmapi:install        # pinned rmapi → ./bin/rmapi (checksum-verified)
cp .env.example .env
```

1. **Telegram bot:** create one with [@BotFather](https://t.me/BotFather) and put the token in `TELEGRAM_BOT_TOKEN`.
2. **Your chat id:** message [@userinfobot](https://t.me/userinfobot) and put your numeric id in `ALLOWED_CHAT_ID`.
   The bot refuses to start without it: anyone can find a bot's @, and this one writes to your tablet.
3. **Pair rmapi:** run `pnpm rmapi:pair`, open <https://my.remarkable.com/device/browser/connect>, paste the
   8-character code. The token is saved to `RMAPI_CONFIG` (default `./.secrets/rmapi.conf`). **That file is a
   secret: it grants access to your reMarkable cloud.** It is git-ignored; never commit it.

## Run

```sh
pnpm dev                                   # polling bot with reload
pnpm send https://arxiv.org/abs/2610.30755 # upload one link without Telegram
pnpm test
```

On start the bot checks that rmapi runs, is paired and that the destination folder exists, then starts polling.

## Configuration

| Variable | Default | |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | required | From @BotFather |
| `ALLOWED_CHAT_ID` | required | Only this chat is served; others are ignored silently |
| `REMARKABLE_FOLDER` | `/Inbox` | Created if missing |
| `RMAPI_CONFIG` | rmapi's default | Path to the rmapi auth file |
| `RMAPI_BIN` | `rmapi` | Path to the binary (`./bin/rmapi` after `rmapi:install`) |
| `MAX_DOWNLOAD_MB` | `50` | Larger files are refused |

## Notes

- Same-name documents aren't overwritten (that would wipe annotations); the upload gets a date suffix instead.
- rmapi only stores a long-lived device token in its config and derives a fresh user token on each run, so a
  read-only copy of the file (e.g. a mounted secret) works as long as `RMAPI_CONFIG` points to a writable copy.
- Without a Connect subscription, files not opened in 50 days leave the cloud (they stay on the tablet).

## License

MIT
