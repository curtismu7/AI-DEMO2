#!/usr/bin/env bash
# SessionStart: say so, once, when a service declares a dependency the shared
# main checkout has never installed.
#
# Why: every package-lock.json here is gitignored, so worktrees take their deps
# by SYMLINKING the main checkout's node_modules (scripts/bootstrap-worktree.sh).
# A dependency added to a service's package.json therefore reaches nobody until
# somebody runs an install in main — and nothing surfaces that until a worktree
# fails to compile, usually mid-task and far from the cause. On 2026-09-07 the
# same prom-client omission was sitting in THREE services at once (oauth-mcp,
# demo_mcp_gateway, demo_api_resource_server); the first two were found only
# because a build broke, the third days later.
#
# Deliberately warn-only, like warn-stale-main-checkout.sh next to it: an
# install mutates the shared checkout's node_modules and can be slow, which is
# not something to do unasked at session start on a machine running several
# sessions.
#
# This NEVER blocks and never fails a session. Silent when every dep resolves.
set -uo pipefail

MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" 2>/dev/null) || exit 0
[ -d "$MAIN" ] || exit 0
[ -f "$MAIN/scripts/bootstrap-worktree.sh" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

# --check-deps, NOT --check: from the main checkout — where most sessions start —
# --check short-circuits with "nothing to link" and exit 0 without verifying a
# single dependency, so this hook would be silent by construction.
OUT=$(bash "$MAIN/scripts/bootstrap-worktree.sh" --check-deps 2>&1)
[ $? -eq 0 ] && exit 0

OUT="$OUT" python3 -c '
import json, os
out = os.environ.get("OUT", "").strip()
if not out:
    raise SystemExit
msg = (
    "A service declares a dependency the shared main checkout never installed. "
    "Worktrees symlink that node_modules, so this breaks the build in EVERY "
    "worktree, not just one:\n\n" + out +
    "\n\nUntil it is installed, expect MODULE_NOT_FOUND or a failing tsc in that "
    "service from any worktree."
)
print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": msg}}))
'
exit 0
