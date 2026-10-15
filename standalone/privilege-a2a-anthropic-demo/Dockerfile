# One image for the main agent, the worker agent and the MCP server; each
# container picks its process with `command` (see k8s/deployment.yaml).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
# Links the GHCR package to this repo on push (see .github/workflows/build-a2a-demo-image.yml).
LABEL org.opencontainers.image.source=https://github.com/cmuir_pingcorp/AI-DEMO2
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/worker-agent/index.js"]
