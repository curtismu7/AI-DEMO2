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
#   GHCR_USERNAME    — GitHub login used for the pull secret (defaults to gh login)
#   IMAGE_TAG        — Docker image tag to deploy (default: sha-<current commit>)
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
#   GITHUB_OWNER=cmuir_pingcorp K8S_NAMESPACE=ping-devops-cmuir \
#   PUBLIC_APP_URL=https://ai-demo.ping-devops.com ./k8s/aws/deploy.sh
#
# Usage (AWS EKS):
#   GITHUB_OWNER=myorg AWS_REGION=us-east-1 EKS_CLUSTER_NAME=ai-demo-cluster \
#   IMAGE_TAG=abc1234 ./k8s/aws/deploy.sh
#
# Usage (local sim):
#   GITHUB_OWNER=myorg IMAGE_TAG=sha-<full-commit> ./k8s/aws/deploy.sh
#
# Usage (focused — one service; se-update-code.sh <svc> sets this itself):
#   FOCUS_DEPLOYMENTS=frontend IMAGE_TAG=<tag-in-ghcr> \
#     GITHUB_OWNER=myorg K8S_NAMESPACE=ping-devops-cmuir ./k8s/aws/deploy.sh
#   Only the listed deployments get their image rewritten to IMAGE_TAG and
#   waited on; other deployments keep their manifest image (no roll, no
#   retag). Requires IMAGE_TAG to actually exist in GHCR for those services.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
K8S_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# K8S_NAMESPACE: use pre-existing namespace (SE cluster) or default ai-demo (EKS/local)
K8S_NAMESPACE="${K8S_NAMESPACE:-}"
NS="${K8S_NAMESPACE:-ai-demo}"
# CI publishes commit-addressed tags. Keep deployments reproducible by
# defaulting to the current commit instead of a mutable :latest tag.
IMAGE_TAG="${IMAGE_TAG:-sha-$(git -C "$K8S_DIR" rev-parse HEAD)}"

# Environment first, then the git remote — the same fallback se-update-code.sh
# already applies before it calls this script. Without it, se-update-config.sh
# (which never sets the variable) aborted here with
# "GITHUB_OWNER: Set GITHUB_OWNER ...", but only AFTER create-secrets.sh had
# applied every secret and restarted nine deployments: a config deploy that
# looked half-done and left the manifests unapplied.
GITHUB_OWNER="${GITHUB_OWNER:-}"
if [ -z "$GITHUB_OWNER" ]; then
  GITHUB_OWNER="$(git -C "$K8S_DIR" remote get-url origin 2>/dev/null \
    | sed 's|.*github.com[:/]\([^/]*\)/.*|\1|' || true)"
fi
[ -n "$GITHUB_OWNER" ] || {
  echo "Set GITHUB_OWNER (your GitHub username or org) — could not auto-detect from the git remote" >&2
  exit 1
}
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
  "ai-demo-k8-mcp-weather:ai-demo-mcp-weather"
  "ai-demo-k8-mcp-gateway:ai-demo-mcp-gateway"
  "ai-demo-k8-authz-server:ai-demo-authz-server"
  "ai-demo-k8-agent-service:ai-demo-agent-service"
  "ai-demo-k8-hitl-service:ai-demo-hitl-service"
  "ai-demo-k8-mcp-resource-server:ai-demo-mcp-resource-server"
  "ai-demo-k8-api-resource-server:ai-demo-api-resource-server"
  "ai-demo-k8-mcp-brave:ai-demo-mcp-brave"
  "ai-demo-k8-langchain-agent:ai-demo-langchain-agent"
  "ai-demo-k8-llm-proxy:ai-demo-llm-proxy"
  "ai-demo-k8-tier-manager:ai-demo-tier-manager"
  "ai-demo-k8-mcp-code-search:ai-demo-mcp-code-search"
  "ai-demo-k8-llamaindex-agent:ai-demo-llamaindex-agent"
)

# Rewrite image refs in a YAML: local name → GHCR URI
#
# FOCUS_DEPLOYMENTS (optional, k8s deployment names, comma/space separated):
# when set, only those deployments' images are rewritten to the sha tag.
# Every other first-party image line is left EXACTLY as the manifest ships it
# (`:latest`), so `kubectl apply` sees an unchanged pod template and does not
# roll the deployment. This is what makes se-update-code.sh <svc> a genuinely
# focused deploy: local builds push only :latest (sha- tags come from CI), so
# retagging all deployments to sha-$(git rev-parse HEAD) points every
# non-built service at a tag that does not exist in GHCR (measured
# 2026-10-11: single-service deploy put 14 deployments into ImagePullBackOff).
# Unset = rewrite everything (CI / full-deploy path, unchanged behavior).
FOCUS_DEPLOYMENTS="${FOCUS_DEPLOYMENTS:-}"

