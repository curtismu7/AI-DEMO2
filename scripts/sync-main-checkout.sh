#!/usr/bin/env bash
# scripts/sync-main-checkout.sh
#
# Fast-forwards this shared main checkout to origin/main. Exists because
# Docker (ai-demo-ui / ai-demo-api-server) bind-mounts this checkout's
# working tree directly — a PR merging on GitHub does NOT update these
# files on disk, so the running demo silently serves stale code until
# something pulls. Safe to run unattended: it only ever fast-forwards
# (never rewrites history) and only ever touches the known runtime-data
# noise paths that chronically show as dirty here (regenerated test
# snapshots, the LMDB file, the config pointer) — anything else dirty
# makes it back off without touching a thing. secrets.vault is deliberately
# NOT a noise path: it is gitignored, so it never shows as dirty, and naming
# it in the stash pathspec below made git refuse the whole stash.
#
# Usage: scripts/sync-main-checkout.sh
# Exit 0 = synced or already up to date. Exit 1 = left alone, see log line.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

NOISE_PATHS=(demo_api_server/data setup-config.md)
STASH_TAG="auto-sync-main-$(date +%Y%m%d-%H%M%S)"
LOG_PREFIX="[sync-main-checkout]"

git fetch origin main --quiet

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/main)"

if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  echo "$LOG_PREFIX up to date ($LOCAL_SHA)"
  exit 0
fi

if ! git merge-base --is-ancestor "$LOCAL_SHA" "$REMOTE_SHA"; then
  echo "$LOG_PREFIX local HEAD ($LOCAL_SHA) is not an ancestor of origin/main ($REMOTE_SHA) — not a clean fast-forward, leaving it alone. Investigate manually."
  exit 1
fi

# Anything dirty outside the known noise paths means real, unidentified
# work is sitting in this checkout — do not touch it, do not stash it.
DIRTY_OUTSIDE_NOISE="$(git status --porcelain -- . ":(exclude)demo_api_server/data" ":(exclude)setup-config.md")"
if [ -n "$DIRTY_OUTSIDE_NOISE" ]; then
  echo "$LOG_PREFIX unexpected dirty files outside the known noise paths — leaving it alone:"
  echo "$DIRTY_OUTSIDE_NOISE"
  exit 1
fi

STASHED=0
if [ -n "$(git status --porcelain -- "${NOISE_PATHS[@]}")" ]; then
  git stash push -u -m "$STASH_TAG" -- "${NOISE_PATHS[@]}" >/dev/null
  STASHED=1
fi

if ! git merge --ff-only origin/main >/dev/null 2>&1; then
  echo "$LOG_PREFIX fast-forward merge failed unexpectedly — leaving it alone."
  if [ "$STASHED" = "1" ]; then
    # Apply by SHA: this path never drops, and a SHA cannot be shifted by a
    # concurrent stash the way a positional stash@{N} can.
    STASH_SHA="$(git stash list --format='%H %gs' | awk -v tag="$STASH_TAG" '$0 ~ tag {print $1; exit}')"
    if [ -n "$STASH_SHA" ]; then
      git stash apply "$STASH_SHA" >/dev/null || true
    fi
  fi
  exit 1
fi

if [ "$STASHED" = "1" ]; then
  # Two identities for the same stash. `git stash apply` takes a SHA, which is
  # stable. `git stash drop` refuses a SHA and demands a positional stash@{N} —
  # and the `|| true` used to hide that, so every successful sync leaked its
  # stash. But stash@{N} shifts whenever anything else pushes or drops, so it is
  # re-resolved immediately before the destructive step and only used if it still
  # points at our SHA. Otherwise the stash is left behind: a leaked stash is
  # recoverable, dropping someone else's is not.
  STASH_LINE="$(git stash list --format='%gd %H %gs' | awk -v tag="$STASH_TAG" '$0 ~ tag {print $1, $2; exit}')"
  STASH_REF="${STASH_LINE%% *}"
  STASH_SHA="${STASH_LINE##* }"
  if [ -n "$STASH_LINE" ]; then
    git stash apply "$STASH_SHA" >/dev/null
    if [ "$(git rev-parse --verify --quiet "$STASH_REF" || true)" = "$STASH_SHA" ]; then
      git stash drop "$STASH_REF" >/dev/null 2>&1 || true
    else
      echo "$LOG_PREFIX stash reflog moved under us — leaving $STASH_SHA in place rather than dropping the wrong entry."
    fi
  fi
fi

echo "$LOG_PREFIX fast-forwarded $LOCAL_SHA -> $REMOTE_SHA"
