#!/usr/bin/env bash
# stack-stopped.sh — which ai-demo-* compose containers are down, and were they
# switched to restart=no? ./run-k8.sh does both (docker update --restart=no +
# docker stop) and nothing brings them back, so a day later every use case fails
# with "MCP gateway unreachable (ENOTFOUND ping-gateway)". Read-only.
#
#   npm run -s stack:stopped      # exit 1 if any ai-demo-* container is not running
set -uo pipefail

down=$(docker ps -a --filter 'name=^ai-demo-' --filter 'status=exited' --filter 'status=created' \
  --format '{{.Names}}' | sort)
[[ -z "$down" ]] && { echo "stack-stopped: all ai-demo-* containers running"; exit 0; }

echo "stack-stopped: not running (optional-profile services may be down on purpose):"
for c in $down; do
  echo "  $c  restart=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$c")  $(docker ps -a --filter "name=^$c\$" --format '{{.Status}}')"
done
echo "bring back: ./run-docker.sh restart <service>   (recreates it and resets the restart policy)"
exit 1
