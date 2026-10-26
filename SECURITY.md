# Security policy

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository. It's a personal project, so replies are best effort.

## What's in scope

This is a single-user bot, so the things worth reporting are ways to:

- make the bot act for someone other than the `ALLOWED_CHAT_ID` owner (e.g. get it to upload to their tablet);
- leak secrets: the Telegram bot token, the rmapi config (which grants access to the owner's reMarkable cloud)
  or other environment variables, through logs, replies, errors or generated files;
- get content from a fetched page to run code or reach the EPUB as active content (scripts, event handlers,
  `javascript:` URLs);
- compromise the build or the supply chain (dependencies, the pinned rmapi binary, GitHub Actions).

Out of scope: problems in upstream projects (rmapi, fxtwitter, Readability, jsdom) — report those to them —
and anything that requires already having the owner's bot token or rmapi config.

## If you run your own instance

- Keep `.env`, `.secrets/` and `rmapi.conf` out of git (they're ignored by default) and out of screenshots.
- Leaked bot token: `/revoke` it in @BotFather. Leaked rmapi config: remove its device from your account at
  <https://my.remarkable.com> and pair again.
