#!/usr/bin/env bash
# scripts/push-to-test.sh — push a branch to origin and deploy on a remote test Mac.
#
# Usage (from repo root or any worktree):
#   ./scripts/push-to-test.sh                      # current branch → testmac, full profile
#   ./scripts/push-to-test.sh my-branch            # named branch
#   ./scripts/push-to-test.sh my-branch testmac smoke
#   ./scripts/push-to-test.sh my-branch testmac max
#
# Profiles:
#   smoke — core stack only (~750MB Docker): ./run-docker.sh start
#   full  — every compose service (default): ./run-docker.sh start full
#   max   — full + rag + agents optional groups
#
# Environment overrides:
#   REMOTE_DIR   path on test Mac (default: ~/AI-demo-test)
#   SKIP_PUSH=1  skip git push (remote already has the branch)
#   SKIP_BUILD=1 skip docker image rebuild
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRANCH="${1:-$(git -C "$ROOT" branch --show-current)}"
HOST="${2:-testmac}"
PROFILE="${3:-full}"
REMOTE_DIR="${REMOTE_DIR:-~/AI-demo-test}"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '  %s\n' "$*"; }

usage() {
  sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && usage 0

if [[ -z "$BRANCH" ]]; then
  red "Could not determine branch — pass one explicitly."
  exit 1
fi

case "$PROFILE" in
  smoke|full|max) ;;
  *)
    red "Unknown profile: $PROFILE (expected smoke, full, or max)"
    exit 1
    ;;
esac

echo "== push-to-test =="
info "branch:  $BRANCH"
info "host:    $HOST"
info "remote:  $REMOTE_DIR"
info "profile: $PROFILE"
echo ""

if [[ "${SKIP_PUSH:-0}" != "1" ]]; then
  info "Pushing $BRANCH to origin..."
  git -C "$ROOT" push -u origin "$BRANCH"
else
  info "SKIP_PUSH=1 — skipping git push"
fi

info "Deploying on $HOST..."
ssh "$HOST" env SKIP_BUILD="${SKIP_BUILD:-0}" bash -s -- "$REMOTE_DIR" "$BRANCH" "$PROFILE" <<REMOTE
set -euo pipefail
REMOTE_DIR="\$1"
BRANCH="\$2"
PROFILE="\$3"
cd "\$REMOTE_DIR"

echo "[remote] fetch + checkout \$BRANCH"
git fetch origin
git checkout "\$BRANCH"
git pull --ff-only origin "\$BRANCH"

if [[ "\${SKIP_BUILD:-0}" != "1" ]]; then
  echo "[remote] rebuilding images"
  ./run-docker.sh build
else
  echo "[remote] SKIP_BUILD=1 — skipping image rebuild"
fi

echo "[remote] starting stack (profile: \$PROFILE)"
case "\$PROFILE" in
  smoke) ./run-docker.sh start ;;
  full)  ./run-docker.sh start full ;;
  max)
    ./run-docker.sh start full
    ./run-docker.sh optional start rag agents
    ;;
esac

./run-docker.sh status
REMOTE

green "Deploy complete on $HOST (branch $BRANCH, profile $PROFILE)"
info "Run tests:  ./scripts/run-remote-tests.sh"
info "Open UI:    ./scripts/open-test-ui.sh $HOST"
info "Tail logs:  ssh $HOST 'cd $REMOTE_DIR && ./run-docker.sh logs'"
