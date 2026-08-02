#!/usr/bin/env bash
# scripts/demo-terminal.sh — shared ANSI colors and banner helpers for run*.sh launchers.
# Usage: source "${BASEDIR}/scripts/demo-terminal.sh" && demo_init_terminal

demo_init_terminal() {
  [[ -n "${DEMO_TERM_INIT:-}" ]] && return 0
  DEMO_TERM_INIT=1

  local _use_color=0
  if [[ -z "${NO_COLOR:-}" ]]; then
    if [[ -t 1 || "${FORCE_COLOR:-}" == "1" || "${CLICOLOR_FORCE:-}" == "1" ]]; then
      _use_color=1
    fi
  fi

  if [[ $_use_color -eq 1 ]]; then
    BOLD=$'\033[1m'
    CYAN=$'\033[1;36m'
    GREEN=$'\033[1;32m'
    YELLOW=$'\033[1;33m'
    MAGENTA=$'\033[1;35m'
    BLUE=$'\033[1;34m'
    WHITE=$'\033[1;37m'
    RED=$'\033[1;31m'
    DIM=$'\033[2m'
    RESET=$'\033[0m'
  else
    BOLD='' CYAN='' GREEN='' YELLOW='' MAGENTA='' BLUE='' WHITE='' RED='' DIM='' RESET=''
  fi
  NC="${RESET}"
}

# Print a pre-rendered multiline block (preserves embedded ANSI from command substitution).
demo_print_block() {
  printf '%b\n' "${1:-}"
}

demo_hrule() {
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

# demo_banner_title "[DOCKER]" "AI DEMO — STATUS"
demo_banner_title() {
  demo_hrule
  echo -e "${CYAN}${BOLD}   $1  $2${RESET}"
  demo_hrule
}

demo_box_open() {
  local color="$1" label="$2"
  echo -e "${color}${BOLD}  ╭─ ${label} ──────────────────────────────────────────────────────╮${RESET}"
}

demo_box_close() {
  local color="$1"
  echo -e "${color}${BOLD}  ╰─────────────────────────────────────────────────────────────╯${RESET}"
}

demo_box_row() {
  local color="$1"
  shift
  echo -e "${color}${BOLD}  │${RESET}  $*"
}

demo_ok()   { echo -e "  ${GREEN}✓${RESET}  $*"; }
demo_warn() { echo -e "  ${YELLOW}!${RESET}  $*"; }
demo_err()  { echo -e "  ${RED}✗${RESET}  $*" >&2; }
demo_info() { echo -e "${BLUE}${BOLD}[INFO]${RESET} $*"; }
demo_success() { echo -e "${GREEN}${BOLD}[OK]${RESET} $*"; }

# ── Host machine banner ──────────────────────────────────────────────────────
# Reports what the launcher is running on, then suggests how to run the stack
# on that hardware. Advisory only — nothing here changes what actually starts.
# macOS bash 3.2 safe (no associative arrays, no ${var^^}); `set -u` safe.

# Bytes -> "12.5" (one decimal GiB). Prints "?" for missing/garbage input.
_demo_gb() {
  awk -v b="${1:-0}" 'BEGIN { if (b + 0 <= 0) print "?"; else printf "%.1f", b / 1073741824 }'
}

# Keep only a non-negative integer; anything else becomes 0 (guards `[[ -lt ]]`).
_demo_int() {
  case "${1:-}" in
    ''|*[!0-9]*) echo 0 ;;
    *) echo "$1" ;;
  esac
}

