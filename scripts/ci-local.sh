#!/usr/bin/env bash
# Local stand-in for GitHub Actions CI (.github/workflows/ci.yml).
#
# Why this exists: Actions is refusing to start jobs ("recent account payments
# have failed or your spending limit needs to be increased"). Every job dies in
# ~3s with zero steps executed, so every PR shows red regardless of the code and
# no merge has been verified. This runs the same checks locally so the push
# boundary still has a guard.
#
# Mirrors ci.yml exactly:
#   job "Hygiene + topology gates" -> hygiene:check, regression:paths, topology:verify
#   job "API server tests (Jest)"  -> npm test --prefix demo_api_server
#
# Usage: npm run ci:local     (also runs from .husky/pre-push)
# Bypass: git push --no-verify

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

FAILED=""
run() { # run <label> <npm-script>
  printf '  %-22s' "$1"
  local log; log=$(mktemp)
  local s; s=$(date +%s)
  if npm run --silent "$2" >"$log" 2>&1; then
    printf 'PASS  (%ss)\n' "$(( $(date +%s) - s ))"
  else
    printf 'FAIL  (%ss)\n' "$(( $(date +%s) - s ))"
    FAILED="$FAILED $2"
    echo "  ---- $2 output (tail) ----"
    tail -25 "$log" | sed 's/^/  | /'
  fi
  rm -f "$log"
}

# Dependencies. A git worktree gets no node_modules of its own; symlink the main
# checkout's (instant) rather than installing (minutes) -- a slow gate is a gate
# people bypass, and --no-verify also disables the secret guards in pre-commit.
ensure_deps() { # ensure_deps <pkg-dir>
  [ -d "$1" ] || return 0
  [ -e "$1/node_modules" ] && return 0
  local common main_ck
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 0
  main_ck=$(dirname "$common")
  if [ -d "$main_ck/$1/node_modules" ]; then
    ln -sfn "$main_ck/$1/node_modules" "$1/node_modules"
    echo "  deps: linked $1/node_modules from the main checkout"
  else
    echo "  deps: installing $1 (no main-checkout node_modules to link)..."
    npm install --prefix "$1" --no-audit --no-fund >/dev/null 2>&1 \
      || echo "  deps: WARNING npm install failed for $1 — checks may be inaccurate"
  fi
}

# demo_api_server/jest.config.js ignores '/\.claude/worktrees/' so a main-checkout
# run doesn't double-execute suites it walks into inside agent worktrees. Running
# jest FROM such a worktree means every test's own path matches that pattern and
# jest exits 1 with "No tests found" -- a false failure, and worktrees are now
# mandatory (#532). Override on the CLI, which REPLACES the array rather than
# merging: re-state '/node_modules/' and '/tests/real/' so we keep CI's exclusions
# and drop only the worktree ones. In the main checkout, run the script verbatim.
JEST_IGNORES=(--testPathIgnorePatterns="/node_modules/" --testPathIgnorePatterns="/tests/real/")

