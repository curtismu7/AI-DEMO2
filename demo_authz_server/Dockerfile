# Build context: repo root — the server reads the single-source-of-truth
# scope-topology.json at runtime via __dirname/../scope-topology.json.
ARG GIT_SHA=unknown
FROM node:22-alpine
ENV GIT_SHA=$GIT_SHA

# Recreate the sibling layout so __dirname/../scope-topology.json resolves
# (repo root at /repo, app at /repo/demo_authz_server), matching local dev.
WORKDIR /repo/demo_authz_server

COPY demo_authz_server/package*.json ./
# Lockfiles are gitignored repo-wide, so install (not `npm ci`) to build
# reliably from a fresh checkout.
RUN npm install --omit=dev --legacy-peer-deps --no-audit --no-fund

COPY demo_authz_server/*.js ./
COPY demo_authz_server/routes/ ./routes/

# Required at runtime (require() at module load, not embedded).
COPY scope-topology.json /repo/scope-topology.json

# routes/generate-snapshot.js require()s the reconciler + the snapshot it
# reads/writes at module load — missing this crash-loops the container.
COPY snapshots/gen-authorize-snapshot.js /repo/snapshots/gen-authorize-snapshot.js
COPY snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json /repo/snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json

EXPOSE 9001

# Server binds 127.0.0.1, so probe from inside the container (same netns).
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9001/health || exit 1

CMD ["node", "index.js"]
