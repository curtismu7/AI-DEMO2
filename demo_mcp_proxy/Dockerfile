ARG GIT_SHA=unknown
FROM node:20-alpine
ENV GIT_SHA=$GIT_SHA

WORKDIR /app

COPY package.json ./
COPY server.js ./

EXPOSE 8895

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8895/health || exit 1

CMD ["node", "server.js"]
