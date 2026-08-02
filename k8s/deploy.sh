#!/bin/bash
# k8s/deploy.sh — deploy or manage the AI Demo on local Kubernetes
#
# Usage:
#   ./k8s/deploy.sh                       # full deploy (langchain agent on by default)
#   ./k8s/deploy.sh status                # show pod/service/ingress status
#   ./k8s/deploy.sh forward               # port-forward running services to localhost
#   ./k8s/deploy.sh forward-api           # BFF only (3001) — auto-respawn supervisor
#   ./k8s/deploy.sh forward-bg [api|core] # same, detached (survives terminal close)
#   ./k8s/deploy.sh stop-forward          # stop a running port-forward session
#   ./k8s/deploy.sh extras off            # stop just the investment + mortgage backends (frees memory)
#   ./k8s/deploy.sh rag on                  # start Code Search / RAG stack on demand
#   ./k8s/deploy.sh yotuo on                # mount host GGUFs from .local/models (internal HD)
#   ./k8s/deploy.sh stop                  # scale all workloads to 0 (keep config; frees memory)
#   ./k8s/deploy.sh agent mastra          # switch active agent to mastra (others → 0)
#   ./k8s/deploy.sh agent langchain       #   or switch back to langchain
#   ./k8s/deploy.sh agent mastra off      # stop it (frees quota), don't start another
#   ./k8s/deploy.sh demo-sync             # align gateway deployments with admin Quick Flags
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
NS="${K8S_NAMESPACE:-ai-demo}"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/demo-terminal.sh
source "${REPO_ROOT}/scripts/demo-terminal.sh"
demo_init_terminal

# Which AI agent to start (replicas:1). All others are scaled to 0.
# Inherited from run-k8.sh via --agent=<name>, or set directly. Default: langchain.
AGENT_SELECTION="${AGENT_SELECTION:-langchain}"
ALL_AGENTS="langchain mastra openai pydantic"

# Optional feature backends (investment + mortgage tools). They start normally
# with `deploy`; `./k8s/deploy.sh extras off|on` stops/starts just these two to
# shed (or restore) memory on demand without touching the rest of the stack.
EXTRA_SERVICES="mcp-resource-server api-resource-server"
RAG_SERVICES="weaviate embeddings mcp-code-search llamaindex-agent"
DEFAULT_YOTUO_PATH="${LLM_MODELS_HOST_PATH:-$(cd "$SCRIPT_DIR/.." && pwd)/.local/models}"

info()    { demo_info "$@"; }
success() { demo_success "$@"; }
warn()    { demo_warn "$@"; }
die()     { demo_err "$@"; exit 1; }

check_prereqs() {
  command -v kubectl &>/dev/null || die "kubectl not found"
  kubectl cluster-info &>/dev/null || die "Cannot reach K8s cluster. Enable K8s in OrbStack Settings."
  info "K8s cluster reachable."
}

