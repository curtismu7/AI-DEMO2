#!/usr/bin/env bash
# install.sh — one-command deploy of the whole AI-DEMO2 stack + Privilege gateway
# via the ai-demo-stack Helm chart, on the Ping SE AWS cluster.
#
# Why this script exists instead of a pure Helm hook: a Kubernetes-native Helm
# hook (a Job running inside the cluster) cannot read your local `gh auth`
# session or local gitignored .env files — both are required to build the
# GHCR pull secret and the app's own secrets. Those two steps stay local,
# client-side, exactly like k8s/aws/deploy.sh already does them; everything
# else (all workload manifests + the mcpgw gateway) is one `helm upgrade
# --install` against ai-demo-stack/, run from this script.
#
# Usage:
#   GITHUB_OWNER=curtismu7 ./install.sh
#
# Env vars:
#   GITHUB_OWNER    — GHCR owner (required, images at ghcr.io/OWNER/...)
#   IMAGE_TAG       — image tag to deploy (default: latest)
#   SE_NAMESPACE    — override namespace (default: derived from PING_EMAIL /
#                     demo_api_server/.env, same as run-pingaws.sh)
#   PUBLIC_APP_URL  — public origin (default: https://ai-demo.ping-devops.com)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHART_DIR="$SCRIPT_DIR/ai-demo-stack"
K8S_DIR="$REPO_ROOT/k8s"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
die()     { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

[[ -n "${GITHUB_OWNER:-}" ]] || die "GITHUB_OWNER is required (images at ghcr.io/\$GITHUB_OWNER/...)"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PUBLIC_APP_URL="${PUBLIC_APP_URL:-https://ai-demo.ping-devops.com}"

command -v helm >/dev/null 2>&1 || die "helm not installed"
command -v kubectl >/dev/null 2>&1 || die "kubectl not installed"
command -v gh >/dev/null 2>&1 || die "gh (GitHub CLI) not installed — needed for the GHCR pull secret"

# Namespace: run-k8.sh's derive_se_namespace() has multi-source fallback +
# interactive prompt logic not worth duplicating here (and its file isn't
# safe to source — it has top-level command dispatch). Require it explicit;
# `./run-pingaws.sh status` will print the namespace it derived, if unsure.
[[ -n "${SE_NAMESPACE:-}" ]] || die "SE_NAMESPACE is required, e.g. SE_NAMESPACE=ping-devops-cmuir ./install.sh (run './run-pingaws.sh status' from the repo root first if unsure which namespace is yours)"
NS="$SE_NAMESPACE"
info "Target namespace: $NS"

kubectl get namespace "$NS" &>/dev/null \
  || die "Namespace '$NS' not found — request it via JIRA DEVHELP before deploying"

# Step 1 (local-only) — GHCR pull secret, from your local gh auth session.
info "Creating GHCR pull secret..."
kubectl create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io \
  --docker-username="$GITHUB_OWNER" \
  --docker-password="$(gh auth token)" \
  -n "$NS" --dry-run=client -o yaml | kubectl apply -f -
kubectl patch serviceaccount default -n "$NS" \
  -p '{"imagePullSecrets": [{"name": "ghcr-pull-secret"}]}' || true

# Step 2 (local-only) — app secrets, from your local gitignored .env files.
info "Creating app secrets from local .env files (create-secrets.sh)..."
K8S_NAMESPACE="$NS" bash "$K8S_DIR/create-secrets.sh"

# Step 3 — everything else, as one Helm release.
info "Deploying ai-demo-stack (Helm)..."
helm dependency update "$CHART_DIR"

# helm reads ENV_PROXY_TOKEN back out of the ping-mcpgw-secrets Secret that
# create-secrets.sh (step 2) just created (from ping-mcpgw/procyon/config/
# proxy-token.env) — --set-file, not --set-string, see values.yaml's comment.
MCPGW_ARGS=()
TOKEN_B64="$(kubectl get secret ping-mcpgw-secrets -n "$NS" -o jsonpath='{.data.ENV_PROXY_TOKEN}' 2>/dev/null || true)"
if [[ -n "$TOKEN_B64" ]]; then
  TMP_TOKEN="$(mktemp)"
  trap 'rm -f "$TMP_TOKEN"' EXIT
  echo "$TOKEN_B64" | base64 -d > "$TMP_TOKEN"
  MCPGW_ARGS+=(--set-file "privgateway.mcpgw.proxyToken=$TMP_TOKEN")
else
  info "No ping-mcpgw-secrets ENV_PROXY_TOKEN found (needs ping-mcpgw/procyon/config/proxy-token.env before step 2) — deploying with privgateway.enabled=false"
  MCPGW_ARGS+=(--set privgateway.enabled=false)
fi

helm upgrade --install ai-demo-stack "$CHART_DIR" \
  --namespace "$NS" \
  --set imageRegistry="ghcr.io/${GITHUB_OWNER}" \
  --set imageTag="$IMAGE_TAG" \
  --set privgateway.mcpgw.hostname="${PUBLIC_APP_URL#https://}" \
  --set privgateway.mcpgw.serverUrl="$PUBLIC_APP_URL" \
  "${MCPGW_ARGS[@]}"

# Step 4 (local-only) — public origin patch, same logic deploy.sh uses
# (derived from service-topology.json so a newly added public-derived
# configmap key can't be missed here).
info "Overriding public origin in configmap: $PUBLIC_APP_URL"
patch_json="$(node "$REPO_ROOT/scripts/gen-service-topology.js" public-patch "$PUBLIC_APP_URL")"
kubectl patch configmap ai-demo-config -n "$NS" --type merge -p "$patch_json"

# Step 5 — SE ingress (not part of the Helm release; matches k8s/aws/deploy.sh).
info "Applying SE cluster ingress..."
sed "s|<<NAMESPACE>>|$NS|g" "$K8S_DIR/aws/se-ingress.yaml" | kubectl apply -f -

success "Deployed. App: $PUBLIC_APP_URL  |  Gateway: $PUBLIC_APP_URL/mcpgw"
success "Verify: kubectl get pods -n $NS"
