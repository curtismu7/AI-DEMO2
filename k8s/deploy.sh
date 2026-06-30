#!/bin/bash
# k8s/deploy.sh — deploy or manage the AI Demo on local Kubernetes
#
# Usage:
#   ./k8s/deploy.sh                       # full deploy (langchain agent on by default)
#   ./k8s/deploy.sh status                # show pod/service/ingress status
#   ./k8s/deploy.sh forward               # port-forward running services to localhost
#   ./k8s/deploy.sh stop-forward          # stop a running port-forward session
#   ./k8s/deploy.sh extras off            # stop just the investment + mortgage backends (frees memory)
#   ./k8s/deploy.sh stop                  # scale all workloads to 0 (keep config; frees memory)
#   ./k8s/deploy.sh agent mastra          # switch active agent to mastra (others → 0)
#   ./k8s/deploy.sh agent langchain       #   or switch back to langchain
#   ./k8s/deploy.sh agent mastra off      # stop it (frees quota), don't start another
#   ./k8s/deploy.sh destroy               # delete the namespace and everything in it
#
# Prerequisites:
#   1. OrbStack (or Docker Desktop) K8s enabled
#   2. Images built: docker compose build  (from repo root)
#   3. Bootstrap run: cd demo_api_server && npm run pingone:bootstrap
#
# Access after deploy:
#   Port-forward: ./k8s/deploy.sh forward
#   UI:           https://api.ping.demo:4000
#   BFF:          https://api.ping.demo:3001

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_NAME="$(basename "$0")"
NS="ai-demo"

# Which AI agent to start (replicas:1). All others are scaled to 0.
# Inherited from run-k8.sh via --agent=<name>, or set directly. Default: langchain.
AGENT_SELECTION="${AGENT_SELECTION:-langchain}"
ALL_AGENTS="langchain mastra openai pydantic"