deploy() {
  info "Deploying AI Demo to namespace: $NS"

  kubectl apply -f "$SCRIPT_DIR/01-namespace.yaml"

  # Images are tagged ai-demo-k8-*:latest with imagePullPolicy: IfNotPresent. When
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
  kubectl apply -f "$SCRIPT_DIR/21-api-server-logs-pvc.yaml"

  # OTel bootstrap script mounted at /otel in every instrumented Node service
  # (mirrors docker-compose's ./scripts/otel-instrument.js bind mount).
  kubectl create configmap otel-instrument -n "$NS" \
    --from-file=otel-instrument.js="$SCRIPT_DIR/../scripts/otel-instrument.js" \
    --dry-run=client -o yaml | kubectl apply -f -

  # Deploy in dependency order: tracing → backends → bff → gateway/agents → ui
  # Jaeger first so the OTLP collector is up before services export spans
  kubectl apply -f "$SCRIPT_DIR/73-jaeger-deployment.yaml"
  # Backend tool servers
  kubectl apply -f "$SCRIPT_DIR/30-mcp-server-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/63-mcp-resource-server-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/64-api-resource-server-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/62-hitl-service-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/56-llm-stack.yaml"           # 2-tier LLM proxy + swap tiers
  kubectl apply -f "$SCRIPT_DIR/72-rag-stack.yaml"           # RAG (replicas:0 until `rag on`)
  # BFF (token custodian)
  kubectl apply -f "$SCRIPT_DIR/20-api-server-deployment.yaml"
  # Gateway + agent runtimes (mcp-gateway starts at replicas:0; demo-sync scales it)
  kubectl apply -f "$SCRIPT_DIR/60-mcp-gateway-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/71-ping-gateway-deployment.yaml"   # real PingGateway (IG)
  kubectl apply -f "$SCRIPT_DIR/75-ping-mcpgw-deployment.yaml"     # PingOne Privilege MCPGW
  kubectl apply -f "$SCRIPT_DIR/68-mcp-proxy-deployment.yaml"      # scaled by demo-sync
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
  for dep in jaeger mcp-server mcp-resource-server api-resource-server hitl-service \
             demo-api-server ping-gateway agent-service \
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
  # LLM stack: tier-manager + proxy start quickly; tier1 downloads Phi-4 on first
  # boot (~2GB). Non-fatal if slow — agents become usable once /health passes.
  info "Waiting for LLM stack (tier-manager, llm-proxy, llama-tier1; up to 10m for first model download)..."
  for dep in tier-manager llm-proxy; do
    kubectl rollout status "deployment/$dep" -n "$NS" --timeout=120s \
      || warn "$dep not ready — check: kubectl logs deploy/$dep -n $NS"
  done
  if ! kubectl rollout status deployment/llama-tier1 -n "$NS" --timeout=600s; then
    warn "llama-tier1 not ready yet — model may still be downloading. Check: kubectl logs deploy/llama-tier1 -n $NS"
  fi

  _maybe_apply_yotuo_models

  demo_sync_cmd

  success "Core deployments ready (${AGENT_SELECTION}-agent on; others off)."
  show_status
  # run-k8.sh owns the final "next step" line (it points at ./run-k8.sh forward),
  # so suppress ours when invoked through it — otherwise the user sees two
  # forward instructions pointing at two different scripts. Direct callers of
  # this script still get the hint.
  [ -n "${RUNK8:-}" ] || success "Deploy complete — to open the UI, run:  ./k8s/deploy.sh forward   (https://api.ping.demo:4000)"
}

show_commands() {
  echo ""
  demo_banner_title "[K8S]" "AI DEMO — deploy.sh"
  echo ""
  demo_box_open "${WHITE}" "COMMANDS"
  demo_box_row "${WHITE}" "${BOLD}./k8s/deploy.sh${RESET}                       full deploy"
  demo_box_row "${WHITE}" "${BOLD}./k8s/deploy.sh status${RESET}            pod and agent health"
  demo_box_row "${WHITE}" "${BOLD}./k8s/deploy.sh forward${RESET}           port-forward to localhost"
  demo_box_row "${WHITE}" "${BOLD}./k8s/deploy.sh forward-api${RESET}       BFF :3001 only (auto-respawn)"
  demo_box_row "${WHITE}" "${BOLD}./k8s/deploy.sh forward-bg [api]${RESET}  detached forward supervisor"
  demo_box_row "${WHITE}" "${BOLD}./k8s/deploy.sh stop-forward${RESET}      stop a running port-forward session"
  demo_box_row "${WHITE}" "${BOLD}./k8s/deploy.sh extras [on|off]${RESET}   stop/start investment + mortgage backends"
  demo_box_row "${WHITE}" "${BOLD}./k8s/deploy.sh rag [on|off]${RESET}      start/stop Code Search / RAG stack"
  demo_box_row "${WHITE}" "${BOLD}./k8s/deploy.sh yotuo [on|off]${RESET}    mount host GGUFs from .local/models"
  demo_box_row "${WHITE}" "${BOLD}./k8s/deploy.sh stop${RESET}              scale all workloads to 0"
  demo_box_row "${WHITE}" "${BOLD}./k8s/deploy.sh agent <name>${RESET}      switch agent [langchain|mastra|openai|pydantic]"
  demo_box_row "${WHITE}" "${BOLD}./k8s/deploy.sh demo-sync${RESET}         align gateways with Quick Flags"
  demo_box_row "${WHITE}" "${BOLD}./k8s/deploy.sh destroy${RESET}           delete namespace and all resources"
  demo_box_close "${WHITE}"
  echo ""
  demo_box_open "${GREEN}" "URLS"
  demo_box_row "${GREEN}" "[WEB]  App   ${YELLOW}${BOLD}https://api.ping.demo:4000${RESET}"
  demo_box_row "${GREEN}" "[BFF]  API   ${YELLOW}${BOLD}https://api.ping.demo:3001${RESET}"
  demo_box_close "${GREEN}"
  echo ""
}

