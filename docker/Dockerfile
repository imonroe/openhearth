# syntax=docker/dockerfile:1

# OpenHearth single-image build.
#
# Multi-stage:
#   1. builder  — installs the full pnpm workspace and compiles web + server.
#   2. deploy   — prunes to a self-contained, production-only server bundle.
#   3. runtime  — slim Node 20 + ffmpeg serving the built SPA + API on :8080.
#
# The runtime layer carries no build toolchain (no pnpm store, no devDeps, no
# TypeScript) — only Node, ffmpeg, the compiled JS, and production deps.

ARG NODE_VERSION=20

# ---------------------------------------------------------------------------
# Stage 1 — builder: install workspace + build web and server
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# Install dependencies first (better layer caching). Copy only the manifests
# and lockfile so this layer is reused until dependencies actually change.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Copy the rest of the sources and build all packages via project references.
COPY . .
RUN pnpm build

# Produce a self-contained, production-only deployment of the server package.
# pnpm replaces the workspace `@openhearth/shared` symlink with a real copy of
# its built output, so the runtime needs no workspace context.
# `--legacy`: deploy without injected workspace deps (pnpm v10 default would
# otherwise require inject-workspace-packages). pnpm still copies the built
# @openhearth/shared into the deployment's node_modules.
RUN pnpm --filter @openhearth/server deploy --prod --legacy /deploy

# ---------------------------------------------------------------------------
# Stage 2 — runtime: slim Node + ffmpeg
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV WEB_ROOT=/app/public

# ffmpeg is required for local-media transcoding (Strategy C). Install it and
# clean apt lists in the same layer to keep the image slim.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Compiled server + its production node_modules (incl. the deployed shared pkg).
COPY --from=builder /deploy ./
# Built web bundle, served as static files by the server.
COPY --from=builder /repo/packages/web/dist ./public

# Run as the unprivileged user that the node image ships with.
USER node

EXPOSE 8080

# Lightweight readiness probe against the health endpoint.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
