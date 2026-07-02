# JWKS Follow-ups — Live Verification (invest route + aud_config_missing guard)

**Date:** 2026-07-02
**Branch:** `worktree-jwks-followups`
**Commit under test:** `f3d203b55` — "feat: JWKS validation for /mcp/invest + empty-aud fail-closed guard"

**Scope:** Two follow-up changes to the JWKS validation feature verified previously
(see `test-results/2026-07-02-jwks-validation-results.md`):

1. `ping-gateway/config/routes/00-mcp-invest-jwks.json` — new route: `/mcp/invest`
   requests carrying `X-Token-Validation: jwks` are validated locally by
   `jwks-token-validation.groovy` instead of the global-introspection `rsFilter`,
   with the rest of the chain mirroring `02-mcp-invest.json`
   (StripInvestPrefix → validator → McpValidationFilter → p1az-decision.groovy →
   OAuth2TokenExchangeFilter → proxy).
2. `ping-gateway/scripts/groovy/jwks-token-validation.groovy` — audience hardening:
   denies `aud_config_missing` (401) when both `PG_GATEWAY_RESOURCE_URI` and
   `PG_GATEWAY_RESOURCE_ID` are empty/unset, so an empty-string `aud` claim entry
   can never match by accident.

Not in scope: full 200 end-to-end against the live demo stack (real PingOne
tokens, live P1AZ decision, real OLB/invest token exchange) — the running Docker
stack serves the main checkout, not this worktree. This harness asserts
behavior at the validator layer (401-with-`"validation":"jwks"` vs
passed-validation), matching the method used in the prior verification run.

---

## Environment

- Throwaway container: `ping-gateway-jwks-fu-test`, compose project `-p jwks-fu-test`, published on host port **3038**.
- JWKS stub: `nginx:alpine` container `jwks-stub-fu-test` serving the scratchpad's freshly re-minted `jwks.json` on host port **9778**, reached from the gateway container via `host.docker.internal:9778`.
- Tokens minted with the prior run's `mint-tokens.js` (reused verbatim, re-run because tokens expire after 600s) inside a throwaway `node:20-alpine` container, mounting the scratchpad dir at `/private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/e2ea3b04-a2ed-4c26-b4a8-6abcd1eaf4a5/scratchpad/jwks-verify/`.
- Compose override: new file `compose.followups.yml` in the same scratchpad dir, copied from the prior run's `compose.override.yml` and edited with unique container name (`ping-gateway-jwks-fu-test`), unique port (`3038:8080`), unique JWKS stub port (`9778`), plus the invest-route env vars needed for `OAuth2TokenExchangeFilter`/`ReverseProxyHandler` to build: `PINGONE_TOKEN_ENDPOINT`, `PG_INVEST_SCOPE`, `PG_INVEST_RESOURCE_URI`, `PG_INVEST_BACKEND_URL` (pointed at the already-running `ai-demo-mcp-invest` backend on host port 8081 — read-only proxy target, not modified).
- `.env` for the worktree's `ping-gateway/docker-compose.yml` was copied from `/Users/cmuir/Development/AI-DEMO2/ping-gateway/.env` (contents never printed, file deleted after teardown).
- Tooling note (per prior run): bare `node`/`curl` calls used `docker run --rm` equivalents (`node:20-alpine` for minting, `curlimages/curl` with `--add-host=host.docker.internal:host-gateway` for HTTP calls) to stay inside pre-approved sandbox patterns.
- Isolation: this run never touched `ping-gateway`, `ai-demo-ping-gateway`, `ping-gateway-jwks-test`, or ports 3006/3036/3037. A concurrent, unrelated session's own throwaway container (project `gw-validate`, container name `ping-gateway`, port 3037) was observed running the whole time and was not interacted with.

---

## Step 1: Token minting

```
$ docker run --rm -v $SCRATCHPAD:/work -w /work node:20-alpine node mint-tokens.js
minted: rs256-valid, rs256-expired, rs256-wrong-aud, rs256-no-scope, rs256-bad-iss, hs256-valid, alg-none, rs256-tampered
```

JWKS stub reachability check:
```
$ docker run --rm --add-host=host.docker.internal:host-gateway curlimages/curl:latest -s http://host.docker.internal:9778/jwks.json
{"keys":[{"kty":"RSA","n":"l2C1qgGAvcnPcfHbN...","e":"AQAB","kid":"test-1","use":"sig","alg":"RS256"}]}
```