show_status() {
  local ctx
  ctx="$(kubectl config current-context 2>/dev/null || echo "(none)")"
  echo
  echo -e "${CYAN}${BOLD}  Pods — context: ${ctx}  namespace: ${NS}${RESET}"
  echo

  # Fetch once so we can tell "kubectl failed" apart from "namespace has no pods" —
  # piping straight into the while loop hid both cases behind a silent blank line
  # (the pipeline's exit status was the while loop's, never kubectl's).
  local raw
  if ! raw="$(kubectl get pods -n "$NS" --no-headers 2>&1)"; then
    echo -e "  ${RED}kubectl failed — check context/cluster reachability:${RESET}"
    echo "$raw" | sed 's/^/    /'
    echo
    return
  fi
  # kubectl prints "No resources found in <ns> namespace." (not empty output)
  # when there are no pods — treat that the same as truly empty output.
  if [ -z "$raw" ] || [[ "$raw" == "No resources found"* ]]; then
    echo "  (no pods found in this namespace)"
  else
    # awk normalises "2 (50s ago)" restarts → "2" so read gets exactly 5 fields.
    echo "$raw" \
      | awk '{print $1, $2, $3, $4, $NF}' \
      | while read -r name ready status restarts age; do
      local icon color restart_tag
      local total="${ready##*/}" current="${ready%%/*}"
      case "$status" in
        Running)
          if [ "$current" = "$total" ]; then
            icon="✅"; color="$GREEN"
          else
            icon="⚠️"; color="$YELLOW"
          fi ;;
        ContainerCreating|Init:*|PodInitializing|Pending|Terminating)
          icon="⚠️"; color="$YELLOW" ;;
        CrashLoopBackOff|Error|OOMKilled|ImagePullBackOff|ErrImagePull)
          icon="❌"; color="$RED" ;;
        *)
          icon="⚠️"; color="$YELLOW" ;;
      esac

      restart_tag=""
      [ "${restarts:-0}" -gt 0 ] 2>/dev/null && restart_tag=" ${RED}↺${restarts}${RESET}"

      printf "  %s  ${color}%-48s${RESET}  %s  %-22s  age:%-4s%b\n" \
        "$icon" "$name" "$ready" "$status" "$age" "$restart_tag"
    done
  fi

  echo
  echo -e "${CYAN}${BOLD}  Agent selection${RESET}"
  echo
  for _agent in $ALL_AGENTS; do
    local dep="${_agent}-agent"
    local replicas
    replicas=$(kubectl get deploy "$dep" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null) || true
    if [ "${replicas:-0}" -ge 1 ]; then
      printf "  ${GREEN}✓${RESET}  ${GREEN}%-28s on${RESET}\n" "$dep"
    else
      printf "  ${DIM}%-30s off${RESET}\n" "$dep"
    fi
  done

  echo
  echo -e "${CYAN}${BOLD}  Gateway selection (demo-sync)${RESET}"
  echo
  for _gw in ping-gateway mcp-gateway mcp-proxy llm-proxy; do
    local replicas
    replicas=$(kubectl get deploy "$_gw" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null) || true
    if [ "${replicas:-}" = "" ]; then
      printf "  ${DIM}%-30s not deployed${RESET}\n" "$_gw"
    elif [ "${replicas:-0}" -ge 1 ]; then
      printf "  ${GREEN}✓${RESET}  ${GREEN}%-28s on${RESET}\n" "$_gw"
    else
      printf "  ${DIM}%-30s off${RESET}\n" "$_gw"
    fi
  done

  echo
  echo -e "${CYAN}${BOLD}  RAG stack (rag on/off)${RESET}"
  echo
  for _rag in $RAG_SERVICES; do
    local replicas
    replicas=$(kubectl get deploy "$_rag" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null) || true
    if [ "${replicas:-}" = "" ]; then
      printf "  ${DIM}%-30s not deployed${RESET}\n" "$_rag"
    elif [ "${replicas:-0}" -ge 1 ]; then
      printf "  ${GREEN}✓${RESET}  ${GREEN}%-28s on${RESET}\n" "$_rag"
    else
      printf "  ${DIM}%-30s off${RESET}\n" "$_rag"
    fi
  done

  show_commands
}

