#!/bin/bash
# Seal secrets for K8s deployment
# Encrypts K8s Secrets at rest in etcd using sealed-secrets controller
#
# Usage:
#   1. Install sealed-secrets: kubectl apply -f k8s/00-sealed-secrets-install.yaml
#   2. Wait for controller to start: kubectl get deploy -n kube-system sealed-secrets-controller
#   3. Seal secrets: k8s/sealed-secrets.sh
#
# Output: k8s/04-sealed-secrets.yaml (committed to git, safe to share)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${K8S_NAMESPACE:-ai-demo}"

# Resolve assets from primary checkout if in a worktree
ASSET_ROOT="$REPO_ROOT"
if [ ! -f "$ASSET_ROOT/demo_api_server/.env" ]; then
  if git_common="$(git -C "$REPO_ROOT" rev-parse --git-common-dir 2>/dev/null)"; then
    case "$git_common" in
      /*) : ;;
      *)  git_common="$REPO_ROOT/$git_common" ;;
    esac
    primary_root="$(cd "$(dirname "$git_common")" && pwd)"
    if [ "$primary_root" != "$REPO_ROOT" ] && [ -f "$primary_root/demo_api_server/.env" ]; then
      ASSET_ROOT="$primary_root"
    fi
  fi
fi

echo "[INFO] Sealing secrets for namespace: $NS"
echo "[INFO] Using assets from: $ASSET_ROOT"

# Check sealed-secrets controller is running
if ! kubectl get deploy sealed-secrets-controller -n kube-system &>/dev/null; then
  echo "[ERROR] sealed-secrets-controller not found. Install first:"
  echo "  kubectl apply -f k8s/00-sealed-secrets-install.yaml"
  exit 1
fi

# Create regular secret (intermediate step)
kubectl -n "$NS" create secret generic ai-demo-secrets \
  --from-env-file="$ASSET_ROOT/demo_api_server/.env" \
  --dry-run=client -o yaml | \
  kubeseal -n "$NS" -o yaml > "$SCRIPT_DIR/04-sealed-secrets.yaml"

echo "[INFO] Sealed secrets written to: $SCRIPT_DIR/04-sealed-secrets.yaml"
echo "[INFO] This file is safe to commit (encrypted at rest in etcd only)."
echo "[INFO] Apply with: kubectl apply -f k8s/04-sealed-secrets.yaml"
