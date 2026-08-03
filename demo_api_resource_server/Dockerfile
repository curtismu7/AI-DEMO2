ARG GIT_SHA=unknown
FROM node:22-alpine
ENV GIT_SHA=$GIT_SHA

WORKDIR /app

COPY package*.json ./
# Lockfiles are gitignored repo-wide, so install (not `npm ci`) to build
# from a clean checkout — same as demo_api_server/Dockerfile.
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8082/health || exit 1

# Drop privileges — node:22-alpine ships a non-root `node` user.
USER node

CMD ["node", "server.js"]