FORWARD_BG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/.local/k8s-forward"
FORWARD_PIDFILE="$FORWARD_BG_DIR/forward.pid"
FORWARD_LOG="$FORWARD_BG_DIR/forward.log"

# Print the PIDs (space-separated) of any OTHER running forward supervisors.
# Checks the detached pidfile first, then foreground `deploy.sh forward*` procs.
find_forward_sessions() {
  local mypgid pids="" pid pgid
  if [ -f "$FORWARD_PIDFILE" ]; then
    pid=$(tr -d ' \n' < "$FORWARD_PIDFILE")
    if [ -n "$pid" ] && [ "$pid" != "$$" ] && kill -0 "$pid" 2>/dev/null; then
      pids="$pid"
    fi
  fi
  mypgid=$(ps -o pgid= -p "$$" 2>/dev/null | tr -d ' ')
  for pid in $(pgrep -f "$SCRIPT_NAME forward" 2>/dev/null); do
    [ "$pid" = "$$" ] && continue
    case "$(ps -p "$pid" -o args= 2>/dev/null)" in
      *"stop-forward"*) continue ;;
      *"$SCRIPT_NAME forward"*) ;;
      *) continue ;;
    esac
    pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
    [ "$pgid" = "$mypgid" ] && continue
    case " $pids " in *" $pid "*) continue ;; esac
    pids="$pids $pid"
  done
  echo "${pids# }"
}