# Populates HOST_OS HOST_ARCH HOST_MODEL HOST_CPU HOST_CORES HOST_MEM_BYTES.
demo_detect_host() {
  if [[ -n "${HOST_DETECTED:-}" ]]; then return 0; fi
  HOST_DETECTED=1
  HOST_OS="$(uname -s 2>/dev/null || echo unknown)"
  HOST_ARCH="$(uname -m 2>/dev/null || echo unknown)"
  HOST_MODEL=""
  HOST_CPU=""
  HOST_CORES=""
  HOST_MEM_BYTES=""

  case "${HOST_OS}" in
    Darwin)
      HOST_MODEL="$(sysctl -n hw.model 2>/dev/null || true)"
      HOST_CPU="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || true)"
      HOST_CORES="$(sysctl -n hw.ncpu 2>/dev/null || true)"
      HOST_MEM_BYTES="$(sysctl -n hw.memsize 2>/dev/null || true)"
      ;;
    Linux)
      if [[ -r /sys/devices/virtual/dmi/id/product_name ]]; then
        HOST_MODEL="$(cat /sys/devices/virtual/dmi/id/product_name 2>/dev/null || true)"
      fi
      if [[ -r /proc/cpuinfo ]]; then
        # x86 exposes "model name"; many ARM boards only expose "Hardware".
        HOST_CPU="$(awk -F': +' '/^model name/ { print $2; exit } /^Hardware/ { print $2; exit }' /proc/cpuinfo 2>/dev/null || true)"
      fi
      HOST_CORES="$(nproc 2>/dev/null || true)"
      if [[ -r /proc/meminfo ]]; then
        # %.0f, not print or %d — mawk renders the product as 1.68e+10 with the
        # default OFMT, and saturates it at 2^31 with %d.
        HOST_MEM_BYTES="$(awk '/^MemTotal:/ { printf "%.0f", $2 * 1024; exit }' /proc/meminfo 2>/dev/null || true)"
      fi
      ;;
  esac

  [[ -n "${HOST_MODEL}" ]] || HOST_MODEL="unknown"
  [[ -n "${HOST_CPU}" ]]   || HOST_CPU="unknown"
  HOST_CORES="$(_demo_int "${HOST_CORES}")"
  HOST_MEM_BYTES="$(_demo_int "${HOST_MEM_BYTES}")"
  return 0
}

# Populates DOCKER_CPUS DOCKER_MEM_BYTES DOCKER_ENGINE. All zero/empty when the
# daemon is unreachable — on macOS this VM ceiling, not host RAM, is the real
# limit the Compose stack hits.
demo_detect_docker() {
  if [[ -n "${DOCKER_DETECTED:-}" ]]; then return 0; fi
  DOCKER_DETECTED=1
  DOCKER_CPUS=0
  DOCKER_MEM_BYTES=0
  DOCKER_ENGINE=""
  command -v docker >/dev/null 2>&1 || return 0

  local info rest
  info="$(docker info --format '{{.NCPU}}|{{.MemTotal}}|{{.OperatingSystem}}' 2>/dev/null || true)"
  [[ -n "${info}" ]] || return 0

  DOCKER_CPUS="$(_demo_int "${info%%|*}")"
  rest="${info#*|}"
  DOCKER_MEM_BYTES="$(_demo_int "${rest%%|*}")"
  DOCKER_ENGINE="${rest#*|}"
  return 0
}

# Which launchers this box can actually run. Specs alone are not enough: ./run.sh
# needs a local Node + Python toolchain, and ./run-pingaws.sh needs cluster
# credentials no amount of RAM substitutes for.
# Populates LAUNCHER_{NATIVE,DOCKER,CLUSTER}_OK plus a _WHY string for each.
demo_detect_launchers() {
  if [[ -n "${LAUNCHERS_DETECTED:-}" ]]; then return 0; fi
  LAUNCHERS_DETECTED=1
  local ver major kubecfg

  # ── ./run.sh — Node >= NODE_MIN_VERSION (20) and python3 on PATH.
  LAUNCHER_NATIVE_OK=0
  LAUNCHER_NATIVE_WHY=""
  if ! command -v node >/dev/null 2>&1; then
    LAUNCHER_NATIVE_WHY="node not installed"
  elif ! command -v python3 >/dev/null 2>&1; then
    LAUNCHER_NATIVE_WHY="python3 not installed"
  else
    ver="$(node --version 2>/dev/null || true)"
    major="${ver#v}"
    major="$(_demo_int "${major%%.*}")"
    if [[ "${major}" -lt 20 ]]; then
      LAUNCHER_NATIVE_WHY="node ${ver} is below the required v20"
    else
      LAUNCHER_NATIVE_OK=1
      LAUNCHER_NATIVE_WHY="starts every service natively — no lean mode"
    fi
  fi

  # ── ./run-docker.sh — CLI present and daemon answering.
  LAUNCHER_DOCKER_OK=0
  LAUNCHER_DOCKER_WHY=""
  demo_detect_docker
  if ! command -v docker >/dev/null 2>&1; then
    LAUNCHER_DOCKER_WHY="docker not installed"
  elif [[ "${DOCKER_MEM_BYTES}" -le 0 ]]; then
    LAUNCHER_DOCKER_WHY="docker daemon not responding — start Docker Desktop / OrbStack"
  else
    LAUNCHER_DOCKER_OK=1
    LAUNCHER_DOCKER_WHY="lean core by default, stop optional groups on demand"
  fi

  # ── ./run-pingaws.sh — kubectl, a kubeconfig, and a derivable SE namespace.
  LAUNCHER_CLUSTER_OK=0
  LAUNCHER_CLUSTER_WHY=""
  kubecfg="${KUBECONFIG:-${HOME}/.kube/config}"
  if ! command -v kubectl >/dev/null 2>&1; then
    LAUNCHER_CLUSTER_WHY="kubectl not installed"
  elif [[ ! -f "${kubecfg}" ]]; then
    LAUNCHER_CLUSTER_WHY="no kubeconfig — ./run-pingaws.sh kubeconfig"
  elif [[ -z "${PING_EMAIL:-}" && -z "${SE_NAMESPACE:-}" ]] &&
       ! grep -q '^PING_EMAIL=' "${BASEDIR:-.}/demo_api_server/.env" 2>/dev/null; then
    LAUNCHER_CLUSTER_WHY="namespace not derivable — set PING_EMAIL or SE_NAMESPACE"
  else
    LAUNCHER_CLUSTER_OK=1
    LAUNCHER_CLUSTER_WHY="runs on the SE cluster — this machine only builds and pushes"
  fi
  return 0
}

