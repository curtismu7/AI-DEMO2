#!/usr/bin/env bash

k8_docker_cleanup_container_ids() {
  docker ps -a \
    --filter "name=^ai-demo-" \
    --filter "name=^librechat" \
    --format '{{.ID}} {{.Names}}' 2>/dev/null \
    | awk '$2 != "ai-demo-pingfederate" { print $1 }' || true
}

k8_docker_cleanup_network_ids() {
  local pf_container
  if ! pf_container="$(docker ps -a \
    --filter "name=^ai-demo-pingfederate$" \
    --format '{{.ID}}' 2>/dev/null)"; then
    return 0
  fi
  [[ -z "$pf_container" ]] || return 0
  docker network ls -q --filter "name=ai-demo" 2>/dev/null || true
}