# Return the kubectl port-forward specs for the active FORWARD_PROFILE.
#   api  — BFF only (local Vite dev)
#   core — UI + BFF
#   all  — full debug set (default)
forward_specs_for_profile() {
  local profile="${FORWARD_PROFILE:-all}"
  case "$profile" in
    api)
      FORWARD_SPECS=(
        "svc/demo-api-server 3001:3001"
      )
      ;;
    core)
      FORWARD_SPECS=(
        "svc/frontend           4000:4000"
        "svc/demo-api-server 3001:3001"
      )
      ;;
    all|*)
      FORWARD_SPECS=(
        "svc/frontend           4000:4000"
        "svc/demo-api-server 3001:3001"
        "svc/mcp-server         8080:8080"
        "svc/mcp-resource-server         8081:8081"
        "svc/api-resource-server   8082:8082"
        "svc/mcp-gateway        3005:3005"
        "svc/ping-gateway       3036:8080"
        "svc/mcp-proxy          8895:8895"
        "svc/llm-proxy          8090:8090"
        "svc/mcp-code-search    8095:8095"
        "svc/llamaindex-agent   8894:8894"
        "svc/agent-service      3016:3006"
        "svc/hitl-service       3009:3009"
        "svc/langchain-agent    8888:8888 8889:8889 8890:8890"
        "svc/openai-agent       8891:8891"
        "svc/mastra-agent       8892:8892"
        "svc/pydantic-agent     8893:8893"
      )
      ;;
  esac
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
  # them: the loop below respawns any that exit. FORWARD_PROFILE selects which
  # ports to bind (api = BFF only; core = UI+BFF; all = full debug set).
  local specs=()
  forward_specs_for_profile
  specs=("${FORWARD_SPECS[@]}")
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

  cleanup() {
    trap - INT TERM EXIT
    kill "${pids[@]}" 2>/dev/null
    rm -f "$FORWARD_PIDFILE"
    exit 0
  }
  trap cleanup INT TERM EXIT

  if [ -n "${FORWARD_DETACHED:-}" ]; then
    echo $$ > "$FORWARD_PIDFILE"
  fi

  info "Port-forwarding (${FORWARD_PROFILE:-all}) — Ctrl-C to stop. Dropped forwards auto-respawn."
  local i
  for i in "${!specs[@]}"; do start_fwd "$i"; done
  echo
  case "${FORWARD_PROFILE:-all}" in
    api)
      demo_box_open "${GREEN}" "FORWARD"
      demo_box_row "${GREEN}" "[BFF]  ${YELLOW}${BOLD}https://api.ping.demo:3001${RESET}"
      demo_box_close "${GREEN}"
      ;;
    core)
      demo_box_open "${GREEN}" "FORWARD"
      demo_box_row "${GREEN}" "[WEB]  ${YELLOW}${BOLD}https://api.ping.demo:4000${RESET}"
      demo_box_row "${GREEN}" "[BFF]  ${YELLOW}${BOLD}https://api.ping.demo:3001${RESET}"
      demo_box_close "${GREEN}"
      ;;
    *)
      demo_box_open "${GREEN}" "FORWARD"
      demo_box_row "${GREEN}" "[WEB]  ${YELLOW}${BOLD}https://api.ping.demo:4000${RESET}"
      demo_box_row "${GREEN}" "[BFF]  ${YELLOW}${BOLD}https://api.ping.demo:3001${RESET}"
      demo_box_close "${GREEN}"
      ;;
  esac
  echo
  success "Forwards up for running services. Watching for drops..."

  # Prove the host BFF is reachable before we go quiet. Dual listeners
  # (Docker Compose via OrbStack on *:3001 + kubectl on 127.0.0.1:3001) are
  # the usual cause of curl exit 000 / flaky /api/health.
  local _hc _i
  _hc=000
  for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    _hc=$(curl -sk -o /dev/null -w '%{http_code}' --connect-timeout 2 \
      https://api.ping.demo:3001/api/health 2>/dev/null || echo 000)
    [ "$_hc" = "200" ] && break
    sleep 1
  done
  if [ "$_hc" = "200" ]; then
    success "BFF health OK (https://api.ping.demo:3001/api/health → 200)"
  else
    warn "BFF health still unreachable (HTTP $_hc). If Docker Compose is also up, run './run-k8.sh kill' then './run-k8.sh forward'."
  fi

  # run-k8.sh sets RUNK8=1 — print the full status epilogue once forwards bind.
  if [ -n "${RUNK8:-}" ]; then
    demo_k8_forward_epilogue "$NS"
  elif [ -n "${RUNK8_POST_FORWARD_BANNER:-}" ]; then
    demo_print_block "$RUNK8_POST_FORWARD_BANNER"
  fi

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

# BFF-only forward — for local Vite on :4000 with K8s API on :3001.
forward_api() {
  FORWARD_PROFILE=api port_forward
}

# Detached supervisor — survives terminal close; auto-respawns dropped forwards.
forward_bg() {
  local profile="${1:-api}"
  case "$profile" in
    api|core|all) ;;
    *)
      die "forward-bg profile must be api, core, or all (got: $profile)"
      ;;
  esac
  local others; others=$(find_forward_sessions)
  if [ -n "$others" ]; then
    success "Forward supervisor already running (PID: $others). Log: $FORWARD_LOG"
    return 0
  fi
  mkdir -p "$FORWARD_BG_DIR"
  : > "$FORWARD_LOG"
  FORWARD_PROFILE="$profile" FORWARD_DETACHED=1 nohup "$SCRIPT_DIR/deploy.sh" forward >>"$FORWARD_LOG" 2>&1 &
  sleep 1
  if [ -f "$FORWARD_PIDFILE" ] && kill -0 "$(tr -d ' \n' < "$FORWARD_PIDFILE")" 2>/dev/null; then
    success "Port-forward supervisor started in background (profile=$profile, PID=$(tr -d ' \n' < "$FORWARD_PIDFILE"))"
  else
    warn "Supervisor may have failed to start — check $FORWARD_LOG"
    tail -5 "$FORWARD_LOG" 2>/dev/null || true
    return 1
  fi
  success "BFF: https://api.ping.demo:3001 — log: $FORWARD_LOG"
  success "Stop with: ./k8s/deploy.sh stop-forward"
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
  rm -f "$FORWARD_PIDFILE"
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

