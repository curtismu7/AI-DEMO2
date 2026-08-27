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

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
die()     { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# local-image:ghcr-image pairs (indexed array — works on macOS bash 3.2)
IMAGE_MAP=(
  "ai-demo-k8-ui:ai-demo-frontend"
  "ai-demo-k8-api-server:ai-demo-demo-api-server"
  "ai-demo-k8-mcp-server:ai-demo-mcp-server"
  "ai-demo-k8-mcp-gateway:ai-demo-mcp-gateway"
  "ai-demo-k8-authz-server:ai-demo-authz-server"
  "ai-demo-k8-agent-service:ai-demo-agent-service"
  "ai-demo-k8-hitl-service:ai-demo-hitl-service"
  "ai-demo-k8-mcp-resource-server:ai-demo-mcp-resource-server"
  "ai-demo-k8-api-resource-server:ai-demo-api-resource-server"
  "ai-demo-k8-langchain-agent:ai-demo-langchain-agent"
  "ai-demo-k8-openai-agent:ai-demo-openai-agent"
  "ai-demo-k8-mastra-agent:ai-demo-mastra-agent"
  "ai-demo-k8-pydantic-agent:ai-demo-pydantic-agent"
  "ai-demo-k8-llm-proxy:ai-demo-llm-proxy"
  "ai-demo-k8-tier-manager:ai-demo-tier-manager"
  "ai-demo-k8-mcp-code-search:ai-demo-mcp-code-search"
  "ai-demo-k8-llamaindex-agent:ai-demo-llamaindex-agent"
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
  # Always pull from GHCR (never use a cached local image). // = replace ALL
  # occurrences: multi-container manifests (mcp-gateway + authz-server sidecar)
  # have several imagePullPolicy lines; a single / left the sidecar on
  # IfNotPresent, pinning it to whatever stale image the node had cached.
  content="${content//imagePullPolicy: IfNotPresent/imagePullPolicy: Always}"
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
# MCPGW_APP_NAME: Privilege console app name (AI Security > Agentic Apps).
# mcpgw binary routes /mcpgw/<app-name>/mcp — set to match the registered name.
K8S_NAMESPACE="$NS" MCPGW_APP_NAME="${MCPGW_APP_NAME:-}" bash "$K8S_DIR/create-secrets.sh"

# OTel bootstrap script mounted at /otel in every instrumented Node service
# (mirrors docker-compose's ./scripts/otel-instrument.js bind mount).
info "Creating otel-instrument ConfigMap..."
kubectl create configmap otel-instrument \
  --from-file=otel-instrument.js="$K8S_DIR/../scripts/otel-instrument.js" \
  -n "$NS" --dry-run=client -o yaml | kubectl apply -f -

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
# Durable OAuth state for mcp-server's embedded AS (dynamically-registered MCP
# clients). Same reason: standalone file, and the deployment that mounts it
# cannot schedule until the claim exists.
apply_patched "$K8S_DIR/31-mcp-server-oauth-state-pvc.yaml"

# Deploy in dependency order (jaeger first so the OTLP collector is up before
# the instrumented services start exporting spans).
#
# ORDER IS LOAD-BEARING at the end of this list: nginx resolves the literal
# upstream in `proxy_pass http://grafana` at STARTUP and exits when it does not
# resolve ("host not found in upstream"). A frontend applied before the grafana
# Service exists does not degrade to a broken /grafana — it crash-loops and the
# WHOLE site is down. So 76/77 come before 10-frontend, and anything that adds a
# new literal upstream to the nginx configmap must add its Service here too.
for manifest in \
  73-jaeger-deployment.yaml \
  30-mcp-server-deployment.yaml \
  63-mcp-resource-server-deployment.yaml \
  64-api-resource-server-deployment.yaml \
  62-hitl-service-deployment.yaml \
  56-llm-stack.yaml \
  72-rag-stack.yaml \
  20-api-server-deployment.yaml \
  60-mcp-gateway-deployment.yaml \
  71-ping-gateway-deployment.yaml \
  61-agent-service-deployment.yaml \
  40-agent-service-deployment.yaml \
  65-mastra-agent-deployment.yaml \
  66-openai-agent-deployment.yaml \
  67-pydantic-agent-deployment.yaml \
  76-prometheus-deployment.yaml \
  77-grafana-deployment.yaml \
  10-frontend-deployment.yaml; do
  info "Applying $manifest..."
  apply_patched "$K8S_DIR/$manifest"
done

# MCPGW chart (k8s/helm/mcpgw): installs the OpenSearch backend only. The
# agent-based Privilege GATEWAY pod is disabled by default as of 2026-08-26 —
# it runs only in ping-devops-curtismuir (release cm-mcpgw); see
# k8s/helm/mcpgw/values.yaml mcpgw.enabled for the full reasoning.
#
# This block no longer reads ENV_PROXY_TOKEN. It used to pass the token via
# --set-file (never --set-string, which corrupts long JWTs during Helm's own
# CLI arg parsing) — that is gone with the gateway pod, so an expired token is
# no longer a deploy failure. Re-enabling the gateway means restoring both.
#
# Still installed on every SE deploy by default, because the OpenSearch backend
# is real and other things point at it. Opt out with SKIP_MCPGW=1.
MCPGW_DEPLOY_FAILED=0
MCPGW_FAILURE_REASON=""
if [[ -n "${PUBLIC_APP_URL:-}" && "${SKIP_MCPGW:-0}" != "1" ]]; then
  if ! command -v helm >/dev/null 2>&1; then
    warn "  helm not installed — MCPGW OpenSearch backend cannot be deployed"
    MCPGW_DEPLOY_FAILED=1
    MCPGW_FAILURE_REASON="helm is not installed (brew install helm)"
  else
    # The gateway pod itself is OFF (chart default mcpgw.enabled=false, 2026-08-26):
    # the agent-based Privilege gateway lives ONLY in ping-devops-curtismuir
    # (release cm-mcpgw). The copy installed here was a redundant duplicate whose
    # ENV_PROXY_TOKEN is single-use and ~2h-lived, so every deploy reinstalled a
    # pod that could never start and left smoke.sh reporting the demo "degraded".
    #
    # No token is read any more, and a missing/expired one is no longer a deploy
    # failure — there is nothing here for it to authenticate. Deleting the pod by
    # hand never held, because THIS block recreated it on the next deploy of any
    # service; disabling it in the chart is what makes that stick.
    #
    # The OpenSearch pieces are NOT the gateway and stay deployed — they are a
    # real backend other things point at, so the release is still installed.
    mcpgw_host="${PUBLIC_APP_URL#https://}"
    mcpgw_host="${mcpgw_host#http://}"
    info "Deploying MCPGW OpenSearch backend (Helm) — gateway pod disabled, see k8s/helm/mcpgw/values.yaml"
    helm upgrade --install ping-mcpgw "$K8S_DIR/helm/mcpgw" \
      --namespace "$NS" \
      --set mcpgw.hostname="$mcpgw_host" \
      --set mcpgw.serverUrl="${PUBLIC_APP_URL}/mcpgw" \
      --set opensearch.enabled=true \
      --set opensearchMcpServer.enabled=true
  fi

  # ── Agentless Privilege gateway ──────────────────────────────────────────
  # Its own Helm release, from a chart outside k8s/ entirely
  # (pingone-privgateway-helm-main/agentless/agentless-mcpgw).
  #
  # Deliberately NOT a plain `helm upgrade --install`: the gateway's proxy token
  # is single-use and valid ~2h, so reinstalling on every deploy would recreate
  # a pod with a dead token and CrashLoopBackOff — exactly the failure that made
  # mcpgw.enabled false above. Three cases:
  #
  #   release already present   -> left strictly alone (never disturb a running
  #                                gateway; upgrades are a deliberate manual act)
  #   absent + token supplied   -> installed
  #   absent + no token         -> LOUD warning, never silence
  #
  # That last case is why this block exists. On 2026-08-27 `se-undeploy` deleted
  # this release and the next `se-deploy` said nothing about it, so the agentless
  # demo was simply missing until a console screenshot showed one gateway where
  # there should have been two.
  agentless_chart="$K8S_DIR/../pingone-privgateway-helm-main/agentless/agentless-mcpgw"
  if [[ -d "$agentless_chart" ]]; then
    if helm status agentless-mcpgw --namespace "$NS" &>/dev/null; then
      info "Agentless gateway: release present — left untouched (upgrade it deliberately, not via deploy)"
    else
      # Token from AGENTLESS_PROXY_TOKEN, or a file named by
      # AGENTLESS_PROXY_TOKEN_FILE. Generate one in the Privilege console:
      # Gateways -> Add New -> Add via Docker, and copy the ENV_PROXY_TOKEN value.
      agentless_token="${AGENTLESS_PROXY_TOKEN:-}"
      if [[ -z "$agentless_token" && -n "${AGENTLESS_PROXY_TOKEN_FILE:-}" && -r "${AGENTLESS_PROXY_TOKEN_FILE}" ]]; then
        agentless_token="$(tr -d '[:space:]' < "${AGENTLESS_PROXY_TOKEN_FILE}")"
      fi

      if [[ -z "$agentless_token" ]]; then
        warn "Agentless gateway MISSING and no token supplied — the Privilege agentless demo will not work."
        warn "  Its release was not found in $NS, and this deploy cannot recreate it without a registration token."
        warn "  Fix: Privilege console -> Gateways -> Add New -> Add via Docker, copy ENV_PROXY_TOKEN, then:"
        warn "    AGENTLESS_PROXY_TOKEN=<token> ./run-k8.sh se-deploy    (or install the chart directly)"
      else
        # OIDC settings come from the secret create-secrets.sh wrote earlier in
        # this same run, so there is exactly one source for them.
        _agl() { kubectl get secret ai-demo-secrets -n "$NS" -o jsonpath="{.data.$1}" 2>/dev/null | base64 -d; }
        agentless_host="${AGENTLESS_HOSTNAME:-}"
        if [[ -z "$agentless_host" ]]; then
          agentless_host="$(_agl PRIVILEGE_AGENTLESS_MCPGW_URL)"
          agentless_host="${agentless_host#https://}"
          agentless_host="${agentless_host%%/*}"
        fi
        agentless_env="$(_agl PRIVILEGE_SSO_ENV_ID)"
        agentless_cid="$(_agl PRIVILEGE_SSO_CLIENT_ID)"
        agentless_sec="$(_agl PRIVILEGE_SSO_CLIENT_SECRET)"

        if [[ -z "$agentless_host" || -z "$agentless_env" || -z "$agentless_cid" ]]; then
          warn "Agentless gateway: token supplied but PRIVILEGE_* values are missing from ai-demo-secrets — skipping rather than installing a gateway that cannot authenticate."
        else
          info "Agentless gateway: absent and token supplied — installing at $agentless_host"
          helm install agentless-mcpgw "$agentless_chart" \
            --namespace "$NS" \
            --set hostname="$agentless_host" \
            --set namespace="$NS" \
            --set proxyToken="$agentless_token" \
            --set opensearch.enabled=false \
            --set opensearchMcpServer.enabled=false \
            --set oidc.serverUrl="https://$agentless_host" \
            --set oidc.clientId="$agentless_cid" \
            --set oidc.clientSecret="$agentless_sec" \
            --set oidc.authUrl="https://auth.pingone.com/$agentless_env/as/authorize" \
            --set oidc.tokenUrl="https://auth.pingone.com/$agentless_env/as/token" \
            --set oidc.userUrl="https://auth.pingone.com/$agentless_env/as/userinfo" \
            || warn "Agentless gateway install failed — the rest of the stack is unaffected"
        fi
      fi
    fi
  fi
fi

if [[ -n "$K8S_NAMESPACE" ]]; then
  info "Applying SE cluster ingress..."
  sed "s|<<NAMESPACE>>|$NS|g" "$SCRIPT_DIR/se-ingress.yaml" | kubectl apply -f -

  # SSL-passthrough ingress for the Privilege gateway, on its own dedicated
  # hostname (see mcpgw-passthrough-ingress.yaml's header comment for why it
  # can't share the app's host/path). Requires DNS already pointed at the
  # nginx-public-passthrough LoadBalancer — set MCPGW_HOSTNAME once that's
  # done; skipped with a warning otherwise, rest of the stack still deploys.
  if [[ -n "${MCPGW_HOSTNAME:-}" ]]; then
    info "Applying Privilege gateway passthrough ingress: $MCPGW_HOSTNAME"
    sed -e "s|<<NAMESPACE>>|$NS|g" -e "s|<<MCPGW_HOSTNAME>>|$MCPGW_HOSTNAME|g" \
      "$SCRIPT_DIR/mcpgw-passthrough-ingress.yaml" | kubectl apply -f -
  else
    info "MCPGW_HOSTNAME not set — skipping Privilege gateway ingress (gateway itself still deploys)"
  fi

  # mcpgw-agentless-ingress.yaml + mcpgw-wildcard-certificate.yaml route via the
  # mcpgw binary's agentless-mode upstream-vhost/Frontend-Name mechanism, which
  # only exists on the untested privilege-mcpgw binary — cyonproxy (what's
  # actually deployed, via Helm above) has no equivalent and would just 502
  # forever behind a real-looking Ingress + cert-manager Certificate. Skipped
  # until agentless mode is verified against the mcpgw binary; see
  # k8s/helm/mcpgw and 75-ping-mcpgw-deployment.yaml's header comment.
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

info "Starting RAG stack by default..."
kubectl scale deployment/weaviate deployment/embeddings deployment/mcp-code-search deployment/llamaindex-agent \
  -n "$NS" --replicas=1

info "Waiting for rollouts (timeout 3m each)..."
for dep in jaeger mcp-server mcp-resource-server api-resource-server hitl-service \
           llm-proxy tier-manager demo-api-server mcp-gateway agent-service langchain-agent \
           mastra-agent openai-agent pydantic-agent frontend weaviate embeddings \
           mcp-code-search llamaindex-agent; do
  kubectl rollout status "deployment/$dep" -n "$NS" --timeout=180s
done
kubectl rollout status "deployment/llama-tier1" -n "$NS" --timeout=900s \
  || info "WARNING: llama-tier1 not ready yet — model may still be downloading from HuggingFace"

# ── Reset runtime demo flags to demo defaults ────────────────────────────────
# The LMDB runtime KV (PVC-backed) beats env for these keys, so a QuickFlags
# click or Gateway Tester preset from a previous session survives deploys and
# silently changes agent behavior (heuristics off / mock Authorize on broke
# the live demo). Opt out with SKIP_DEMO_FLAG_RESET=1.
if [[ "${SKIP_DEMO_FLAG_RESET:-0}" != "1" ]]; then
  info "Resetting runtime demo flags to demo defaults..."
  # Retry once: `kubectl exec` against a pod that has just been rolled fails
  # intermittently with an OCI runtime "write init-p: broken pipe", which has
  # nothing to do with the script and succeeds on a second attempt. Observed
  # 2026-08-27 — the first attempt failed, SE kept a previous session's flag
  # values for an hour, and the only trace was the warning below scrolling past.
  # A silent no-op here is exactly the failure this reset exists to prevent.
  reset_demo_flags() {
    kubectl exec -n "$NS" deploy/demo-api-server -- node scripts/reset-demo-flags.js
  }
  reset_ok=0
  if reset_demo_flags; then
    reset_ok=1
  else
    info "demo-flag reset failed (often a transient exec error) — retrying once..."
    sleep 5
    reset_demo_flags && reset_ok=1
  fi
  if [[ "$reset_ok" == "1" ]]; then
    kubectl rollout restart deployment/demo-api-server -n "$NS" \
      && kubectl rollout status deployment/demo-api-server -n "$NS" --timeout=180s
  else
    info "WARNING: demo-flag reset failed twice — flags keep their previous runtime values"
  fi
fi

success "Deploy complete."
echo
if [[ -n "$K8S_NAMESPACE" ]]; then
  kubectl get ingress ai-demo-ingress -n "$NS" 2>/dev/null && \
    echo "App URL: https://ai-demo.ping-devops.com (DNS may take a few minutes)" || true
else
  kubectl get ingress ai-demo-ingress -n "$NS" 2>/dev/null && \
    echo "ALB hostname shown above under ADDRESS. May take 2-3 minutes to provision." || true
fi

if [[ "$MCPGW_DEPLOY_FAILED" == "1" ]]; then
  echo
  echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"
  echo -e "${RED}  MCPGW OpenSearch backend was NOT deployed: $MCPGW_FAILURE_REASON${NC}"
  echo -e "${RED}  The rest of the stack above deployed fine.${NC}"
  echo -e "${RED}${NC}"
  echo -e "${RED}  Fix: brew install helm, then: ./run-pingaws.sh deploy${NC}"
  echo -e "${RED}${NC}"
  echo -e "${RED}  NB: this no longer means a missing or expired proxy token. The${NC}"
  echo -e "${RED}  agent-based Privilege gateway is not installed in this namespace${NC}"
  echo -e "${RED}  at all (it runs only in ping-devops-curtismuir) — see${NC}"
  echo -e "${RED}  k8s/helm/mcpgw/values.yaml mcpgw.enabled.${NC}"
  echo -e "${RED}${NC}"
  echo -e "${RED}  To deploy without it on purpose: SKIP_MCPGW=1 ./run-pingaws.sh deploy${NC}"
  echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"
  exit 1
fi
