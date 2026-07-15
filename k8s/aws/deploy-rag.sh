#!/usr/bin/env bash
# k8s/aws/deploy-rag.sh — Build, push, apply, and start the Code Search RAG stack.
#
# Required:
#   GITHUB_OWNER     — GHCR owner (e.g. curtismu7)
#   K8S_NAMESPACE    — target namespace (e.g. ping-devops-cmuir)
#
# Optional:
#   IMAGE_TAG        — default: latest
#   SKIP_BUILD=1     — skip docker build/push (images already in GHCR)
#   RAG_ACTION       — on|off (default: on)
#
# Example:
#   GITHUB_OWNER=curtismu7 K8S_NAMESPACE=ping-devops-cmuir ./k8s/aws/deploy-rag.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
K8S_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GITHUB_OWNER="${GITHUB_OWNER:?Set GITHUB_OWNER (e.g. curtismu7)}"
NS="${K8S_NAMESPACE:?Set K8S_NAMESPACE (e.g. ping-devops-cmuir)}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
SKIP_BUILD="${SKIP_BUILD:-0}"
RAG_ACTION="${RAG_ACTION:-on}"
OWNER_LC="$(echo "$GITHUB_OWNER" | tr '[:upper:]' '[:lower:]')"
GHCR="ghcr.io/${OWNER_LC}"