---

## Step 2: Boot check — route loads

```
$ docker compose -p jwks-fu-test -f docker-compose.yml -f $SCRATCHPAD/compose.followups.yml up -d
Network jwks-fu-test_default  Created
Container ping-gateway-jwks-fu-test  Started
```

Route-load evidence (~20s after boot):
```
[main] INFO  o.f.o.handler.router.RouterHandler @system - Loaded the route with id '00-mcp-invest-jwks' registered with the name 'mcp-invest-jwks'
[main] INFO  o.f.o.handler.router.RouterHandler @system - Loaded the route with id '02-mcp-invest' registered with the name 'mcp-invest-secondary'
[main] INFO  o.f.o.handler.router.RouterHandler @system - Loaded the route with id '01-mcp-olb' registered with the name 'mcp-olb-primary'
[main] ERROR o.f.o.handler.router.RouterHandler @system - An error occurred while building the route with the name 'oauth-passthrough'
[main] INFO  o.f.o.handler.router.RouterHandler @system - Loaded the route with id '00-mcp-olb-jwks' registered with the name 'mcp-olb-jwks'
[main] INFO  o.f.openig.launcher.Launcher @system - Gateway 16 verticles started on ports : [8080], Admin verticle started on port : 8085 in 1656ms
```

**All four required routes loaded with no errors: `mcp-invest-jwks`, `mcp-olb-jwks`, `mcp-olb-primary`, `mcp-invest-secondary`.** No Groovy compile error for the new/changed files.

**Observed but out of scope:** `oauth-passthrough` (`03-oauth-passthrough.json`) fails to build with the same pre-existing `ClassCastException` documented in the prior verification run (`java.lang.ClassCastException: Cannot cast org.forgerock.http.handler.Handlers$1 to org.forgerock.http.Filter`) — unrelated to either file changed by commit f3d203b55, not fixed here per scope.

---

## Step 3: Matrix (cases 1–6)

All calls via `docker run --rm --add-host=host.docker.internal:host-gateway curlimages/curl:latest ...` against `http://host.docker.internal:3038`. Body: `{"jsonrpc":"2.0","id":"1","method":"tools/list","params":{}}`, with `Content-Type: application/json` and `MCP-Protocol-Version: 2025-06-18` (needed so the request clears `McpValidationFilter` and reaches `p1az-decision.groovy`, which lets us see whether *validation* passed vs. failed, independent of the downstream authorization/exchange decision).

