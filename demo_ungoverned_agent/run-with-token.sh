#!/usr/bin/env bash
# run-with-token.sh — one-command ungoverned-agent demo.
#
# Grabs a fresh Customer access token from the running BFF's session store
# (refreshing it if it has < MIN_MINUTES left), then runs the ungoverned-agent
# sidecar with it. Sign in as a Customer at the UI first so a session exists.
#
#   ./demo_ungoverned_agent/run-with-token.sh
#   MIN_MINUTES=10 AMOUNT=75 ./demo_ungoverned_agent/run-with-token.sh
#
# Any extra args are passed through to `docker compose run`.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
CONTAINER="${API_CONTAINER:-ai-demo-api-server}"

echo "[run-with-token] fetching a fresh Customer token from the session store…" >&2
TOK="$(MIN_MINUTES="${MIN_MINUTES:-5}" docker exec -i -e MIN_MINUTES="${MIN_MINUTES:-5}" "$CONTAINER" node - < "$DIR/get-customer-token.js")"

if [ -z "$TOK" ]; then
  echo "[run-with-token] no token available — sign in as a Customer at the UI, then retry." >&2
  exit 1
fi

cd "$ROOT"
exec docker compose --profile demo-attack run --rm \
  -e ACCESS_TOKEN="$TOK" \
  ${AMOUNT:+-e AMOUNT="$AMOUNT"} \
  ${DESCRIPTION:+-e DESCRIPTION="$DESCRIPTION"} \
  ungoverned-agent "$@"
