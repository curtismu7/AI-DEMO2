#!/usr/bin/env bash
#
# topology-verify.sh — the offline "no drift" gate for scope-topology.json.
#
# Proves the scope SSOT is in lock-step with everything that consumes it, WITHOUT
# touching the network or PingOne credentials, so it can run in pre-commit / CI:
#   1. vertical manifests -> topology            (verticals:check)
#   2. schema + running-code consumers + full referential integrity + P1AZ
#      decision-path constants                   (scopeTopology.regression jest)
#   3. P1AZ cloud policy snapshot                (snapshot:check)
#   4. PingGateway env/config parity             (verify-pinggateway-parity.js)
#   5. mock PingOne Authorize rule store parity  (demo_authz_server/topology.parity)
#
# The LIVE PingOne diff (needs worker creds + network) is intentionally NOT here.
# Run it deliberately with:  npm run topology:verify:live
#
# Runs every step (does not stop at the first failure) so one commit shows all
# drift at once, then exits non-zero if any step failed.

set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0
step() { printf '\n\033[36m── %s ──\033[0m\n' "$1"; }

step "1/5 vertical manifests -> topology (verticals:check)"
( cd demo_api_server && npm run --silent verticals:check ) || fail=1

step "2/5 schema + running code + referential integrity + P1AZ constants"
# --runTestsByPath runs ONLY this exact file (no directory scan, so it can never
# collect another checkout's copy), and the ignore override keeps it runnable
# inside .claude/worktrees — the repo's jest config ignores that path, which would
# otherwise break the gate for the mandated worktree commit workflow. --no-coverage
# keeps it fast.
( cd demo_api_server && npx --no-install jest --runTestsByPath src/__tests__/scopeTopology.regression.test.js --testPathIgnorePatterns='/node_modules/' --no-coverage --forceExit ) || fail=1

step "3/5 P1AZ cloud policy snapshot (snapshot:check)"
# snapshots/ is gitignored (local-only import artifact). Only verify it where it
# exists (developer/main checkout); skip gracefully on a fresh clone / CI / worktree.
if [ -f snapshots/gen-authorize-snapshot.js ]; then
  node snapshots/gen-authorize-snapshot.js --check || fail=1
else
  echo "[skip] snapshots/gen-authorize-snapshot.js not present (gitignored local artifact) — skipping P1AZ snapshot check."
fi

step "4/5 PingGateway env/config parity"
node scripts/verify-pinggateway-parity.js || fail=1

step "5/5 mock PingOne Authorize rule-store parity"
( cd demo_authz_server && node --test topology.parity.test.js ) || fail=1

printf '\n'
if [ "$fail" -ne 0 ]; then
  printf '\033[31m❌ topology:verify FAILED — scope-topology.json drifts from something above.\033[0m\n'
  printf '   Fix the drift (or regenerate: npm run scopes:doc / npm --prefix demo_api_server run scopes:gen).\n'
  exit 1
fi
printf '\033[32m✅ topology:verify PASSED — scope-topology.json is in sync (offline checks).\033[0m\n'
