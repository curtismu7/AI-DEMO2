FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY router.js .

EXPOSE 8090
ENV LLM_PROXY_PORT=8090

# Mirrors demo_agent_service/demo_mcp_gateway healthchecks. /health returns 503
# while the model tier is degraded, so Docker shows unhealthy during real trouble
# but healthy through normal tier swaps (start-period covers cold boot).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8090/health || exit 1

CMD ["npm", "start"]
