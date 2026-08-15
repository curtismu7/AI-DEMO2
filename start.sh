#!/usr/bin/env bash
# start.sh — Start all demo digital assistant services
set -e

BASEDIR="$(cd "$(dirname "$0")" && pwd)"

echo "🏦 Starting Banking Digital Assistant..."
echo "   Using PingOne environment: ${PINGONE_ENVIRONMENT_ID:-see .env files}"

# Check for node_modules
for svc in demo_api_server oauth-mcp langchain_agent demo_api_ui; do
  if [ ! -d "$BASEDIR/$svc/node_modules" ]; then
    echo "📦 Installing dependencies for $svc..."
    (cd "$BASEDIR/$svc" && npm install)
  fi
done

# Start demo_api_server (port 3001)
echo "🚀 Starting Demo API Server on :3001..."
(cd "$BASEDIR/demo_api_server" && npm start > /tmp/demo-api-server.log 2>&1) &
echo $! > /tmp/demo-api-server.pid

sleep 1

# Start oauth-mcp (port 8080)
if [ -d "$BASEDIR/oauth-mcp" ]; then
  echo "🤖 Starting AI Demo MCP Server on :8080..."
  (cd "$BASEDIR/oauth-mcp" && cp .env.development .env 2>/dev/null; npm start > /tmp/demo-mcp-server.log 2>&1) &
  echo $! > /tmp/demo-mcp-server.pid
fi

# Start langchain_agent backend (port 8887 — 8888/8889/8890 taken by OrbStack on macOS)
if [ -f "$BASEDIR/langchain_agent/src/main.py" ]; then
  echo "🔗 Starting LangChain Agent Backend on :8887..."
  (cd "$BASEDIR/langchain_agent" && \
   PYTHONPATH="$BASEDIR/langchain_agent:${PYTHONPATH:-}" \
   AGUI_HTTP_PORT=8887 HEALTH_HTTP_PORT=8881 \
   ./.venv/bin/python -m src.main > /tmp/langchain-agent.log 2>&1) &
  echo $! > /tmp/langchain-agent.pid
fi

# Start demo_api_ui (port 3000)
if [ -d "$BASEDIR/demo_api_ui" ]; then
  echo "🌐 Starting Banking UI on :3000..."
  (cd "$BASEDIR/demo_api_ui" && npm start > /tmp/demo-ui.log 2>&1) &
  echo $! > /tmp/demo-ui.pid
fi

echo ""
echo "✅ Services started:"
echo "   Demo API Server: https://api.ping.demo:3001"
echo "   AI Demo MCP Server: ws://localhost:8080 (internal)"
echo "   Banking UI:         https://local.ping-devops.com:4000"
echo "   LangChain Agent:    http://localhost:8888 (internal)"
echo ""
echo "📋 Logs:"
echo "   Demo API: /tmp/demo-api-server.log"
echo "   MCP Server:  /tmp/demo-mcp-server.log"
echo "   Agent:       /tmp/langchain-agent.log"
echo "   UI:          /tmp/demo-ui.log"
echo ""
echo "ℹ️  To stop all services: ./stop.sh"
