FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache docker-cli lsof procps

COPY mcp-discovery-agent/package.json mcp-discovery-agent/index.mjs ./
COPY mcp-discovery-agent/src ./src
COPY mcp-scanner /standalone/mcp-scanner

RUN mkdir -p /data
EXPOSE 3910

CMD ["node", "index.mjs"]