# Optional feature backends (investment + mortgage tools). They start normally
# with `deploy`; `./k8s/deploy.sh extras off|on` stops/starts just these two to
# shed (or restore) memory on demand without touching the rest of the stack.
EXTRA_SERVICES="mcp-invest mortgage-service"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
die()     { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

check_prereqs() {
  command -v kubectl &>/dev/null || die "kubectl not found"
  kubectl cluster-info &>/dev/null || die "Cannot reach K8s cluster. Enable K8s in OrbStack Settings."
  info "K8s cluster reachable."
}

deploy() {
  info "Deploying AI Demo to namespace: $NS"

  kubectl apply -f "$SCRIPT_DIR/01-namespace.yaml"

  # Images are tagged ai-demo-*:latest with imagePullPolicy: IfNotPresent. When
  # only the image *contents* change (a rebuild), the Deployment spec is
  # identical, so `kubectl apply` is a no-op and the running pods keep serving
  # the OLD image. Capture which deployments already exist so we can force them
  # to recreate from the freshly built image after applying. Brand-new
  # deployments start from it already, so they are excluded (no wasted cycle).
  local pre_existing
  pre_existing=$(kubectl get deploy -n "$NS" -o name 2>/dev/null | sed 's#.*/##' | tr '\n' ' ' || true)

  info "Creating secrets from demo_api_server/.env and certs/..."
  bash "$SCRIPT_DIR/create-secrets.sh"

  kubectl apply -f "$SCRIPT_DIR/02-configmap.yaml"

  # Deploy in dependency order: backends → bff → gateway/agents → ui
  # Backend tool servers
  kubectl apply -f "$SCRIPT_DIR/30-mcp-server-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/63-mcp-invest-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/64-mortgage-service-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/62-hitl-service-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/55-llamacpp-deployment.yaml"   # in-cluster local LLM
  # BFF (token custodian)
  kubectl apply -f "$SCRIPT_DIR/20-api-server-deployment.yaml"
  # Gateway + agent runtimes
  kubectl apply -f "$SCRIPT_DIR/60-mcp-gateway-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/61-agent-service-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/40-agent-service-deployment.yaml"   # langchain agent
  kubectl apply -f "$SCRIPT_DIR/65-mastra-agent-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/66-openai-agent-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/67-pydantic-agent-deployment.yaml"
  # Frontend
  kubectl apply -f "$SCRIPT_DIR/10-frontend-deployment.yaml"

  if [ -n "${pre_existing// /}" ]; then
    info "Restarting already-running deployments to pick up rebuilt images..."
    kubectl rollout restart deployment -n "$NS" $pre_existing
  fi

  # Scale agents in parallel: only the selected agent runs (replicas:1), others 0.
  # This overrides whatever the manifests hardcode so langchain:1 in the manifest
  # doesn't accidentally run when a different agent is selected.
  case " $ALL_AGENTS " in *" $AGENT_SELECTION "*) ;; *)
    die "Unknown --agent value '$AGENT_SELECTION'. Valid: $ALL_AGENTS"
  ;; esac
  info "Agent selection: ${AGENT_SELECTION}-agent (all others scaled to 0)"
  for _agent in $ALL_AGENTS; do
    if [ "$_agent" = "$AGENT_SELECTION" ]; then
      kubectl scale "deployment/${_agent}-agent" -n "$NS" --replicas=1 &
    else
      kubectl scale "deployment/${_agent}-agent" -n "$NS" --replicas=0 &
    fi
  done
  wait

  # Wait for all rollouts in parallel — total time = slowest single deployment,
  # not the sequential sum. Each watcher runs in the background; we collect PIDs
  # and exit codes, then report any failures at the end.
  info "Waiting for rollouts in parallel (timeout 3m each)..."
  local _pids=() _deps=()
  for dep in mcp-server mcp-invest mortgage-service hitl-service \
             demo-api-server mcp-gateway agent-service \
             "${AGENT_SELECTION}-agent" frontend; do
    kubectl rollout status "deployment/$dep" -n "$NS" --timeout=180s &
    _pids+=($!)
    _deps+=("$dep")
  done

  local _failed=0
  for _i in "${!_pids[@]}"; do
    if ! wait "${_pids[$_i]}"; then
      warn "Rollout failed or timed out: ${_deps[$_i]}"
      _failed=$((_failed + 1))
    fi
  done
  [ "$_failed" -eq 0 ] || die "$_failed deployment(s) failed to roll out — check: kubectl get pods -n $NS"

  # llama.cpp is waited on separately and non-fatally: its readiness gates on the
  # GGUF model being downloaded (~2GB), which on a cold network can exceed the
  # 180s used above. A slow download should not fail the whole deploy — the rest
  # of the stack is already up; the llama.cpp agent mode just becomes usable once
  # the download finishes.
  info "Waiting for llama.cpp (downloads the GGUF on first start; up to 10m)..."
  if ! kubectl rollout status deployment/llamacpp -n "$NS" --timeout=600s; then
    warn "llama.cpp not ready yet — model may still be downloading. Check: kubectl logs deploy/llamacpp -n $NS"
  fi

  success "Core deployments ready (${AGENT_SELECTION}-agent on; others off)."
  show_status
  # run-k8.sh owns the final "next step" line (it points at ./run-k8.sh forward),
  # so suppress ours when invoked through it — otherwise the user sees two
  # forward instructions pointing at two different scripts. Direct callers of
  # this script still get the hint.
  [ -n "${RUNK8:-}" ] || success "Deploy complete — to open the UI, run:  ./k8s/deploy.sh forward   (https://api.ping.demo:4000)"
}

show_commands() {
  echo
  echo -e "${BLUE}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}  🛠  Commands${NC}"
  echo -e "${BLUE}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  printf "  ${GREEN}%-38s${NC} %s\n" "./k8s/deploy.sh"                   "full deploy"
  printf "  ${GREEN}%-38s${NC} %s\n" "./k8s/deploy.sh status"            "pod & agent health"
  printf "  ${GREEN}%-38s${NC} %s\n" "./k8s/deploy.sh forward"           "port-forward to localhost"
  printf "  ${GREEN}%-38s${NC} %s\n" "./k8s/deploy.sh stop-forward"      "stop a running port-forward session"
  printf "  ${GREEN}%-38s${NC} %s\n" "./k8s/deploy.sh extras [on|off]"   "stop/start investment + mortgage backends (frees memory)"
  printf "  ${GREEN}%-38s${NC} %s\n" "./k8s/deploy.sh stop"              "scale all workloads to 0 (keep config; frees memory)"
  printf "  ${GREEN}%-38s${NC} %s\n" "./k8s/deploy.sh agent <name>"      "switch agent  [langchain|mastra|openai|pydantic]"
  printf "  ${GREEN}%-38s${NC} %s\n" "./k8s/deploy.sh agent <name> off"  "stop agent, free quota"
  printf "  ${GREEN}%-38s${NC} %s\n" "./k8s/deploy.sh destroy"           "delete namespace & all resources"
  echo -e "${BLUE}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  printf "  🌐  %-10s ${BLUE}%s${NC}\n" "UI:"  "https://api.ping.demo:4000"
  printf "  🔗  %-10s ${BLUE}%s${NC}\n" "BFF:" "https://api.ping.demo:3001"
  echo -e "${BLUE}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo
}

