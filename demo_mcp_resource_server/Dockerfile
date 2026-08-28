FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
# Lockfiles are gitignored repo-wide, so install (not `npm ci`) to build
# reliably from a fresh checkout.
RUN npm install --legacy-peer-deps --no-audit --no-fund

COPY src/ ./src/
RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
ARG GIT_SHA=unknown
FROM node:22-alpine

# Half of what CI needs to push this image to GHCR: this links the package to
# the repo on push. The other half is NOT in this repo — the package's
# "Manage Actions access" list must also contain AI-DEMO2 with the Write role
# (UI only, starts empty). Either one missing gives the same
# "denied: permission_denied: write_package". See demo_llm_proxy/Dockerfile.
#
# Must sit in the FINAL stage: a LABEL applies only to the stage it is in, and
# no compose service sets `target:`, so the last stage is what gets built.
LABEL org.opencontainers.image.source=https://github.com/curtismu7/AI-DEMO2
ENV GIT_SHA=$GIT_SHA

WORKDIR /app

COPY package*.json ./
# Lockfiles are gitignored repo-wide, so install (not `npm ci`) to build
# reliably from a fresh checkout.
RUN npm install --legacy-peer-deps --omit=dev --no-audit --no-fund

COPY --from=builder /app/dist ./dist
COPY openapi/ ./openapi/
# Seeds for the per-vertical SQLite databases. Applied only when the tables are empty
# (src/db/*Db.ts), so a restart never clobbers out-of-band edits to
# /app/data/*.db.
COPY seed/ ./seed/

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8081/health || exit 1

CMD ["node", "--experimental-sqlite", "dist/index.js"]
