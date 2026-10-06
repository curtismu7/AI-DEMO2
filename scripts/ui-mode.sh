#!/usr/bin/env bash
# Switch ONLY the `ui` container between the two ways it can run.
#
#   npm run ui:mode            show the current mode
#   npm run ui:mode built      nginx serving the production bundle (fast: a handful of
#                              chunks instead of ~1,300 unbundled /src modules, and no
#                              StrictMode double-run of every boot effect)
#   npm run ui:mode dev        Vite dev server with HMR (what ./run-docker.sh gives by default)
#
# Built mode bakes the source into the image. Edits (and merges) do NOT show until you
# re-run `npm run ui:mode built`; `scripts/deploy-live.sh` says so instead of restarting
# a container that would keep serving the old code. Only `ui` is rebuilt and recreated.
set -euo pipefail

BASEDIR="$(cd "$(dirname "$0")/.." && pwd)"
UI_CONTAINER="ai-demo-ui"

# Dev mode bind-mounts the UI tree at /app (docker-compose.override.yml); the built image has no mount there.
current_mode() {
  docker inspect "$UI_CONTAINER" --format '{{range .Mounts}}{{.Destination}} {{end}}' 2>/dev/null \
    | tr ' ' '\n' | grep -qx '/app' && echo dev && return
  docker inspect "$UI_CONTAINER" >/dev/null 2>&1 && echo built || echo "not running"
}

case "${1:-status}" in
  status) echo "ui mode: $(current_mode)" ;;
  built)  PROD_MODE=1 "${BASEDIR}/run-docker.sh" build ui ;;
  dev)    "${BASEDIR}/run-docker.sh" build ui ;;
  *)      echo "usage: npm run ui:mode [status|built|dev]" >&2; exit 2 ;;
esac