show_status() {
  echo
  echo -e "${BLUE}▶ Pods — namespace: ${NS}${NC}"
  echo

  # awk normalises "2 (50s ago)" restarts → "2" so read gets exactly 5 fields.
  kubectl get pods -n "$NS" --no-headers 2>/dev/null \
    | awk '{print $1, $2, $3, $4, $NF}' \
    | while read -r name ready status restarts age; do
    local icon color restart_tag
    local total="${ready##*/}" current="${ready%%/*}"
    case "$status" in
      Running)
        if [ "$current" = "$total" ]; then
          icon="✅"; color="$GREEN"
        else
          icon="⏳"; color="$YELLOW"
        fi ;;
      ContainerCreating|Init:*|PodInitializing)
        icon="⏳"; color="$YELLOW" ;;
      Pending)
        icon="⌛"; color="$YELLOW" ;;
      CrashLoopBackOff|Error|OOMKilled)
        icon="❌"; color="$RED" ;;
      ImagePullBackOff|ErrImagePull)
        icon="🚫"; color="$RED" ;;
      Terminating)
        icon="🔄"; color="$YELLOW" ;;
      *)
        icon="❓"; color="$YELLOW" ;;
    esac

    restart_tag=""
    [ "${restarts:-0}" -gt 0 ] 2>/dev/null && restart_tag=" ${RED}↺${restarts}${NC}"

    printf "  %s  ${color}%-48s${NC}  %s  %-22s  age:%-4s%b\n" \
      "$icon" "$name" "$ready" "$status" "$age" "$restart_tag"
  done || echo "  (no pods found)"

  echo
  echo -e "${BLUE}▶ Agent selection${NC}"
  echo
  for _agent in $ALL_AGENTS; do
    local dep="${_agent}-agent"
    local replicas
    replicas=$(kubectl get deploy "$dep" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null)
    if [ "${replicas:-0}" -ge 1 ]; then
      printf "  🟢  ${GREEN}%-28s on${NC}\n" "$dep"
    else
      printf "  ⚫  %-28s off\n" "$dep"
    fi
  done

  show_commands
}

# Print the PIDs (space-separated) of any OTHER running `forward` sessions of
# this script. Matches by command line, then drops our own process group — the
# `$(...)` subshells running this check share our cmdline — so only genuinely
# separate sessions remain. Empty output means none are running.
find_forward_sessions() {
  local mypgid pids="" pid pgid
  mypgid=$(ps -o pgid= -p "$$" 2>/dev/null | tr -d ' ')
  for pid in $(pgrep -f "$SCRIPT_NAME forward\$" 2>/dev/null); do
    pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
    [ "$pgid" = "$mypgid" ] && continue   # our own process group (incl. $$ and its subshells)
    pids="$pids $pid"
  done
  echo "${pids# }"
}

