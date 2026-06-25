#!/bin/bash
# k8s/update.sh — rebuild image(s) and roll the K8s deployment(s) to pick them up.
#
# Because images are :latest with imagePullPolicy: IfNotPresent, a rebuild alone
# does NOT update running pods — they must be recreated. This script does both.
#
# Usage:
#   ./k8s/update.sh                          # rebuild ALL images, restart ALL 12 deployments
#   ./k8s/update.sh mcp-gateway agent-service# rebuild + restart only those
#   ./k8s/update.sh --secrets                # also re-create secrets from .env files first
#   ./k8s/update.sh --config                 # also re-apply the configmap first
#   ./k8s/update.sh --secrets --config mcp-server
#
# Service names: use the docker-compose / deployment name (they match, except
# the UI is `ui` in compose and `frontend` in K8s — either is accepted).

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="ai-demo"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
die()     { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Name mapping (compose name <-> K8s deployment name) ──────────────────────
to_compose() { case "$1" in frontend) echo ui;;        *) echo "$1";; esac; }
to_k8s()     { case "$1" in ui)       echo frontend;;  *) echo "$1";; esac; }

# ── Parse flags + service list ───────────────────────────────────────────────
DO_SECRETS=false
DO_CONFIG=false
SERVICES=()
for arg in "$@"; do
  case "$arg" in
    --secrets) DO_SECRETS=true ;;
    --config)  DO_CONFIG=true ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*)       die "Unknown flag: $arg" ;;
    *)         SERVICES+=("$arg") ;;
  esac
done

command -v kubectl &>/dev/null || die "kubectl not found"
kubectl get ns "$NS" &>/dev/null || die "Namespace $NS not found — run ./k8s/deploy.sh first."

# ── 1. Optional: refresh secrets / configmap (read only at pod boot) ─────────
if $DO_SECRETS; then
  info "Re-creating secrets from .env files..."
  bash "$SCRIPT_DIR/create-secrets.sh"
fi
if $DO_CONFIG; then
  # Drift gate: never apply a configmap that diverged from the SoT
  # (service-topology.json). run-k8.sh deploy already gates on this; update.sh
  # --config bypassed it, which is how stale URLs/audiences caused the 502/401
  # cold-start bugs. Validate before applying.
  info "Validating configmap against service-topology.json (drift gate)..."
  node "$REPO_ROOT/scripts/gen-service-topology.js" check \
    || die "Configmap drifted from service-topology.json — run 'npm run topology:generate' and commit, then retry."
  info "Re-applying configmap..."
  kubectl apply -f "$SCRIPT_DIR/02-configmap.yaml"
fi

# ── 2. Rebuild image(s) ──────────────────────────────────────────────────────
if [ "${#SERVICES[@]}" -eq 0 ]; then
  info "Rebuilding ALL images (docker compose build)..."
  ( cd "$REPO_ROOT" && docker compose build )
else
  compose_names=()
  for s in "${SERVICES[@]}"; do compose_names+=("$(to_compose "$s")"); done
  info "Rebuilding: ${compose_names[*]}"
  ( cd "$REPO_ROOT" && docker compose build "${compose_names[@]}" )
fi

# ── 3. Restart deployment(s) so new images are pulled into fresh pods ────────
if [ "${#SERVICES[@]}" -eq 0 ]; then
  info "Restarting ALL deployments..."
  kubectl rollout restart deployment -n "$NS"
  info "Waiting for rollouts..."
  kubectl rollout status deployment -n "$NS" --timeout=180s
else
  k8s_names=()
  for s in "${SERVICES[@]}"; do k8s_names+=("$(to_k8s "$s")"); done
  info "Restarting: ${k8s_names[*]}"
  for d in "${k8s_names[@]}"; do
    kubectl rollout restart "deployment/$d" -n "$NS"
  done
  info "Waiting for rollouts..."
  for d in "${k8s_names[@]}"; do
    kubectl rollout status "deployment/$d" -n "$NS" --timeout=180s
  done
fi

success "Update complete."
kubectl get pods -n "$NS"