# ghcr_name → k8s deployment name, derived from the map: ai-demo-<svc>. The
# authz-server sidecar lives INSIDE the mcp-gateway/ping-gateway pod templates,
# so rewriting "the mcp-gateway deployment" rewrites its sidecar too — one key
# per manifest, no separate sidecar list.
ghcr_to_dep() {
  case "$1" in
    ai-demo-*) echo "${1#ai-demo-}" ;;
    *) echo "$1" ;;
  esac
}

dep_in_focus() {
  local dep="$1"
  [[ -z "$FOCUS_DEPLOYMENTS" ]] && return 0  # unset → everything in focus
  local list=" $FOCUS_DEPLOYMENTS "
  list="${list//,/ }"
  [[ "$list" == *" $dep "* ]]
}

patch_images() {
  local content="$1"
  for entry in "${IMAGE_MAP[@]}"; do
    local local_name="${entry%%:*}"
    local ghcr_name="${entry##*:}"
    if ! dep_in_focus "$(ghcr_to_dep "$ghcr_name")"; then
      continue  # leave this service's image: line untouched — no roll
    fi
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

# Third-party images must be digest-pinned. First-party images are rewritten
# above to a commit-derived GHCR tag; every other image must carry an immutable
# sha256 digest so a hosted rollout cannot resolve a different upstream tag.
# Under FOCUS_DEPLOYMENTS, untouched first-party image lines still read
# `:latest` (that is the point — leave them alone) so they are first-party by
# registry — match them against IMAGE_MAP's local names and exempt them.
assert_pinned_external_images() {
  local content="$1"
  local image entry local_name
  while IFS= read -r image; do
    [[ -z "$image" || "$image" == "$GHCR_REGISTRY/"* ]] && continue
    for entry in "${IMAGE_MAP[@]}"; do
      local_name="${entry%%:*}"
      [[ "$image" == "$local_name":* ]] && continue 2
    done
    [[ "$image" == *@sha256:* ]] || die "External image is not digest-pinned: $image"
  done < <(printf '%s\n' "$content" | sed -nE 's/^[[:space:]]*image:[[:space:]]*([^[:space:]]+).*/\1/p')
}

apply_patched() {
  local file="$1"
  local content
  content=$(cat "$file")
  content=$(patch_images "$content")
  assert_pinned_external_images "$content"
  # When deploying to a non-default namespace (SE cluster), rewrite every
  # hardcoded "namespace: ai-demo" in the manifest to the target namespace
  # so kubectl doesn't reject the mismatch.
  if [[ "$NS" != "ai-demo" ]]; then
    content="${content//namespace: ai-demo/namespace: $NS}"
  fi
  echo "$content" | kubectl apply -f - -n "$NS"
}

# The seed Job's own "Complete" status is ephemeral (ttlSecondsAfterFinished:
# 86400 in 54-seed-llm-models.yaml, or a plain delete before a re-apply) while
# the model files it wrote to the RWO PVCs are not — so on a long-lived,
# already-serving cluster that status check goes stale and this script
# re-attempts a seed that Multi-Attaches against whichever tier/embeddings pod
# already holds the volume (measured on the SE cluster 2026-09-08 and again
# 2026-09-10, both a 45-minute wait ending in DeadlineExceeded). Checking the
# files directly, through whichever serving pod already holds the mount, needs
# no new volume attach and so cannot itself hit Multi-Attach.
models_seeded_on_disk() {
  local pod label llm_ok=0 embed_ok=0
  for label in component=llama-tier1 component=llama-tier5; do
    pod="$(kubectl get pods -n "$NS" -l "$label" --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)"
    [ -n "$pod" ] || continue
    if kubectl exec -n "$NS" "$pod" -- sh -c \
        'test -f /models/gpt-oss-20b-MXFP4.gguf && test -f /models/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf' \
        2>/dev/null; then
      llm_ok=1
      break
    fi
  done
  pod="$(kubectl get pods -n "$NS" -l component=embeddings --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)"
  if [ -n "$pod" ] && kubectl exec -n "$NS" "$pod" -- test -f /models/nomic-embed-text-v1.5.Q8_0.gguf 2>/dev/null; then
    embed_ok=1
  fi
  [ "$llm_ok" = 1 ] && [ "$embed_ok" = 1 ]
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

# Apply service network boundaries in both managed and pre-created namespaces.
# In SE mode this updates only NetworkPolicy objects; it does not patch the
# shared Namespace labels or quota.
apply_patched "$K8S_DIR/04-network-policies.yaml"

# Create a GHCR pull secret so containerd (OrbStack/EKS) can pull private images.
# Uses gh CLI token — idempotent (--dry-run + apply).
if command -v gh &>/dev/null; then
  GHCR_USERNAME="${GHCR_USERNAME:-$(gh api user -q .login 2>/dev/null || true)}"
  [ -n "$GHCR_USERNAME" ] || die "Could not determine GitHub login for GHCR pull secret; set GHCR_USERNAME"
  info "Creating GHCR pull secret..."
  kubectl create secret docker-registry ghcr-pull-secret \
    --docker-server=ghcr.io \
    --docker-username="$GHCR_USERNAME" \
    --docker-password="$(gh auth token)" \
    -n "$NS" --dry-run=client -o yaml | kubectl apply -f -
  kubectl patch serviceaccount default -n "$NS" \
    -p '{"imagePullSecrets": [{"name": "ghcr-pull-secret"}]}' || true
  kubectl patch serviceaccount llm-tier-manager -n "$NS" \
    -p '{"imagePullSecrets": [{"name": "ghcr-pull-secret"}]}' 2>/dev/null || true
fi

info "Creating secrets from demo_api_server/.env..."
# SKIP_SECRET_CREATE=1 skips this for test runs that must not touch the vault
# (create-secrets.sh prompts for the vault password when no VAULT_PASSWORD is
# set). Full deploys never set it; default behavior unchanged.
if [[ "${SKIP_SECRET_CREATE:-0}" == "1" ]]; then
  info "SKIP_SECRET_CREATE=1 — skipping create-secrets.sh"
else
# MCPGW_APP_NAME: Privilege console app name (AI Security > Agentic Apps).
# mcpgw binary routes /mcpgw/<app-name>/mcp — set to match the registered name.
K8S_NAMESPACE="$NS" \
SECURITY_HARDENED_DEPLOYMENT=true \
MCPGW_APP_NAME="${MCPGW_APP_NAME:-}" bash "$K8S_DIR/create-secrets.sh"
fi

# OTel bootstrap scripts mounted at /otel in every instrumented service
# (mirrors docker-compose's ./scripts/ bind mounts).
#
# Keep in step with the same ConfigMap in k8s/deploy.sh — the two are separate
# copies and only this one runs for SE.
#
# The Python entrypoint is NOT optional the way the Node one is: the Python
# agents' Dockerfiles set ENTRYPOINT ["/otel/otel-python-entrypoint.sh"], so a
# pod whose /otel lacks it cannot start at all —
#   exec: "/otel/otel-python-entrypoint.sh": no such file or directory
# langchain-agent crashlooped on SE on its first restart after that ENTRYPOINT
# landed, because this ConfigMap carried only the .js file.
info "Creating otel-instrument ConfigMap..."
kubectl create configmap otel-instrument \
  --from-file=otel-instrument.js="$K8S_DIR/../scripts/otel-instrument.js" \
  --from-file=otel-python-entrypoint.sh="$K8S_DIR/../scripts/otel-python-entrypoint.sh" \
  -n "$NS" --dry-run=client -o yaml | kubectl apply -f -

# Read the origin currently live in the cluster BEFORE the apply below resets
# it to the local default — decides whether pods must be rolled further down.
prev_public_origin="$(kubectl get configmap ai-demo-config -n "$NS" -o jsonpath='{.data.PUBLIC_APP_URL}' 2>/dev/null || true)"

apply_patched "$K8S_DIR/02-configmap.yaml"

# SE-only browser perimeter. Keep the shared ConfigMap defaults gate-off so
# local Kubernetes developer environments remain accessible without PingOne.
if [[ -n "$K8S_NAMESPACE" ]]; then
  if [[ -z "${HOSTED_ACCESS_REQUIRED_GROUP_ID:-}" ]]; then
    # Fallback to the BFF .env, where the value already lives next to the other
    # HOSTED_ACCESS_* group/population IDs that create-secrets.sh reads. An
    # explicit shell export still wins.
    HOSTED_ACCESS_REQUIRED_GROUP_ID="$(grep -E '^HOSTED_ACCESS_REQUIRED_GROUP_ID=' "$K8S_DIR/../demo_api_server/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"')"
  fi
  if [[ -z "${HOSTED_ACCESS_REQUIRED_GROUP_ID:-}" ]]; then
    die "HOSTED_ACCESS_REQUIRED_GROUP_ID must be set (shell export or demo_api_server/.env) before enabling hosted access"
  fi
  # ALLOWED_DOMAINS includes pingone.com (demoUser's email domain) and
  # REQUIRE_VERIFIED_EMAIL stays false — matching the live-patched configmap
  # that fixed hosted-access logins; see REGRESSION_PLAN before changing.
  #
  # ALLOWED_IDENTIFIERS: exact-match demo test accounts exempt from the
  # plus-addressing and domain rules (demoUser signs in AS a + address;
  # demoAdmin is provisioned @api.ping.demo). Clear the value to revoke.
  # test12345@mailinator.com is the AIC (external IdP) test user, kept on at the
  # user's request (2026-10-14). Its Mailinator inbox is PUBLIC: anyone can read
  # its reset/OTP mail, so treat it as an open door through the wall.
  #
  # OAUTH_PROVIDER=pingone is pinned here deliberately: the UI's provider
  # toggle persists oauth_provider=pingfederate into LMDB, and the SE PF_*
  # endpoints (local.ping-devops.com:9031) only resolve on a dev Mac — an
  # in-cluster pod health-checking them 503s and the startup probe CrashLoops
  # the BFF (2026-09-25). envFrom beats the LMDB store, so this pin makes the
  # toggle a no-op on SE regardless of what LMDB holds.
  kubectl patch configmap ai-demo-config -n "$NS" --type merge -p \
    "{\"data\":{\"OAUTH_PROVIDER\":\"pingone\",\"HOSTED_ACCESS_GATE_ENABLED\":\"true\",\"HOSTED_ACCESS_ALLOWED_DOMAINS\":\"pingidentity.com,pingone.com\",\"HOSTED_ACCESS_REQUIRE_VERIFIED_EMAIL\":\"false\",\"HOSTED_ACCESS_REQUIRED_GROUP_ID\":\"${HOSTED_ACCESS_REQUIRED_GROUP_ID}\",\"HOSTED_ACCESS_ALLOWED_IDENTIFIERS\":\"${HOSTED_ACCESS_ALLOWED_IDENTIFIERS:-demoUser,demoAdmin,cmuir+demo-user@pingone.com,demoAdmin@api.ping.demo,demoUser@example.com,test12345@mailinator.com}\"}}"
fi

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
if [[ -n "$K8S_NAMESPACE" ]]; then
  # Per-engineer hostnames, derived BEFORE the configmap's PUBLIC_APP_URL patch
  # (line ~280) so a non-owner's origin is correct without any extra env. The
  # shared nginx-public controller routes on Host, so every namespace must
  # claim its own or two deploys collide silently. Owner namespaces keep the
  # canonical hosts (what's live today); everyone else derives <slug>.* from
  # their namespace. APP_HOST/MCP_HOST/A2A_HOST override any derivation
  # (loudly logged, e.g. to mirror an existing DNS name).
  owner_slug="${NS#ping-devops-}"
  case "$NS" in
    ping-devops-cmuir|ping-devops-curtismuir)
      derived_app_host="ai-demo.ping-devops.com"
      derived_mcp_host="cmuir-mcp.ping-devops.com"
      derived_a2a_host="langchain-a2a.ai-demo.ping-devops.com"
      ;;
    ping-devops-*)
      derived_app_host="${owner_slug}.ai-demo.ping-devops.com"
      derived_mcp_host="${owner_slug}-mcp.ping-devops.com"
      derived_a2a_host="a2a-${owner_slug}.ai-demo.ping-devops.com"
      ;;
    *)
      # Non-ping-devops namespaces: still derive from the full name so the
      # sed below never leaves a placeholder behind.
      derived_app_host="${NS}.ai-demo.ping-devops.com"
      derived_mcp_host="${NS}-mcp.ping-devops.com"
      derived_a2a_host="a2a-${NS}.ai-demo.ping-devops.com"
      ;;
  esac
  APP_HOST="${APP_HOST:-$derived_app_host}"
  MCP_HOST="${MCP_HOST:-$derived_mcp_host}"
  A2A_HOST="${A2A_HOST:-$derived_a2a_host}"
  if [[ "${APP_HOST:-}" != "$derived_app_host" || "${MCP_HOST:-}" != "$derived_mcp_host" || "${A2A_HOST:-}" != "$derived_a2a_host" ]]; then
    warn "Hostname override active: APP_HOST=$APP_HOST MCP_HOST=$MCP_HOST A2A_HOST=$A2A_HOST (derived would be $derived_app_host / $derived_mcp_host / $derived_a2a_host)"
  fi
  # The public origin must match the app host or OAuth redirects/CORS break.
  # se-deploy no longer hardcodes the canonical URL; run-k8.sh's explicit
  # PUBLIC_APP_URL still wins when the caller pins it deliberately.
  if [[ -z "${PUBLIC_APP_URL:-}" ]]; then
    PUBLIC_APP_URL="https://${APP_HOST}"
    info "PUBLIC_APP_URL derived from namespace: $PUBLIC_APP_URL"
  fi
