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
# Resolve the main checkout via git, not this script's own file location —
# every worktree under .claude/worktrees/ has its own copy of this file, and
# `dirname "${BASH_SOURCE[0]}"` used to resolve to whichever copy ran it. That
# silently synced/diffed the WORKTREE instead of the main checkout Docker
# bind-mounts when invoked from inside one. --git-common-dir always points at
# the main checkout's .git regardless of which worktree's copy is running.
#
# `git -C <this script's dir>` rather than a bare `git`: the bare form asks
# about the CALLER's cwd, which is fine for an agent standing in the repo and
# fatal for launchd, whose cwd is `/`. The 15-minute sync job had been dying on
# "fatal: not a git repository" every run since this line was introduced,
# logging it where nobody reads — the exact silent staleness the job exists to
# prevent. Anchoring on BASH_SOURCE keeps the worktree property above intact:
# --git-common-dir maps any worktree copy back to the main checkout anyway.
cd "$(dirname "$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --path-format=absolute --git-common-dir)")"

NOISE_PATHS=(demo_api_server/data setup-config.md)
# Matched against `git status --porcelain` lines rather than passed as a
# `:(exclude)` pathspec: git makes an exclude-only pathspec a fatal error the
# moment one of the named paths does not exist on disk, which turned a missing
# setup-config.md into "sync is broken" rather than "nothing to exclude".
NOISE_RE='^.. (demo_api_server/data(/|$)|setup-config\.md$)'
STASH_TAG="auto-sync-main-$(date +%Y%m%d-%H%M%S)"
LOG_PREFIX="[sync-main-checkout]"
STATUS_FILE=".claude/sync-status.json"

# Record every outcome so a silent back-off stops being silent: the launchd job
# logs where nobody looks, and a stale checkout is invisible until someone
# notices Docker serving old code. `npm run sync:status` reads this.
# $1 = outcome (synced|uptodate|blocked|failed), $2 = human reason.
write_status() {
  local outcome="$1" reason="$2"
  OUTCOME="$outcome" REASON="$reason" STATUS_FILE="$STATUS_FILE" \
  LOCAL_SHA="${LOCAL_SHA:-}" REMOTE_SHA="${REMOTE_SHA:-}" \
    node -e '
      const fs = require("node:fs");
      const f = process.env.STATUS_FILE;
      let prev = {};
      try { prev = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
      const now = new Date().toISOString();
      const outcome = process.env.OUTCOME;
      const ok = outcome === "synced" || outcome === "uptodate";
      fs.mkdirSync(require("node:path").dirname(f), { recursive: true });
      fs.writeFileSync(f, `${JSON.stringify({
        outcome,
        reason: process.env.REASON || "",
        checkedAt: now,
        lastSuccessAt: ok ? now : (prev.lastSuccessAt || null),
        localSha: process.env.LOCAL_SHA || null,
        remoteSha: process.env.REMOTE_SHA || null,
      }, null, 2)}\n`);
    ' 2>/dev/null || true
}

# Put parked .claude docs back exactly as they were — used when the sync did
# NOT happen, so the checkout ends up in the state we found it in.
# PARKED_COUNT rather than ${#PARKED_FILES[@]}: under `set -u` an empty array
# is an unbound variable on bash < 4.4, and the ${#a[@]:-0} form that papers
# over it is a syntax error on bash 5 (silently tolerated by the 3.2 that ships
# with macOS — green here, "bad substitution" on the CI runner).
PARKED_COUNT=0

restore_parked_docs() {
  [ "$PARKED_COUNT" -gt 0 ] || { rm -rf "${PARKED_DIR:-}"; return 0; }
  for doc in "${PARKED_FILES[@]}"; do
    [ -e "$doc" ] || mv "$PARKED_DIR/$doc" "$doc"
  done
  rm -rf "$PARKED_DIR"
}

# After a successful fast-forward the doc arrives tracked. Identical content is
# the normal case (the commit tracked the very file that was sitting here) and
# the parked copy is dropped. Anything else is kept as <name>.local — a diverged
# local edit is the one thing this script must never throw away.
reconcile_parked_docs() {
  [ "$PARKED_COUNT" -gt 0 ] || { rm -rf "${PARKED_DIR:-}"; return 0; }
  for doc in "${PARKED_FILES[@]}"; do
    if cmp -s "$PARKED_DIR/$doc" "$doc" 2>/dev/null; then
      rm -f "$PARKED_DIR/$doc"
    else
      mv "$PARKED_DIR/$doc" "${doc}.local"
      echo "$LOG_PREFIX kept your version of $doc as ${doc}.local — it differs from the one now tracked."
    fi
  done
  rm -rf "$PARKED_DIR"
}

git fetch origin main --quiet

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/main)"

