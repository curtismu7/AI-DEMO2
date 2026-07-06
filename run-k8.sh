#!/usr/bin/env bash
# run-k8.sh — Build, deploy, and manage the AI Demo on Kubernetes (local or AWS EKS).
#
# LOCAL (OrbStack / Docker Desktop):
#   ./run-k8.sh                          # kill stale procs + build images + deploy + forward
#   ./run-k8.sh --agent=mastra           # same, but start mastra agent instead of langchain
#   ./run-k8.sh build                    # build Docker images only
#   ./run-k8.sh deploy                   # apply manifests (no build); restarts running pods + forward
#   ./run-k8.sh deploy --agent=openai    #   and start the openai agent
#   ./run-k8.sh forward                  # kill stale procs, then port-forward all services
#                                        #   (supervised: dropped forwards auto-respawn)
#   ./run-k8.sh kill                     # kill ai-demo port-forwards + stray demo-port listeners
#   ./run-k8.sh stop                     # clear forwards + scale all workloads to 0 (keep config; frees memory)
#   ./run-k8.sh extras off               # stop just the investment + mortgage backends (frees memory; 'extras on' restores)
#   ./run-k8.sh status                   # show pod/service status
#   ./run-k8.sh restart                  # rebuild images + rolling redeploy + forward
#   ./run-k8.sh restart --agent=pydantic #   and start the pydantic agent
#   ./run-k8.sh destroy                  # delete the ai-demo namespace
#
# --agent=<name>  Choose which AI agent starts on deploy (default: langchain).
#                 Valid: langchain | mastra | openai | pydantic
#                 All other agents are scaled to 0. Use './k8s/deploy.sh agent <name>'
#                 to switch agents after deploy without a full redeploy.
#
# AWS simulation (local OrbStack, GHCR images — test the AWS image path locally):
#   ./run-k8.sh sim          # aws-build + deploy GHCR images to local K8s + forward
#   ./run-k8.sh sim-deploy   # deploy GHCR images to local K8s only (no rebuild)
#
# Ping SE DevOps cluster (ping-dev-aws-us-east-2):
#   ./run-k8.sh se-build      # build images + push to GHCR (needs GITHUB_OWNER)
#   ./run-k8.sh se-deploy     # deploy to SE cluster (auto-derives your namespace)
#   ./run-k8.sh se-all        # se-build + se-deploy
#   ./run-k8.sh se-undeploy   # remove all app resources from your SE namespace (run when done!)
#
#   Namespace is auto-derived from your Ping email (cmuir@pingidentity.com → ping-devops-cmuir).
#   Override with: SE_NAMESPACE=ping-devops-yourname ./run-k8.sh se-deploy
#
# AWS EKS:
#   ./run-k8.sh aws-build    # build images + push to GHCR (needs GITHUB_OWNER)
#   ./run-k8.sh aws-deploy   # deploy to EKS (needs GITHUB_OWNER, AWS_REGION, EKS_CLUSTER_NAME)
#   ./run-k8.sh aws-all      # aws-build + aws-deploy
#
#   ./run-k8.sh help         # show this help
#
# Logs (local K8s — namespace: ai-demo):
#   kubectl logs -n ai-demo deploy/banking-api-server -f        # BFF
#   kubectl logs -n ai-demo deploy/frontend -f                  # UI
#   kubectl logs -n ai-demo deploy/mcp-gateway -f               # MCP gateway
#   kubectl logs -n ai-demo deploy/mcp-gateway -c authz-server -f  # authz sidecar
#   kubectl logs -n ai-demo deploy/langchain-agent -f           # AI agent
#   kubectl logs -n ai-demo -l app=ai-demo --all-containers --prefix -f  # everything
#   kubectl logs -n ai-demo deploy/<name> --previous            # after a crash
#   kubectl get deploy -n ai-demo                               # list all services
#
# Logs (SE cluster — replace ai-demo with your namespace, e.g. ping-devops-cmuir):
#   kubectl logs -n ping-devops-cmuir deploy/banking-api-server -f
#   kubectl logs -n ping-devops-cmuir -l app=ai-demo --all-containers --prefix -f
#
# LOCAL prerequisites:
#   1. OrbStack (or Docker Desktop) with Kubernetes enabled
#   2. kubectl on PATH
#   3. Bootstrap: cd demo_api_server && npm run pingone:bootstrap
#
# SE cluster prerequisites:
#   1. kubectl context pointing at ping-dev-aws-us-east-2 (run: kubectl config use-context us)
#   2. Your namespace provisioned (JIRA DEVHELP ticket)
#   3. gh CLI authenticated: gh auth login
#
# Sim + AWS prerequisites:
#   GITHUB_OWNER (auto-detected from git remote if not set)
#   gh CLI authenticated: gh auth login
#   AWS_REGION + EKS_CLUSTER_NAME also needed for aws-deploy/aws-all
#   PUBLIC_APP_URL (real EKS) — public origin the ALB serves; rewrites the
#     configmap's OAuth-redirect/CORS URLs away from the local api.ping.demo:4000
#   ACM_CERTIFICATE_ARN (real EKS) — cert for the ALB HTTPS listener
#
# Access after local deploy:
#   UI:  https://api.ping.demo:4000
#   BFF: https://api.ping.demo:3001

