#!/usr/bin/env bash
# run-pingaws.sh — Ping SE AWS cluster launcher (ai-demo.ping-devops.com).
#
# Thin wrapper around ./run-k8.sh se-* and the se-update-* helpers so Ping AWS
# has the same “just run this” entry point as ./run.sh and ./run-docker.sh.
#
# Usage:
#   ./run-pingaws.sh                    # build + push + deploy (se-all)
#   ./run-pingaws.sh start              # same as default
#   ./run-pingaws.sh build              # build images + push to GHCR
#   ./run-pingaws.sh deploy             # deploy only (images already in GHCR)
#   ./run-pingaws.sh status             # show pods in your SE namespace
#   ./run-pingaws.sh undeploy | stop    # remove app resources (keep namespace)
#   ./run-pingaws.sh update code [svc]  # rebuild/redeploy changed service(s)
#   ./run-pingaws.sh update config      # push secrets/configmaps (no rebuild)
#   ./run-pingaws.sh update pingone     # re-bootstrap PingOne redirect URIs
#   ./run-pingaws.sh kubeconfig         # install SE kubeconfig into ~/.kube
#   ./run-pingaws.sh help
#
# Namespace is auto-derived from PING_EMAIL / demo_api_server/.env
# (cmuir@pingidentity.com → ping-devops-cmuir). Override with:
#   SE_NAMESPACE=ping-devops-yourname ./run-pingaws.sh start
#
# App: https://ai-demo.ping-devops.com
#
# Equivalent low-level commands (still work):
#   ./run-k8.sh se-all | se-build | se-deploy | se-status | se-undeploy
#   ./se-update-code.sh [svc] | ./se-update-config.sh | ./se-update-pingone.sh

set -euo pipefail

BASEDIR="$(cd "$(dirname "$0")" && pwd)"
RUN_K8="$BASEDIR/run-k8.sh"

# shellcheck source=scripts/demo-terminal.sh
source "${BASEDIR}/scripts/demo-terminal.sh"
demo_init_terminal

usage() {
  cat <<'EOF'
run-pingaws.sh — Ping SE AWS cluster (https://ai-demo.ping-devops.com)

Usage:
  ./run-pingaws.sh                  build + push + deploy
  ./run-pingaws.sh start | all      same as default
  ./run-pingaws.sh build            build images + push to GHCR
  ./run-pingaws.sh deploy           deploy only (no rebuild)
  ./run-pingaws.sh status           show SE pod status
  ./run-pingaws.sh undeploy | stop  remove app from your namespace
  ./run-pingaws.sh update code [svc…]
                                    rebuild/redeploy (all, or bff|frontend|mcp|…)
  ./run-pingaws.sh update config    push .env / configmaps (no image rebuild)
  ./run-pingaws.sh update pingone   re-register OAuth redirect URIs for SE URL
  ./run-pingaws.sh kubeconfig       install SE kubeconfig (scripts/install-se-kubeconfig.sh)
  ./run-pingaws.sh machine          show machine specs and which launcher fits
  ./run-pingaws.sh help

Prerequisites: Docker Desktop, kubectl context `us`, gh auth, SE namespace.

Override namespace:
  SE_NAMESPACE=ping-devops-yourname ./run-pingaws.sh start
EOF
}

cmd="${1:-start}"
shift || true

# Banner before the exec below — every branch here hands off with exec, so this
# is the last point at which this process still owns the terminal. The function
# exports DEMO_MACHINE_BANNER_SHOWN, so run-k8.sh will not print it again.
case "$cmd" in
  machine|specs)
    demo_machine_banner cluster
    exit 0
    ;;
  start|all|se-all|""|build|se-build|deploy|se-deploy|update)
    demo_machine_banner cluster
    ;;
esac

case "$cmd" in
  start|all|se-all|"")
    exec "$RUN_K8" se-all "$@"
    ;;
  build|se-build)
    exec "$RUN_K8" se-build "$@"
    ;;
  deploy|se-deploy)
    exec "$RUN_K8" se-deploy "$@"
    ;;
  status|se-status)
    exec "$RUN_K8" se-status "$@"
    ;;
  undeploy|stop|se-undeploy)
    exec "$RUN_K8" se-undeploy "$@"
    ;;
  update)
    sub="${1:-}"
    shift || true
    case "$sub" in
      code|svc|service)
        exec "$BASEDIR/se-update-code.sh" "$@"
        ;;
      config|cfg|secrets)
        exec "$BASEDIR/se-update-config.sh" "$@"
        ;;
      pingone|p1|oauth)
        exec "$BASEDIR/se-update-pingone.sh" "$@"
        ;;
      ""|help|-h|--help)
        echo "Usage: ./run-pingaws.sh update {code|config|pingone} [args…]" >&2
        exit 1
        ;;
      *)
        echo "Unknown update target: $sub (use code|config|pingone)" >&2
        exit 1
        ;;
    esac
    ;;
  kubeconfig|kubectl-config|install-kubeconfig)
    exec "$BASEDIR/scripts/install-se-kubeconfig.sh" "$@"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    echo "" >&2
    usage >&2
    exit 1
    ;;
esac