# The launcher table. `best` is chosen from what is reachable AND what fits:
# a box too small for the local stack is a reason to use the cluster, not a
# reason to recommend a launcher that will thrash.
# demo_launcher_table <current mode: native|docker|cluster>
demo_launcher_table() {
  local current="${1:-}" best="" gb8=8589934592
  demo_detect_launchers

  if [[ "${LAUNCHER_DOCKER_OK}" -eq 1 && "${DOCKER_MEM_BYTES}" -ge ${gb8} ]]; then
    best="docker"
  elif [[ "${LAUNCHER_DOCKER_OK}" -eq 1 && "${LAUNCHER_CLUSTER_OK}" -eq 1 ]]; then
    best="cluster"          # Docker works but is cramped — the cluster has room.
  elif [[ "${LAUNCHER_DOCKER_OK}" -eq 1 ]]; then
    best="docker"
  elif [[ "${LAUNCHER_NATIVE_OK}" -eq 1 ]]; then
    best="native"
  elif [[ "${LAUNCHER_CLUSTER_OK}" -eq 1 ]]; then
    best="cluster"
  fi

  echo ""
  echo -e "  ${WHITE}${BOLD}WHICH LAUNCHER${RESET}"
  _demo_launcher_row "docker"  "./run-docker.sh " "${LAUNCHER_DOCKER_OK}"  "${LAUNCHER_DOCKER_WHY}"  "${best}" "${current}"
  _demo_launcher_row "native"  "./run.sh        " "${LAUNCHER_NATIVE_OK}"  "${LAUNCHER_NATIVE_WHY}"  "${best}" "${current}"
  _demo_launcher_row "cluster" "./run-pingaws.sh" "${LAUNCHER_CLUSTER_OK}" "${LAUNCHER_CLUSTER_WHY}" "${best}" "${current}"

  if [[ -n "${current}" && -n "${best}" && "${current}" != "${best}" ]]; then
    echo ""
    demo_warn "You are running the ${current} launcher; ${best} is the better fit on this machine."
  fi
  return 0
}

# _demo_launcher_row <key> <label> <ok> <why> <best> <current>
_demo_launcher_row() {
  local key="$1" label="$2" ok="$3" why="$4" best="$5" current="$6" tag color suffix=""
  if [[ "${ok}" -ne 1 ]]; then
    tag="N/A "; color="${DIM}"
  elif [[ "${key}" == "${best}" ]]; then
    tag="BEST"; color="${GREEN}"
  else
    tag="OK  "; color="${RESET}"
  fi
  [[ "${key}" == "${current}" ]] && suffix="  ${DIM}(current)${RESET}"
  echo -e "    ${color}${BOLD}${tag}${RESET}  ${color}${label}${RESET}  ${DIM}${why}${RESET}${suffix}"
  return 0
}

