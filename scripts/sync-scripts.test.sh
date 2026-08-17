#!/usr/bin/env bash
# scripts/sync-scripts.test.sh — end-to-end test for the shared-checkout sync
# tooling (sync-main-checkout.sh, park-main-edits.sh, sync-status.sh), driven
# against a throwaway origin/clone pair in a temp dir. Touches nothing real.
#
# These scripts only ever run against the ONE shared checkout Docker
# bind-mounts, where a bug means either a silently stale demo or someone's
# uncommitted work moved without them asking. That is not a place to find out
# by trying. Two real portability bugs turned up here first: mapfile is bash 4
# and macOS ships 3.2, and an exclude-only pathspec is fatal the moment one of
# the named paths does not exist.
#
# Usage: bash scripts/sync-scripts.test.sh   (also runs in npm run hygiene:check)

set -uo pipefail
WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# --- upstream ---
git init -q --bare "$ROOT/origin.git"
git clone -q "$ROOT/origin.git" "$ROOT/seed"
cd "$ROOT/seed"
mkdir -p scripts .claude demo_api_server/data
cp "$WT/scripts/sync-main-checkout.sh" "$WT/scripts/sync-status.sh" "$WT/scripts/park-main-edits.sh" scripts/
echo "v1" > app.js
echo "runtime" > demo_api_server/data/runtimeData.json
printf '.claude/sync-status.json\n.claude/*.md.local\n' > .gitignore
git add -A && git commit -qm init && git branch -M main && git push -qu origin main

# --- the "shared main checkout" ---
git clone -q "$ROOT/origin.git" "$ROOT/main"

# --- upstream moves ahead: a code change AND a tracked .claude note ---
cd "$ROOT/seed"
echo "v2" > app.js
echo "handoff body" > .claude/HANDOFF-test.md
git add -A && git commit -qm "v2 + handoff" && git push -q origin main

pass=0; fail=0
check() { # check <desc> <expected-substring> <actual>
  if grep -q -- "$2" <<<"$3"; then echo "  PASS  $1"; pass=$((pass+1));
  else echo "  FAIL  $1"; echo "        wanted: $2"; echo "        got:    $3"; fail=$((fail+1)); fi
}

cd "$ROOT/main"
# NOTE: setup-config.md deliberately never exists in this fixture — it is one of
# the scripts' noise paths, and a missing noise path used to be fatal.

echo "== B: untracked .claude note must not block, and must reconcile =="
mkdir -p .claude
echo "handoff body" > .claude/HANDOFF-test.md   # identical to the incoming tracked one
echo "noise" >> demo_api_server/data/runtimeData.json
out="$(bash scripts/sync-main-checkout.sh 2>&1)"
check "sync fast-forwards despite the untracked .claude note" "fast-forwarded" "$out"
check "app.js updated to v2" "v2" "$(cat app.js)"
check "note is now tracked, no .local left" "^$" "$(ls .claude/*.local 2>/dev/null)"
check "noise path survived the stash round-trip" "noise" "$(cat demo_api_server/data/runtimeData.json)"

echo "== C: status file written and readable =="
out="$(bash scripts/sync-status.sh 2>&1)"; rc=$?
check "sync:status reports in sync" "in sync" "$out"
check "sync:status exits 0 when clean" "0" "$rc"

echo "== B2: a DIVERGED untracked note is kept as .local, never lost =="
cd "$ROOT/seed"; echo "upstream edit" > .claude/HANDOFF-two.md; git add -A; git commit -qm two; git push -q origin main
cd "$ROOT/main"; echo "my local version" > .claude/HANDOFF-two.md
out="$(bash scripts/sync-main-checkout.sh 2>&1)"
check "diverged note kept as .local" "kept your version" "$out"
check ".local holds the local content" "my local version" "$(cat .claude/HANDOFF-two.md.local 2>/dev/null)"
check "tracked file holds upstream content" "upstream edit" "$(cat .claude/HANDOFF-two.md)"

echo "== C2: blocked run is recorded and surfaced =="
cd "$ROOT/seed"; echo "v3" > app.js; git commit -qam v3; git push -q origin main
cd "$ROOT/main"; echo "half-finished" > src-edit.js
out="$(bash scripts/sync-main-checkout.sh 2>&1)"; rc=$?
check "sync backs off on a real dirty file" "leaving it alone" "$out"
check "sync exits 1 when blocked" "1" "$rc"
out="$(bash scripts/sync-status.sh 2>&1)"; rc=$?
check "sync:status says BLOCKED" "BLOCKED" "$out"
check "sync:status names the blocking file" "src-edit.js" "$out"
check "sync:status exits 1 when blocked" "1" "$rc"

echo "== A: park-main-edits clears it and syncs =="
out="$(bash scripts/park-main-edits.sh --dry-run 2>&1)"
check "dry run lists the file" "src-edit.js" "$out"
check "dry run changes nothing" "half-finished" "$(cat src-edit.js)"
out="$(bash scripts/park-main-edits.sh 2>&1)"
check "park reports the wip branch" "parked on wip/main-" "$out"
check "park then syncs" "fast-forwarded" "$out"
check "app.js now v3" "v3" "$(cat app.js)"
check "work recoverable on the wip branch" "half-finished" "$(git show "$(git branch --list 'wip/main-*' | tr -d ' *')":src-edit.js 2>&1)"
check "main is clean after parking" "^$" "$(git status --porcelain | grep -v 'demo_api_server/data' | grep -v '\.local$')"

echo "== A2: refuses to run off main =="
git switch -qc some-branch
out="$(bash scripts/park-main-edits.sh 2>&1)"; rc=$?
check "refuses when not on main" "refusing" "$out"
check "exits 1 when refusing" "1" "$rc"
git switch -q main

echo
echo "RESULT pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
