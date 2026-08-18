#!/bin/bash
# PreToolUse (Bash): deny an agent-typed `docker compose ... up`; route it to ./run-docker.sh.
#
# Why: several sessions converge the same Compose project at once. Session A lists
# containers, decides a service must be created; session B creates it first; A's
# create then dies with `Conflict. The container name "/ai-demo-ui" is already in
# use`. Observed 2026-08-02 five times across two worktree sessions (ai-demo-ui,
# ai-demo-mcp-invest, ai-demo-llm-proxy, ai-demo-api-server) — every one from a
# plain `docker compose up -d`, none from run-docker.sh.
#
# run-docker.sh is the serialization point: it stops first, purges container-name
# squatters left by other projects, pins the project name and project directory,
# and gates the result. None of that happens when compose is driven directly.
#
# Not blocked: every read-only / non-creating compose verb (ps, logs, config,
# down, stop, restart, exec), `--dry-run`, and run-docker.sh's own internal
# compose calls — hooks see agent tool calls, not commands a script spawns.
#
# Escape hatch: append `# force-compose` to the command.

CMD=$(python3 -c "import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    print(''); raise SystemExit
t=d.get('tool_input') or {}
print(t.get('command') or '')" 2>/dev/null || true)
[ -z "$CMD" ] && exit 0

case "$CMD" in
  *force-compose*) exit 0 ;;
  *--dry-run*)     exit 0 ;;
esac

# `up` must belong to the same command segment as the compose invocation, so
# `docker compose ps && ./run-docker.sh up-to-date` does not trip it.
printf '%s' "$CMD" \
  | grep -qE '(docker[[:space:]]+compose|docker-compose)[^;&|]*[[:space:]]up([[:space:]]|$)' \
  || exit 0

printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: do not drive `docker compose up` directly. Parallel agent sessions converging the same project produce \"container name /ai-demo-... is already in use\" conflicts that no cleanup code can prevent (5 occurrences on 2026-08-02). Use the launcher, which stops first, purges name squatters, pins the project name/directory and verifies the result: ./run-docker.sh start | restart <svc> | build <svc> | optional start <group> | demo-sync. Read-only compose verbs (ps, logs, config, down, stop) and --dry-run are not blocked. To make the stack serve YOUR worktree instead of the main checkout, use `npm run serve:worktree here` — it moves only the two source mounts and keeps the project directory on main, so nothing is starved of its .env. If you truly need the raw command, append `# force-compose` to it."}}'
exit 0
