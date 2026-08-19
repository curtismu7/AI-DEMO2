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
#   ./run-k8.sh forward-api              # BFF :3001 only (for local Vite on :4000)
#   ./run-k8.sh forward-bg [api|core]    # detached supervisor (survives terminal close)
#   ./run-k8.sh kill                     # kill ai-demo port-forwards + stray demo-port listeners
#   ./run-k8.sh stop                     # clear forwards + scale all workloads to 0 (keep config; frees memory)
#   ./run-k8.sh mode demo                # minimal set for dashboard demos (frontend + BFF + gateways)
#   ./run-k8.sh mode mcpgw               # scale down to ping-mcpgw + mcp-server only
#   ./run-k8.sh mode full                # scale back up to full stack (no rebuild)
#   ./run-k8.sh extras off               # stop just the investment + mortgage backends (frees memory; 'extras on' restores)
#   ./run-k8.sh rag on                     # start Code Search / RAG stack on demand
#   ./run-k8.sh yotuo on                   # mount YOTUO host GGUFs into llama tiers (OrbStack)
#   ./run-k8.sh demo-sync                # align gateway deployments with admin Quick Flags
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
#   Prefer: ./run-pingaws.sh [start|build|deploy|status|undeploy|update …]
#   Low-level (same behavior):
#   ./run-k8.sh se-build      # build images + push to GHCR (needs GITHUB_OWNER)
#   ./run-k8.sh se-deploy     # deploy to SE cluster (auto-derives your namespace)
#   ./run-k8.sh se-all        # se-build + se-deploy
#   ./run-k8.sh se-status     # switch to the SE cluster + your namespace, show pod status
#   ./run-k8.sh se-undeploy   # remove all app resources from your SE namespace (run when done!)
#
#   Namespace is auto-derived from your Ping email (cmuir@pingidentity.com → ping-devops-cmuir).
#   Override with: SE_NAMESPACE=ping-devops-yourname ./run-pingaws.sh
#
# AWS EKS:
#   ./run-k8.sh aws-build    # build images + push to GHCR (needs GITHUB_OWNER)
#   ./run-k8.sh aws-deploy   # deploy to EKS (needs GITHUB_OWNER, AWS_REGION, EKS_CLUSTER_NAME)
#   ./run-k8.sh aws-all      # aws-build + aws-deploy
#   ./run-k8.sh aws-status   # update kubeconfig for EKS_CLUSTER_NAME, show pod status
#
#   NOTE: plain `./run-k8.sh status` only ever inspects whatever kubectl context
#   is CURRENTLY active — it never switches clusters. Use se-status/aws-status
#   to check pods on the SE or EKS cluster specifically.
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
# shellcheck source=scripts/demo-terminal.sh
source "${BASEDIR}/scripts/demo-terminal.sh"
demo_init_terminal
# shellcheck source=scripts/ping-email.sh
source "$BASEDIR/scripts/ping-email.sh"

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