fi

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

# Models onto the PVCs BEFORE anything that serves them. The llama tiers and the
# embeddings pod run `-m /models/<file>.gguf` and never download; if the file is
# absent they CrashLoopBackOff. This Job is the only thing that fetches a model.
#
# It must COMPLETE before 56-llm-stack.yaml and 72-rag-stack.yaml appear in the
# loop below. Both model PVCs are RWO, so a serving pod that starts first pins the
# volume to its node and the Job then fails to attach with a Multi-Attach error and
# sits in ContainerCreating until its deadline — measured on the SE cluster
# 2026-09-08. On a cluster that is ALREADY serving, scale llama-tier* and
# embeddings to 0 before re-seeding, for the same reason.
#
# A re-run does NOT cost "one pod start": on an already-serving cluster the tier
# that owns the RWO volume never releases it, so a re-applied Job cannot even
# attach — the 45-minute wait above is paid on every scoped deploy, whether or
# not that deploy touched anything model-related. If the Job already reports
# Complete, the models are already on disk (the seed script itself is what skips
# present files, so this only trusts a completion this repo's own Job produced)
# — skip the delete/re-apply/wait outright rather than pay that tax again. A Job
# that does not exist yet, or previously Failed, still runs exactly as before.
if [[ "$(kubectl get job seed-llm-models -n "$NS" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null)" == "True" ]]; then
  info "seed-llm-models already Complete — models on disk, skipping re-seed."
