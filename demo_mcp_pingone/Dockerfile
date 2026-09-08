ARG GIT_SHA=unknown
# Debian, not alpine: pingone-mcp-server is a prebuilt Go binary from the
# upstream GitHub release. It is not built here, so we cannot guarantee
# CGO_ENABLED=0 — and a cgo-linked binary will not run against musl. glibc is
# the safe base for a third-party binary we do not compile.
FROM node:22-slim
LABEL org.opencontainers.image.source=https://github.com/curtismu7/AI-DEMO2
# Re-declared after FROM: an ARG before FROM is global and is NOT in scope in
# the build stage, so `ENV GIT_SHA=$GIT_SHA` alone resolves to empty.
ARG GIT_SHA
ENV GIT_SHA=$GIT_SHA

# Pinned, not "latest": this is a v0.0.x project (v0.0.2 released 2025-12-12)
# and its tool surface is still moving. Bump deliberately, not by rebuild.
ARG PINGONE_MCP_VERSION=0.0.2
# TARGETARCH is set by buildx from --platform. The SE cluster's nodes are
# arm64, so build with --platform linux/arm64; the default here only matters
# for a plain `docker build` on this host, which is also arm64.
ARG TARGETARCH=arm64

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -fsSL -o /usr/local/bin/pingone-mcp-server \
       "https://github.com/pingidentity/pingone-mcp-server/releases/download/v${PINGONE_MCP_VERSION}/pingone-mcp-server_${PINGONE_MCP_VERSION}_linux_${TARGETARCH}" \
    && chmod +x /usr/local/bin/pingone-mcp-server \
    && /usr/local/bin/pingone-mcp-server --version \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY server.js ./

EXPOSE 8083

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8083)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
