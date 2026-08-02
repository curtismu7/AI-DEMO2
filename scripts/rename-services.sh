#!/usr/bin/env zsh
# One-shot rename script: demo_mcp_invest → demo_mcp_resource_server,
# demo_mortgage_service → demo_api_resource_server.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

FILES=()
while IFS= read -r -d '' f; do
  if file "$f" 2>/dev/null | grep -qE 'text|JSON|empty|ASCII'; then
    FILES+=("$f")
  fi
done < <(find . -type f \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/dist/*' \
  -not -path '*/.next/*' \
  -not -path '*/coverage/*' \
  -not -path '*/.claude/worktrees/*' \
  -not -name '*.lock' \
  -not -name '*.png' -not -name '*.jpg' -not -name '*.jpeg' \
  -not -name '*.gif' -not -name '*.ico' -not -name '*.webp' \
  -not -name '*.woff' -not -name '*.woff2' -not -name '*.ttf' -not -name '*.eot' \
  -not -name '*.zip' -not -name '*.tar' -not -name '*.gz' -not -name '*.bz2' \
  -not -name '*.svg' -not -name '*.drawio' \
  -not -name '*.vault' \
  -print0)

echo "Processing ${#FILES[@]} text files..."

sed -i '' \
  -e 's/demo_mcp_invest/demo_mcp_resource_server/g' \
  -e 's/banking-mcp-invest/banking-mcp-resource-server/g' \
  -e 's/McpInvest/McpResourceServer/g' \
  -e 's/mcpInvest/mcpResourceServer/g' \
  -e 's/MCP_INVEST/MCP_RESOURCE_SERVER/g' \
  -e 's/mcp-invest/mcp-resource-server/g' \
  -e 's/mcp_invest/mcp_resource_server/g' \
  "${FILES[@]}"

sed -i '' \
  -e 's/demo_mortgage_service/demo_api_resource_server/g' \
  -e 's/banking-mortgage-service/banking-api-resource-server/g' \
  -e 's/MortgageService/ApiResourceServer/g' \
  -e 's/mortgageService/apiResourceServer/g' \
  -e 's/MORTGAGE_SERVICE/API_RESOURCE_SERVER/g' \
  -e 's/mortgage-service/api-resource-server/g' \
  -e 's/mortgage_service/api_resource_server/g' \
  "${FILES[@]}"

sed -i '' \
  -e 's/DEMO_INVEST_SERVICE_KEY/DEMO_MCP_RESOURCE_SERVER_KEY/g' \
  -e 's/MCP_GW_INVEST_WS_URL/MCP_GW_RESOURCE_SERVER_WS_URL/g' \
  -e 's/PG_INVEST_RESOURCE_URI/PG_MCP_RESOURCE_SERVER_URI/g' \
  -e 's/PG_MORTGAGE_BACKEND_URL/PG_API_RESOURCE_SERVER_URL/g' \
  -e 's/INVEST_AUD/MCP_RS_AUD/g' \
  "${FILES[@]}"

echo "Done — run 'git diff --stat' to review"
