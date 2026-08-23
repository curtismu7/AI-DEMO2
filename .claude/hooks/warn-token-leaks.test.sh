#!/bin/bash
# Runnable check for warn-token-leaks.sh. Run: bash .claude/hooks/warn-token-leaks.test.sh
HOOK="$(dirname "$0")/warn-token-leaks.py"
FAIL=0

# Each case gets its own session id so the CI-poll counter starts clean.
fire() { printf '{"session_id":"%s","tool_input":{"command":%s}}' "$1" "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$2")" | python3 "$HOOK"; }

want() { # want <expect warn: yes|no> <label> <session> <cmd>
  local out; out=$(fire "$3" "$4")
  if [ "$1" = yes ] && [ -z "$out" ]; then echo "FAIL (expected warning): $2"; FAIL=1
  elif [ "$1" = no ] && [ -n "$out" ]; then echo "FAIL (unexpected warning): $2"; FAIL=1
  else echo "ok: $2"; fi
}

want no  "first CI poll is free"        s1 'gh pr checks 2248'
want yes "second CI poll warns"         s1 'gh pr checks 2248'
want no  "--watch never warns"          s2 'gh pr checks 2248 --watch'
want yes "bare npm test"                s3 'cd demo_api_server && CI=true npm test -- --forceExit'
want no  "scoped jest by path"          s4 'CI=true npx jest routes/auth.test.js --forceExit'
want no  "vitest via test:unit script"  s5 'npm --prefix demo_api_ui run test:unit'
want yes "whole-stack restart"          s6 './run-docker.sh restart'
want no  "targeted restart"             s7 './run-docker.sh restart ui demo-api-server'
want no  "deploy-live is targeted"      s8 'scripts/deploy-live.sh'
want no  "escape hatch"                 s9 './run-docker.sh restart # no-leak-warn'

[ "$FAIL" = 0 ] && echo "ALL PASS" || echo "FAILURES"
exit "$FAIL"
