#!/usr/bin/env bash
# k8s/check-cluster.sh — Is the SE cluster up to date with local main?
#
# Compares the GIT_SHA baked into each running pod's image against the
# current local HEAD SHA. Prints a table: UP-TO-DATE / STALE / UNKNOWN.
#
# Usage:
#   ./k8s/check-cluster.sh                          # uses ping-devops-cmuir
#   NS=ping-devops-jeremycarrier ./k8s/check-cluster.sh
#
# Requirements: kubectl (context "us" active), git

set -euo pipefail

NS="${NS:-ping-devops-cmuir}"
HEAD_SHA="$(git rev-parse HEAD)"
SHORT_SHA="${HEAD_SHA:0:8}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

echo -e "${BOLD}Cluster:${NC} $NS"
echo -e "${BOLD}Local HEAD:${NC} $SHORT_SHA ($(git log -1 --format='%s'))"
echo

printf "%-24s %-10s %-10s %s\n" "DEPLOYMENT" "CLUSTER" "LOCAL" "STATUS"
printf "%-24s %-10s %-10s %s\n" "----------" "-------" "-----" "------"

# All deployments that ship a GIT_SHA env var
DEPLOYMENTS=(
  frontend
  banking-api-server
  langchain-agent
  mcp-server
  mcp-gateway
  agent-service
  hitl-service
  mcp-resource-server
  api-resource-server
  mastra-agent
  openai-agent
  pydantic-agent
)

all_current=true

for dep in "${DEPLOYMENTS[@]}"; do
  # Read GIT_SHA from the first running pod for this deployment
  pod_sha="$(kubectl get pods -n "$NS" -l "app=$dep" \
    -o jsonpath='{.items[0].spec.containers[0].env[?(@.name=="GIT_SHA")].value}' 2>/dev/null || true)"

  # Fall back: check via `kubectl exec` if env isn't in the spec (e.g. set via envFrom)
  if [[ -z "$pod_sha" ]]; then
    pod_name="$(kubectl get pods -n "$NS" -l "app=$dep" \
      -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    if [[ -n "$pod_name" ]]; then
      pod_sha="$(kubectl exec -n "$NS" "$pod_name" -- sh -c 'echo $GIT_SHA' 2>/dev/null | tr -d '\r\n' || true)"
    fi
  fi

  cluster_short="${pod_sha:0:8}"
  local_short="${SHORT_SHA}"

  if [[ -z "$pod_sha" ]]; then
    status="${YELLOW}UNKNOWN${NC} (no pod or SHA not set)"
    all_current=false
  elif [[ "$pod_sha" == "$HEAD_SHA" ]]; then
    status="${GREEN}UP-TO-DATE${NC}"
  else
    status="${RED}STALE${NC}"
    all_current=false
  fi

  printf "%-24s %-10s %-10s " "$dep" "${cluster_short:-n/a}" "$local_short"
  echo -e "$status"
done

echo
if $all_current; then
  echo -e "${GREEN}✓ All pods match local HEAD.${NC}"
else
  echo -e "${YELLOW}Some pods are out of date. To update:${NC}"
  echo "  docker compose -p ai-demo-k8 build <service>  # rebuild changed images (k8 project — do not clobber dev tags)"
  echo "  docker tag <local>:latest ghcr.io/curtismu7/<ghcr-name>:latest && docker push ..."
  echo "  kubectl rollout restart deployment/<name> -n $NS"
  echo "  See k8s/aws/deploy.sh or /ping-aws-cluster skill for full instructions."
fi
