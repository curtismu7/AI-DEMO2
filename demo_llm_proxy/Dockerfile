FROM node:22-alpine

# Half of what CI needs to push this image to GHCR. A package first pushed by
# hand is owned by that user with `repository: NONE`; the first push carrying
# this label links it (verified #2545: NONE -> curtismu7/AI-DEMO2).
#
# The OTHER half is not in this repo and cannot be: on the package's settings
# page, "Manage Actions access" -> Add Repository -> AI-DEMO2 -> Write. That
# list starts EMPTY and is separate from the "Repository source" the label sets
# — a package can show this repo as its source and still refuse this repo's
# Actions. #2546 proved it the expensive way: linked package, empty access list,
# same "denied: permission_denied: write_package".
#
# So for a NEW service: add this label AND grant Actions access. One without the
# other fails identically, which is what made this take all day to pin down.
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
