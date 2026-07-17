#!/bin/bash
# PreToolUse (Write|Edit): deny writes in the shared MAIN checkout; allow in worktrees.
#
# Why: CLAUDE.md requires edit -> test -> commit in an isolated worktree because
# concurrent sessions share one index. This has silently clobbered work twice --
# see REGRESSION_PLAN section 4 (2026-07-11 and 2026-07-16): a commit authored in
# the main checkout swept in stale demo_api_ui files and reverted prior fixes with
# no test or build failure. The rule was documented but never enforced; this hook
# enforces it.
#
# Detection is generic -- no hardcoded paths. In a linked worktree, --absolute-git-dir
# is <repo>/.git/worktrees/<name> while --git-common-dir is the shared <repo>/.git.
# In the main checkout the two resolve to the SAME directory.
#
# Exemptions: .claude/** and the contract docs. The clobber pattern is stale SOURCE
# swept into a commit, not config -- and keeping these editable means this hook stays
# maintainable without spinning up a worktree.

F=$(python3 -c "import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    print(''); raise SystemExit
t=d.get('tool_input') or {}
print(t.get('file_path') or '')" 2>/dev/null || true)
[ -z "$F" ] && exit 0

case "$F" in
  */.claude/*|*/CLAUDE.md|*/REGRESSION_PLAN.md|*/AGENTS.md) exit 0 ;;
esac

# nearest existing ancestor (the file may not exist yet)
D=$(dirname "$F")
while [ ! -d "$D" ] && [ "$D" != "/" ] && [ -n "$D" ]; do D=$(dirname "$D"); done
[ -d "$D" ] || exit 0

GD=$(git -C "$D" rev-parse --absolute-git-dir 2>/dev/null) || exit 0
CD=$(git -C "$D" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
[ -n "$GD" ] && [ -n "$CD" ] || exit 0

if [ "$GD" = "$CD" ]; then
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: this path is in the shared MAIN checkout. CLAUDE.md requires edit -> test -> commit in an isolated git worktree -- concurrent sessions share one index and this has silently clobbered work twice (REGRESSION_PLAN section 4). Create or enter a worktree and edit there. Exempt: .claude/**, CLAUDE.md, REGRESSION_PLAN.md, AGENTS.md."}}'
fi
exit 0
