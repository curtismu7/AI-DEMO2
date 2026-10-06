#!/usr/bin/env bash
# Self-check for deploy-live.sh's built-bundle UI guard.
#   bash scripts/deploy-live.builtUi.test.sh
#
# With `npm run ui:mode built` the ui container is an nginx image with the source baked
# in. add_restart ui would "succeed" while the container kept serving the old code, and
# add_build ui goes through run-docker.sh, which re-applies the dev override and flips
# the container back to the Vite dev server. Both must schedule nothing and say why.
#
# Like deploy-live.unmanaged.test.sh this lifts the real definitions out of the script
# (sourcing it would lock, sync and deploy) and runs them against a stub `docker`.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/deploy-live.sh"
fails=0
ok()  { echo "  ok   — $1"; }
bad() { echo "  FAIL — $1"; fails=$((fails + 1)); }

echo "deploy-live built-bundle ui guard:"

eval "$(sed -n '/^UNMANAGED_BY_RUN_DOCKER=/p; /^is_unmanaged_by_run_docker()/p; /^add_build()/p; /^UI_BUILT_NOTED=/p' "$SCRIPT")"
eval "$(awk '/^ui_runs_built_bundle\(\)/,/^\}/; /^skip_built_ui\(\)/,/^\}/; /^add_restart\(\)/,/^\}/' "$SCRIPT")"
note() { NOTES="${NOTES}$1"$'\n'; }

# UI_MODE: dev (source mounted at /app) | built (no /app mount) | absent (no container)
docker() {
  [ "$UI_MODE" = absent ] && return 1
  case "$*" in
    *"--format"*) [ "$UI_MODE" = dev ] && echo "/app /app/node_modules /certs " || echo "/etc/nginx/certs " ;;
  esac
  return 0
}
reset() { RESTART_SET=""; BUILD_SET=""; NOTES=""; UI_BUILT_NOTED=0; CURRENT_SERVICE=""; }

UI_MODE=dev; reset
add_restart ui; add_build ui
[[ " $RESTART_SET " == *" ui "* && " $BUILD_SET " == *" ui "* && -z "$NOTES" ]] \
  && ok "dev mode: ui is scheduled as before, no note" || bad "dev mode changed behaviour (restart='$RESTART_SET' build='$BUILD_SET' notes='$NOTES')"

UI_MODE=built; reset
add_restart ui; rc1=$?; add_build ui; rc2=$?
[[ -z "$RESTART_SET" && -z "$BUILD_SET" ]] \
  && ok "built mode: add_restart and add_build schedule nothing for ui" || bad "built mode still scheduled ui (restart='$RESTART_SET' build='$BUILD_SET')"
[[ "$rc1" = 0 && "$rc2" = 0 ]] && ok "built mode: both return 0 (no abort under set -e)" || bad "built mode returned non-zero ($rc1,$rc2)"
[[ "$NOTES" == *"npm run ui:mode built"* ]] && ok "built mode: the note names the command that rebuilds it" || bad "no rebuild hint in notes: '$NOTES'"
[[ "$(printf '%s' "$NOTES" | grep -c 'BUILT bundle')" = 1 ]] && ok "built mode: the note is emitted once, not once per changed file" || bad "note repeated: '$NOTES'"

UI_MODE=built; reset
add_restart demo-api-server
[[ " $RESTART_SET " == *" demo-api-server "* ]] && ok "built mode: other services are untouched" || bad "built mode swallowed demo-api-server"

UI_MODE=absent; reset
add_restart ui
[[ " $RESTART_SET " == *" ui "* ]] && ok "no ui container: left to the existing not-running handling" || bad "absent ui container was treated as built"

echo
[ "$fails" -eq 0 ] && { echo "all checks passed"; exit 0; }
echo "$fails check(s) failed"; exit 1