# demo_machine_banner <native|docker|cluster>
# Idempotent per process tree: run-pingaws.sh execs run-k8.sh, and the panel
# should not print twice across that handoff.
demo_machine_banner() {
  local mode="${1:-native}" budget_bytes budget_label
  if [[ -n "${DEMO_MACHINE_BANNER_SHOWN:-}" ]]; then return 0; fi
  export DEMO_MACHINE_BANNER_SHOWN=1

  demo_detect_host
  budget_bytes="${HOST_MEM_BYTES}"
  budget_label="host RAM"

  if [[ "${mode}" == "docker" ]]; then
    demo_detect_docker
    if [[ "${DOCKER_MEM_BYTES}" -gt 0 ]]; then
      budget_bytes="${DOCKER_MEM_BYTES}"
      budget_label="Docker memory"
    fi
  fi

  # Populated for every mode — the Docker ceiling is part of choosing a launcher,
  # not just part of running one.
  demo_detect_launchers

  echo ""
  demo_box_open "${CYAN}" "MACHINE"
  demo_box_row "${CYAN}" "$(printf '%-9s %s' 'Model' "${HOST_MODEL}  (${HOST_OS}/${HOST_ARCH})")"
  demo_box_row "${CYAN}" "$(printf '%-9s %s' 'CPU' "${HOST_CPU} — ${HOST_CORES} cores")"
  demo_box_row "${CYAN}" "$(printf '%-9s %s GB' 'Memory' "$(_demo_gb "${HOST_MEM_BYTES}")")"
  if [[ "${DOCKER_MEM_BYTES:-0}" -gt 0 ]]; then
    demo_box_row "${CYAN}" "$(printf '%-9s %s GB limit / %s CPUs  (%s)' \
      'Docker' "$(_demo_gb "${DOCKER_MEM_BYTES}")" "${DOCKER_CPUS}" "${DOCKER_ENGINE}")"
  fi
  demo_box_close "${CYAN}"

  demo_launcher_table "${mode}"
  demo_machine_advice "${mode}" "${budget_bytes}" "${budget_label}"
  echo ""
  return 0
}

# demo_machine_advice <mode> <budget_bytes> <budget_label>
# Thresholds are sized against the Compose stack: 12 core services + the `rag`
# group start by default; `start full` adds agents/tracing/demo-auth/mcpgw.
demo_machine_advice() {
  local mode="$1" bytes="$2" label="$3"
  local gb8=8589934592 gb16=17179869184

  echo ""

  # Cluster mode: the services run on the SE cluster, so local memory sizing
  # says nothing. What this machine still does is build and push images.
  if [[ "${mode}" == "cluster" ]]; then
    demo_ok "Services run on the SE cluster — local memory is not the constraint."
    if [[ "${HOST_CORES}" -gt 0 && "${HOST_CORES}" -lt 4 ]]; then
      demo_warn "${HOST_CORES} cores — the local image build before the push will be slow."
    fi
    return 0
  fi

  if [[ "${bytes}" -le 0 ]]; then
    demo_warn "Could not read ${label} — skipping run suggestions."
    return 0
  fi

  if [[ "${bytes}" -lt ${gb8} ]]; then
    demo_warn "$(_demo_gb "${bytes}") GB ${label} — tight. Core services only."
    if [[ "${mode}" == "docker" ]]; then
      echo -e "       Run:    ${YELLOW}${BOLD}./run-docker.sh${RESET}  ${DIM}(lean core, the default)${RESET}"
      echo -e "       Avoid:  ${DIM}./run-docker.sh start full${RESET}"
      echo -e "       Tight:  ${DIM}./run-docker.sh optional stop rag${RESET}"
    else
      echo -e "       run.sh starts every service natively with no lean mode."
      echo -e "       Prefer: ${YELLOW}${BOLD}./run-docker.sh${RESET}  ${DIM}(lean core + per-group stop)${RESET}"
    fi
  elif [[ "${bytes}" -lt ${gb16} ]]; then
    demo_ok "$(_demo_gb "${bytes}") GB ${label} — core stack fits."
    if [[ "${mode}" == "docker" ]]; then
      echo -e "       Run:    ${YELLOW}${BOLD}./run-docker.sh${RESET}  ${DIM}(core + rag)${RESET}"
      echo -e "       Avoid:  ${DIM}./run-docker.sh start full${RESET}  ${DIM}— adds agents/tracing/demo-auth/mcpgw${RESET}"
    fi
  else
    demo_ok "$(_demo_gb "${bytes}") GB ${label} — full stack OK."
    if [[ "${mode}" == "docker" ]]; then
      echo -e "       Run:    ${YELLOW}${BOLD}./run-docker.sh${RESET}  ${DIM}or${RESET} ${YELLOW}${BOLD}./run-docker.sh start full${RESET}"
    fi
  fi

  if [[ "${HOST_CORES}" -gt 0 && "${HOST_CORES}" -lt 4 ]]; then
    demo_warn "${HOST_CORES} cores — image builds will be slow; skip ${DIM}build --no-cache${RESET} unless needed."
  fi

  if [[ "${HOST_OS}" == "Darwin" && "${HOST_ARCH}" == "arm64" ]]; then
    demo_ok "Apple Silicon — ${YELLOW}${BOLD}LLM_BACKEND=omlx${RESET} keeps the model on Metal, out of the Docker VM."
  else
    demo_ok "No Metal backend — ${DIM}LLM_BACKEND=llamacpp${RESET} (default); expect a slower token rate."
  fi

  # A Docker ceiling far below host RAM is a settings problem, not a hardware one.
  if [[ "${mode}" == "docker" && "${DOCKER_MEM_BYTES:-0}" -gt 0 && "${HOST_MEM_BYTES}" -gt $(( DOCKER_MEM_BYTES * 2 )) ]]; then
    demo_warn "Docker is capped at $(_demo_gb "${DOCKER_MEM_BYTES}") GB of $(_demo_gb "${HOST_MEM_BYTES}") GB host RAM — raise it in Docker Desktop / OrbStack settings for more headroom."
  fi
  return 0
}