port_forward() {
  # Singleton guard: a second concurrent `forward` can't bind the ports the
  # first already holds — kubectl errors "address already in use" and the
  # supervisor below respawn-spams forever. Refuse to start if another
  # `forward` session is already running.
  local others; others=$(find_forward_sessions)
  if [ -n "$others" ]; then
    die "A 'forward' session is already running (PID(s): $others). Stop it with './k8s/deploy.sh stop-forward' (or Ctrl-C in its terminal) before starting another."
  fi

  # Each entry is the args after `kubectl port-forward -n "$NS"`. A single
  # kubectl port-forward dies when the pod behind it restarts, so we supervise
  # them: the loop below respawns any that exit. Frontend/BFF are the
  # externally-facing ports (match docker-compose host ports); the rest are
  # loopback-only and handy for debugging.
  local specs=(
    "svc/frontend           4000:4000"
    "svc/demo-api-server 3001:3001"
    "svc/mcp-server         8080:8080"
    "svc/mcp-invest         8081:8081"
    "svc/mortgage-service   8082:8082"
    "svc/mcp-gateway        3005:3005"
    "svc/agent-service      3016:3006"
    "svc/hitl-service       3009:3009"
    "svc/langchain-agent    8888:8888 8889:8889 8890:8890"
    "svc/openai-agent       8891:8891"
    "svc/mastra-agent       8892:8892"
    "svc/pydantic-agent     8893:8893"
  )
  # Indexed (not associative) arrays — /bin/bash on macOS is 3.2.
  local pids=()
  # A service backed by a replicas:0 deployment (the on-demand agents) has no
  # endpoints — port-forwarding it errors immediately and the supervisor would
  # respawn-spam. Skip forwards with no ready replicas; once an agent is started
  # (`./k8s/deploy.sh agent <name>`) the supervisor picks it up on the next tick.
  svc_ready() {
    local name="${1#svc/}"; name="${name%% *}"
    local ready
    ready=$(kubectl get deploy "$name" -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null)
    [ "${ready:-0}" -gt 0 ] 2>/dev/null
  }
  # Word-splitting on the spec is intentional (svc + one or more ports).
  start_fwd() {
    svc_ready "${specs[$1]}" || return 0
    kubectl port-forward -n "$NS" ${specs[$1]} >/dev/null & pids[$1]=$!
  }

  cleanup() { trap - INT TERM EXIT; kill "${pids[@]}" 2>/dev/null; exit 0; }
  trap cleanup INT TERM EXIT

  info "Port-forwarding — Ctrl-C to stop. Dropped forwards auto-respawn."
  local i
  for i in "${!specs[@]}"; do start_fwd "$i"; done
  echo
  echo -e "  🌐  ${BLUE}https://api.ping.demo:4000${NC}  (UI)"
  echo -e "  🔗  ${BLUE}https://api.ping.demo:3001${NC}  (BFF)"
  echo
  success "Forwards up for running services. Watching for drops..."

  # run-k8.sh hands its final banners (log commands + DONE - SUCCESS) through
  # this env var, pre-rendered, so they print here — the very end of the
  # output before the supervisor goes quiet.
  [ -z "${RUNK8_POST_FORWARD_BANNER:-}" ] || printf '%s\n' "$RUNK8_POST_FORWARD_BANNER"

  # Supervisor: every few seconds, respawn any forward whose process exited
  # (e.g. after a pod restart). The trap tears everything down on Ctrl-C/SIGTERM.
  while true; do
    sleep 3
    for i in "${!specs[@]}"; do
      if ! kill -0 "${pids[$i]:-}" 2>/dev/null; then
        # Skip (silently) services with no ready replicas — e.g. on-demand
        # agents not yet started. Once started, this respawns the forward.
        svc_ready "${specs[$i]}" || continue
        info "Forward '${specs[$i]%% *}' (re)starting."
        start_fwd "$i"
      fi
    done
  done
}

# Cleanly stop any running `forward` session. TERM lets each supervisor's
# cleanup trap reap its own kubectl children; only if that fails do we KILL and
# sweep up orphaned forwards directly.
stop_forward() {
  local sessions; sessions=$(find_forward_sessions)
  if [ -z "$sessions" ]; then
    info "No 'forward' session is running."
    return 0
  fi
  info "Stopping forward session(s): $sessions"
  kill $sessions 2>/dev/null || true
  # Poll up to ~3s: each supervisor's cleanup trap needs a moment to reap its
  # kubectl children before exiting. Only escalate if it's genuinely stuck.
  local left="" i
  for i in 1 2 3 4 5 6; do
    sleep 0.5
    left=$(find_forward_sessions)
    [ -z "$left" ] && break
  done
  if [ -n "$left" ]; then
    warn "Still alive after TERM ($left); sending KILL."
    kill -9 $left 2>/dev/null || true
    # KILL skips the cleanup trap, so reap any orphaned kubectl forwards.
    pkill -f "kubectl port-forward -n $NS" 2>/dev/null || true
  fi
  success "Forward session(s) stopped."
}

