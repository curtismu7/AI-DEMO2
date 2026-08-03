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
#   6. PingGateway tool-schema drift             (demo_mcp_gateway/toolSchemaDrift)
#   7. tool scope-audience coverage              (allowedScopesByAudience.parity)
#   8. hand-authored PaC policy tool lists       (check-pac-policy-drift.js)
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

step "1/8 vertical manifests -> topology (verticals:check)"
( cd demo_api_server && npm run --silent verticals:check ) || fail=1

step "2/8 schema + running code + referential integrity + P1AZ constants"
# --runTestsByPath runs ONLY this exact file (no directory scan, so it can never
# collect another checkout's copy), and the ignore override keeps it runnable
# inside .claude/worktrees — the repo's jest config ignores that path, which would
# otherwise break the gate for the mandated worktree commit workflow. --no-coverage
# keeps it fast.
( cd demo_api_server && npx --no-install jest --runTestsByPath src/__tests__/scopeTopology.regression.test.js --testPathIgnorePatterns='/node_modules/' --no-coverage --forceExit ) || fail=1

step "3/8 P1AZ cloud policy snapshot (snapshot:check)"
# snapshots/ is gitignored (local-only import artifact). Only verify it where it
# exists (developer/main checkout); skip gracefully on a fresh clone / CI / worktree.
if [ -f snapshots/gen-authorize-snapshot.js ]; then
  node snapshots/gen-authorize-snapshot.js --check || fail=1
else
  echo "[skip] snapshots/gen-authorize-snapshot.js not present (gitignored local artifact) — skipping P1AZ snapshot check."
fi

step "4/8 PingGateway env/config parity"
node scripts/verify-pinggateway-parity.js || fail=1

step "5/8 mock PingOne Authorize rule-store parity"
( cd demo_authz_server && node --test topology.parity.test.js ) || fail=1

step "6/8 PingGateway tool-schema drift (mcp-tool-schemas.json)"
# mcp-tool-schemas.json (what PingGateway reads to know which MCP tools exist) is
# generated from the tool registry by `gen:tool-schemas`. Fails if a tool was
# added/renamed/removed without regenerating — PingGateway would then reject it
# with "Unknown tool". Fix: npm --prefix demo_mcp_gateway run gen:tool-schemas
( cd demo_mcp_gateway && npm test -- --testPathPattern=toolSchemaDrift --testPathIgnorePatterns='/node_modules/' --no-coverage --forceExit ) || fail=1

step "7/8 tool scope-audience coverage (configStore allowlist)"
# Every gateway-surface tool's requiredScopes must be present in the RFC 8707
# scope-audience allowlist for the MCP Gateway (and MCP Server, minus gateway-only
# scopes). A missing scope = SCOPE_MISMATCH at token exchange before the gateway.
# Fix: add the scope to buildAllowedScopesByAudience() in configStore.js.
( cd demo_api_server && npx --no-install jest --runTestsByPath src/__tests__/allowedScopesByAudience.parity.test.js --testPathIgnorePatterns='/node_modules/' --no-coverage --forceExit ) || fail=1

step "8/8 hand-authored PaC policy tool lists (pac/policies/*.yaml)"
# pac/policies/*.yaml is the one link in this chain with no generator: its rule
# tool lists are hand-typed. #1279 added sensitive_passenger_record as an
# a2aDelegated tool and nobody added it to DenyA2aDelegationRequired, so the rule
# could never fire against it. This derives the expected list from
# scope-topology.json and compares both ways. Self-test: node --test
# scripts/check-pac-policy-drift.test.js
node scripts/check-pac-policy-drift.js || fail=1

printf '\n'
if [ "$fail" -ne 0 ]; then
  printf '\033[31m❌ topology:verify FAILED — scope-topology.json drifts from something above.\033[0m\n'
  printf '   Fix the drift (or regenerate: npm run scopes:doc / npm --prefix demo_api_server run scopes:gen).\n'
  exit 1
fi
printf '\033[32m✅ topology:verify PASSED — scope-topology.json is in sync (offline checks).\033[0m\n'
