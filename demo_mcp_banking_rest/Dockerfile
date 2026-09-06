FROM node:22-alpine
# Re-declared after FROM on purpose: an ARG from before it is out of scope here,
# and the ENV silently resolves to empty without this (see demo_mcp_grafana).
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

WORKDIR /app

COPY package.json ./
COPY server.js ./

EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-8082}/health || exit 1

CMD ["node", "server.js"]
