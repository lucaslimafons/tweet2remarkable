# syntax=docker/dockerfile:1
# Runs the bot: Telegram long polling, no ports exposed. Configure with env vars (see README).

# node:24.22.1-bookworm-slim, pinned by digest (multi-arch index).
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
WORKDIR /app

# Production dependencies only. pnpm comes from package.json's packageManager via corepack.
FROM base AS deps
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Pinned, checksum-verified rmapi for the build platform (amd64 or arm64).
FROM base AS rmapi
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/*
COPY scripts/install-rmapi.sh scripts/
RUN sh scripts/install-rmapi.sh /out

FROM base
# rmapi is a Go binary and uses the system CA bundle.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
  RMAPI_BIN=/app/bin/rmapi
COPY --from=deps /app/node_modules ./node_modules
COPY --from=rmapi /out/rmapi ./bin/rmapi
COPY package.json ./
COPY src ./src
USER node
# Node runs the TypeScript directly (type stripping); tsconfig enforces erasable-only syntax.
CMD ["node", "src/index.ts"]
