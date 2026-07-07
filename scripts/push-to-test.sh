#!/usr/bin/env bash
# scripts/push-to-test.sh — push a branch to origin and deploy full Docker stack on test Mac.
#
# The test Mac (64GB) always starts every compose service — no lean/smoke mode.
#
# Usage (from repo root or any worktree):
#   ./scripts/push-to-test.sh              # current branch → testmac
#   ./scripts/push-to-test.sh my-branch    # named branch
#   ./scripts/push-to-test.sh my-branch testmac
#
# Remote steps: git pull → ./run-docker.sh build → ./run-docker.sh start full
#
# Environment overrides:
#   REMOTE_DIR   path on test Mac (default: ~/Development/AI-demo-test)
#   SKIP_PUSH=1  skip git push (remote already has the branch)
#   SKIP_BUILD=1 skip docker image rebuild
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRANCH="${1:-$(git -C "$ROOT" branch --show-current)}"
HOST="${2:-testmac}"
REMOTE_DIR="${REMOTE_DIR:-~/Development/AI-demo-test}"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '  %s\n' "$*"; }

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && {
  sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

if [[ -z "$BRANCH" ]]; then
  red "Could not determine branch — pass one explicitly."
  exit 1
fi

echo "== push-to-test =="
info "branch: $BRANCH"
info "host:   $HOST"
info "remote: $REMOTE_DIR"
info "stack:  full (all compose services)"
echo ""

if [[ "${SKIP_PUSH:-0}" != "1" ]]; then
  info "Pushing $BRANCH to origin..."
  git -C "$ROOT" push -u origin "$BRANCH"
else
  info "SKIP_PUSH=1 — skipping git push"
fi

info "Deploying on $HOST..."
ssh "$HOST" env SKIP_BUILD="${SKIP_BUILD:-0}" bash -s -- "$REMOTE_DIR" "$BRANCH" <<'REMOTE'
set -euo pipefail
REMOTE_DIR="$1"
BRANCH="$2"
cd "$REMOTE_DIR"

echo "[remote] fetch + checkout $BRANCH"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "[remote] rebuilding images"
  ./run-docker.sh build
else
  echo "[remote] SKIP_BUILD=1 — skipping image rebuild"
fi

echo "[remote] starting full stack (all services)"
./run-docker.sh start full
./run-docker.sh demo-sync
./run-docker.sh status
REMOTE

green "Deploy complete on $HOST (branch $BRANCH, full stack)"
info "Run tests:  ./scripts/run-remote-tests.sh"
info "Open UI:    ./scripts/open-test-ui.sh $HOST"
info "Tail logs:  ssh $HOST 'cd $REMOTE_DIR && ./run-docker.sh logs'"
