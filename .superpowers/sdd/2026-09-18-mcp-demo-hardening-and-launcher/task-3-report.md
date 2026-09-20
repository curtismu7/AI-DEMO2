# Task 3 report: fixed-scope launcher/status server

## Scope delivered

- Added `scripts/demo-launcher-server.mjs` with exported `createLauncherServer({ startStack, probe })` and `getAllowedServices()`.
- The server accepts only `GET /health`, `GET /`, `GET /api/status`, and `POST /api/start`; all other paths return `404` and unsupported methods return `405`.
- `listenOnLoopback` accepts only numeric loopback addresses, defaulting to `127.0.0.1`.
- Status probes are limited to local LibreChat, MCP gateway, authorization service, and JWT verifier health endpoints. Responses are normalized to `{ service, status, detail }` without dependency bodies or exception details.
- The start route rejects request bodies and invokes only the fixed local `./run-docker.sh` command through a callback. Startup and readiness calls have bounded timeouts.
- Added a static-page serving hook for Task 4. Until its page exists, `GET /` returns a bounded `503` without exposing file-system details.
- Added the required `demo:launcher` package command.

## Tests and checks

Initial red run:

```text
node --test scripts/demo-launcher-server.test.mjs
ERR_MODULE_NOT_FOUND: demo-launcher-server.mjs
```

Final verification:

```text
node --test scripts/demo-launcher-server.test.mjs
7 tests passed, 0 failed

node --check scripts/demo-launcher-server.mjs
exit 0

git diff --check
exit 0
```

Tests use the Node request handler directly with injected `startStack` and `probe` callbacks. They do not run Docker, open a listening socket, or reach external network endpoints.

## Self-review

- User input cannot select an executable, command arguments, target URL, or service list.
- The default startup callback has a fixed working directory and uses `spawn` with `shell: false`.
- Status output uses constant details only and omits probe response bodies and thrown error messages.
- A timed-out startup remains single-flight until its underlying operation settles, preventing a second concurrent stack start.
- The static-page hook is intentionally limited to `/`; Task 4 will add the constrained page and asset routing.

## Files staged for commit

- `scripts/demo-launcher-server.mjs`
- `scripts/demo-launcher-server.test.mjs`
- `package.json`

## Follow-up hardening fix

- `POST /api/start` now rejects a foreign `Origin` and `Sec-Fetch-Site: cross-site` before invoking the fixed startup callback. Headerless local CLI requests remain accepted.
- Rejected body-bearing requests are resumed so their streams are drained before the connection is reused.
- Added an integration-level ephemeral bind test: `listenOnLoopback` successfully binds a real server to `127.0.0.1`, rejects `0.0.0.0`, and the test closes its listener in teardown.

Verification:

```text
node --test scripts/demo-launcher-server.test.mjs
11 tests passed, 0 failed

git diff --check
exit 0
```
