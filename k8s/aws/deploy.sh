#!/usr/bin/env bash
# k8s/aws/deploy.sh — Deploy AI Demo using GHCR images.
#
# Works for EKS, the Ping SE DevOps cluster, and local OrbStack simulation:
#   - Set EKS_CLUSTER_NAME to deploy to AWS EKS (updates kubeconfig automatically)
#   - Set K8S_NAMESPACE to deploy into a pre-existing namespace (e.g. SE cluster)
#   - Omit both to target the current kubectl context/namespace (local sim)
#
# Required env vars:
#   GITHUB_OWNER     — GitHub username or org (images at ghcr.io/OWNER/...)
#   IMAGE_TAG        — Docker image tag to deploy (default: latest)
#
# AWS EKS-only env vars:
#   AWS_REGION          — e.g. us-east-1
#   EKS_CLUSTER_NAME    — EKS cluster name
#   ACM_CERTIFICATE_ARN — ACM cert ARN substituted into ingress.yaml for HTTPS
#
# SE cluster / shared cluster env vars:
#   K8S_NAMESPACE    — pre-existing namespace to deploy into (e.g. ping-devops-cmuir)
#                      when set, namespace creation is skipped and SE ingress is used
#
# Common env vars:
#   PUBLIC_APP_URL   — public origin served (e.g. https://ai-demo.ping-devops.com);
#                      overrides the configmap's local api.ping.demo:4000 URLs
#
# Usage (SE DevOps cluster):
#   GITHUB_OWNER=curtismu7 K8S_NAMESPACE=ping-devops-cmuir \
#   PUBLIC_APP_URL=https://ai-demo.ping-devops.com ./k8s/aws/deploy.sh
#
# Usage (AWS EKS):
#   GITHUB_OWNER=myorg AWS_REGION=us-east-1 EKS_CLUSTER_NAME=ai-demo-cluster \
#   IMAGE_TAG=abc1234 ./k8s/aws/deploy.sh
#
# Usage (local sim):
#   GITHUB_OWNER=myorg IMAGE_TAG=latest ./k8s/aws/deploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
K8S_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# K8S_NAMESPACE: use pre-existing namespace (SE cluster) or default ai-demo (EKS/local)
K8S_NAMESPACE="${K8S_NAMESPACE:-}"
NS="${K8S_NAMESPACE:-ai-demo}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

GITHUB_OWNER="${GITHUB_OWNER:?Set GITHUB_OWNER (your GitHub username or org)}"
GHCR_REGISTRY="ghcr.io/$(echo "$GITHUB_OWNER" | tr '[:upper:]' '[:lower:]')"

