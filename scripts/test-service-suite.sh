#!/usr/bin/env bash
# scripts/test-service-suite.sh — run a test suite that no runner used to reach.
#
# WHY THIS EXISTS
# demo_authz_server and demo_mcp_gateway had ~90 test cases that executed only if
# a human manually cd'd into the directory. Neither appeared in run-all-tests.sh,
# ci-local.sh, or ci.yml (the gateway appeared in ci.yml only to `npm install` its
# deps so topology:verify could run an unrelated drift check). That included
# decision.contract.test.js, importSnapshot.parity.test.js, and five gateway
# suites added as regression protection — protection that never ran.
#
# Usage: bash scripts/test-service-suite.sh <authz-server|mcp-gateway>
#
# BLOCKING vs NON-BLOCKING
# Both services carry pre-existing failures that predate this wiring and are out
# of scope to fix here, so by default a failing test REPORTS but does not fail the
# gate. What always fails the gate is the suite not running at all — a missing
# module, a broken config, or a bad invocation. That distinction is the point:
# "0 tests ran" must never again be indistinguishable from "all tests passed".
#
# Set SUITE_BLOCKING=1 to make test failures fail the gate too. Do that once the
# pre-existing failures below are fixed; that is the intended end state, and this
# file is the single place to flip it.
#
# Deliberately NOT a pinned allowlist of known-failing test names: this repo runs
# several agents concurrently in one worktree, so a name list goes stale within
# minutes and starts failing the gate on tests someone else is still writing.
# Counts are printed on every run so drift stays visible.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="${1:-}"
BLOCKING="${SUITE_BLOCKING:-0}"

case "$SERVICE" in
  authz-server) DIR="$ROOT/demo_authz_server" ;;
  mcp-gateway)  DIR="$ROOT/demo_mcp_gateway" ;;
  # 2026-08-17: six more services had a `test` script and no CI job at all.
  # Five are fully green and run as BLOCKING gates from ci.yml (SUITE_BLOCKING=1)
  # — a red there is a regression. mastra-agent is the exception: three
  # pre-existing failures in tests/runHandler.test.ts, out of scope to fix in the
  # change that wired it up, so it runs non-blocking like the two above until
  # someone fixes them and flips it.
  agent-service)        DIR="$ROOT/demo_agent_service" ;;
  hitl-service)         DIR="$ROOT/demo_hitl_service" ;;
  code-search)          DIR="$ROOT/demo_mcp_code_search" ;;
  agent-token-service)  DIR="$ROOT/agent_token_service" ;;
  api-resource-server)  DIR="$ROOT/demo_api_resource_server" ;;
  mastra-agent)         DIR="$ROOT/mastra_agent" ;;
  *) echo "usage: $0 <authz-server|mcp-gateway|agent-service|hitl-service|code-search|agent-token-service|api-resource-server|mastra-agent>" >&2; exit 2 ;;
esac

[ -d "$DIR" ] || { echo "$SERVICE: $DIR not present — skipping"; exit 0; }

# A git worktree gets no node_modules of its own (every package-lock.json here is
# gitignored, so worktrees never inherit installed deps). Link the main checkout's
# rather than installing: same trick ci-local.sh uses, for the same reason.
if [ ! -e "$DIR/node_modules" ]; then
  common=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  main_ck=$(dirname "${common:-}")
  if [ -n "${common:-}" ] && [ -d "$main_ck/$(basename "$DIR")/node_modules" ]; then
    ln -sfn "$main_ck/$(basename "$DIR")/node_modules" "$DIR/node_modules"
    echo "  deps: linked $(basename "$DIR")/node_modules from the main checkout"
  else
    echo "  deps: installing $(basename "$DIR")..."
    npm install --prefix "$DIR" --no-audit --no-fund >/dev/null 2>&1 \
      || echo "  deps: WARNING npm install failed — results may be inaccurate"
  fi
fi

log=$(mktemp)
trap 'rm -f "$log"' EXIT

if [ "$SERVICE" = "authz-server" ]; then
  # node --test does NOT recurse on Node 20 (what ci.yml pins); it only gained
  # recursive discovery in Node 21. `node --test` alone therefore runs the root
  # *.test.js files and SILENTLY SKIPS tests/ — which is where the UC16 and tier
  # suites live. Pass both globs explicitly so the set is identical on every Node.
  shopt -s nullglob
  cd "$DIR" || exit 1
  files=( *.test.js tests/*.test.js )
  shopt -u nullglob
  if [ "${#files[@]}" -eq 0 ]; then
    echo "  ERROR: no test files matched *.test.js or tests/*.test.js" >&2
    exit 1
  fi
  echo "  running ${#files[@]} node --test files (root + tests/)"
  # --test-reporter=spec is REQUIRED, not cosmetic. node --test only defaults to
  # the spec reporter when stdout is a TTY; redirected to "$log" it is not, so it
  # emitted TAP (`# tests 221`) and the `^ℹ tests ` guard below never matched.
  # The suite passed 221/221 and the harness still exited 1 with "the runner did
  # not start" — this job could never go green in CI, only when a human watched
  # it. Pin the reporter so the parsing below matches what is actually produced.
  node --test --test-reporter=spec "${files[@]}" >"$log" 2>&1
  rc=$?
  # A completed `node --test` run always prints an "ℹ tests N" summary. No
  # summary means the runner never started — a harness failure, not a red test.
  if ! grep -qE '^ℹ tests ' "$log"; then
    echo "  ERROR: node --test produced no summary — the runner did not start." >&2
    tail -25 "$log" | sed 's/^/  | /'
    exit 1
  fi
  total=$(grep -E '^ℹ tests '  "$log" | tail -1 | awk '{print $3}')
  passed=$(grep -E '^ℹ pass '  "$log" | tail -1 | awk '{print $3}')
  failed=$(grep -E '^ℹ fail '  "$log" | tail -1 | awk '{print $3}')
else
  cd "$DIR" || exit 1
  # CI=true + --maxWorkers=2: higher worker counts flake the supertest suites in
  # this repo (demo_api_server/jest.config.js caps the same way under CI).
  CI=true npx jest --forceExit --maxWorkers=2 >"$log" 2>&1
  rc=$?
  plain=$(sed -E 's/\x1b\[[0-9;]*m//g' "$log")
  if ! grep -qE '^Tests:' <<<"$plain"; then
    echo "  ERROR: jest produced no test summary — it never started." >&2
    tail -25 "$log" | sed 's/^/  | /'
    exit 1
  fi
  total=$(grep -E '^Tests:'  <<<"$plain" | tail -1 | grep -oE '[0-9]+ total'  | awk '{print $1}')
  passed=$(grep -E '^Tests:' <<<"$plain" | tail -1 | grep -oE '[0-9]+ passed' | awk '{print $1}')
  failed=$(grep -E '^Tests:' <<<"$plain" | tail -1 | grep -oE '[0-9]+ failed' | awk '{print $1}')
fi

echo "  $SERVICE: ${passed:-0} passed, ${failed:-0} failed, ${total:-0} total"

if [ "$rc" -eq 0 ]; then
  exit 0
fi

echo "  ---- failing (tail) ----"
tail -20 "$log" | sed 's/^/  | /'

if [ "$BLOCKING" = "1" ]; then
  echo "  $SERVICE: FAILING (SUITE_BLOCKING=1)"
  exit 1
fi

echo "  $SERVICE: NON-BLOCKING — pre-existing failures, tracked separately."
echo "  The suite RAN and is reported above; set SUITE_BLOCKING=1 to gate on it."
exit 0