# Start/stop the RAG Code Search stack (Weaviate + embeddings + code-search + LlamaIndex).
rag_cmd() {
  local action="${1:-on}" replicas=1
  [ "$action" = "off" ] && replicas=0
  info "Scaling RAG stack to $replicas: $RAG_SERVICES"
  for _svc in $RAG_SERVICES; do
    kubectl scale "deployment/$_svc" -n "$NS" --replicas="$replicas"
  done
  if [ "$replicas" -eq 0 ]; then
    success "RAG stack stopped ($RAG_SERVICES)."
    return
  fi
  warn "RAG embeddings warm up on first request — Code Search may 503 for ~30s."
  kubectl rollout status deployment/weaviate -n "$NS" --timeout=180s || true
  local _pids=()
  for _svc in embeddings mcp-code-search llamaindex-agent; do
    kubectl rollout status "deployment/$_svc" -n "$NS" --timeout=300s & _pids+=($!)
  done
  for _pid in "${_pids[@]}"; do wait "$_pid" || true; done
  success "RAG stack running. Reindex from the Code Search UI after first start."
}

# Patch a llama tier Deployment to read GGUFs from a hostPath (OrbStack / single-node).
_yotuo_patch_tier() {
  local dep="$1" port="$2" model_file="$3" with_jinja="$4" host_path="$5"
  python3 - "$dep" "$port" "$model_file" "$with_jinja" "$host_path" "$NS" <<'PY'
import json, subprocess, sys
dep, port, model_file, with_jinja, host_path, ns = sys.argv[1:7]
# Match demo_llm_proxy/start-local-models.sh — cap context + single slot so
# Phi-4 fits in a 5Gi K8 limit (default ctx would OOM on ~17Gi OrbStack nodes).
args = ["--host", "0.0.0.0", "--port", port, "--ctx-size", "4096", "--parallel", "1"]
if with_jinja == "1":
    args.append("--jinja")
args += ["-m", f"/models/{model_file}"]
patch = [
    {"op": "replace", "path": "/spec/template/spec/containers/0/args", "value": args},
    {"op": "replace", "path": "/spec/template/spec/containers/0/volumeMounts",
     "value": [{"name": "host-models", "mountPath": "/models", "readOnly": True}]},
    {"op": "replace", "path": "/spec/template/spec/volumes",
     "value": [{"name": "host-models", "hostPath": {"path": host_path, "type": "Directory"}}]},
]
subprocess.run(
    ["kubectl", "patch", "deployment", dep, "-n", ns, "--type=json", "-p", json.dumps(patch)],
    check=True,
)
PY
  kubectl rollout status "deployment/$dep" -n "$NS" --timeout=300s \
    || warn "$dep rollout slow after YOTUO patch — check: kubectl logs deploy/$dep -n $NS"
}

