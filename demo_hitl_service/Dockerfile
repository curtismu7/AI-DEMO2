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
RUN npm install --omit=dev --legacy-peer-deps --no-audit --no-fund

COPY src/ ./src/

EXPOSE 3009

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3009/health || exit 1

CMD ["node", "src/index.js"]
