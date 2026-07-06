# Build context: repo root (scope-topology.json + mcp-tool-schemas.json needed
# at compile time; sibling openapi files needed at runtime via ../../demo_mcp_*/openapi/).
FROM node:20-alpine AS builder

# Place repo root at /repo so relative paths match local dev layout
WORKDIR /repo

COPY scope-topology.json ./
COPY mcp-tool-schemas.json ./

# Install deps before copying source (layer cache)
COPY demo_mcp_gateway/package*.json demo_mcp_gateway/tsconfig.json ./demo_mcp_gateway/
WORKDIR /repo/demo_mcp_gateway
RUN npm install --legacy-peer-deps --no-audit --no-fund

COPY demo_mcp_gateway/src/ ./src/
RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
ARG GIT_SHA=unknown
FROM node:20-alpine
ENV GIT_SHA=$GIT_SHA

# Recreate the sibling layout so runtime path resolution works:
#   dist/index.js → ../../demo_mcp_server/openapi/...
#               → /repo/demo_mcp_server/openapi/...
WORKDIR /repo/demo_mcp_gateway

COPY demo_mcp_gateway/package*.json ./
# Lockfiles are gitignored repo-wide, so install (not `npm ci`) to build
# reliably from a fresh checkout.
RUN npm install --omit=dev --legacy-peer-deps --no-audit --no-fund

COPY --from=builder /repo/demo_mcp_gateway/dist ./dist

# scope-topology.json and mcp-tool-schemas.json are required at runtime
# (tsc emits a require(), not an embed)
COPY scope-topology.json /repo/scope-topology.json
COPY mcp-tool-schemas.json /repo/mcp-tool-schemas.json

# Sibling openapi specs (served via GET /openapi/mcp-olb and /openapi/mcp-invest)
COPY demo_mcp_server/openapi/ /repo/demo_mcp_server/openapi/
COPY demo_mcp_invest/openapi/ /repo/demo_mcp_invest/openapi/

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3005/health || exit 1

CMD ["node", "dist/index.js"]