set -euo pipefail

BASEDIR="$(cd "$(dirname "$0")" && pwd)"
K8S_DIR="$BASEDIR/k8s"

# Strip --agent=<name> from $@ before the case statement sees it.
# Exported so k8s/deploy.sh inherits it without any extra plumbing.
AGENT_SELECTION="${AGENT_SELECTION:-langchain}"
_CLEANED_ARGS=()
for _arg in "$@"; do
  case "$_arg" in
    --agent=*) AGENT_SELECTION="${_arg#--agent=}" ;;
    *)         _CLEANED_ARGS+=("$_arg") ;;
  esac
done
set -- "${_CLEANED_ARGS[@]+"${_CLEANED_ARGS[@]}"}"
export AGENT_SELECTION

# Let k8s/deploy.sh know it was invoked through this wrapper, so it suppresses
# its own "run forward" hint and lets us print the single ./run-k8.sh one.
export RUNK8=1

# Ports the K8s port-forwards bind (and the legacy local-node stack used).
# kill_all sweeps any process still listening on these before we (re)bind.
DEMO_PORTS="3001 4000 8080 8081 8082 3005 3006 3009 3016 8888 8889 8890 8891 8892 8893"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
die()     { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

# Check Docker daemon is available and running — works with Docker Desktop or OrbStack.
# For SE/AWS deploy you only need Docker (not OrbStack K8s).
check_docker() {
  command -v docker &>/dev/null \
    || die "docker not found — install Docker Desktop (https://www.docker.com/products/docker-desktop/) or OrbStack"
  docker info &>/dev/null \
    || die "Docker daemon not running — start Docker Desktop (or OrbStack) and try again"
}

check_prereqs() {
  command -v kubectl &>/dev/null   || die "kubectl not found — install via: brew install kubectl"
  check_docker
  kubectl cluster-info &>/dev/null || die "Cannot reach K8s cluster. For local dev: enable Kubernetes in OrbStack/Docker Desktop Settings."
  info "K8s cluster reachable."
  # llama.cpp runs as an in-cluster pod (k8s/55-llamacpp-deployment.yaml) — no host
  # install is required. The pod downloads the GGUF on first deploy and caches
  # the weights on a PVC so restarts don't re-download.
  if ! command -v llama-server >/dev/null 2>&1; then
    info "llama.cpp: will run in-cluster (no host install needed for Kubernetes)."
  else
    info "llama.cpp: host binary present — in-cluster pod will be used by agents regardless."
  fi
}

# Stop anything that would collide with the port-forwards before we bind: all
# existing ai-demo port-forwards, plus any stray process still listening on a
# demo port (a leftover local-node stack, a previous run's forwards, etc.).
kill_all() {
  info "Clearing existing port-forwards and stray demo-port listeners..."
  # Stop the deploy.sh 'forward' SUPERVISOR first. It auto-respawns dropped
  # children, so killing only the `kubectl port-forward` procs below leaves the
  # supervisor alive — it then re-creates the forwards AND makes the next start
  # die with "A 'forward' session is already running". stop-forward is the
  # canonical teardown (supervisor + its children); it no-ops when none is up.
  bash "$K8S_DIR/deploy.sh" stop-forward >/dev/null 2>&1 || true
  pkill -f "kubectl port-forward -n ai-demo" 2>/dev/null || true
  local pids
  for port in $DEMO_PORTS; do
    pids=$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
  done
  sleep 1
  success "Cleared existing processes."
}

build() {
  info "Building Docker images..."
  # Ensure .codegraph/codegraph.db exists as a regular file before compose
  # starts. If the path doesn't exist, Docker creates a directory there and
  # mounts it into the langchain-agent container, breaking SQLite.
  mkdir -p "$BASEDIR/.codegraph"
  [[ -f "$BASEDIR/.codegraph/codegraph.db" ]] || touch "$BASEDIR/.codegraph/codegraph.db"
  docker compose build
  success "Images built."
}

# Recreate cluster resources that OrbStack wipes on VM restart:
#   - secrets (from each service's .env)
#   - ai-demo-config + nginx-config ConfigMaps
#   - bff-logs PersistentVolumeClaim
# Safe to call on every deploy — skips anything already present.
ensure_cluster_resources() {
  local ns="ai-demo"
  # Namespace may not exist yet on first run — that's fine, deploy.sh creates it.
  if ! kubectl get namespace "$ns" &>/dev/null; then
    return
  fi

  # Secrets — create-secrets.sh uses `kubectl apply` so it's idempotent.
  if ! kubectl get secret ai-demo-secrets -n "$ns" &>/dev/null; then
    info "Restoring K8s secrets (lost on OrbStack restart)..."
    bash "$K8S_DIR/create-secrets.sh" || die "create-secrets.sh failed"
    success "Secrets restored."
  fi

  # ConfigMaps
  if ! kubectl get configmap ai-demo-config -n "$ns" &>/dev/null; then
    info "Restoring ai-demo-config ConfigMap..."
    kubectl apply -f "$K8S_DIR/02-configmap.yaml" \
      || die "Failed to apply k8s/02-configmap.yaml"
    success "ConfigMap restored."
  fi

  # PersistentVolumeClaim
  if ! kubectl get pvc bff-logs -n "$ns" &>/dev/null; then
    info "Restoring bff-logs PVC..."
    kubectl apply -f "$K8S_DIR/21-api-server-logs-pvc.yaml" \
      || die "Failed to apply k8s/21-api-server-logs-pvc.yaml"
    success "PVC restored."
  fi
}

deploy() {
  # Fail fast if the configmap/docker-compose drifted from service-topology.json
  # (the master SoT for service URLs/ports) — a stale configmap is what caused
  # the recurring in-cluster 502/ECONNREFUSED bugs.
  info "Validating service topology (service-topology.json)..."
  node "$BASEDIR/scripts/gen-service-topology.js" check || die "Service topology drift — run 'node scripts/gen-service-topology.js generate' and fix docker-compose."
  ensure_cluster_resources
  info "Deploying to Kubernetes..."
  bash "$K8S_DIR/deploy.sh" deploy
}

forward() {
  # 'forward' never returns (deploy.sh supervises the port-forwards), so hand
  # it the final banners pre-rendered — it prints them once the forwards are
  # up, at the very end of the output.
  RUNK8_POST_FORWARD_BANNER="$(logs_banner; done_banner)" \
    bash "$K8S_DIR/deploy.sh" forward
}

# How to see each service's logs. Printed at the end of every run that leaves
# the stack deployed (all/forward/deploy/restart/sim/sim-deploy/aws-deploy/
# aws-all — on the aws paths kubectl is already pointed at the EKS cluster).
logs_banner() {
  echo
  echo -e "${BLUE}================================= LOGS =================================${NC}"
  echo "  Follow one service:  kubectl logs -n ai-demo deploy/<name> -f"
  echo "      BFF:             kubectl logs -n ai-demo deploy/demo-api-server -f"
  echo "      MCP gateway:     kubectl logs -n ai-demo deploy/mcp-gateway -f"
  echo "      Authz sidecar:   kubectl logs -n ai-demo deploy/mcp-gateway -c authz-server -f"
  echo "      Agent:           kubectl logs -n ai-demo deploy/langchain-agent -f"
  echo "  List services:       kubectl get deploy -n ai-demo"
  echo "  Follow everything:   kubectl logs -n ai-demo -l app=ai-demo --all-containers --prefix -f"
  echo "  After a crash:       kubectl logs -n ai-demo deploy/<name> --previous"
  echo -e "${BLUE}========================================================================${NC}"
}

done_banner() {
  echo
  echo -e "${GREEN}========================================================================${NC}"
  echo -e "${GREEN}  DONE - SUCCESS${NC}"
  echo -e "${GREEN}========================================================================${NC}"
}

# EKS epilogue: same banners, but no port-forwarding — that's a local-cluster
# concept; the ALB serves the EKS deployment.
aws_finish() {
  logs_banner
  done_banner
}

status() {
  bash "$K8S_DIR/deploy.sh" status
}

restart() {
  info "Rebuilding images and rolling out..."
  build
  deploy
}

destroy() {
  bash "$K8S_DIR/deploy.sh" destroy
}

# Clear local port-forwards, then scale every workload to 0 — frees all cluster
# pod memory while keeping the namespace/config/secrets, so a later deploy
# brings it back without a rebuild. Use `destroy` for a full namespace teardown.
stop() {
  kill_all
  bash "$K8S_DIR/deploy.sh" stop
}

# Stop/start just the optional feature backends (investment + mortgage) to shed
# or restore memory without redeploying the rest of the stack.
extras() {
  bash "$K8S_DIR/deploy.sh" extras "${1:-}"
}

# ── AWS helpers ───────────────────────────────────────────────────────────────

check_ghcr_env() {
  if [[ -z "${GITHUB_OWNER:-}" ]]; then
    GITHUB_OWNER=$(git remote get-url origin 2>/dev/null \
      | sed -E 's|.*github.com[:/]([^/]+)/.*|\1|' | tr '[:upper:]' '[:lower:]' || true)
  fi
  [[ -n "${GITHUB_OWNER:-}" ]] || die "GITHUB_OWNER not set and could not detect from git remote"
  command -v gh     &>/dev/null || die "gh CLI not found — brew install gh && gh auth login"
  command -v docker &>/dev/null || die "docker not found"
  export GITHUB_OWNER
}

check_eks_env() {
  check_ghcr_env
  [[ -n "${AWS_REGION:-}" ]]       || die "AWS_REGION not set"
  [[ -n "${EKS_CLUSTER_NAME:-}" ]] || die "EKS_CLUSTER_NAME not set"
  command -v aws &>/dev/null       || die "aws CLI not found — brew install awscli"
}

aws_build() {
  check_ghcr_env
  check_docker
  local registry="ghcr.io/${GITHUB_OWNER}"
  local tag="${IMAGE_TAG:-latest}"

  info "Logging in to GHCR..."
  # Logout first to clear any stale macOS keychain entry — a leftover credential
  # causes "The specified item already exists in the keychain" and blocks login.
  docker logout ghcr.io >/dev/null 2>&1 || true
  gh auth token | docker login ghcr.io -u "$GITHUB_OWNER" --password-stdin \
    || die "GHCR login failed — run: gh auth login"

  info "Building images..."
  docker compose build

  # local-image:ghcr-image pairs (indexed array — works on macOS bash 3.2)
  local IMAGE_MAP=(
    "ai-demo-ui:ai-demo-frontend"
    "ai-demo-demo-api-server:ai-demo-demo-api-server"
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
  )

  for entry in "${IMAGE_MAP[@]}"; do
    local_name="${entry%%:*}"
    ghcr_name="${entry##*:}"
    ghcr_uri="${registry}/${ghcr_name}:${tag}"
    info "Pushing $local_name → $ghcr_uri"
    docker tag "${local_name}:latest" "$ghcr_uri"
    docker push "$ghcr_uri"
  done

  success "All images pushed to GHCR (tag: $tag)."
}

aws_deploy() {
  check_eks_env
  bash "$K8S_DIR/aws/deploy.sh"
}

sim_deploy() {
  check_ghcr_env
  check_prereqs
  info "Deploying GHCR images to local OrbStack K8s..."
  bash "$K8S_DIR/aws/deploy.sh"   # EKS_CLUSTER_NAME not set → targets current context
}

# ── SE DevOps cluster helpers ─────────────────────────────────────────────────

# Derive the SE namespace from the Ping email address.
# cmuir@pingidentity.com  → ping-devops-cmuir
# curtis.muir@pingidentity.com → ping-devops-curtismuir
# Override by setting SE_NAMESPACE before running.
derive_se_namespace() {
  if [[ -n "${SE_NAMESPACE:-}" ]]; then
    echo "$SE_NAMESPACE"
    return
  fi

  # Prefer a Ping Identity email — the namespace is always derived from the
  # Ping email localpart, not whatever git config user.email is set to.
  # Check sources in order: PING_EMAIL env var, .env file, git config (only
  # if it ends in @pingidentity.com), then prompt the user.
  local email=""

  # 1. Explicit env var
  if [[ -n "${PING_EMAIL:-}" ]]; then
    email="$PING_EMAIL"
  fi

  # 2. PING_EMAIL in demo_api_server/.env
  if [[ -z "$email" && -f "$BASEDIR/demo_api_server/.env" ]]; then
    email="$(grep -E '^PING_EMAIL=' "$BASEDIR/demo_api_server/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
  fi

  # 3. git config — only if it's a Ping email
  if [[ -z "$email" ]]; then
    local _git_email
    _git_email="$(git config user.email 2>/dev/null || true)"
    if [[ "$_git_email" == *@pingidentity.com ]]; then
      email="$_git_email"
    fi
  fi

  # 4. Ask the user — namespace can't be derived without a Ping email
  if [[ -z "$email" ]]; then
    if [[ -t 0 ]] || [[ -r /dev/tty ]]; then
      local _input=""
      read -r -p "  Enter your Ping email (e.g. cmuir@pingidentity.com): " _input </dev/tty 2>/dev/null || true
      email="$_input"
      # Cache it in .env for next time
      if [[ -n "$email" && -f "$BASEDIR/demo_api_server/.env" ]]; then
        if grep -q '^PING_EMAIL=' "$BASEDIR/demo_api_server/.env" 2>/dev/null; then
          sed -i.bak "s|^PING_EMAIL=.*|PING_EMAIL=${email}|" "$BASEDIR/demo_api_server/.env" && rm -f "$BASEDIR/demo_api_server/.env.bak"
        else
          echo "PING_EMAIL=${email}" >> "$BASEDIR/demo_api_server/.env"
        fi
        info "Saved PING_EMAIL to demo_api_server/.env for future deploys."
      fi
    fi
  fi

  if [[ -z "$email" ]]; then
    die "Cannot derive SE namespace — set SE_NAMESPACE=ping-devops-yourname or PING_EMAIL=you@pingidentity.com"
  fi

  local localpart="${email%%@*}"
  # Strip dots to match Ping namespace convention (jeremy.carrier → jeremycarrier)
  local slug
  slug="$(echo "$localpart" | tr -d '.' | tr '[:upper:]' '[:lower:]')"
  echo "ping-devops-${slug}"
}

# Ensure llama.cpp is installed and the 2-tier LLM proxy serves :8090 for
# the Code Explorer. :8090 is ALWAYS the proxy (demo_llm_proxy/router.js → tier
# llama-servers on :8091 and :8096) — never a raw llama-server pointing straight at
# one model. Called before any deploy that uses docker-compose (se-deploy,
# se-all); the langchain-agent container connects via host.docker.internal:8090.
ensure_llamacpp_running() {
  if ! command -v llama-server >/dev/null 2>&1; then
    info "Installing llama.cpp (required for Code Explorer)..."
    if [[ "$(uname)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
      brew install llama.cpp --quiet && success "llama.cpp installed." \
        || { info "brew install llama.cpp failed — build from https://github.com/ggml-org/llama.cpp"; return 0; }
    else
      info "llama.cpp not found and Homebrew unavailable — build from https://github.com/ggml-org/llama.cpp"
      return 0
    fi
  fi

  # Reuse whatever healthy proxy already serves :8090 (llm-proxy container when
  # the compose stack is up, or a host router started earlier).
  if curl -sf --max-time 2 http://localhost:8090/health >/dev/null 2>&1; then
    success "LLM proxy already serving :8090."
    return 0
  fi

  if [[ -f demo_llm_proxy/start-local-models.sh ]]; then
    info "Starting LLM proxy stack in swap mode (tier-manager :8097 + smallest tier + router :8090)..."
    if ! curl -sf --max-time 2 http://localhost:8097/health >/dev/null 2>&1; then
      nohup node demo_llm_proxy/tier-manager.js > /tmp/demo-tier-manager.log 2>&1 &
      echo $! > /tmp/demo-tier-manager.pid
    fi
    bash demo_llm_proxy/start-local-models.sh ensure 8091 \
      || { info "smallest tier failed to start — verify GGUFs: bash demo_llm_proxy/download-models.sh"; return 0; }
    LLAMA_HOST=127.0.0.1 LLM_PROXY_PORT=8090 nohup node demo_llm_proxy/router.js > /tmp/demo-llm-proxy.log 2>&1 &
    echo $! > /tmp/demo-llm-proxy.pid
    local waited=0
    while [[ $waited -lt 60 ]]; do
      if curl -sf --max-time 2 http://localhost:8090/health >/dev/null 2>&1; then
        success "LLM proxy ready on :8090 (routing tiers 8091 + 8096)."
        return 0
      fi
      sleep 3; (( waited += 3 ))
    done
    info "LLM proxy not ready yet — check /tmp/demo-llm-proxy.log and /tmp/llama-models/"
  else
    info "demo_llm_proxy/ not found (run from the repo root) — :8090 left unserved; no raw llama-server fallback."
  fi
}

se_deploy() {
  ensure_llamacpp_running
  check_ghcr_env
  local ns
  ns="$(derive_se_namespace)"
  info "SE cluster deploy → namespace: $ns"
  # Switch kubectl context to the SE cluster if not already there
  local ctx
  ctx="$(kubectl config current-context 2>/dev/null || true)"
  if [[ "$ctx" != "us" && "$ctx" != "ping-dev-aws-us-east-2-oidc" ]]; then
    info "Switching kubectl context to 'us' (ping-dev-aws-us-east-2)..."
    kubectl config use-context us
  fi
  kubens "$ns"
  K8S_NAMESPACE="$ns" \
  PUBLIC_APP_URL="https://ai-demo.ping-devops.com" \
    bash "$K8S_DIR/aws/deploy.sh"
  se_deploy_banner "$ns"
}

se_deploy_banner() {
  local ns="$1"
  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║              SE CLUSTER DEPLOY COMPLETE ✓                       ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${GREEN}App URL:${NC}      https://ai-demo.ping-devops.com"
  echo -e "  ${GREEN}Namespace:${NC}    $ns"
  echo ""
  echo -e "${BLUE}──── Access ─────────────────────────────────────────────────────────${NC}"
  echo "  Open in browser:  https://ai-demo.ping-devops.com"
  echo "  BFF API:          https://ai-demo.ping-devops.com/api/health"
  echo ""
  echo -e "${BLUE}──── Logs ───────────────────────────────────────────────────────────${NC}"
  echo "  All pods:         kubectl logs -n $ns -l app=ai-demo --all-containers --prefix -f"
  echo "  Frontend:         kubectl logs -n $ns deploy/frontend -f"
  echo "  BFF:              kubectl logs -n $ns deploy/demo-api-server -f"
  echo "  MCP Gateway:      kubectl logs -n $ns deploy/mcp-gateway -f"
  echo "  Authz sidecar:    kubectl logs -n $ns deploy/mcp-gateway -c authz-server -f"
  echo "  Agent:            kubectl logs -n $ns deploy/langchain-agent -f"
  echo ""
  echo -e "${BLUE}──── Pod status ─────────────────────────────────────────────────────${NC}"
  kubectl get pods -n "$ns" 2>/dev/null || true
  echo ""
  echo -e "${BLUE}──── Switch agent ───────────────────────────────────────────────────${NC}"
  echo "  Use a different AI agent (no rebuild needed):"
  echo "    langchain:  kubectl scale deploy/langchain-agent --replicas=1 -n $ns && kubectl scale deploy/mastra-agent --replicas=0 -n $ns"
  echo "    mastra:     kubectl scale deploy/mastra-agent --replicas=1 -n $ns && kubectl scale deploy/langchain-agent --replicas=0 -n $ns"
  echo "    openai:     kubectl scale deploy/openai-agent --replicas=1 -n $ns && kubectl scale deploy/langchain-agent --replicas=0 -n $ns"
  echo "    pydantic:   kubectl scale deploy/pydantic-agent --replicas=1 -n $ns && kubectl scale deploy/langchain-agent --replicas=0 -n $ns"
  echo ""
  echo -e "${YELLOW}──── ⚠  IMPORTANT — Undeploy when done ──────────────────────────────${NC}"
  echo -e "${YELLOW}  The SE cluster is shared. Leaving the app running may result in${NC}"
  echo -e "${YELLOW}  loss of your publishing rights.${NC}"
  echo ""
  echo "  To undeploy:      ./run-k8.sh se-undeploy"
  echo ""
}

se_undeploy() {
  local ns
  ns="$(derive_se_namespace)"
  info "SE cluster undeploy → namespace: $ns"
  local ctx
  ctx="$(kubectl config current-context 2>/dev/null || true)"
  if [[ "$ctx" != "us" && "$ctx" != "ping-dev-aws-us-east-2-oidc" ]]; then
    info "Switching kubectl context to 'us' (ping-dev-aws-us-east-2)..."
    kubectl config use-context us
  fi
  # Delete all app resources inside the namespace; leave the namespace itself
  # (it is cluster-managed — do not delete it or you'll need a new JIRA ticket).
  kubectl delete deployments,services,ingresses,configmaps,secrets \
    -n "$ns" --all --ignore-not-found
  success "SE undeploy complete — all resources removed from namespace $ns."
  success "Namespace $ns itself was preserved (cluster-managed)."
}

sim() {
  check_ghcr_env
  check_prereqs
  kill_all
  aws_build
  sim_deploy
  forward
  success "Sim deploy complete — running GHCR images on local K8s."
  success "Access at https://api.ping.demo:4000"
}

show_help() {
  grep '^#' "$0" | grep -v '#!/' | sed 's/^# \?//'
}

case "${1:-all}" in
  all)        check_prereqs; kill_all; build; deploy; forward ;;
  build)      build ;;
  deploy)     check_prereqs; deploy; kill_all; forward ;;
  forward)    check_prereqs; kill_all; forward ;;
  kill)       kill_all ;;
  stop)       check_prereqs; stop ;;
  extras)     check_prereqs; extras "${2:-}" ;;
  status)     check_prereqs; status ;;
  restart)    check_prereqs; restart; kill_all; forward ;;
  destroy)    check_prereqs; destroy ;;
  sim)        sim ;;
  sim-deploy) sim_deploy; forward ;;
  se-build)    aws_build ;;
  se-deploy)   se_deploy ;;
  se-all)      aws_build; se_deploy ;;
  se-undeploy) se_undeploy ;;
  aws-build)  aws_build ;;
  aws-deploy) aws_deploy; aws_finish ;;
  aws-all)    aws_build; aws_deploy; aws_finish ;;
  help)       show_help ;;
  *)
    echo "Usage: $0 {all|build|deploy|forward|kill|stop|extras|status|restart|destroy|sim|sim-deploy|se-build|se-deploy|se-all|se-undeploy|aws-build|aws-deploy|aws-all|help}"
    exit 1
    ;;
esac