# Mount pre-downloaded GGUFs from the Mac host (default: repo .local/models on internal HD).
yotuo_cmd() {
  local action="${1:-on}"
  if [ "$action" = "off" ]; then
    info "Restoring llama tiers to PVC + HuggingFace download mode..."
    kubectl apply -f "$SCRIPT_DIR/56-llm-stack.yaml"
    kubectl rollout restart deployment/llama-tier1 deployment/llama-tier5 -n "$NS"
    success "YOTUO overlay removed — tiers use llm-models PVC again."
    return
  fi
  local path="${2:-$DEFAULT_YOTUO_PATH}"
  [ -d "$path" ] || die "Models path not found: $path (set LLM_MODELS_HOST_PATH or pass a path)"
  [ -f "$path/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf" ] \
    || die "Missing Phi-4 GGUF under $path"
  if [ ! -f "$path/gpt-oss-20b-mxfp4.gguf" ]; then
    warn "gpt-oss-20b not found — tier5 swaps will fail until that file is present."
  fi
  info "Applying YOTUO hostPath overlay from $path"
  _yotuo_patch_tier llama-tier1 8091 microsoft_Phi-4-mini-instruct-Q4_K_M.gguf 0 "$path"
  _yotuo_patch_tier llama-tier5 8096 gpt-oss-20b-mxfp4.gguf 1 "$path"
  success "YOTUO models mounted — llama tiers read from $path (no HF download on cold start)."
}

