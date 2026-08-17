#!/usr/bin/env bash
# scripts/park-main-edits.sh — move stray uncommitted work out of the shared
# main checkout and onto a wip branch, then sync.
#
# Why this exists: scripts/sync-main-checkout.sh refuses to touch a checkout
# with unexplained dirty files (correctly — concurrent sessions sharing one
# index have clobbered work twice, REGRESSION_PLAN §4). Clearing that by hand
# takes four steps and trips the pre-commit guard that blocks source commits
# from the shared checkout, so in practice the sync stays blocked for hours and
# Docker keeps bind-mounting stale code.
#
# This parks the work instead of discarding it: a real commit on a real branch,
# nothing stashed (the stash stack is shared with every worktree and a bare pop
# from the wrong session is unrecoverable), nothing deleted.
#
# Usage:
#   scripts/park-main-edits.sh              park, then run the sync
#   scripts/park-main-edits.sh --dry-run    print what would be parked
#   scripts/park-main-edits.sh --no-sync    park only
#
# Exit 0 = parked (or nothing to park). Exit 1 = refused, see the log line.

set -euo pipefail
cd "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

LOG_PREFIX="[park-main-edits]"
DRY_RUN=0
RUN_SYNC=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-sync) RUN_SYNC=0 ;;
    *) echo "$LOG_PREFIX unknown argument: $arg" >&2; exit 1 ;;
  esac
done

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  echo "$LOG_PREFIX checkout is on '$BRANCH', not main — refusing. This script is only for the shared main checkout."
  exit 1
fi

# Same exclusions the sync script tolerates: runtime data churn, and untracked
# top-level .claude notes. Anything else dirty is what blocks the sync. Kept as
# a porcelain-line filter, not a `:(exclude)` pathspec — git treats an
# exclude-only pathspec naming a path that is absent on disk as fatal.
NOISE_RE='^.. (demo_api_server/data(/|$)|setup-config\.md$)'
# DIRTY_COUNT rather than ${#DIRTY[@]}: under `set -u` an empty array is an
# unbound variable on bash < 4.4 (macOS ships 3.2), and "nothing to park" is
# the common case.
DIRTY=()
DIRTY_COUNT=0
while IFS= read -r line; do
  if [ -n "$line" ]; then
    DIRTY+=("$line")
    DIRTY_COUNT=$((DIRTY_COUNT + 1))
  fi
done < <(git status --porcelain --untracked-files=all | grep -Ev "$NOISE_RE" | grep -Ev '^\?\? \.claude/[^/]+\.md$' || true)

if [ "$DIRTY_COUNT" -eq 0 ]; then
  echo "$LOG_PREFIX nothing to park — no dirty files outside the tolerated paths."
  [ "$RUN_SYNC" = "1" ] && exec "$(dirname "$0")/sync-main-checkout.sh"
  exit 0
fi

FILES=()
for line in "${DIRTY[@]}"; do
  # porcelain: XY<space>path — renames appear as "R  old -> new", keep the new.
  path="${line:3}"
  path="${path##* -> }"
  path="${path%\"}"; path="${path#\"}"
  FILES+=("$path")
done

echo "$LOG_PREFIX $DIRTY_COUNT file(s) to park:"
printf '  %s\n' "${FILES[@]}"

if [ "$DRY_RUN" = "1" ]; then
  echo "$LOG_PREFIX dry run — nothing changed."
  exit 0
fi

WIP_BRANCH="wip/main-$(date +%Y%m%d-%H%M%S)"

# --no-verify is deliberate and narrow. .husky/pre-commit blocks source commits
# made from this checkout to stop concurrent sessions clobbering each other via
# the shared index; that is exactly the situation being cleaned up here, and the
# hook's own message names --no-verify as the sanctioned exception. The commit
# lands on a throwaway wip branch, never on main, and is never pushed.
git switch -c "$WIP_BRANCH"
git add -- "${FILES[@]}"
git commit --no-verify -q -m "wip: park stray edits from the shared main checkout

Parked by scripts/park-main-edits.sh so scripts/sync-main-checkout.sh could
fast-forward the checkout Docker bind-mounts. Nothing here was reviewed; pick
it back up with: git switch $WIP_BRANCH"
git switch main -q

echo "$LOG_PREFIX parked on $WIP_BRANCH — recover with: git switch $WIP_BRANCH"

if [ "$RUN_SYNC" = "1" ]; then
  exec "$(dirname "$0")/sync-main-checkout.sh"
fi
