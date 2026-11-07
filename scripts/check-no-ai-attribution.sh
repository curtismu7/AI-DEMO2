#!/bin/bash
# No AI attribution anywhere (owner rule 2026-11-07): fails when a tracked file, or any commit made on or after the rule
# date, contains an AI-attribution credit: the Claude Code "Generated with" line or a Co-Authored-By trailer.
# Older history is not rewritten, so only commits from the rule date on are checked; the tree is always checked.
# Prints counts and locations, never the matching text. Usage: scripts/check-no-ai-attribution.sh   (run from anywhere in the repo)
set -u
rule_date="2026-11-07"
# bracketed first letters so this file does not match its own pattern
pat='[G]enerated with \[?[C]laude Code|[C]o-[A]uthored-[B]y:'
cd "$(git rev-parse --show-toplevel)" || exit 1
status=0

tree=$(git grep -lIiE "$pat" -- . ':(exclude)scripts/check-no-ai-attribution.sh' 2>/dev/null || true)
tree_count=$(printf '%s' "$tree" | grep -c . || true)
echo "tracked files with an AI-attribution credit: $tree_count"
if [ "$tree_count" != "0" ]; then printf '%s\n' "$tree" | sed 's/^/  /'; status=1; fi

bad=0
for h in $(git log --all --since="$rule_date" --format=%H 2>/dev/null); do
  if git log -1 --format=%B "$h" | grep -qiE "$pat"; then bad=$((bad+1)); echo "  commit ${h:0:7}"; fi
done
echo "commits since $rule_date with an AI-attribution credit: $bad"
[ "$bad" != "0" ] && status=1

[ "$status" != "0" ] && echo "FAIL    remove the credit (rule: never write it in a commit, PR body, issue, comment or file)"
exit $status
