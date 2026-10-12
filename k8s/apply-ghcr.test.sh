#!/bin/bash
# k8s/apply-ghcr.test.sh — offline verification of deploy.sh's apply_ghcr
# rewrite: mirrors the function, rewrites every first-party manifest, asserts
# no bare ai-demo-k8 image survives, every first-party image lands in GHCR,
# known mappings are correct, and the gateway sidecar is rewritten too.
# Run: bash k8s/apply-ghcr.test.sh   (no cluster/docker needed)
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
NS="ai-demo"
GHCR_TAG="latest"
GITHUB_OWNER="${GITHUB_OWNER:-cmuir_pingcorp}"
GHCR_REGISTRY="ghcr.io/$GITHUB_OWNER"
# shellcheck source=k8s/ghcr-images.env
source "$DIR/ghcr-images.env"

# Mirror of the apply_ghcr rewrite in k8s/deploy.sh — keep in step.
apply_ghcr() {
  local content
  content="$(cat "$1")"
  local entry
  for entry in "${GHCR_IMAGE_MAP[@]}"; do
    content="${content/image: ${entry%%:*}:latest/image: ${GHCR_REGISTRY}/${entry##*:}:${GHCR_TAG}}"
  done
  content="${content//imagePullPolicy: IfNotPresent/imagePullPolicy: Always}"
  printf '%s' "$content"
}

fails=0
for f in 73-jaeger-deployment.yaml 30-mcp-server-deployment.yaml 65-promptguard-deployment.yaml \
         63-mcp-resource-server-deployment.yaml 64-api-resource-server-deployment.yaml \
         57-mcp-weather-deployment.yaml 58-mcp-brave-deployment.yaml 59-mcp-jwt-verifier-deployment.yaml \
         62-hitl-service-deployment.yaml 56-llm-stack.yaml 72-rag-stack.yaml 20-api-server-deployment.yaml \
         60-mcp-gateway-deployment.yaml 71-ping-gateway-deployment.yaml 75-ping-mcpgw-deployment.yaml \
         68-mcp-proxy-deployment.yaml 61-agent-service-deployment.yaml 40-agent-service-deployment.yaml \
         76-prometheus-deployment.yaml 83-alertmanager-deployment.yaml 81-loki-deployment.yaml \
         82-alloy-deployment.yaml 77-grafana-deployment.yaml 10-frontend-deployment.yaml; do
  out="$(apply_ghcr "$DIR/$f")"
  if printf '%s' "$out" | grep -q "image: ai-demo-k8-"; then
    echo "  FAIL $f: bare ai-demo-k8 image survived rewrite"; fails=$((fails+1))
  fi
done
# Spot-check mappings, including the two names that differ from their compose
# service (ui→frontend, promptguard→mcp-promptguard).
g="$(apply_ghcr "$DIR/10-frontend-deployment.yaml" | grep 'image: ' | head -1)"
[[ "$g" == *"ghcr.io/$GITHUB_OWNER/ai-demo-frontend:"* ]] || { echo "  FAIL frontend map: $g"; fails=$((fails+1)); }
p="$(apply_ghcr "$DIR/65-promptguard-deployment.yaml" | grep 'image: ' | head -1)"
[[ "$p" == *"ghcr.io/$GITHUB_OWNER/ai-demo-mcp-promptguard:"* ]] || { echo "  FAIL promptguard map: $p"; fails=$((fails+1)); }
# Sidecar: the gateway manifest carries mcp-gateway + authz-server — both rewritten.
n="$(apply_ghcr "$DIR/60-mcp-gateway-deployment.yaml" | /usr/bin/grep -c "image: ghcr.io/$GITHUB_OWNER/ai-demo-" || true)"
[ "$n" -ge 2 ] || { echo "  FAIL gateway sidecar rewrite (only $n images)"; fails=$((fails+1)); }

if ((fails)); then echo "apply-ghcr test: $fails failure(s)"; exit 1; fi
echo "apply-ghcr test: passed (24 manifests, no bare images, sidecar rewritten)"
