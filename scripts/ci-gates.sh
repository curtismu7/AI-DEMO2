#!/usr/bin/env bash
# Local mirror of the CI job "Hygiene + topology gates" (.github/workflows/ci.yml, job `gates`).
# `hygiene:check` alone omits the use-case drift gates and the bash gate tests, so a PR can pass
# it locally and still fail CI. Keep this list in step with that job.
# Usage: npm run ci:gates   (needs demo_api_server + demo_mcp_gateway node_modules)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
step() { echo "── $*"; }
step mock-drift;         node scripts/check-mock-drift.js
step hygiene:check;      npm run --silent hygiene:check
step use-case-gates
( cd demo_api_server &&
  npm run --silent use-cases:audit:check &&
  npm run --silent use-cases:docs:check &&
  node ../scripts/check-use-cases-maturity.js &&
  node ../scripts/gen-demo-runbook.js check &&
  node ../scripts/check-goldens.js &&
  node ../scripts/check-step-verification.js )
step regression:paths;   npm run --silent regression:paths
step root:allowlist;     npm run --silent root:allowlist:check
step authz:verify;       npm run --silent authz:verify
step auth-requirements;  node --test scripts/check-auth-requirements.test.js
step topology:verify;    npm run --silent topology:verify
step bash-gate-tests
bash scripts/test-se-undeploy-guard.sh
bash scripts/test-se-gateways.sh
bash scripts/test-k8-build-cwd.sh
echo "ci:gates: all passed"