# Auto-apply host GGUF overlay on deploy when models exist under .local/models.
_maybe_apply_yotuo_models() {
  if [ "${APPLY_YOTUO_MODELS:-auto}" = "0" ]; then
    return 0
  fi
  local path="$DEFAULT_YOTUO_PATH"
  if [ -d "$path" ] && [ -f "$path/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf" ]; then
    yotuo_cmd on "$path"
  fi
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

# Wait until the BFF readiness probe passes (demo-sync reads LMDB flags from it).
_wait_bff_healthy_k8() {
  if ! kubectl get deploy demo-api-server -n "$NS" &>/dev/null; then
    return 1
  fi
  local i=0
  while [ "$i" -lt 30 ]; do
    local ready
    ready=$(kubectl get deploy demo-api-server -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    if [ "${ready:-0}" -ge 1 ]; then
      if kubectl exec -n "$NS" deploy/demo-api-server -- \
        curl -sk -f --max-time 2 https://localhost:3001/api/healthz >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 2
    i=$((i + 1))
  done
  return 1
}

# Read ff_authorize_simulated + ff_mcp_gateway_pinggateway from the BFF LMDB store.
# Prints "sim pgw" as 0/1 tokens. Falls back to 0 1 (real P1AZ + PingGateway).
_read_demo_stack_flags_k8() {
  if ! kubectl get deploy demo-api-server -n "$NS" &>/dev/null; then
    echo "0 1"
    return 0
  fi
  local ready
  ready=$(kubectl get deploy demo-api-server -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  [ "${ready:-0}" -ge 1 ] || { echo "0 1"; return 0; }
  kubectl exec -n "$NS" deploy/demo-api-server -- node -e "
    const cs = require('./services/configStore');
    const t = (v) => (v === true || v === 'true') ? '1' : '0';
    const sim = t(cs.getEffective('ff_authorize_simulated'));
    const pgw = t(cs.getEffective('ff_mcp_gateway_pinggateway'));
    process.stdout.write(sim + ' ' + pgw);
  " 2>/dev/null || echo "0 1"
}

# Scale gateway deployments + mcp-proxy to match admin Quick Flag toggles.
# Real default: PingGateway (IG) + cloud PingOne Authorize — mcp-gateway off.
# Demo path: Node mcp-gateway when ff_mcp_gateway_pinggateway is OFF.
# Mock Authorize is handled by each gateway pod's authz sidecar (no standalone
# authz-server deployment in k8s — unlike Docker's demo-auth profile).
demo_sync_cmd() {
  echo ""
  echo -e "${CYAN}${BOLD}   [K8]  Demo stack sync (Quick Flags → deployments)${RESET}"
  echo ""

  if ! _wait_bff_healthy_k8; then
    warn "BFF not deployed/healthy yet — skipping demo-sync (default: real P1AZ + PingGateway)."
    warn "Deploy the stack first: ./run-k8.sh deploy"
    echo ""
    return 0
  fi

  local flags sim pgw need_demo_gw=0 proxy_gw_url
  flags="$(_read_demo_stack_flags_k8)"
  sim="${flags%% *}"
  pgw="${flags##* }"

  [ "$pgw" = "0" ] && need_demo_gw=1

  if [ "$need_demo_gw" -eq 1 ]; then
    success "Demo flags active (simulated=${sim}, pingGateway=${pgw}) — starting mcp-gateway"
    kubectl scale deployment/mcp-gateway -n "$NS" --replicas=1
    kubectl scale deployment/ping-gateway -n "$NS" --replicas=0 2>/dev/null || true
    proxy_gw_url="http://mcp-gateway:3005"
    kubectl rollout status deployment/mcp-gateway -n "$NS" --timeout=180s \
      || warn "mcp-gateway rollout slow — check: kubectl get pods -n $NS -l component=mcp-gateway"
  else
    success "Real stack (P1AZ + PingGateway) — stopping demo mcp-gateway"
    kubectl scale deployment/mcp-gateway -n "$NS" --replicas=0 2>/dev/null || true
    kubectl scale deployment/ping-gateway -n "$NS" --replicas=1
    proxy_gw_url="http://ping-gateway:8080"
    kubectl rollout status deployment/ping-gateway -n "$NS" --timeout=300s \
      || warn "ping-gateway rollout slow — IG cold start can take several minutes"
  fi

  if kubectl get deployment mcp-proxy -n "$NS" &>/dev/null; then
    kubectl scale deployment/mcp-proxy -n "$NS" --replicas=1
    kubectl set env deployment/mcp-proxy -n "$NS" "MCP_GATEWAY_HTTP_URL=${proxy_gw_url}"
    kubectl rollout status deployment/mcp-proxy -n "$NS" --timeout=120s \
      || warn "mcp-proxy rollout slow — check: kubectl logs deploy/mcp-proxy -n $NS"
  fi

  # BFF tool calls read MCP_GATEWAY_HTTP_URL from ai-demo-config (envFrom). Keep it
  # aligned with the active gateway — configmap defaults to mcp-gateway:3005 but
  # real-stack mode uses PingGateway at ping-gateway:8080.
  if kubectl get configmap ai-demo-config -n "$NS" &>/dev/null; then
    kubectl patch configmap ai-demo-config -n "$NS" --type merge \
      -p "{\"data\":{\"MCP_GATEWAY_HTTP_URL\":\"${proxy_gw_url}\"}}"
    kubectl rollout restart deployment/demo-api-server -n "$NS"
    kubectl rollout status deployment/demo-api-server -n "$NS" --timeout=180s \
      || warn "demo-api-server rollout slow after gateway URL patch"
  fi
  echo ""
}

case "${1:-deploy}" in
  deploy)        check_prereqs; deploy ;;
  status)        show_status ;;
  forward)       port_forward ;;
  forward-api)   forward_api ;;
  forward-bg)    forward_bg "${2:-api}" ;;
  # Exit 0 if a forward session is running, 1 if not — lets run-k8.sh reuse
  # find_forward_sessions (the one source of truth) for its post-deploy hint.
  forward-status) [ -n "$(find_forward_sessions)" ] ;;
  stop-forward)  stop_forward ;;
  stop)          stop_cluster ;;
  extras)        extras_cmd "$2" ;;
  rag)           rag_cmd "${2:-on}" ;;
  yotuo)         yotuo_cmd "${2:-on}" "$3" ;;
  demo-sync)     check_prereqs; demo_sync_cmd ;;
  agent)         check_prereqs; agent_cmd "$2" "$3" ;;
  destroy)       destroy ;;
  help|--help|-h) show_commands ;;
  *)
    echo -e "${RED}Unknown command: ${1}${RESET}"
    show_commands
    exit 1
    ;;
esac