| # | Call | Expected | Actual | Result |
|---|------|----------|--------|--------|
| 1 | POST `/mcp/invest`, `rs256-valid` + `X-Token-Validation: jwks` | passes validator (log `[JWKS] validation ok: alg=RS256`); response not a `"validation":"jwks"` 401; `X-Token-Validation-Mode: jwks` header present | `403 Forbidden` `{"error":"access_denied","decision":"DENY","backend":"mock","tool":"","mcp_method":""}` (p1az-decision.groovy's mock policy denial — downstream of the validator, expected since this harness doesn't wire a real P1AZ decision). Header **present**: `X-Token-Validation-Mode: jwks`. Log: `[JWKS] validation ok: alg=RS256 sub=user-jwks-test aud=mcpgateway.ping.demo (local validation — no introspection call)` | **PASS** |
| 2 | POST `/mcp/invest`, `rs256-expired` + `jwks` | `401` reason `token_expired` | `401` `{"error":"invalid_token","validation":"jwks","reason":"token_expired"}` | **PASS** |
| 3 | POST `/mcp/invest`, `rs256-wrong-aud` + `jwks` | `401` reason `audience_mismatch` | `401` `{"error":"invalid_token","validation":"jwks","reason":"audience_mismatch"}` | **PASS** |
| 4 | POST `/mcp/invest`, `rs256-valid` + `X-Token-Validation: introspect` | handled by route 02 (no `"validation":"jwks"` anywhere in response) | `401`, body verified **empty** (0 bytes, confirmed via host-redirected curl output) — `WWW-Authenticate: Bearer error="invalid_token", error_description="The access token provided is expired, revoked, malformed, or invalid for other reasons."` (route 02's `rsFilter`/introspection path; the mock introspection endpoint isn't reachable/configured to accept this token in this harness, but critically no `"validation":"jwks"` string appears anywhere) | **PASS** |
| 5 | regression: POST `/mcp`, `rs256-valid` + `jwks` (route `00-mcp-olb-jwks` still works) | passes validator | `403 Forbidden` `{"error":"access_denied",...}` (same p1az mock-denial shape as case 1), `X-Token-Validation-Mode: jwks` header present. Log: `[JWKS] validation ok: alg=RS256 sub=user-jwks-test aud=mcpgateway.ping.demo (local validation — no introspection call)` | **PASS** |
| 6 | regression: POST `/mcp`, `rs256-tampered` + `jwks` | `401` (fail-closed) | `401` `{"error":"invalid_token","validation":"jwks","reason":"undecodable_jwt"}` — same reason-code discrepancy documented in the prior run (the brief's tamper method corrupts the payload's trailing JSON, which the script's JSON-parse try/catch (before signature check) catches first as `undecodable_jwt`; still correctly fail-closed with 401) | **PASS (fail-closed; reason code matches prior documented discrepancy, not a defect)** |

`[JWKS]` log excerpt covering cases 1–6:
```
[vert.x-eventloop-thread-1]  INFO ... @00-mcp-invest-jwks - [JWKS] fetched 1 key(s) from http://host.docker.internal:9778/jwks.json
[vert.x-eventloop-thread-1]  INFO ... @00-mcp-invest-jwks - [JWKS] validation ok: alg=RS256 sub=user-jwks-test aud=mcpgateway.ping.demo (local validation — no introspection call)
[vert.x-eventloop-thread-15] INFO ... @00-mcp-invest-jwks - [JWKS] validation FAILED: token_expired
[vert.x-eventloop-thread-13] INFO ... @00-mcp-invest-jwks - [JWKS] validation FAILED: audience_mismatch
[vert.x-eventloop-thread-12] INFO ... @00-mcp-olb-jwks    - [JWKS] fetched 1 key(s) from http://host.docker.internal:9778/jwks.json
[vert.x-eventloop-thread-12] INFO ... @00-mcp-olb-jwks    - [JWKS] validation ok: alg=RS256 sub=user-jwks-test aud=mcpgateway.ping.demo (local validation — no introspection call)
[vert.x-eventloop-thread-8]  INFO ... @00-mcp-olb-jwks    - [JWKS] validation FAILED: undecodable_jwt
```
Note: `00-mcp-invest-jwks` and `00-mcp-olb-jwks` each fetch the JWKS once independently (separate `ScriptableFilter` instances have separate `globals` scope) — expected, not a cache regression within either route.

---

## Step 4: Guard check — `aud_config_missing` (case 7)

Teardown of the first boot:
```
$ docker compose -p jwks-fu-test -f docker-compose.yml -f $SCRATCHPAD/compose.followups.yml down
Container ping-gateway-jwks-fu-test  Removed
Network jwks-fu-test_default  Removed
```

`compose.followups.yml` edited: `PG_GATEWAY_RESOURCE_URI: ""` and `PG_GATEWAY_RESOURCE_ID: ""`. Reboot:
```
$ docker compose -p jwks-fu-test -f docker-compose.yml -f $SCRATCHPAD/compose.followups.yml up -d
Container ping-gateway-jwks-fu-test  Started
```

Route-load evidence on this boot:
```
[main] INFO  o.f.o.handler.router.RouterHandler @system - Loaded the route with id '00-mcp-invest-jwks' registered with the name 'mcp-invest-jwks'
[main] INFO  o.f.o.handler.router.RouterHandler @system - Loaded the route with id '02-mcp-invest' registered with the name 'mcp-invest-secondary'
[main] ERROR o.f.o.handler.router.RouterHandler @system - An error occurred while building the route with the name 'mcp-olb-primary'
[main] ERROR o.f.o.handler.router.RouterHandler @system - An error occurred while building the route with the name 'oauth-passthrough'
[main] INFO  o.f.o.handler.router.RouterHandler @system - Loaded the route with id '00-mcp-olb-jwks' registered with the name 'mcp-olb-jwks'
[main] INFO  o.f.openig.launcher.Launcher @system - Gateway 16 verticles started on ports : [8080], Admin verticle started on port : 8085 in 1688ms
```

**Observed but out of scope:** with both `PG_GATEWAY_RESOURCE_URI` and `PG_GATEWAY_RESOURCE_ID` empty, route `01-mcp-olb.json` (`mcp-olb-primary`) now fails to build:
```
java.lang.NullPointerException: Cannot invoke "String.equals(Object)" because the return value of "java.net.URI.getScheme()" is null
	at org.forgerock.openig.mcp.ResourceId.resourceId(ResourceId.java:45)
Wrapped by: org.forgerock.openig.heap.HeapException: Invalid object declaration
```
This is `01-mcp-olb.json`'s `OAuth2ResourceServerFilter`/`ResourceId` config resolving the same env vars at **route-build (heap) time** and choking on an empty URI string — a config-time failure in a file untouched by commit f3d203b55, and specific to this synthetic "both vars empty" test scenario (a real deployment always sets at least one). It does not affect route `00-mcp-olb-jwks` (the target of case 7), which loaded cleanly because the Groovy script reads these env vars at **request time**, not heap-build time. Not fixed — out of scope for this verification and for the two changed files.

Case 7:
```
$ curl -si POST http://host.docker.internal:3038/mcp -H "Authorization: Bearer <rs256-valid>" -H "X-Token-Validation: jwks" ...
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="mcp",error="invalid_token",error_description="aud_config_missing"

{"error":"invalid_token","validation":"jwks","reason":"aud_config_missing"}
```

Log:
```
[vert.x-eventloop-thread-3] INFO ... @00-mcp-olb-jwks - [JWKS] fetched 1 key(s) from http://host.docker.internal:9778/jwks.json
[vert.x-eventloop-thread-3] INFO ... @00-mcp-olb-jwks - [JWKS] validation FAILED: aud_config_missing
```

| # | Call | Expected | Actual | Result |
|---|------|----------|--------|--------|
| 7 | POST `/mcp`, `rs256-valid` + `jwks`, `PG_GATEWAY_RESOURCE_URI`/`PG_GATEWAY_RESOURCE_ID` both empty | `401` reason `aud_config_missing` | `401` `{"error":"invalid_token","validation":"jwks","reason":"aud_config_missing"}` | **PASS** |

---

## Fixes applied

None. All 7 cases passed on the first run against the unmodified commit `f3d203b55` files.

---

## Teardown

```
$ docker compose -p jwks-fu-test -f docker-compose.yml -f $SCRATCHPAD/compose.followups.yml down
Container ping-gateway-jwks-fu-test  Removed
Network jwks-fu-test_default  Removed
$ docker stop jwks-stub-fu-test
jwks-stub-fu-test   (removed, started with --rm)
```

Post-teardown `docker ps` (relevant excerpt): `ping-gateway-jwks-fu-test` and `jwks-stub-fu-test` are gone. Only the pre-existing stack (`ai-demo-*`, `ai-demo-ping-gateway` on 3036) and one **unrelated concurrent session's own throwaway container** (`ping-gateway`, compose project `gw-validate`, port 3037 — inspected and confirmed to belong to a different worktree/session, not interacted with) remain running. The copied `ping-gateway/.env` in this worktree was deleted after use (confirmed absent).

---

## Summary

All 7 matrix cases behave correctly with no fixes required:
- The new `/mcp/invest` JWKS route (`00-mcp-invest-jwks.json`) validates locally exactly like the existing `/mcp` JWKS route, correctly passing valid tokens through to the p1az-decision stage and correctly rejecting expired/wrong-audience tokens with the right reason codes, while leaving the `introspect`-header path on `/mcp/invest` untouched (handled by route `02-mcp-invest.json`).
- The `aud_config_missing` fail-closed guard in `jwks-token-validation.groovy` correctly denies with `401`/`aud_config_missing` when both `PG_GATEWAY_RESOURCE_URI` and `PG_GATEWAY_RESOURCE_ID` are empty, and does not affect normal operation (case 5) when at least one is set.
- Regression cases against the original `/mcp` JWKS route (5, 6) confirm no behavior change from the two follow-up edits.

Two config-build-time failures were observed and are explicitly out of scope (unrelated files, pre-existing or scenario-specific): `oauth-passthrough` (pre-existing `ClassCastException`, documented in the prior verification run) and `mcp-olb-primary` failing to build only when both audience env vars are emptied (a `ResourceId`/`URI.getScheme()` NPE in `01-mcp-olb.json`, a file untouched by this commit).
