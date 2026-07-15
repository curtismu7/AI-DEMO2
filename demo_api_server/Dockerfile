# Banking API Server Dockerfile
# Build context: repo root (required — BFF references scope-topology.json and docs/ from ../../)
ARG GIT_SHA=unknown
FROM node:20-alpine
ENV GIT_SHA=$GIT_SHA

# Create app directory
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Build tools required for native modules (argon2, lmdb)
RUN apk add --no-cache python3 make g++ curl

# PingCLI for the PingCLI demo page. The dev bind mount (./demo_api_server:/app)
# shadows /app/bin with the repo's macOS Mach-O binary, which cannot exec in a
# Linux container ("Exec format error"). Bake the matching Linux build into a
# non-shadowed path instead; routes/pingcli.js prefers it when present.
ARG TARGETARCH
ARG PINGCLI_VERSION=1.2.0
RUN curl -fsSL -o /usr/local/bin/pingcli \
      "https://github.com/pingidentity/pingcli/releases/download/v${PINGCLI_VERSION}/pingcli_${PINGCLI_VERSION}_linux_${TARGETARCH}" \
    && chmod 755 /usr/local/bin/pingcli

# Copy package files from service subdirectory (context is repo root)
COPY demo_api_server/package*.json ./

# Lockfiles are gitignored repo-wide, so install (not `npm ci`) to build
# reliably from a fresh checkout.
RUN npm install --omit=dev --legacy-peer-deps --no-audit --no-fund

# Copy BFF application code
COPY demo_api_server/ .

# Copy repo-root files that BFF services reference via ../../
# scopeTopology.js, agentRestrictionsService.js, pingoneProvisionService.js resolve to /scope-topology.json
COPY scope-topology.json /scope-topology.json
# startupConfigGuard.js resolves to /service-topology.json (boot-time SoT validation)
COPY service-topology.json /service-topology.json
# geminiNlIntent.js resolves to /docs/HELIX_AGENT_DIRECTIVES.json
COPY docs/ /docs/
# llamacppModelsService.js resolves to /demo_llm_proxy/modelCatalog.js (../../ from /app/services)
COPY demo_llm_proxy/modelCatalog.js /demo_llm_proxy/modelCatalog.js
# pingOneAuthorizeService.getAuthorizationPoliciesFromSnapshot resolves to /snapshots/… (../../ from /app/services)
COPY snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json /snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json

# Create data directory with proper permissions. Pre-create the LMDB persist
# dir (/app/data/persistent) so that when docker-compose mounts the
# ai-demo-bff-data named volume there, Docker seeds the fresh volume with this
# appuser-owned path — otherwise the volume mounts root-owned and the non-root
# appuser can't write, silently dropping configStore to in-memory.
RUN mkdir -p /app/data/persistent && \
    chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -k -f https://localhost:3001/api/healthz || exit 1

# Start the application
CMD ["npm", "start"]
