#!/usr/bin/env bash
# scripts/sync-wip-to-test.sh — rsync uncommitted work to a LAN test Mac (fast WIP loop).
#
# Does NOT sync secrets, git metadata, node_modules, or runtime LMDB data.
# For committed work prefer ./scripts/push-to-test.sh (git is the source of truth).
#
# Usage:
#   ./scripts/sync-wip-to-test.sh                  # sync to testmac, restart core services
#   ./scripts/sync-wip-to-test.sh testmac          # custom host
#   ./scripts/sync-wip-to-test.sh testmac --no-restart
#
# Environment:
#   REMOTE_DIR  path on test Mac (default: ~/Development/AI-demo-test)
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${1:-testmac}"
REMOTE_DIR="${REMOTE_DIR:-~/Development/AI-demo-test}"
RESTART=1

if [[ "${2:-}" == "--no-restart" ]]; then
  RESTART=0
elif [[ "${1:-}" == "--no-restart" ]]; then
  RESTART=0
  HOST="testmac"
fi

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '  %s\n' "$*"; }

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && {
  sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

echo "== sync-wip-to-test =="
info "source:  $ROOT"
info "host:    $HOST"
info "remote:  $REMOTE_DIR"
echo ""

info "Rsyncing (excluding secrets, .git, node_modules, runtime data)..."
rsync -avz --delete \
  --exclude '.git/' \
  --exclude '.claude/' \
  --exclude 'node_modules/' \
  --exclude '*/node_modules/' \
  --exclude '.env' \
  --exclude 'demo_api_server/.env' \
  --exclude 'demo_api_server/data/' \
  --exclude 'secrets.vault' \
  --exclude '*.mdb' \
  --exclude '.DS_Store' \
  "$ROOT/" "${HOST}:${REMOTE_DIR}/"

if [[ "$RESTART" -eq 1 ]]; then
  info "Restarting Docker services to pick up changes..."
  ssh "$HOST" bash -s -- "$REMOTE_DIR" <<'REMOTE'
set -euo pipefail
cd "$1"
./run-docker.sh restart ui demo-api-server mcp-server langchain-agent agent-service
REMOTE
  green "Sync + restart complete."
else
  green "Sync complete (no restart — run ./run-docker.sh restart on test Mac if needed)."
fi

info "Open UI: ./scripts/open-test-ui.sh $HOST"
