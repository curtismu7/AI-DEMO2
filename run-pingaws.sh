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
#   ./run-pingaws.sh rag [on|off]       # build/start or stop the RAG stack
#   ./run-pingaws.sh undeploy           # delete workloads AND secrets INSIDE your
#                                       # namespace (asks first). The namespace is kept.
#   ./run-pingaws.sh update code [svc]  # rebuild/redeploy changed service(s)
#   ./run-pingaws.sh update config      # push secrets/configmaps (no rebuild)
#   ./run-pingaws.sh update pingone     # re-bootstrap PingOne redirect URIs
#   ./run-pingaws.sh kubeconfig         # install SE kubeconfig into ~/.kube
#   ./run-pingaws.sh help
#
# Namespace is derived once from PING_EMAIL (cmuir@pingidentity.com →
# ping-devops-cmuir) and then PINNED to demo_api_server/.env as SE_NAMESPACE=
# — every later run reuses that pinned value, so it can't silently drift from
# a leftover shell export. One-off override (loudly logged):
#   SE_NAMESPACE=ping-devops-yourname ./run-pingaws.sh start
#
# App: https://ai-demo.ping-devops.com
#
# Also deploys the Privilege MCPGW gateway (Helm, k8s/helm/mcpgw) alongside the
# app — required by default, see privilege/deploy-whole-stack.prompt.md.
# Opt out with SKIP_MCPGW=1.
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
  ./run-pingaws.sh rag [on|off]     build/start or stop the RAG stack
  ./run-pingaws.sh undeploy         delete everything INSIDE your SHARED SE namespace:
                                    workloads AND secrets. The namespace itself is KEPT.
                                    Takes ai-demo.ping-devops.com down for everyone on it,
                                    so it asks before it does (--yes skips)
  ./run-pingaws.sh update code [svc…]
                                    rebuild/redeploy (all, or bff|frontend|mcp|…)
  ./run-pingaws.sh update config    push .env / configmaps (no image rebuild)
  ./run-pingaws.sh update pingone   re-register OAuth redirect URIs for SE URL
  ./run-pingaws.sh kubeconfig       install SE kubeconfig (scripts/install-se-kubeconfig.sh)
  ./run-pingaws.sh machine          show machine specs and which launcher fits
  ./run-pingaws.sh help

Prerequisites: Docker Desktop, kubectl context `us`, gh auth, SE namespace.

Includes the Privilege MCPGW gateway: `deploy`/`start` always runs `helm
upgrade --install ping-mcpgw k8s/helm/mcpgw`, using Secret ping-mcpgw-secrets
(created by create-secrets.sh from ping-mcpgw/procyon/config/proxy-token.env —
see privilege/deploy-whole-stack.prompt.md). Required by default: if that
file/secret is missing, the rest of the stack still deploys but the command
exits non-zero with remediation instructions. Deliberately skip it with:
  SKIP_MCPGW=1 ./run-pingaws.sh start

Namespace is pinned once per checkout (written to demo_api_server/.env as
SE_NAMESPACE=...) so every later run targets the same namespace by default —
no re-deriving, no silent drift from a leftover shell export. Override for a
single run (loudly logged, does not change the pinned value):
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
  start|all|se-all|""|build|se-build|deploy|se-deploy|rag|update)
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
  rag)
    exec "$RUN_K8" se-rag "$@"
    ;;
  undeploy|se-undeploy)
    exec "$RUN_K8" se-undeploy "$@"
    ;;
  # `stop` used to be a third alias for the full SE teardown above. It is not
  # one any more, because the same word means the opposite thing one script
  # over: `./run-k8.sh stop` is a harmless local stop, while this script's
  # `stop` wiped a shared cluster namespace. Anyone who learned the first and
  # typed the second got a teardown they did not ask for — and would answer
  # "no" in good faith to "did you undeploy?", because they typed `stop`.
  #
  # Refuse and name both real commands rather than guessing which was meant.
  stop)
    echo "Refusing: 'stop' is ambiguous here and used to mean a full SE teardown." >&2
    echo >&2
    echo "  Did you mean to stop the LOCAL stack?" >&2
    echo "    ./run-k8.sh stop            # local kubernetes stack" >&2
    echo "    ./run-docker.sh stop        # docker compose stack" >&2
    echo >&2
    echo "  Or to clear out the SHARED SE cluster namespace?" >&2
    echo "    ./run-pingaws.sh undeploy   # deletes workloads AND secrets inside it," >&2
    echo "                                # keeps the namespace; asks first" >&2
    exit 1
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
