#!/usr/bin/env bash
# Clones (or updates) the three tools as sibling directories under repos/,
# then runs each one's own install. No Docker required.
set -euo pipefail
cd "$(dirname "$0")/.."

REPOS=(
  "llm-gateway"
  "mcp-inspector"
  "ai-gateway-client"
)

mkdir -p repos
for name in "${REPOS[@]}"; do
  dir="repos/$name"
  if [ -d "$dir/.git" ]; then
    echo "== $name: updating =="
    git -C "$dir" pull --ff-only
  else
    echo "== $name: cloning =="
    git clone "https://github.com/curtismu7/$name.git" "$dir"
  fi
done

echo "== llm-gateway: npm install =="
npm install --prefix repos/llm-gateway

echo "== mcp-inspector: npm run install:all =="
npm run install:all --prefix repos/mcp-inspector

echo "== ai-gateway-client: npm run install:all =="
npm run install:all --prefix repos/ai-gateway-client

echo
echo "Done. Run ./scripts/start-all.sh to start all three."