# EKS_CLUSTER_NAME is optional — omit to target current kubectl context (local sim)
EKS_CLUSTER_NAME="${EKS_CLUSTER_NAME:-}"
AWS_REGION="${AWS_REGION:-}"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
die()     { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# local-image:ghcr-image pairs (indexed array — works on macOS bash 3.2)
IMAGE_MAP=(
  "ai-demo-ui:ai-demo-frontend"
  "ai-demo-api-server:ai-demo-demo-api-server"
  "ai-demo-mcp-server:ai-demo-mcp-server"
  "ai-demo-mcp-gateway:ai-demo-mcp-gateway"
  "ai-demo-authz-server:ai-demo-authz-server"
  "ai-demo-agent-service:ai-demo-agent-service"
  "ai-demo-hitl-service:ai-demo-hitl-service"
  "ai-demo-mcp-invest:ai-demo-mcp-invest"
  "ai-demo-mortgage-service:ai-demo-mortgage-service"
  "ai-demo-langchain-agent:ai-demo-langchain-agent"
  "ai-demo-openai-agent:ai-demo-openai-agent"
  "ai-demo-mastra-agent:ai-demo-mastra-agent"
  "ai-demo-pydantic-agent:ai-demo-pydantic-agent"
  "ai-demo-llm-proxy:ai-demo-llm-proxy"
  "ai-demo-tier-manager:ai-demo-tier-manager"
)

# Rewrite image refs in a YAML: local name → GHCR URI
patch_images() {
  local content="$1"
  for entry in "${IMAGE_MAP[@]}"; do
    local local_name="${entry%%:*}"
    local ghcr_name="${entry##*:}"
    local ghcr_uri="${GHCR_REGISTRY}/${ghcr_name}:${IMAGE_TAG}"
    content="${content/image: ${local_name}:latest/image: ${ghcr_uri}}"
  done
  # Always pull from GHCR (never use a cached local image)
  content="${content/imagePullPolicy: IfNotPresent/imagePullPolicy: Always}"
  echo "$content"
}

apply_patched() {
  local file="$1"
  local content
  content=$(cat "$file")
  content=$(patch_images "$content")
  # When deploying to a non-default namespace (SE cluster), rewrite every
  # hardcoded "namespace: ai-demo" in the manifest to the target namespace
  # so kubectl doesn't reject the mismatch.
  if [[ "$NS" != "ai-demo" ]]; then
    content="${content//namespace: ai-demo/namespace: $NS}"
  fi
  echo "$content" | kubectl apply -f - -n "$NS"
}

if [[ -n "$EKS_CLUSTER_NAME" ]]; then
  info "Updating kubeconfig for EKS cluster: $EKS_CLUSTER_NAME"
  aws eks update-kubeconfig --name "$EKS_CLUSTER_NAME" --region "$AWS_REGION"
else
  info "No EKS_CLUSTER_NAME set — targeting current kubectl context ($(kubectl config current-context))"
fi

info "Deploying to namespace: $NS"
if [[ -n "$K8S_NAMESPACE" ]]; then
  # SE/shared cluster — namespace is pre-provisioned; just verify it exists
  kubectl get namespace "$NS" &>/dev/null \
    || die "Namespace '$NS' not found — request it via JIRA DEVHELP before deploying"
  info "Using pre-existing namespace $NS (SE cluster mode)"
else
  kubectl apply -f "$K8S_DIR/01-namespace.yaml"
fi

# Create a GHCR pull secret so containerd (OrbStack/EKS) can pull private images.
# Uses gh CLI token — idempotent (--dry-run + apply).
if command -v gh &>/dev/null; then
  info "Creating GHCR pull secret..."
  kubectl create secret docker-registry ghcr-pull-secret \
    --docker-server=ghcr.io \
    --docker-username="$GITHUB_OWNER" \
    --docker-password="$(gh auth token)" \
    -n "$NS" --dry-run=client -o yaml | kubectl apply -f -
  kubectl patch serviceaccount default -n "$NS" \
    -p '{"imagePullSecrets": [{"name": "ghcr-pull-secret"}]}' || true
  kubectl patch serviceaccount llm-tier-manager -n "$NS" \
    -p '{"imagePullSecrets": [{"name": "ghcr-pull-secret"}]}' 2>/dev/null || true
fi

info "Creating secrets from demo_api_server/.env..."
K8S_NAMESPACE="$NS" bash "$K8S_DIR/create-secrets.sh"

# Read the origin currently live in the cluster BEFORE the apply below resets
# it to the local default — decides whether pods must be rolled further down.
prev_public_origin="$(kubectl get configmap ai-demo-config -n "$NS" -o jsonpath='{.data.PUBLIC_APP_URL}' 2>/dev/null || true)"

apply_patched "$K8S_DIR/02-configmap.yaml"

# Override the nginx-config ConfigMap from 02-configmap.yaml (which contains the
# TLS config for local use) with the plain-HTTP version for ALB/SE cluster.
# Must come AFTER 02-configmap.yaml so it wins.
info "Applying nginx HTTP config (ALB/SE cluster — no TLS in pods)..."
apply_patched "$SCRIPT_DIR/nginx-http-configmap.yaml"

# Public origin: the configmap defaults every public-facing URL to the local
# https://api.ping.demo:4000. On a real cluster, set PUBLIC_APP_URL to the
# origin the ALB serves (e.g. https://demo.example.com); the patch payload is
# derived from service-topology.json (the SoT for which configmap keys follow
# the public origin) so a newly added public-derived key can't be missed here.
# The BFF derives its OAuth redirect URIs from PINGONE_PUBLIC_APP_URL, so the
# PingOne apps must also list
#   ${PUBLIC_APP_URL}/api/auth/oauth/callback
#   ${PUBLIC_APP_URL}/api/auth/oauth/user/callback
# as redirect URIs (re-run the bootstrap or update the apps in PingOne).
if [[ -n "${PUBLIC_APP_URL:-}" ]]; then
  info "Overriding public origin in configmap: $PUBLIC_APP_URL"
  patch_json="$(node "$K8S_DIR/../scripts/gen-service-topology.js" public-patch "$PUBLIC_APP_URL")"
  kubectl patch configmap ai-demo-config -n "$NS" --type merge -p "$patch_json"
  # envFrom captures env at pod start — roll any already-running deployments so
  # a changed origin takes effect on re-deploys, not just first deploys. Skip
  # the roll when the origin is unchanged (don't bounce every pod for nothing).
  # Read the key back rather than normalising the URL in shell, so the
  # comparison can never drift from the generator's normalisation.
  new_public_origin="$(kubectl get configmap ai-demo-config -n "$NS" -o jsonpath='{.data.PUBLIC_APP_URL}' 2>/dev/null || true)"
  if [[ "$prev_public_origin" != "$new_public_origin" ]]; then
    kubectl rollout restart deployment -n "$NS" 2>/dev/null || true
  fi
elif [[ -n "$EKS_CLUSTER_NAME" ]]; then
  info "WARNING: PUBLIC_APP_URL not set — OAuth redirects and CORS will point at the local default https://api.ping.demo:4000."
fi

# PVCs must exist before the deployments that mount them are scheduled.
# 21-api-server-logs-pvc.yaml is a standalone file (not bundled with a
# deployment), so we apply it explicitly here.
apply_patched "$K8S_DIR/21-api-server-logs-pvc.yaml"

# Deploy in dependency order
for manifest in \
  30-mcp-server-deployment.yaml \
  63-mcp-invest-deployment.yaml \
  64-mortgage-service-deployment.yaml \
  62-hitl-service-deployment.yaml \
  56-llm-stack.yaml \
  20-api-server-deployment.yaml \
  60-mcp-gateway-deployment.yaml \
  71-ping-gateway-deployment.yaml \
  61-agent-service-deployment.yaml \
  40-agent-service-deployment.yaml \
  65-mastra-agent-deployment.yaml \
  66-openai-agent-deployment.yaml \
  67-pydantic-agent-deployment.yaml \
  10-frontend-deployment.yaml; do
  info "Applying $manifest..."
  apply_patched "$K8S_DIR/$manifest"
done

if [[ -n "$K8S_NAMESPACE" ]]; then
  info "Applying SE cluster ingress..."
  sed "s|<<NAMESPACE>>|$NS|g" "$SCRIPT_DIR/se-ingress.yaml" | kubectl apply -f -
else
  info "Applying ALB ingress..."
  # ingress.yaml ships with a placeholder ACM cert ARN — substitute the real one
  # from ACM_CERTIFICATE_ARN so HTTPS provisions without hand-editing the file.
  ACM_PLACEHOLDER="arn:aws:acm:REGION:ACCOUNT_ID:certificate/CERT_ID"
  if [[ -n "${ACM_CERTIFICATE_ARN:-}" ]]; then
    grep -q "$ACM_PLACEHOLDER" "$SCRIPT_DIR/ingress.yaml" \
      || die "ACM placeholder not found in ingress.yaml — keep it in sync with ACM_PLACEHOLDER in $0"
  elif [[ -n "$EKS_CLUSTER_NAME" ]]; then
    info "WARNING: ACM_CERTIFICATE_ARN not set — ingress keeps the placeholder cert ARN; the ALB HTTPS listener will not provision."
  fi
  sed "s|$ACM_PLACEHOLDER|${ACM_CERTIFICATE_ARN:-$ACM_PLACEHOLDER}|" "$SCRIPT_DIR/ingress.yaml" | kubectl apply -f -
fi

info "Waiting for rollouts (timeout 3m each)..."
for dep in mcp-server mcp-invest mortgage-service hitl-service \
           llm-proxy tier-manager demo-api-server mcp-gateway agent-service langchain-agent \
           mastra-agent openai-agent pydantic-agent frontend; do
  kubectl rollout status "deployment/$dep" -n "$NS" --timeout=180s
done
kubectl rollout status "deployment/llama-tier1" -n "$NS" --timeout=900s \
  || info "WARNING: llama-tier1 not ready yet — model may still be downloading from HuggingFace"

success "Deploy complete."
echo
if [[ -n "$K8S_NAMESPACE" ]]; then
  kubectl get ingress ai-demo-ingress -n "$NS" 2>/dev/null && \
    echo "App URL: https://ai-demo.ping-devops.com (DNS may take a few minutes)" || true
else
  kubectl get ingress ai-demo-ingress -n "$NS" 2>/dev/null && \
    echo "ALB hostname shown above under ADDRESS. May take 2-3 minutes to provision." || true
fi
