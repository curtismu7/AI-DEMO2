#!/usr/bin/env bash
# worktree-cleanup.sh -- remove leftover git worktrees, safely. Never uses --force.
#   worktree-cleanup.sh            list every extra worktree and its state; changes nothing
#   worktree-cleanup.sh <path>...  per path: show state, remove only if clean and you type yes
# Run from inside the repo that owns the worktrees. Ignored files (e.g. deploy/local secrets)
# are deleted with the worktree, so they are listed and need a separate DELETE confirmation.
set -euo pipefail
git rev-parse --show-toplevel >/dev/null 2>&1 || { echo "run this inside a git repo" >&2; exit 1; }
main_wt="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"

state() { # prints findings; returns 0 when clean
  local p="$1" dirty ign unpushed br clean=0
  dirty="$(git -C "$p" status --porcelain 2>/dev/null || echo '?')"
  ign="$(git -C "$p" status --porcelain --ignored 2>/dev/null | grep '^!!' || true)"
  br="$(git -C "$p" branch --show-current 2>/dev/null || true)"
  unpushed=""
  if [ -n "$br" ]; then
    if git -C "$p" rev-parse --verify -q "origin/$br" >/dev/null; then
      unpushed="$(git -C "$p" log --oneline "origin/$br..HEAD" 2>/dev/null || true)"
    else
      unpushed="$(git -C "$p" log --oneline "origin/main..HEAD" 2>/dev/null || true)"
    fi
  fi
  echo "  branch: ${br:-<detached>}"
  if [ -n "$dirty" ]; then echo "  UNCOMMITTED:"; printf '%s\n' "$dirty" | sed 's/^/    /'; clean=1; fi
  if [ -n "$unpushed" ]; then echo "  COMMITS NOT ON origin:"; printf '%s\n' "$unpushed" | sed 's/^/    /'; clean=1; fi
  if [ -n "$ign" ]; then echo "  IGNORED FILES (deleted with the worktree):"; printf '%s\n' "$ign" | sed 's/^/    /' | head -20; fi
  [ "$clean" = 0 ] && echo "  clean"
  return "$clean"
}

if [ "$#" -eq 0 ]; then
  git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r p; do
    [ "$p" = "$main_wt" ] && continue
    echo "$p"; state "$p" || true
  done
  exit 0
fi

for p in "$@"; do
  p="$(cd "$p" 2>/dev/null && pwd)" || { echo "skip: $p does not exist"; continue; }
  [ "$p" = "$main_wt" ] && { echo "skip: $p is the main checkout"; continue; }
  git worktree list --porcelain | grep -qx "worktree $p" || { echo "skip: $p is not a worktree of this repo (run from the repo that owns it)"; continue; }
  echo "$p"
  if ! state "$p"; then echo "  NOT removed: commit or push first."; continue; fi
  read -r -p "  Remove $p? Type yes: " a
  [ "$a" = "yes" ] || { echo "  kept"; continue; }
  if git -C "$p" status --porcelain --ignored | grep -q '^!!'; then
    read -r -p "  It holds ignored files (secrets?). Type DELETE to remove them too: " b
    [ "$b" = "DELETE" ] || { echo "  kept"; continue; }
  fi
  git worktree remove "$p" && echo "  removed"
done
git worktree prune
