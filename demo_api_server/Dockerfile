# Banking API Server Dockerfile
# Build context: repo root (required — BFF references scope-topology.json and docs/ from ../../)
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
# agentReasoningClient.js resolves to /llm-timeouts.json (../../ from /app/services)
COPY llm-timeouts.json /llm-timeouts.json
# geminiNlIntent.js resolves to /docs/HELIX_AGENT_DIRECTIVES.json
COPY docs/ /docs/

# knowledge bundles (banking-domain.kb.json, repo-topology.kb.json)
COPY graphify-out/*.kb.json /graphify-out/
# llamacppModelsService.js resolves to /demo_llm_proxy/modelCatalog.js (../../ from /app/services)
COPY demo_llm_proxy/modelCatalog.js /demo_llm_proxy/modelCatalog.js
# pingOneAuthorizeService.getAuthorizationPoliciesFromSnapshot resolves to /snapshots/… (../../ from /app/services)
COPY snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json /snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json

# First-party sources for the default code-search piece indexer. Compose bind-
# mounts ./:/repo:ro over this path; SE/K8 have no host checkout, so the image
# must carry the package trees that CODEBASE_PIECES walks.
ENV CODE_SEARCH_REPO_ROOT=/repo
COPY demo_api_ui/src /repo/demo_api_ui/src
COPY demo_api_server /repo/demo_api_server
COPY oauth-mcp /repo/oauth-mcp
COPY demo_mcp_gateway /repo/demo_mcp_gateway
COPY demo_authz_server /repo/demo_authz_server
COPY ping-gateway /repo/ping-gateway
COPY demo_hitl_service /repo/demo_hitl_service
COPY langchain_agent /repo/langchain_agent
COPY llamaindex_agent /repo/llamaindex_agent
COPY openai_agent /repo/openai_agent
COPY pydantic_agent /repo/pydantic_agent
COPY mastra_agent /repo/mastra_agent
COPY demo_llm_proxy /repo/demo_llm_proxy
COPY demo_mcp_code_search/src /repo/demo_mcp_code_search/src

# Create data directory with proper permissions. Pre-create the LMDB persist
# dir (/app/data/persistent) so that when docker-compose mounts the
# ai-demo-bff-data named volume there, Docker seeds the fresh volume with this
# appuser-owned path — otherwise the volume mounts root-owned and the non-root
# appuser can't write, silently dropping configStore to in-memory.
RUN mkdir -p /app/data/persistent && \
    chown -R appuser:appgroup /app /repo

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -k -f https://localhost:3001/api/healthz || exit 1

# Start the application
CMD ["npm", "start"]
