# Task 4 report: demo operator launcher

## Scope

Implemented only the Task 4 operator surface:

- `docs/demo-launcher/index.html`
- `scripts/start-demo-launcher.sh`
- `scripts/demo-launcher-page.test.mjs`
- `scripts/demo-launcher-server.mjs`

## Delivered behavior

- Static, accessible operator page with usable no-JavaScript instructions.
- Fixed `Check services`, `Start LibreChat`, and `Open LibreChat` controls.
- Canonical PingOne browser origin, Policy Guardrails flow, matching MCP selection, prompts, status colors, reconnect behavior, 403 and 503 lessons, troubleshooting, and targeted commands.
- Page JavaScript calls only the fixed `/api/status` and `/api/start` routes. It neither accepts query-string destinations nor exposes credential values.
- Static server accepts only `/` and `/index.html`; all other paths continue through the existing 404 path.
- Startup wrapper uses `set -euo pipefail`, resolves the repository root, runs the supported `./run-docker.sh` entry point, starts the fixed loopback launcher server, waits for its health route, prints the URL, and optionally opens it when `DEMO_LAUNCHER_OPEN=1`.

## Verification

- Red: `node --test scripts/demo-launcher-page.test.mjs` failed because `docs/demo-launcher/index.html` did not exist.
- Green: `node --test scripts/demo-launcher-page.test.mjs scripts/demo-launcher-server.test.mjs` passed: 13 tests, 0 failures.
- Static serving smoke test passed for `/` and `/index.html`; `/docs/demo-launcher/index.html` returned 404.
- `bash -n scripts/start-demo-launcher.sh`, `node --check scripts/demo-launcher-server.mjs`, and `git diff --check` passed.

## Commit

`c0acde690 feat: add demo operator launcher`

## Concerns

None. The wrapper intentionally uses the existing supported `run-docker.sh` flow and does not run raw Compose commands from the worktree.

## Follow-up fix

- The wrapper now fixes the launcher host at `127.0.0.1` and overwrites the server host environment, so a caller-provided `DEMO_LAUNCHER_HOST` cannot cause a curl or browser-open request to leave loopback.
- Startup now invokes the supported `./run-docker.sh optional start demo-auth` command after the base stack, so the MCP gateway, authorization service, and JWT verifier readiness cards match the demo startup flow. `set -euo pipefail` propagates either command's failure.
- The server rejects raw dot-segment request paths before WHATWG URL normalization. Coverage includes `/../`, `/%2e%2e`, and `/%2e%2e/index.html`.

## Follow-up verification

- `node --test scripts/demo-launcher-page.test.mjs scripts/demo-launcher-server.test.mjs` — 15 passed, 0 failed.
- `bash -n scripts/start-demo-launcher.sh`, `node --check scripts/demo-launcher-server.mjs`, and `git diff --check` passed.

## Follow-up concerns

None.

## Round 2 follow-up fix

- The launcher server's default `/api/start` startup path now runs the supported core `./run-docker.sh` command followed by `./run-docker.sh optional start demo-auth`; a failed core command prevents the optional command and propagates failure.
- The startup wrapper validates `DEMO_LAUNCHER_PORT` as a decimal integer from 1 through 65535 before constructing, curling, printing, or opening `LAUNCHER_URL`.
- Focused coverage proves the two startup commands run in order, core failure stops the optional command, and malicious or out-of-range ports (`3090@external.example`, `0`, `65536`, `-1`) exit before any startup action.

## Round 2 verification

- `node --test scripts/demo-launcher-page.test.mjs scripts/demo-launcher-server.test.mjs` — 18 passed, 0 failed.
- `bash -n scripts/start-demo-launcher.sh`, `node --check scripts/demo-launcher-server.mjs`, and `git diff --check` passed.

## Round 2 concerns

None.
