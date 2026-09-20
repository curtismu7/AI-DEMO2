#!/usr/bin/env bash
set -euo pipefail

: "${AI_DEMO_COMPOSE_FILE:?AI_DEMO_COMPOSE_FILE is required}"
: "${AI_DEMO_PROJECT_NAME:?AI_DEMO_PROJECT_NAME is required}"
: "${AI_DEMO_PROFILE_ARGS:=}"
: "${AI_DEMO_BUILD_IMAGES:=true}"

repo_root="$(cd "$(dirname "$AI_DEMO_COMPOSE_FILE")" && pwd)"
cd "$repo_root"

if [[ ! -f "demo_api_server/.env" ]]; then
  echo "demo_api_server/.env is missing. Run ./install.sh first so PingOne is bootstrapped." >&2
  exit 1
fi

docker info >/dev/null

compose_args=(docker compose -p "$AI_DEMO_PROJECT_NAME" -f "$AI_DEMO_COMPOSE_FILE")
if [[ -n "$AI_DEMO_PROFILE_ARGS" ]]; then
  # shellcheck disable=SC2206
  profile_args=( $AI_DEMO_PROFILE_ARGS )
  compose_args+=( "${profile_args[@]}" )
fi

if [[ "$AI_DEMO_BUILD_IMAGES" == "true" ]]; then
  "${compose_args[@]}" up --build -d
else
  "${compose_args[@]}" up -d
fi

"${compose_args[@]}" ps
