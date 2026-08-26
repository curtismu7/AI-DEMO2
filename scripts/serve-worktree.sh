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
#
# Self-check (stubs docker, touches nothing): bash scripts/serve-worktree.test.sh
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

  # The UI serves from /app/src, not /app. Reporting only /app is how a status
  # line could truthfully say "worktree" while `docker inspect` showed
  # .../demo_api_ui/src -> /app/src still on main — the change under test was not
  # being served, and the verification run blamed the fix. The overlay now moves
  # both mounts together; this makes it impossible for them to disagree quietly.
  local ui_src
  ui_src="$(mount_source "$UI_CONTAINER" /app/src)"
  if [[ -n "$ui" && -n "$ui_src" && "$ui_src" != "$ui/src" ]]; then
    echo "UI  MOUNT SPLIT    /app -> $ui   but /app/src -> $ui_src"
    echo "                   /app/src wins for served source — re-run 'serve-worktree.sh here'"
  fi
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

# A worktree carries no gitignored files, and the BFF loads demo_api_server/.env
# ITSELF at runtime — the --project-directory pin above only makes Compose's own
# env_file entries resolve against main, which is a different mechanism. Without
# this every OAuth login against the worktree fails with
# "invalid_client — Request denied: Invalid client credentials", which reads as
# broken auth rather than a missing file.
#
# Copied, not symlinked: the mount hands the container the worktree directory, so
# a symlink inside it would resolve to a host path that does not exist in the
# container and the BFF would see no .env at all.
#
# Nothing else needs copying. data/persistent (LMDB, config.db, banking.db) is the
# named volume ai-demo-bff-data mounted over /app/data/persistent, and /repo,
# /certs and secrets.vault are all bound from MAIN by absolute path — none of them
# move when the source mount does.
copy_bff_env() {
  local target="$1"
  [[ "$target" == "$MAIN" ]] && return 0
  if [[ ! -f "$MAIN/demo_api_server/.env" ]]; then
    echo "warning: $MAIN/demo_api_server/.env does not exist — the BFF will start without one" >&2
    return 0
  fi
  cp "$MAIN/demo_api_server/.env" "$target/demo_api_server/.env"
  echo "  copied demo_api_server/.env from the main checkout (gitignored, so the worktree has none)"
}

# The recreate is not always believed on the first try: a run has been observed
# reporting the new worktree while `docker inspect` still showed the old mount,
# and a second identical invocation fixed it. Reporting from docker inspect (which
# print_status already does) makes that visible; this makes it not happen. One
# retry matches the observed cure — then fail loudly rather than hand back a stack
# that is silently serving the wrong source.
verify_mounts() {
  local target="$1" bff ui ui_src
  bff="$(mount_source "$BFF_CONTAINER" /app)"
  ui="$(mount_source "$UI_CONTAINER" /app)"
  # /app/src is checked explicitly: it is the mount the UI actually serves from,
  # and the one that was observed lagging behind /app.
  ui_src="$(mount_source "$UI_CONTAINER" /app/src)"
  [[ "$bff" == "$target/demo_api_server" \
     && "$ui" == "$target/demo_api_ui" \
     && "$ui_src" == "$target/demo_api_ui/src" ]]
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

copy_bff_env "$target"

recreate() {
  docker compose \
    --project-directory "$MAIN" \
    -f "$MAIN/docker-compose.yml" \
    -f "$MAIN/docker-compose.override.yml" \
    -f "$MAIN/docker-compose.worktree.yml" \
    up -d --no-deps --force-recreate demo-api-server ui
}

recreate
if ! verify_mounts "$target"; then
  echo "mounts did not move on the first recreate — retrying once" >&2
  recreate
  if ! verify_mounts "$target"; then
    echo
    echo "error: the stack is NOT serving $target after two attempts." >&2
    echo "       Do not trust a verification run against it — what docker reports is:" >&2
    print_status >&2
    exit 1
  fi
fi

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