info()    { demo_info "$@"; }
success() { demo_success "$@"; }
die()     { demo_err "$@"; exit 1; }

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
  # llama.cpp runs as an in-cluster 2-tier stack (k8s/56-llm-stack.yaml) — no host
  # install is required. The llm-proxy pod routes to llama-tier1/llama-tier5.
  info "LLM: in-cluster 2-tier stack — no host llama-server install required."
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

  # Docker Compose (./run-docker.sh) publishes the same host ports as K8s
  # port-forwards (3001/4000/…). Leaving those containers up makes OrbStack
  # keep *:PORT while kubectl also binds 127.0.0.1:PORT — clients then see
  # flaky /api/health (curl exit 000 / wrong backend). Stop the compose
  # project first; do NOT kill the OrbStack helper PID itself.
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qE '^ai-demo-'; then
      info "Stopping Docker Compose ai-demo containers that publish demo ports..."
      (cd "$BASEDIR" && docker compose -f docker-compose.yml stop \
        demo-api-server ui mcp-server mcp-resource-server api-resource-server \
        mcp-gateway agent-service hitl-service langchain-agent \
        openai-agent mastra-agent pydantic-agent mcp-proxy \
        2>/dev/null) || true
      # Force-remove any leftover publish on DEMO_PORTS (stopped containers can
      # still hold bindings briefly; compose rm is safer than killing OrbStack).
      local cname
      for cname in $(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -E '^ai-demo-' || true); do
        local published
        published=$(docker port "$cname" 2>/dev/null || true)
        for port in $DEMO_PORTS; do
          if printf '%s\n' "$published" | grep -qE ":${port}\b"; then
            docker stop "$cname" >/dev/null 2>&1 || true
            break
          fi
        done
      done
    fi
  fi

  local pids pname
  for port in $DEMO_PORTS; do
    pids=$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    for pid in $pids; do
      pname=$(ps -p "$pid" -o comm= 2>/dev/null || true)
      # Never SIGKILL/TERM the OrbStack VM helper — stop containers above instead.
      case "$pname" in
        OrbStack|vmgr) continue ;;
      esac
      kill "$pid" 2>/dev/null || true
    done
  done
  sleep 1
  # Verify BFF port is free (or only held by a process we will replace).
  if lsof -nP -iTCP:3001 -sTCP:LISTEN >/dev/null 2>&1; then
    warn_listeners=$(lsof -nP -iTCP:3001 -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $1"/"$2}' | tr '\n' ' ')
    info "Port 3001 still has listener(s): ${warn_listeners:-unknown} (compose stop may still be draining)"
  fi
  success "Cleared existing processes."
}

# K8 builds run under their own compose project (K8_COMPOSE_PROJECT) so the
# production-stage images they produce get ai-demo-k8-* tags — NEVER the dev
# stack's ai-demo-* tags. Building prod images onto the dev tags broke the
# running dev stack (the recreated dev ui got the nginx image and crash-looped
# with exit 127 — see REGRESSION_PLAN §4 2026-07-11). K8 manifests reference
# the ai-demo-k8-* names.
K8_COMPOSE_PROJECT="ai-demo-k8"

# Two tag gaps remain after a project-scoped build:
#   - the BFF: compose names it ai-demo-k8-demo-api-server; manifests expect
#     ai-demo-k8-api-server.
#   - explicit-image services (llm-proxy, tier-manager-k8, and the rag-profile
#     pair): their compose `image:` pins the ai-demo-* name, which `-p` does
#     not change — retag those to the ai-demo-k8-* manifest names when present.
tag_k8_images() {
  local pairs=(
    "${K8_COMPOSE_PROJECT}-demo-api-server:ai-demo-k8-api-server"
    "ai-demo-llm-proxy:ai-demo-k8-llm-proxy"
    "ai-demo-tier-manager:ai-demo-k8-tier-manager"
    "ai-demo-mcp-code-search:ai-demo-k8-mcp-code-search"
    "ai-demo-llamaindex-agent:ai-demo-k8-llamaindex-agent"
    "${K8_COMPOSE_PROJECT}-mcp-weather:ai-demo-k8-mcp-weather"
    "${K8_COMPOSE_PROJECT}-mcp-brave:ai-demo-k8-mcp-brave"
    "${K8_COMPOSE_PROJECT}-mcp-jwt-verifier:ai-demo-k8-mcp-jwt-verifier"
  )
  for entry in "${pairs[@]}"; do
    local src="${entry%%:*}" dst="${entry##*:}"
    if docker image inspect "${src}:latest" &>/dev/null; then
      docker tag "${src}:latest" "${dst}:latest"
      info "Tagged ${src}:latest → ${dst}:latest"
    fi
  done
  docker image inspect "ai-demo-k8-api-server:latest" &>/dev/null \
    || warn "Missing ai-demo-k8-api-server:latest — build demo-api-server first"
}