elif models_seeded_on_disk; then
  info "Model files already on disk (confirmed via the running tier/embeddings pods) — skipping re-seed."
else
  kubectl delete job seed-llm-models -n "$NS" --ignore-not-found >/dev/null 2>&1 || true
  apply_patched "$K8S_DIR/54-seed-llm-models.yaml"
  info "Seeding model PVCs (first run downloads ~14GB; later runs are a no-op)..."
  if ! kubectl wait --for=condition=complete job/seed-llm-models -n "$NS" --timeout=45m; then
    kubectl logs job/seed-llm-models -n "$NS" --tail=20 2>/dev/null || true
    kubectl describe pod -n "$NS" -l component=seed-llm-models 2>/dev/null | sed -n '/Events:/,$p' | tail -10 || true
    die "Model seed Job did not complete — the LLM tiers would CrashLoopBackOff with no model to load.
  A 'Multi-Attach error' above means a serving pod already holds an RWO model PVC:
    kubectl scale deploy/llama-tier1 deploy/llama-tier3 deploy/llama-tier5 deploy/embeddings -n $NS --replicas=0
  then re-run this deploy."
  fi
fi

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
  57-mcp-weather-deployment.yaml \
  63-mcp-resource-server-deployment.yaml \
  64-api-resource-server-deployment.yaml \
  62-hitl-service-deployment.yaml \
  58-mcp-brave-deployment.yaml \
  56-llm-stack.yaml \
  72-rag-stack.yaml \
  20-api-server-deployment.yaml \
  60-mcp-gateway-deployment.yaml \
  71-ping-gateway-deployment.yaml \
  61-agent-service-deployment.yaml \
  40-agent-service-deployment.yaml \
  76-prometheus-deployment.yaml \
  83-alertmanager-deployment.yaml \
  81-loki-deployment.yaml \
  82-alloy-deployment.yaml \
  77-grafana-deployment.yaml \
  10-frontend-deployment.yaml; do
  info "Applying $manifest..."
  apply_patched "$K8S_DIR/$manifest"
