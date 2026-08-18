#!/bin/bash
# Load secrets from 1Password for Docker Compose dev.
# Usage: source scripts/load-secrets-docker.sh && docker compose up
#
# Prerequisites:
#   - 1Password CLI installed: brew install 1password-cli
#   - Signed in: op signin
#   - Vault "Banking Demo" exists with secrets
#
# Fallback: If 1Password unavailable, sources .env.local (gitignored) instead.
# Never commits or stores secrets in repo.

set -eo pipefail # pipefail: `a | b` must report a's failure, not b's

DEMO_VAULT="Banking Demo"
SERVICES=("demo_api_server" "oauth-mcp" "langchain_agent" "demo_mcp_gateway" "ping_gateway")

if command -v op &>/dev/null && op account get &>/dev/null; then
  echo "[INFO] Loading secrets from 1Password vault: $DEMO_VAULT"

  for svc in "${SERVICES[@]}"; do
    item_name="${svc/_/-} secrets"

    if op item get "$item_name" --vault "$DEMO_VAULT" >/dev/null 2>&1; then
      echo "[INFO] Exporting $svc secrets..."
      op item get "$item_name" --vault "$DEMO_VAULT" --format json | \
        jq -r '.fields[] | "\(.label)=\(.value)"' | \
        while read -r line; do
          export "$line"
        done
    else
      echo "[WARN] Item '$item_name' not found. Skipping $svc."
    fi
  done

  echo "[INFO] 1Password secrets loaded."
else
  echo "[INFO] 1Password not available or not signed in."
  echo "[FALLBACK] Using .env.local files (dev mode only)."

  for svc in "${SERVICES[@]}"; do
    env_file="$svc/.env.local"
    if [ -f "$env_file" ]; then
      echo "[INFO] Loading $env_file..."
      set -o allexport
      source "$env_file"
      set +o allexport
    fi
  done
fi

echo "[INFO] Secrets loaded. Ready for: docker compose up"
