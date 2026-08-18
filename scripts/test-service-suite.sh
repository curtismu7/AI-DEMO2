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
# By default a failing test REPORTS but does not fail the gate. What always fails
# the gate is the suite not running at all — a missing module, a broken config,
# or a bad invocation. That distinction is the point: "0 tests ran" must never
# again be indistinguishable from "all tests passed".
#
# Set SUITE_BLOCKING=1 to make test failures fail the gate too. That is the
# intended end state for every suite here.
#
# mcp-gateway reached it on 2026-08-17 and ci.yml now runs it with
# SUITE_BLOCKING=1 — its 11 pre-existing failures were fixed (6 gateway-auth and
# 3 gateway-passthrough died in setup before reaching an assertion, 2
# gateway-server-hardening were flakes), leaving 721/721 green.
#
# authz-server still carries pre-existing failures and stays non-blocking until
# someone fixes them. Until then, read a green "Service suites" for it as "the
# suite ran", NOT as "the suite passed".
#
# Deliberately NOT a pinned allowlist of known-failing test names: this repo runs
# several agents concurrently in one worktree, so a name list goes stale within
# minutes and starts failing the gate on tests someone else is still writing.
# Counts are printed on every run so drift stays visible.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="${1:-}"
BLOCKING="${SUITE_BLOCKING:-0}"

# Jest workers per service. 2 is the repo-wide cap; mcp-gateway needs 1 because
# its supertest suites bind real sockets and contend at 2 (see the invocation
# below for the measurements).
DEFAULT_WORKERS=2

case "$SERVICE" in
  authz-server) DIR="$ROOT/demo_authz_server" ;;
  mcp-gateway)  DIR="$ROOT/demo_mcp_gateway"; DEFAULT_WORKERS=1 ;;
  # 2026-08-17: six more services had a `test` script and no CI job at all.
  # All six now run as BLOCKING gates from ci.yml (SUITE_BLOCKING=1) — a red
  # there is a regression. mastra-agent was wired non-blocking for three
  # runHandler failures; they were one production bug (abort on req 'close',
  # which Node fires when the request BODY completes rather than on client
  # disconnect) and it now passes 36/36.
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
  # CI=true + --maxWorkers=N: higher worker counts flake the supertest suites in
  # this repo (demo_api_server/jest.config.js caps the same way under CI).
  #
  # mcp-gateway runs at 1. Eight of its suites bind a REAL listening socket via
  # supertest, and at 2 workers they flake two different ways — `socket hang up`
  # and jest timeouts — with a different suite failing each run (observed across
  # gateway-server, gateway-server-hardening, gateway-get-delete-middleware and
  # gateway-http-progress-cancellation in a single day). Since #1959 this is a
  # BLOCKING gate, so an intermittent red here stops everyone.
  #
  # Serial costs nothing: measured 735/735 in 6.5s at 1 worker against ~19s at 2,
  # twice in a row, because the contention IS the slowness. Override with
  # SUITE_MAX_WORKERS to experiment.
  workers="${SUITE_MAX_WORKERS:-$DEFAULT_WORKERS}"
  CI=true npx jest --forceExit --maxWorkers="$workers" >"$log" 2>&1
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