build() {
  info "Building Docker images (sequential — easier on OrbStack memory)..."
  # Ensure .codegraph/codegraph.db exists as a regular file before compose
  # starts. If the path doesn't exist, Docker creates a directory there and
  # mounts it into the langchain-agent container, breaking SQLite.
  mkdir -p "$BASEDIR/.codegraph"
  [[ -f "$BASEDIR/.codegraph/codegraph.db" ]] || touch "$BASEDIR/.codegraph/codegraph.db"
  # Parallel builds of 10+ images can crash OrbStack's Docker daemon; one at a time.
  COMPOSE_PARALLEL_LIMIT=1 docker compose -p "$K8_COMPOSE_PROJECT" -f docker-compose.yml build \
    demo-api-server ui mcp-server langchain-agent agent-service \
    hitl-service mcp-resource-server api-resource-server mcp-proxy authz-server mcp-gateway \
    mcp-weather mcp-brave
  COMPOSE_PARALLEL_LIMIT=1 docker compose -p "$K8_COMPOSE_PROJECT" -f docker-compose.yml --profile demo-auth build mcp-jwt-verifier
  COMPOSE_PARALLEL_LIMIT=1 docker compose -p "$K8_COMPOSE_PROJECT" -f docker-compose.yml --profile k8-build build tier-manager-k8 llm-proxy
  tag_k8_images
  success "Images built and tagged for K8."
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
  bash "$K8S_DIR/deploy.sh" forward
}

forward_api() {
  FORWARD_PROFILE=api bash "$K8S_DIR/deploy.sh" forward
}

forward_bg() {
  bash "$K8S_DIR/deploy.sh" forward-bg "${1:-api}"
}