done

# Privilege gateway: removed from this deploy entirely (2026-09-01). The AI
# Gateway (formerly agentless) is a deliberate MANUAL Helm install from
# pingone-privgateway-helm-main/agentless — its ENV_PROXY_TOKEN is single-use
# and ~2h-lived, so it must never ride along with a routine deploy. This script
# installs nothing Privilege-related into $NS. Gateway 1 and mcpgw-lb are in
# ping-devops-curtismuir; gateway 2 (release agentless-mcpgw2) was installed by
# hand into ping-devops-cmuir, so it can be present in $NS: this deploy does not
# touch it, and se-undeploy skips Helm-managed resources and its sidecar secrets.
# Gateway 2 is a second node of gateway 1's mesh cluster; keep both on the same
# sidecars and secrets with ./run-pingaws.sh gateways (scripts/se-gateways.sh).

if [[ -n "$K8S_NAMESPACE" ]]; then
  # Hostnames were derived before the configmap patch (search "Per-engineer
  # hostnames"); APP_HOST etc. are already set here.
  info "Applying SE cluster ingress (app=$APP_HOST mcp=$MCP_HOST a2a=$A2A_HOST)..."
  sed -e "s|<<NAMESPACE>>|$NS|g" \
      -e "s|<<APP_HOST>>|$APP_HOST|g" \
      -e "s|<<MCP_HOST>>|$MCP_HOST|g" \
      -e "s|<<A2A_HOST>>|$A2A_HOST|g" \
      "$SCRIPT_DIR/se-ingress.yaml" | kubectl apply -f -
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
if [[ -z "$FOCUS_DEPLOYMENTS" ]]; then
  kubectl scale deployment/weaviate deployment/embeddings deployment/mcp-code-search deployment/llamaindex-agent \
    -n "$NS" --replicas=1
