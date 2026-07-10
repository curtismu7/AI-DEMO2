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

# K8 forward epilogue — full status panel after port-forwards bind.
demo_k8_forward_epilogue() {
  local ns="${1:-ai-demo}"
  echo ""
  demo_banner_title "[K8S]" "AI DEMO — READY"
  echo ""
  demo_box_open "${GREEN}" "URLS"
  demo_box_row "${GREEN}" "[WEB]   App           ${YELLOW}${BOLD}https://api.ping.demo:4000${RESET}"
  demo_box_row "${GREEN}" "[CONFIG] Admin Config  ${YELLOW}${BOLD}https://api.ping.demo:4000/config${RESET}"
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