run_api_tests() {
  printf '  %-22s' "test:api-server"
  local log; log=$(mktemp); local s; s=$(date +%s)

  # Only override the ignore list when we ARE inside a worktree. In the main
  # checkout the config's '/\.claude/worktrees/' exclusion is load-bearing --
  # overriding it there would make jest walk into every agent worktree and run
  # their suites too. Main checkout: run exactly what CI runs.
  local gd cd_
  gd=$(git rev-parse --absolute-git-dir 2>/dev/null)
  cd_=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  if [ -n "$gd" ] && [ "$gd" != "$cd_" ]; then
    IN_WORKTREE=1
  else
    IN_WORKTREE=0
    JEST_IGNORES=()
  fi

  # ${arr[@]+"${arr[@]}"}, not "${arr[@]}": macOS ships bash 3.2, where expanding an
  # EMPTY array under `set -u` is a fatal "unbound variable". That is the main-checkout
  # branch above, so this job died before jest started -- 0s, no output, reported as
  # "[failed twice — real]" because the retry died the same way. Worktrees were unaffected
  # (their array is non-empty), which is why it survived: the gate's jest job had never
  # actually run in a main checkout.
  ( cd demo_api_server && npx jest --forceExit --maxWorkers=50% ${JEST_IGNORES[@]+"${JEST_IGNORES[@]}"} ) >"$log" 2>&1
  local rc=$?

  # Did jest actually run? A completed jest run ALWAYS prints a "Tests:" summary
  # line (even "Tests: 0 total"); "No tests found" and any crash-before-start
  # print none. So `rc != 0` with no summary means jest never started -- a bad
  # invocation, missing module, broken config, or the ignore-list override
  # misfiring -- NOT a test failure. Report that distinctly and dump the real
  # output, instead of "[failed twice — real]", which sends people hunting for a
  # broken test that does not exist. (This is exactly how the bash-3.2 empty-array
  # bug hid for so long: 0s exit, no output, labelled "real". Fixed in #557; this
  # keeps the NEXT such failure honest.)
  if [ "$rc" -ne 0 ] && ! grep -qE '^Tests:' "$log"; then
    printf 'ERROR (%ss)  [jest did not start — harness failure, not a test failure]\n' "$(( $(date +%s) - s ))"
    FAILED="$FAILED test:api-server"
    echo "  ---- jest produced no test summary; tail of its output ----"
    tail -15 "$log" | sed 's/^/  | /'
    rm -f "$log"; return 1
  fi

  # Retry once, re-running ONLY the suites that just failed (2s, not 45s).
  # This suite is flaky locally at ~1-2 failures per 6000 -- a different test each
  # run -- because a 16-core box spawns ~15 workers that contend with the running
  # Docker stack. CI's 2-core runner never sees it. A real break fails BOTH times;
  # flake passes on retry. Without this, a ~0.03% flake rate blocks pushes and
  # teaches everyone to reach for --no-verify, which also disables the pre-commit
  # secret guards.
  if [ "$rc" -ne 0 ]; then
    local rlog; rlog=$(mktemp)
    if ( cd demo_api_server && npx jest --forceExit --onlyFailures ${JEST_IGNORES[@]+"${JEST_IGNORES[@]}"} ) >"$rlog" 2>&1; then
      printf 'PASS  (%ss)  [flaky: %s passed on retry]\n' "$(( $(date +%s) - s ))" \
        "$(grep -oE 'Tests: .*' "$rlog" | tail -1 | sed 's/Tests: *//')"
      rm -f "$log" "$rlog"; return 0
    fi
    printf 'FAIL  (%ss)  [failed twice — real]\n' "$(( $(date +%s) - s ))"
    FAILED="$FAILED test:api-server"
    echo "  ---- failing tests (confirmed on retry) ----"
    grep -E '^  ● .*›' "$rlog" | sort -u | head -8 | sed 's/^/  | /'
    rm -f "$log" "$rlog"; return 1
  fi

  printf 'PASS  (%ss)  %s\n' "$(( $(date +%s) - s ))" "$(grep -oE 'Tests: .*' "$log" | tail -1)"
  rm -f "$log"
}

echo "local CI (GitHub Actions on this repo is billing-blocked — remote checks fail in ~3-4s with 0 steps executed; that red X is not a real result, this local run is authoritative)"
ensure_deps demo_api_server
ensure_deps demo_mcp_gateway

echo "job: Hygiene + topology gates"
run "hygiene:check"     hygiene:check
run "regression:paths"  regression:paths
run "topology:verify"   topology:verify
# Generated use-case docs/audit must match useCases.js — a prompt change that
# skips `npm run use-cases:gen` (demo_api_server/) silently ships stale docs
# (caught live 2026-07-17: #553's new per-vertical fields drifted a2a-delegation.md
# and nothing failed). Fix on failure: cd demo_api_server && npm run use-cases:gen
run "use-cases:check"   use-cases:check

echo "job: API server tests (Jest)"
run_api_tests

if [ -n "$FAILED" ]; then
  echo
  echo "LOCAL CI FAILED:$FAILED"
  echo "Reproduce a single check with: npm run <name>"
  echo "To push anyway (deliberately): git push --no-verify"
  exit 1
fi
echo
echo "local CI passed — all checks green"
exit 0
