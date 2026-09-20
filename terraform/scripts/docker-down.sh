#!/usr/bin/env bash
set -euo pipefail

: "${AI_DEMO_COMPOSE_FILE:?AI_DEMO_COMPOSE_FILE is required}"
: "${AI_DEMO_PROJECT_NAME:?AI_DEMO_PROJECT_NAME is required}"
: "${AI_DEMO_RETAIN_VOLUMES:=true}"

repo_root="$(cd "$(dirname "$AI_DEMO_COMPOSE_FILE")" && pwd)"
cd "$repo_root"

docker info >/dev/null

compose_args=(docker compose -p "$AI_DEMO_PROJECT_NAME" -f "$AI_DEMO_COMPOSE_FILE")
if [[ "$AI_DEMO_RETAIN_VOLUMES" == "true" ]]; then
  "${compose_args[@]}" down
else
  "${compose_args[@]}" down --volumes
fi