MCP_LOCAL="ai-demo-k8-mcp-code-search"
LLAMA_LOCAL="ai-demo-k8-llamaindex-agent"
MCP_GHCR="${GHCR}/ai-demo-mcp-code-search:${IMAGE_TAG}"
LLAMA_GHCR="${GHCR}/ai-demo-llamaindex-agent:${IMAGE_TAG}"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
die()     { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo "============================================"
echo " RAG Code Search deploy"
echo "============================================"
info "Namespace:     $NS"
info "GitHub owner:  $GITHUB_OWNER"
info "Image tag:     $IMAGE_TAG"
info "RAG action:    $RAG_ACTION"
info "Skip build:    $SKIP_BUILD"
info "Context:       $(kubectl config current-context 2>/dev/null || echo '(none)')"
echo

kubectl get namespace "$NS" &>/dev/null || die "Namespace '$NS' not found"
success "Namespace $NS exists"

if [[ "$SKIP_BUILD" != "1" ]]; then
  command -v docker >/dev/null || die "docker is required (or set SKIP_BUILD=1)"
  command -v gh >/dev/null || die "gh is required to login to GHCR (or set SKIP_BUILD=1)"

  info "Logging in to ghcr.io as $GITHUB_OWNER"
  echo "$(gh auth token)" | docker login ghcr.io -u "$GITHUB_OWNER" --password-stdin
  success "GHCR login OK"

  info "Building $MCP_GHCR from demo_mcp_code_search/"
  docker build -t "$MCP_GHCR" -t "${MCP_LOCAL}:latest" "$ROOT_DIR/demo_mcp_code_search"
  success "Built mcp-code-search"

  info "Building $LLAMA_GHCR from llamaindex_agent/"
  docker build -t "$LLAMA_GHCR" -t "${LLAMA_LOCAL}:latest" "$ROOT_DIR/llamaindex_agent"
  success "Built llamaindex-agent"

  info "Pushing $MCP_GHCR"
  docker push "$MCP_GHCR"
  success "Pushed mcp-code-search"

  info "Pushing $LLAMA_GHCR"
  docker push "$LLAMA_GHCR"
  success "Pushed llamaindex-agent"
else
  warn "SKIP_BUILD=1 — not building or pushing images"
fi

info "Applying k8s/72-rag-stack.yaml (rewrite namespace + GHCR images)"
sed \
  -e "s/namespace: ai-demo/namespace: ${NS}/g" \
  -e "s|image: ${MCP_LOCAL}:latest|image: ${MCP_GHCR}|" \
  -e "s|image: ${LLAMA_LOCAL}:latest|image: ${LLAMA_GHCR}|" \
  -e "s/imagePullPolicy: IfNotPresent/imagePullPolicy: Always/g" \
  "$K8S_DIR/72-rag-stack.yaml" | kubectl apply -f -
success "RAG manifests applied to $NS"

RAG_SERVICES="weaviate embeddings mcp-code-search llamaindex-agent"
replicas=1
[[ "$RAG_ACTION" == "off" ]] && replicas=0

info "Scaling RAG stack to replicas=$replicas ($RAG_SERVICES)"
for svc in $RAG_SERVICES; do
  kubectl scale "deployment/$svc" -n "$NS" --replicas="$replicas"
  echo "  scaled $svc -> $replicas"
done

if [[ "$replicas" -eq 0 ]]; then
  success "RAG stack stopped in $NS"
  exit 0
fi

warn "Embeddings warm up on first pull — Code Search may 503 for a few minutes"

# Ordered ready: Weaviate → embeddings → mcp (owns schema) → llamaindex.
# If llamaindex races ahead it can create a broken CodeChunk class without
# codebase_id; repair that before indexing.
info "Waiting for weaviate rollout..."
kubectl rollout status deployment/weaviate -n "$NS" --timeout=180s || warn "weaviate rollout not ready yet"

info "Waiting for embeddings rollout..."
kubectl rollout status deployment/embeddings -n "$NS" --timeout=300s || warn "embeddings rollout not ready yet"

info "Waiting for mcp-code-search rollout..."
kubectl rollout status deployment/mcp-code-search -n "$NS" --timeout=180s || warn "mcp-code-search rollout not ready yet"

info "Checking CodeChunk schema (must include codebase_id)"
API_POD="$(kubectl get pod -n "$NS" -l component=api-server -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [[ -n "$API_POD" ]]; then
  SCHEMA_PROPS="$(kubectl exec -n "$NS" "$API_POD" -- node -e '
fetch("http://weaviate:8080/v1/schema").then(r=>r.json()).then(d=>{
  const c=(d.classes||[]).find(x=>x.class==="CodeChunk");
  console.log(c?c.properties.map(p=>p.name).join(","):"MISSING");
}).catch(e=>console.log("ERR:"+e.message));
' 2>/dev/null | tail -1 || true)"
  echo "  props: ${SCHEMA_PROPS}"
  if [[ "$SCHEMA_PROPS" != *"codebase_id"* ]]; then
    warn "Broken/missing CodeChunk schema — deleting and restarting mcp-code-search"
    kubectl exec -n "$NS" "$API_POD" -- node -e '
fetch("http://weaviate:8080/v1/schema/CodeChunk",{method:"DELETE"})
  .then(async r=>console.log("delete",r.status)).catch(e=>console.log(e.message));
' >/dev/null 2>&1 || true
    kubectl rollout restart "deployment/mcp-code-search" -n "$NS"
    kubectl rollout status deployment/mcp-code-search -n "$NS" --timeout=180s || true
  else
    success "CodeChunk schema looks good"
  fi
else
  warn "api-server pod not found — skipped schema check"
fi

info "Waiting for llamaindex-agent rollout..."
kubectl rollout status deployment/llamaindex-agent -n "$NS" --timeout=180s || warn "llamaindex-agent rollout not ready yet"

echo
info "Pod status:"
kubectl get pods -n "$NS" -l 'component in (weaviate,embeddings,mcp-code-search,llamaindex-agent)' -o wide || true
echo
info "Services:"
kubectl get svc -n "$NS" weaviate embeddings mcp-code-search llamaindex-agent || true
echo
info "Indexed codebases:"
kubectl exec -n "$NS" deploy/mcp-code-search -- wget -qO- http://localhost:8095/codebases 2>/dev/null || echo "(could not list)"
echo
success "RAG stack deploy finished for $NS"
echo "Next: open https://ai-demo.ping-devops.com/code-search , refresh, select a codebase, retry Ask."
echo "If the list is empty, Upload & Index a ZIP/folder first (SE cluster has no /repo default index)."
echo "If Ask still fails: kubectl logs -n $NS deploy/llamaindex-agent --tail=80"
