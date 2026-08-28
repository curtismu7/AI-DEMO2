FROM node:22-alpine

# Links the pushed GHCR package to this repository. A package first pushed by
# hand stays at `repository: NONE`; the first push carrying this label flips it
# (verified 2026-08-28, #2545: NONE -> curtismu7/AI-DEMO2).
#
# Keep it — a linked package is strictly better than an unlinked one, and it is
# a prerequisite for ever granting a repository Actions access. But be clear
# what it does NOT do: linking alone did NOT let GITHUB_TOKEN push. #2546 tried
# exactly that against this now-linked package and still got
# "denied: permission_denied: write_package", so it was reverted and the classic
# PAT in GHCR_TOKEN remains what actually authenticates the push.
#
# So linking is NECESSARY BUT NOT SUFFICIENT. The remaining piece is the
# per-package Actions-access grant, which is UI-only. It is worth retrying now
# that an association exists — when it was first attempted the package was
# unlinked, so there was arguably nothing for the grant to attach to. If that
# grant then works, build-images.yml can drop the PAT (see #2546 for the exact
# revert).
LABEL org.opencontainers.image.source=https://github.com/curtismu7/AI-DEMO2

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY router.js posthogAi.js .

EXPOSE 8090
ENV LLM_PROXY_PORT=8090

# Mirrors demo_agent_service/demo_mcp_gateway healthchecks. /health returns 503
# while the model tier is degraded, so Docker shows unhealthy during real trouble
# but healthy through normal tier swaps (start-period covers cold boot).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8090/health || exit 1

CMD ["npm", "start"]