fi

if [[ -n "$FOCUS_DEPLOYMENTS" ]]; then
  # Focused deploy: only the focused services were rolled — wait on those.
  # tier-manager's /ensure, llama-tier waits and the RAG scale-up are full
  # deploy concerns; skipping them keeps a one-service update a one-service wait.
  info "Focused deploy — waiting for rollouts of: ${FOCUS_DEPLOYMENTS//,/ }"
  FOCUS_LIST="${FOCUS_DEPLOYMENTS//,/ }"
  for dep in $FOCUS_LIST; do
    kubectl rollout status "deployment/$dep" -n "$NS" --timeout=180s
  done
else
info "Waiting for rollouts (timeout 3m each)..."
# llm-proxy's /readyz returns 503 until a model tier is loaded, so its rollout
# wait hangs until tier-manager is asked to ensure one (observed 2026-09-25/26:
# both SE deploys timed out on llm-proxy until /ensure?port=8091 was called by
# hand). Ask tier-manager directly once it is up.
kubectl rollout status "deployment/tier-manager" -n "$NS" --timeout=180s
kubectl exec -n "$NS" deploy/tier-manager -- wget -qO- --post-data='' \
  "http://127.0.0.1:8097/ensure?port=8091" 2>/dev/null \
  || info "tier-manager /ensure?port=8091 failed — llm-proxy may sit unready; check tier-manager logs"
for dep in jaeger mcp-server mcp-resource-server api-resource-server mcp-weather mcp-brave hitl-service \
           llm-proxy tier-manager demo-api-server mcp-gateway agent-service langchain-agent \
           frontend weaviate embeddings \
           mcp-code-search llamaindex-agent; do
  kubectl rollout status "deployment/$dep" -n "$NS" --timeout=180s
done
kubectl rollout status "deployment/llama-tier1" -n "$NS" --timeout=900s \
  || info "WARNING: llama-tier1 not ready yet — model may still be downloading from HuggingFace"
fi

# ── Reset runtime demo flags to demo defaults ────────────────────────────────
# The LMDB runtime KV (PVC-backed) beats env for these keys, so a QuickFlags
# click or Gateway Tester preset from a previous session survives deploys and
# silently changes agent behavior (heuristics off / mock Authorize on broke
# the live demo). Opt out with SKIP_DEMO_FLAG_RESET=1.
# A focused deploy skips this: it did not roll demo-api-server, and restarting
# it just to reset flags would betray the "focused" promise (and roll a pod
# whose image was never rebuilt). Callers that need a flag reset run a full
# deploy or the reset script by hand.
if [[ "${SKIP_DEMO_FLAG_RESET:-0}" != "1" && -z "$FOCUS_DEPLOYMENTS" ]]; then
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
