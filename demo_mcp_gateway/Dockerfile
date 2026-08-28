# Build context: repo root (scope-topology.json + mcp-tool-schemas.json needed
# at compile time; sibling openapi files needed at runtime via ../../demo_mcp_*/openapi/).
FROM node:22-alpine AS builder

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

# Recreate the sibling layout so runtime path resolution works:
#   dist/index.js → ../../oauth-mcp/openapi/...
#               → /repo/oauth-mcp/openapi/...
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

# Sibling openapi specs (served via GET /openapi/mcp-olb and /openapi/mcp-resource-server)
COPY oauth-mcp/openapi/ /repo/oauth-mcp/openapi/
COPY demo_mcp_resource_server/openapi/ /repo/demo_mcp_resource_server/openapi/

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3005/health || exit 1

CMD ["node", "dist/index.js"]