# K8 forward epilogue — full status panel after port-forwards bind.
demo_k8_forward_epilogue() {
  local ns="${1:-ai-demo}"
  echo ""
  demo_banner_title "[K8S]" "AI DEMO — READY"
  echo ""
  demo_box_open "${GREEN}" "URLS"
  demo_box_row "${GREEN}" "[WEB]   App           ${YELLOW}${BOLD}https://local.ping-devops.com:4000${RESET}"
  demo_box_row "${GREEN}" "[CONFIG] Admin Config  ${YELLOW}${BOLD}https://local.ping-devops.com:4000/config${RESET}"
  demo_box_row "${GREEN}" "[BFF]   API           ${YELLOW}${BOLD}https://api.ping.demo:3001${RESET}"
  demo_box_row "${GREEN}" "[LOGIN] Admin Login   ${YELLOW}${BOLD}https://api.ping.demo:3001/api/auth/oauth/login${RESET}"
  demo_box_close "${GREEN}"
  echo ""
  demo_box_open "${WHITE}" "LOGS  (namespace: ${ns})"
  demo_box_row "${WHITE}" "One service:   kubectl logs -n ${ns} deploy/<name> -f"
  demo_box_row "${WHITE}" "BFF:           kubectl logs -n ${ns} deploy/demo-api-server -f"
  demo_box_row "${WHITE}" "UI:            kubectl logs -n ${ns} deploy/frontend -f"
  demo_box_row "${WHITE}" "MCP gateway:   kubectl logs -n ${ns} deploy/mcp-gateway -f"
  demo_box_row "${WHITE}" "Agent:         kubectl logs -n ${ns} deploy/langchain-agent -f"
  demo_box_row "${WHITE}" "Everything:    kubectl logs -n ${ns} -l app=ai-demo --all-containers --prefix -f"
  demo_box_close "${WHITE}"
  echo ""
  demo_box_open "${MAGENTA}" "MANAGE"
  demo_box_row "${MAGENTA}" "${BOLD}./run-k8.sh status${RESET}     pod health"
  demo_box_row "${MAGENTA}" "${BOLD}./run-k8.sh restart${RESET}    rebuild + redeploy"
  demo_box_row "${MAGENTA}" "${BOLD}./run-k8.sh kill${RESET}       stop port-forwards"
  demo_box_row "${MAGENTA}" "${BOLD}./run-k8.sh stop${RESET}       scale workloads to 0"
  demo_box_close "${MAGENTA}"
  echo ""
  echo -e "${GREEN}${BOLD}  ✓  Stack is up — Ctrl+C stops port-forwards only (pods keep running)${RESET}"
  echo ""
  demo_hrule
  echo ""
}
