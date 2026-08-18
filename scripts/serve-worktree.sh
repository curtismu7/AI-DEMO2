#!/usr/bin/env bash
# serve-worktree.sh — make the running stack serve THIS worktree's source.
#
# Why this exists: the ai-demo compose project is shared by every worktree, and
# `docker compose up` from a worktree does two damaging things at once. It
# repoints the shared containers at that worktree (so another session's merged
# fix silently "disappears"), and it resolves every env_file against the worktree
# — which has no gitignored files — so services start starved of their .env with
# no error. Both are documented in REGRESSION_PLAN §4 and TECH_DEBT.
#
# This script does the safe half only: the project directory stays on the MAIN
# checkout (env, certs, scripts all resolve there) and only the two source mounts
# move. It also says out loud which checkout the stack is serving, because the
# failure mode is silence.
#
# Usage:
#   scripts/serve-worktree.sh            # status — which checkout is being served
#   scripts/serve-worktree.sh here       # serve the worktree you are standing in
#   scripts/serve-worktree.sh main       # hand the stack back to the main checkout
#   scripts/serve-worktree.sh <path>     # serve an explicit checkout
set -euo pipefail

MAIN="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
BFF_CONTAINER="ai-demo-api-server"
UI_CONTAINER="ai-demo-ui"

mount_source() {  # $1 = container, $2 = destination inside the container
  docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$2\"}}{{.Source}}{{end}}{{end}}" "$1" 2>/dev/null || true
}

print_status() {
  local bff ui
  bff="$(mount_source "$BFF_CONTAINER" /app)"
  ui="$(mount_source "$UI_CONTAINER" /app)"
  if [[ -z "$bff" && -z "$ui" ]]; then
    echo "stack not running (no $BFF_CONTAINER / $UI_CONTAINER container)"
    return 0
  fi
  describe "BFF" "$bff" "$MAIN/demo_api_server"
  describe "UI " "$ui"  "$MAIN/demo_api_ui"
}

describe() {  # $1 = label, $2 = actual mount source, $3 = the main-checkout path
  local label="$1" src="$2" main_path="$3"
  if [[ -z "$src" ]]; then
    echo "$label  not running"
  elif [[ "$src" == "$main_path" ]]; then
    echo "$label  main checkout   $src"
  elif [[ ! -d "$src" ]]; then
    # A worktree deleted while the stack ran: the container serves already-loaded
    # code until something restarts it, then crash-loops on MODULE_NOT_FOUND.
    echo "$label  WORKTREE GONE   $src   <- run 'serve-worktree.sh main'"
  else
    echo "$label  worktree        $src"
  fi
}

target=""
case "${1:-status}" in
  status|"")  print_status; exit 0 ;;
  here)       target="$(git rev-parse --show-toplevel)" ;;
  main)       target="$MAIN" ;;
  *)          target="$(cd "$1" && pwd)" ;;
esac

# Mounting a directory that lacks the source trees gives you a container with an
# empty /app that crash-loops — refuse rather than produce that.
for d in demo_api_server demo_api_ui; do
  [[ -d "$target/$d" ]] || { echo "error: $target has no $d/ — not a checkout of this repo" >&2; exit 1; }
done

if [[ "$target" == "$MAIN" ]]; then
  echo "handing the stack back to the main checkout: $MAIN"
  unset WORKTREE_SRC_ROOT || true
else
  echo "serving worktree: $target"
  echo "  (project directory stays on $MAIN so env_file/certs/scripts still resolve)"
  export WORKTREE_SRC_ROOT="$target"
fi

docker compose \
  --project-directory "$MAIN" \
  -f "$MAIN/docker-compose.yml" \
  -f "$MAIN/docker-compose.override.yml" \
  -f "$MAIN/docker-compose.worktree.yml" \
  up -d --no-deps --force-recreate demo-api-server ui

echo
echo "now serving:"
print_status

# The BFF is HTTPS-only on 3001; plain http:// there returns curl 000 and reads
# as "the stack is down" when it is fine.
for _ in $(seq 1 30); do
  if curl -sk --max-time 2 https://localhost:3001/api/healthz >/dev/null 2>&1; then
    echo "BFF healthy on https://localhost:3001/api/healthz"
    exit 0
  fi
  sleep 2
done
echo "warning: BFF did not answer /api/healthz within 60s — check 'docker logs $BFF_CONTAINER'" >&2
exit 1
