# Build context: repo root — the server reads the single-source-of-truth
# scope-topology.json at runtime via __dirname/../scope-topology.json.
ARG GIT_SHA=unknown
FROM node:20-alpine
ENV GIT_SHA=$GIT_SHA

# Recreate the sibling layout so __dirname/../scope-topology.json resolves
# (repo root at /repo, app at /repo/demo_authz_server), matching local dev.
WORKDIR /repo/demo_authz_server

COPY demo_authz_server/package*.json ./
RUN npm ci --omit=dev

COPY demo_authz_server/*.js ./
COPY demo_authz_server/routes/ ./routes/

# Required at runtime (require() at module load, not embedded).
COPY scope-topology.json /repo/scope-topology.json

EXPOSE 9001

# Server binds 127.0.0.1, so probe from inside the container (same netns).
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9001/health || exit 1

CMD ["node", "index.js"]
