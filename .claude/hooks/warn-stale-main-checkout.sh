#!/usr/bin/env bash
# SessionStart: say so, once, when the shared main checkout is not serving what merged.
#
# Why: Docker bind-mounts the main checkout, so a stale checkout means every
# session's stack quietly serves old code. sync-main-checkout.sh backs off by
# design when it finds unexplained dirty files, and the launchd job that runs it
# every 15 min logs where nobody looks — the failure mode is silence, not an error.
# scripts/sync-status.sh already answers the question in 0.4s; nobody runs it.
#
# This NEVER blocks and never fails a session. Silent when in sync.
set -uo pipefail

MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" 2>/dev/null) || exit 0
[ -d "$MAIN" ] || exit 0
[ -x "$MAIN/scripts/sync-status.sh" ] || [ -f "$MAIN/scripts/sync-status.sh" ] || exit 0

# sync-status.sh compares HEAD against the LOCAL origin/main ref, so without this
# a session that has not fetched sees "in sync" while GitHub has moved on.
# lowSpeed* caps a stalled transfer; the hook's own timeout in settings.json is
# the outer bound.
git -C "$MAIN" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=5 fetch --quiet origin main >/dev/null 2>&1 || true

OUT=$(bash "$MAIN/scripts/sync-status.sh" 2>&1)
[ $? -eq 0 ] && exit 0

OUT="$OUT" python3 -c '
import json, os
out = os.environ.get("OUT", "").strip()
if not out:
    raise SystemExit
msg = (
    "Shared main checkout is NOT serving what merged. Docker bind-mounts it, so "
    "the running stack is on stale code until this is resolved:\n\n" + out +
    "\n\nFix: scripts/sync-main-checkout.sh  (or npm run sync:unblock, which parks "
    "stray main-checkout edits on a wip/ branch first — nothing is stashed or discarded)."
)
print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": msg}}))
'
exit 0