destroy() {
  warn "This will delete the entire $NS namespace and all resources."
  read -r -p "Type 'yes' to confirm: " confirm
  [ "$confirm" = "yes" ] || { info "Aborted."; exit 0; }
  kubectl delete namespace "$NS"
  success "Namespace $NS deleted."
}

# Scale every deployment in the namespace to 0 — frees all pod memory/CPU while
# keeping the namespace, config, secrets, and PVC intact, so a later `deploy`
# brings everything back without a rebuild. Use `destroy` for a full teardown.
stop_cluster() {
  info "Scaling all $NS deployments to 0 (config preserved)..."
  kubectl scale deployment --all -n "$NS" --replicas=0 2>/dev/null \
    || { info "No deployments to scale (namespace empty?)."; return 0; }
  success "All $NS workloads stopped. Restart with './k8s/deploy.sh deploy' or scale back up."
}

# Stop or start just the optional feature backends ($EXTRA_SERVICES) to shed or
# restore memory on demand. `extras off` scales them to 0; `extras` (or
# `extras on`) brings them back and waits for the rollout.
extras_cmd() {
  local action="${1:-on}" replicas=1
  [ "$action" = "off" ] && replicas=0
  info "Scaling extra backends to $replicas: $EXTRA_SERVICES"
  for _svc in $EXTRA_SERVICES; do
    kubectl scale "deployment/$_svc" -n "$NS" --replicas="$replicas"
  done
  if [ "$replicas" -eq 0 ]; then
    success "Extra backends stopped ($EXTRA_SERVICES)."
    return
  fi
  # Wait for rollouts in parallel (mirrors deploy()) so the services don't add up.
  local _pids=()
  for _svc in $EXTRA_SERVICES; do
    kubectl rollout status "deployment/$_svc" -n "$NS" --timeout=120s & _pids+=($!)
  done
  for _pid in "${_pids[@]}"; do wait "$_pid" || true; done
  success "Extra backends running ($EXTRA_SERVICES). If 'forward' is active it exposes them on the next tick."
}

# Switch the active agent at runtime without a full redeploy. Scales the chosen
# agent to 1 and all others to 0, then waits for the rollout to complete.
agent_cmd() {
  local name="$1" action="${2:-on}"
  [ -n "$name" ] || die "Usage: $0 agent <langchain|mastra|openai|pydantic> [on|off]"
  case " $ALL_AGENTS " in *" $name "*) ;; *) die "Unknown agent '$name'. Valid: $ALL_AGENTS" ;; esac
  local dep="${name}-agent"
  if [ "$action" = "off" ]; then
    kubectl scale "deployment/$dep" -n "$NS" --replicas=0
    success "$dep stopped (replicas:0) — quota freed."
    return
  fi
  # Scale down all other agents first, then scale up the selected one.
  for _agent in $ALL_AGENTS; do
    [ "$_agent" = "$name" ] || kubectl scale "deployment/${_agent}-agent" -n "$NS" --replicas=0
  done
  info "Starting $dep (others scaled to 0)..."
  kubectl scale "deployment/$dep" -n "$NS" --replicas=1
  kubectl rollout status "deployment/$dep" -n "$NS" --timeout=180s
  success "$dep is running. If './k8s/deploy.sh forward' is active it will expose it on the next tick."
}

case "${1:-deploy}" in
  deploy)        check_prereqs; deploy ;;
  status)        show_status ;;
  forward)       port_forward ;;
  # Exit 0 if a forward session is running, 1 if not — lets run-k8.sh reuse
  # find_forward_sessions (the one source of truth) for its post-deploy hint.
  forward-status) [ -n "$(find_forward_sessions)" ] ;;
  stop-forward)  stop_forward ;;
  stop)          stop_cluster ;;
  extras)        extras_cmd "$2" ;;
  agent)         check_prereqs; agent_cmd "$2" "$3" ;;
  destroy)       destroy ;;
  help|--help|-h) show_commands ;;
  *)
    echo -e "${RED}Unknown command: ${1}${NC}"
    show_commands
    exit 1
    ;;
esac