# EKS epilogue: log commands + success banner (no port-forward on EKS).
aws_finish() {
  demo_k8_forward_epilogue "ai-demo"
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
  # -p: build under the K8 project so prod-stage images never land on the dev
  # stack's ai-demo-* tags (see K8_COMPOSE_PROJECT above).
  # --profile agents: openai/mastra/pydantic (IMAGE_MAP below).
  # --profile demo-auth: mcp-gateway + authz-server (also in IMAGE_MAP).
  # Bare `compose build` skips profiled services → "No such image" on push.
  # COMPOSE_PARALLEL_LIMIT=1: OrbStack often OOM-/daemon-crash on parallel builds.
  COMPOSE_PARALLEL_LIMIT=1 docker compose -p "$K8_COMPOSE_PROJECT" -f docker-compose.yml \
    --profile agents --profile demo-auth build

  # local-image:ghcr-image pairs (indexed array — works on macOS bash 3.2).
  # Local side = compose default naming under -p: ai-demo-k8-<service>.
  local IMAGE_MAP=(
    "ai-demo-k8-ui:ai-demo-frontend"
    "ai-demo-k8-demo-api-server:ai-demo-demo-api-server"
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
  )

  # Fail fast if any expected image is missing (avoids a partial GHCR push).
  local missing=()
  for entry in "${IMAGE_MAP[@]}"; do
    local_name="${entry%%:*}"
    docker image inspect "${local_name}:latest" &>/dev/null \
      || missing+=("${local_name}:latest")
  done
  if ((${#missing[@]})); then
    die "Build finished but missing local image(s): ${missing[*]}"
  fi

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

# Point kubectl at the EKS cluster and print pod status. `./run-k8.sh status`
# never touches EKS — it only ever inspects whatever context is already
# current, so an AWS-deployed stack was silently invisible to it.
aws_status() {
  check_eks_env
  info "Updating kubeconfig for EKS cluster: $EKS_CLUSTER_NAME"
  aws eks update-kubeconfig --name "$EKS_CLUSTER_NAME" --region "$AWS_REGION"
  K8S_NAMESPACE="${K8S_NAMESPACE:-ai-demo}" bash "$K8S_DIR/deploy.sh" status
}

sim_deploy() {
  check_ghcr_env
  check_prereqs
  info "Deploying GHCR images to local OrbStack K8s..."
  bash "$K8S_DIR/aws/deploy.sh"   # EKS_CLUSTER_NAME not set → targets current context
}

# ── SE DevOps cluster helpers ─────────────────────────────────────────────────

# Derive the SE namespace from the Ping email address, then PIN it to
# demo_api_server/.env as SE_NAMESPACE= so every later run reuses the same
# value without re-deriving. This is a shared cluster — a leftover
# `export SE_NAMESPACE=...` from an unrelated terminal session silently
# redirecting a deploy to the wrong namespace is the failure mode this
# guards against: an explicit env-var override still works (documented,
# sanctioned), but it now logs loudly when it disagrees with the pinned
# value instead of silently winning.
#
# cmuir@pingidentity.com  → ping-devops-cmuir
# curtis.muir@pingidentity.com → ping-devops-curtismuir
#
# NOTE: this function is always called as `ns="$(derive_se_namespace)"` —
# every diagnostic line below MUST go to stderr (`>&2`), never stdout, or it
# corrupts the captured namespace value. `info`/`warn` write to stdout, so
# this function does not use them.
derive_se_namespace() {
  local pinned=""
  if [[ -f "$BASEDIR/demo_api_server/.env" ]]; then
    pinned="$(grep -E '^SE_NAMESPACE=' "$BASEDIR/demo_api_server/.env" 2>/dev/null | tail -1 | cut -d= -f2-)"
  fi

  if [[ -n "${SE_NAMESPACE:-}" ]]; then
    if [[ -n "$pinned" && "$SE_NAMESPACE" != "$pinned" ]]; then
      echo "  !  SE_NAMESPACE=$SE_NAMESPACE overrides the pinned namespace ($pinned) for THIS run only." >&2
      echo "     demo_api_server/.env is unchanged — unset SE_NAMESPACE to go back to $pinned." >&2
    fi
    echo "$SE_NAMESPACE"
    return
  fi

  if [[ -n "$pinned" ]]; then
    echo "$pinned"
    return
  fi

  # Prefer a Ping Identity email — the namespace is always derived from the
  # Ping email localpart, not whatever git config user.email is set to.
  # Check sources in order: PING_EMAIL env var, .env file, git config (only
  # if it ends in @pingidentity.com), then prompt the user.
  local email=""

  # 1. Explicit env var
  if [[ -n "${PING_EMAIL:-}" ]]; then
    email="$(sanitize_ping_email "$PING_EMAIL")"
    if [[ -z "$email" ]]; then
      die "PING_EMAIL must be a @pingidentity.com address (personal email is not allowed)"
    fi
  fi

  # 2. PING_EMAIL in demo_api_server/.env
  if [[ -z "$email" && -f "$BASEDIR/demo_api_server/.env" ]]; then
    email="$(sanitize_ping_email "$(grep -E '^PING_EMAIL=' "$BASEDIR/demo_api_server/.env" 2>/dev/null | cut -d= -f2- || true)")"
  fi

  # 3. git config — only if it's a Ping email
  if [[ -z "$email" ]]; then
    email="$(sanitize_ping_email "$(git config user.email 2>/dev/null || true)")"
  fi

  # 4. Ask the user — namespace can't be derived without a Ping email
  if [[ -z "$email" ]]; then
    if [[ -t 0 ]] || [[ -r /dev/tty ]]; then
      email="$(read_ping_email "  Enter your Ping email (e.g. cmuir@pingidentity.com): ")"
      # Cache it in .env for next time
      if [[ -n "$email" && -f "$BASEDIR/demo_api_server/.env" ]]; then
        if grep -q '^PING_EMAIL=' "$BASEDIR/demo_api_server/.env" 2>/dev/null; then
          sed -i.bak "s|^PING_EMAIL=.*|PING_EMAIL=${email}|" "$BASEDIR/demo_api_server/.env" && rm -f "$BASEDIR/demo_api_server/.env.bak"
        else
          echo "PING_EMAIL=${email}" >> "$BASEDIR/demo_api_server/.env"
        fi
        echo "  Saved PING_EMAIL to demo_api_server/.env for future deploys." >&2
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
  local resolved="ping-devops-${slug}"

  # Pin it — every later run reads SE_NAMESPACE straight from .env above,
  # skipping re-derivation entirely, so the namespace can't drift as long as
  # the pinned line stays untouched.
  if [[ -f "$BASEDIR/demo_api_server/.env" ]]; then
    if grep -q '^SE_NAMESPACE=' "$BASEDIR/demo_api_server/.env" 2>/dev/null; then
      sed -i.bak "s|^SE_NAMESPACE=.*|SE_NAMESPACE=${resolved}|" "$BASEDIR/demo_api_server/.env" && rm -f "$BASEDIR/demo_api_server/.env.bak"
    else
      echo "SE_NAMESPACE=${resolved}" >> "$BASEDIR/demo_api_server/.env"
    fi
    echo "  Pinned SE_NAMESPACE=${resolved} to demo_api_server/.env for future deploys." >&2
  fi

  echo "$resolved"
}

# In-cluster K8 deploy uses k8s/56-llm-stack.yaml (llm-proxy + swap tiers).
# Host llama-server setup is not needed before kubectl apply.
ensure_llamacpp_running() {
  info "LLM: in-cluster 2-tier stack (llm-proxy + swap tiers) — skipping host llama-server setup."
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

# Point kubectl at the SE cluster + your namespace and print pod status.
# `./run-k8.sh status` never switches context/namespace, so an SE-deployed
# stack was silently invisible to it (querying the local cluster instead).
se_status() {
  local ns
  ns="$(derive_se_namespace)"
  local ctx
  ctx="$(kubectl config current-context 2>/dev/null || true)"
  if [[ "$ctx" != "us" && "$ctx" != "ping-dev-aws-us-east-2-oidc" ]]; then
    info "Switching kubectl context to 'us' (ping-dev-aws-us-east-2)..."
    kubectl config use-context us
  fi
  info "SE cluster status → namespace: $ns"
  K8S_NAMESPACE="$ns" bash "$K8S_DIR/deploy.sh" status
}

se_rag() {
  local action="${1:-on}"
  [[ "$action" == "on" || "$action" == "off" ]] \
    || die "RAG action must be 'on' or 'off'"
  local ns
  ns="$(derive_se_namespace)"
  local ctx
  ctx="$(kubectl config current-context 2>/dev/null || true)"
  if [[ "$ctx" != "us" && "$ctx" != "ping-dev-aws-us-east-2-oidc" ]]; then
    info "Switching kubectl context to 'us' (ping-dev-aws-us-east-2)..."
    kubectl config use-context us
  fi
  kubens "$ns"
  info "SE cluster RAG $action → namespace: $ns"
  if [[ "$action" == "on" ]]; then
    check_ghcr_env
  fi
  if [[ "$action" == "off" ]]; then
    K8S_NAMESPACE="$ns" bash "$K8S_DIR/deploy.sh" rag off
  else
    K8S_NAMESPACE="$ns" RAG_ACTION="$action" \
      bash "$K8S_DIR/aws/deploy-rag.sh"
  fi
}

se_deploy_banner() {
  local ns="$1"
  echo ""
  demo_banner_title "[SE]" "CLUSTER DEPLOY COMPLETE ✓"
  echo ""
  demo_box_open "${GREEN}" "ACCESS"
  demo_box_row "${GREEN}" "App URL     ${YELLOW}${BOLD}https://ai-demo.ping-devops.com${RESET}"
  demo_box_row "${GREEN}" "Namespace   ${YELLOW}${BOLD}${ns}${RESET}"
  demo_box_row "${GREEN}" "BFF health  ${YELLOW}${BOLD}https://ai-demo.ping-devops.com/api/health${RESET}"
  demo_box_close "${GREEN}"
  echo ""
  demo_box_open "${WHITE}" "LOGS"
  demo_box_row "${WHITE}" "All pods:      kubectl logs -n ${ns} -l app=ai-demo --all-containers --prefix -f"
  demo_box_row "${WHITE}" "Frontend:      kubectl logs -n ${ns} deploy/frontend -f"
  demo_box_row "${WHITE}" "BFF:           kubectl logs -n ${ns} deploy/demo-api-server -f"
  demo_box_row "${WHITE}" "MCP Gateway:   kubectl logs -n ${ns} deploy/mcp-gateway -f"
  demo_box_close "${WHITE}"
  echo ""
  echo -e "${YELLOW}${BOLD}  ⚠️  IMPORTANT — Undeploy when done (shared cluster)${RESET}"
  echo -e "${YELLOW}  Run: ${BOLD}./run-k8.sh se-undeploy${RESET}"
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
  success "Access at https://local.ping-devops.com:4000"
}

show_help() {
  grep '^#' "$0" | grep -v '#!/' | sed 's/^# \?//'
}

# Machine panel ahead of any command that builds or deploys. Skipped when
# run-pingaws.sh already printed it before exec'ing into this script.
case "${1:-all}" in
  machine|specs)
    demo_machine_banner cluster
    exit 0
    ;;
  all|build|deploy|restart|sim-deploy|se-build|se-deploy|se-all|aws-build|aws-deploy|aws-all)
    demo_machine_banner cluster
    ;;
esac

case "${1:-all}" in
  all)        check_prereqs; kill_all; build; deploy; forward ;;
  build)      build ;;
  deploy)     check_prereqs; deploy; kill_all; forward ;;
  forward)      check_prereqs; kill_all; forward ;;
  forward-api)  check_prereqs; kill_all; forward_api ;;
  forward-bg)   check_prereqs; forward_bg "${2:-api}" ;;
  kill)       kill_all ;;
  stop)       check_prereqs; stop ;;
  mode)       check_prereqs; bash "$K8S_DIR/deploy.sh" mode "${2:-}" ;;
  extras)     check_prereqs; extras "${2:-}" ;;
  rag)        check_prereqs; bash "$K8S_DIR/deploy.sh" rag "${2:-on}" ;;
  yotuo)      check_prereqs; bash "$K8S_DIR/deploy.sh" yotuo "${2:-on}" "${3:-}" ;;
  demo-sync)  check_prereqs; bash "$K8S_DIR/deploy.sh" demo-sync ;;
  status)     check_prereqs; status ;;
  restart)    check_prereqs; restart; kill_all; forward ;;
  destroy)    check_prereqs; destroy ;;
  sim)        sim ;;
  sim-deploy) sim_deploy; forward ;;
  se-build)    aws_build ;;
  se-deploy)   se_deploy ;;
  se-all)      aws_build; se_deploy ;;
  se-status)   se_status ;;
  se-rag)      se_rag "${2:-on}" ;;
  se-undeploy) se_undeploy ;;
  aws-build)  aws_build ;;
  aws-deploy) aws_deploy; aws_finish ;;
  aws-all)    aws_build; aws_deploy; aws_finish ;;
  aws-status) aws_status ;;
  help)       show_help ;;
  *)
    echo "Usage: $0 {all|build|deploy|forward|forward-api|forward-bg|kill|stop|extras|rag|yotuo|demo-sync|status|restart|destroy|sim|sim-deploy|se-build|se-deploy|se-all|se-status|se-rag|se-undeploy|aws-build|aws-deploy|aws-all|aws-status|help}"
    exit 1
    ;;
esac