if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  echo "$LOG_PREFIX up to date ($LOCAL_SHA)"
  write_status uptodate ""
  exit 0
fi

if ! git merge-base --is-ancestor "$LOCAL_SHA" "$REMOTE_SHA"; then
  echo "$LOG_PREFIX local HEAD ($LOCAL_SHA) is not an ancestor of origin/main ($REMOTE_SHA) — not a clean fast-forward, leaving it alone. Investigate manually."
  write_status failed "local HEAD is not an ancestor of origin/main"
  exit 1
fi

# Anything dirty outside the known noise paths means real, unidentified
# work is sitting in this checkout — do not touch it, do not stash it.
# Exception: UNTRACKED top-level .claude/*.md (agent handoff notes). They are
# already exempt from the pre-commit main-checkout guard, they are never a
# service's source, and one of them left unwritten stalls every sync — and with
# it the running stack — until a human moves it. Only the `?? ` form is
# exempted: a MODIFIED tracked .claude doc is still real work and still blocks.
# -uall so untracked files always list individually: with the default
# -unormal git collapses a wholly-untracked directory to a single "?? dir/"
# line, which no per-file rule can match. Measured at 0.11s in this repo,
# same as the default.
DIRTY_OUTSIDE_NOISE="$(git status --porcelain --untracked-files=all \
  | grep -Ev "$NOISE_RE" \
  | grep -Ev '^\?\? \.claude/[^/]+\.md$' || true)"
if [ -n "$DIRTY_OUTSIDE_NOISE" ]; then
  echo "$LOG_PREFIX unexpected dirty files outside the known noise paths — leaving it alone:"
  echo "$DIRTY_OUTSIDE_NOISE"
  write_status blocked "$(printf '%s' "$DIRTY_OUTSIDE_NOISE" | tr '\n' ';')"
  exit 1
fi

# An untracked .claude doc whose path the incoming commits also add makes
# --ff-only refuse ("untracked working tree file would be overwritten"). Move
# those aside, fast-forward, then compare: identical content is dropped, a
# genuine difference is kept as <name>.local rather than silently lost.
PARKED_DIR="$(mktemp -d)"
PARKED_FILES=()
while IFS= read -r doc; do
  [ -n "$doc" ] || continue
  git cat-file -e "origin/main:$doc" 2>/dev/null || continue
  mkdir -p "$PARKED_DIR/$(dirname "$doc")"
  mv "$doc" "$PARKED_DIR/$doc"
  PARKED_FILES+=("$doc")
  PARKED_COUNT=$((PARKED_COUNT + 1))
done < <(git status --porcelain --untracked-files=all -- .claude | sed -n 's|^?? \(\.claude/[^/]*\.md\)$|\1|p')

STASHED=0
# Build stash pathspec excluding gitignored paths — git stash push -u refuses
# to stash a path that matches .gitignore and aborts the whole stash.
STASH_PATHS=()
for p in "${NOISE_PATHS[@]}"; do
  # A path that does not exist here makes `git stash push -- <paths>` fatal the
  # same way the exclude pathspec was.
  [ -e "$p" ] || continue
  git check-ignore -q "$p" 2>/dev/null && continue
  STASH_PATHS+=("$p")
done
if [ "${#STASH_PATHS[@]}" -gt 0 ] && [ -n "$(git status --porcelain -- "${STASH_PATHS[@]}")" ]; then
  git stash push -u -m "$STASH_TAG" -- "${STASH_PATHS[@]}" >/dev/null
  STASHED=1
fi

if ! git merge --ff-only origin/main >/dev/null 2>&1; then
  echo "$LOG_PREFIX fast-forward merge failed unexpectedly — leaving it alone."
  write_status failed "fast-forward merge failed"
  restore_parked_docs
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

reconcile_parked_docs
write_status synced ""
echo "$LOG_PREFIX fast-forwarded $LOCAL_SHA -> $REMOTE_SHA"
