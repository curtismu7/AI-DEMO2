# Live AI Gateway Integration Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicitly invoked integration suite that verifies the AI Gateway Client against real, preconfigured MCP Gateway doors using a short-lived test identity.

**Architecture:** Keep the existing mock-backed `node:test` suite as the default fast check. Add a separate integration suite under `server/integration/` that starts the existing relay locally and checks allowed access, policy denial, filtered tools, and aggregate namespaces against explicitly configured staging URLs. The ordinary live command accepts separate door-scoped bearer tokens; an interactive variant signs in to each app audience with the relay's existing PKCE/DCR flow and keeps both access tokens in process memory, with no token export or persistence.

**Tech Stack:** Node.js 22+, built-in `node:test`, existing Express relay, existing `dotenv` dependency, `fetch`.

**Spec:** User-provided `/Users/cmuir/Downloads/Privilege-AI-Platform-Update (2).pdf` (“MCP Gateway” and “MCP Aggregate” sections), constrained to the client flows in `standalone/ai-gateway-client/README.md` and the known door notes in `privilege/CURRENT-CONFIGURATION.md`.

## Global Constraints

- Node services require Node >=22.
- Run `npm ci` in `standalone/ai-gateway-client/server/` before its tests.
- `cd standalone/ai-gateway-client/server && npm test` stays fast, offline, and mock-backed; live tests run only via `npm run test:integration`.
- Live tests require an explicitly configured non-production gateway and fixture file; the ordinary command requires one short-lived bearer for each app audience, while the interactive command requires a TTY and signs the same enrolled test identity into each audience. Never fall back to the public demo or URLs from application defaults.
- Use one dedicated test principal and harmless read-only tools or deterministic stub tools. Never call a real transfer, delete, write, or credential-bearing tool.
- Do not create, edit, or delete gateway applications, identities, or policies from the test suite. Provision fixtures separately and treat the suite as read-only.
- Never print or persist bearer tokens. Store both ordinary-test tokens in an ignored local env file or protected CI secrets; fixture JSON contains URLs and tool inputs only.
- Interactive sign-in uses the existing relay callback for each app audience; the runner may hold both resulting bearers in process memory only and must not add a token export route or file.
- Keep NHI management/enforcement API tests separate. This suite can exercise an externally provisioned NHI bearer token against MCP doors, but that alone does not prove NHI discovery or NHI policy-management behavior.
- Do not run `docker compose` from the worktree. No UI changes are planned, so no UI build is required.

---

## File Map

- Create `standalone/ai-gateway-client/server/integration/support.js` for fixture validation, local relay startup, and authenticated API helpers.
- Create `standalone/ai-gateway-client/server/integration/gateway.integration.test.js` for the live allow/deny, filtered-tool, and aggregate scenarios.
- Create `standalone/ai-gateway-client/server/integration/gatewayChecks.js` to share live assertions between the node:test suite and interactive command.
- Create `standalone/ai-gateway-client/server/integration/interactive.js` and `interactive.test.js` for the opt-in TTY-based PKCE/DCR sign-in runner and its polling/terminal checks.
- Create `standalone/ai-gateway-client/server/integration/config.example.json` as a non-secret example fixture; add `server/integration/config.local.json` to the client `.gitignore` for operator-specific URLs and safe tool arguments.
- Modify `standalone/ai-gateway-client/server/package.json` to add the opt-in `test:integration` command without changing `npm test`.
- Create `standalone/ai-gateway-client/server/INTEGRATION_TESTS.md` with staging fixture setup, local secret handling, run command, and result interpretation; link it from the client README.

## Task 1: Add an opt-in fixture contract and command

**Files:**
- Modify: `standalone/ai-gateway-client/server/package.json`
- Modify: `standalone/ai-gateway-client/.gitignore`
- Create: `standalone/ai-gateway-client/server/integration/config.example.json`

**Interfaces:**
- `AI_GATEWAY_TEST_TOKEN` supplies the allowed-app audience bearer.
- `AI_GATEWAY_DENIED_TEST_TOKEN` supplies the denied-app audience bearer for the same test identity.
- `AI_GATEWAY_TEST_CONFIG` optionally selects a JSON fixture path; default to `integration/config.local.json` from the server package directory.
- Fixture schema:

```json
{
  "allowed": {
    "url": "https://staging.example.test/app-allow/mcp",
    "tool": { "name": "safe_read", "arguments": {} }
  },
  "deniedDoor": { "url": "https://staging.example.test/app-deny/mcp" },
  "filteredTool": {
    "url": "https://staging.example.test/app-tool-policy/mcp",
    "name": "safe_denied_stub",
    "arguments": { "fixture": "gateway-integration" }
  },
  "aggregate": {
    "url": "https://staging.example.test/aggregate/mcp",
    "tool": { "name": "member_alias__safe_read", "arguments": {} }
  }
}
```

- `npm run test:integration` runs `node -r dotenv/config --test integration/*.test.js`; `npm test` remains `node --test *.test.js`.

- [x] **Step 1: Add the fixture example and ignore rule.** Ignore only `server/integration/config.local.json`; keep the example tracked and token-free.
- [x] **Step 2: Add the script** `"test:integration": "node -r dotenv/config --test integration/*.test.js"` and verify the existing `npm test` script stays unchanged.
- [x] **Step 3: Run** `npm ci`, then `npm test` and `npm run` to verify the offline suite and new command are registered.
- [x] **Step 4: Commit** as `test(ai-gateway-client): add opt-in integration fixture config` (`c3e452949`).

## Task 2: Build a local relay harness for live tests

**Files:**
- Create: `standalone/ai-gateway-client/server/integration/support.js`
- Test: `standalone/ai-gateway-client/server/integration/support.test.js`

**Interfaces:**
- `readIntegrationConfig({ env, serverDir })` returns `{ token, deniedToken, fixture }` after validation. Injected environment/base-directory arguments let tests use dummy values without changing process environment.
- `withRelayServer(callback)` starts an Express app mounting the existing relay at `/api/gateway`, invokes `callback(baseUrl)`, calls `relay.__test.reset()`, and closes the server in `finally`.
- `configureDoor(baseUrl, url, token)` POSTs `{ gatewayMode: "privilege", mcpUrl: url }` with `Authorization: Bearer <token>`.
- `postGateway(baseUrl, path, token, body)` sends the bearer on every request so the relay uses the same principal throughout.

- [x] **Step 1: Write failing unit tests** for missing token, missing fixture, malformed JSON, missing required URLs/tool names, invalid URL schemes, and valid config parsing. Assert error text names missing variables/fields but never includes the token.
- [x] **Step 2: Run** `node --test integration/support.test.js`; confirm it fails because the support module is not implemented yet.
- [x] **Step 3: Implement `readIntegrationConfig()`** with those validations. Require HTTPS; allow loopback HTTP only when `AI_GATEWAY_ALLOW_HTTP_TEST_URLS=true`; reject embedded URL credentials and empty hostnames.
- [x] **Step 4: Add tests** that `configureDoor` and `postGateway` send the bearer header and JSON content type; implement those helpers and the `withRelayServer(callback)` lifecycle.
- [x] **Step 5: Test the harness with a local mock MCP endpoint**; verify it receives the exact bearer and cleanup runs even when the callback throws. Set temporary `DOOR_STORE_DIR` and `GATEWAY_ENV_PATH` before requiring `./lib/relay`.
- [x] **Step 6: Run** `node --test integration/support.test.js` and `npm test`.
- [x] **Step 7: Commit** as `test(ai-gateway-client): add isolated relay integration harness` (`fd0715ea3`).

## Task 3: Verify same-identity allow, deny, and door probing with per-door audiences

**Files:**
- Create: `standalone/ai-gateway-client/server/integration/gateway.integration.test.js`
- Test fixtures: `standalone/ai-gateway-client/server/integration/config.local.json` (ignored, supplied by the operator)

**Interfaces:**
- Use `fixture.allowed.url`, `fixture.deniedDoor.url`, `AI_GATEWAY_TEST_TOKEN`, and `AI_GATEWAY_DENIED_TEST_TOKEN` from `readIntegrationConfig()`. The two tokens must represent the same test identity and the distinct OAuth audiences advertised by each app.
- The test calls only `tools/list` on the denied app and `/doors/probe`; it does not invoke a denied live tool.

- [x] **Step 1: Write the integration case** `same identity uses door-scoped bearers for allowed access and policy denial`. Configure the allowed URL, call `/tools/list`, assert HTTP 200 and that the configured safe tool is present, then call that configured read-only tool and assert HTTP 200 with a nonempty MCP `result`. Probe the denied URL with the allowed app's token and expect an audience-boundary 401. Configure the denied URL with its own token, call `/tools/list`, and assert HTTP 403.
- [x] **Step 2: Add the probe assertions** while the allowed URL is current: POST `/doors/probe` with only the denied URL, then assert the route returns 200 with one `{ ok: false, status: 401 }` result. Assert failures include neither token.
- [x] **Step 3: Run the case against the staging fixture** interactively and inspect only statuses/tool names in output. The allowed token's cross-door probe returned 401, and the denied app's own audience token reached policy and received 403.
- [x] **Step 4: Run** focused integration tests (41/41), offline `npm test` (16/16), and the interactive live test against the configured staging fixture.
- [x] **Step 5: Commit** as `test(ai-gateway-client): verify live gateway allow and deny paths` (`eea254a7b`).

Live metadata discovery showed the allowed and denied app URLs advertise distinct resource/audience and authorization-server URLs. The earlier single-token probe correctly returned 401; this task now models that boundary and authenticates separately to verify the denied app's 403 policy response.

## Task 3A: Run live checks with in-memory interactive sign-in

**Files:**
- Modify: `standalone/ai-gateway-client/server/integration/support.js`
- Modify: `standalone/ai-gateway-client/server/integration/support.test.js`
- Create: `standalone/ai-gateway-client/server/integration/gatewayChecks.js`
- Modify: `standalone/ai-gateway-client/server/integration/gateway.integration.test.js`
- Create: `standalone/ai-gateway-client/server/integration/interactive.js`
- Create: `standalone/ai-gateway-client/server/integration/interactive.test.js`
- Modify: `standalone/ai-gateway-client/server/package.json`
- Create: `standalone/ai-gateway-client/server/INTEGRATION_TESTS.md`
- Modify: `standalone/ai-gateway-client/README.md`
- Modify: `standalone/ai-gateway-client/server/.env.example`

**Interfaces:**
- `readIntegrationConfig({ requireToken: false })` validates the same fixture while allowing the interactive command to start without `AI_GATEWAY_TEST_TOKEN`.
- `withRelayServer(callback)` passes a callback-scoped `getAccessToken()` accessor backed by the relay's existing in-memory test session; it adds no HTTP route and persists nothing.
- `gatewayChecks.runGatewayChecks({ baseUrl, fixture, token, deniedToken })` runs the audience and policy assertions with each token only in memory.
- `npm run test:integration:interactive` requires a TTY, prints the Gateway authorization URL, waits for the PKCE callback, then runs the checks in the same process.

- [x] **Step 1: Add failing support tests** proving interactive config validation works without a token, the callback-scoped accessor returns the relay session's bearer without an HTTP export, and request helpers omit `Authorization` when no token is provided.
- [x] **Step 2: Add failing interactive tests** proving the runner waits until `/state` reports authenticated, times out with a safe message, and rejects a non-TTY before starting authorization.
- [x] **Step 3: Run** `node --test integration/support.test.js integration/interactive.test.js`; verify the new expectations fail because the interactive interfaces do not exist.
- [x] **Step 4: Implement the smallest support changes**: optional token validation, optional Authorization header, callback-scoped in-memory accessor, and a generic callback landing page on the temporary relay.
- [x] **Step 5: Extract the existing live assertions** into `gatewayChecks.js`; keep the ordinary test wrapper token-required and behavior unchanged.
- [x] **Step 6: Implement the interactive command**: validate fixture and TTY before network access, run PKCE/DCR sign-in once for the allowed audience and again for the denied audience, instruct the operator to use the same test identity, poll only the public authenticated boolean, read each token through the in-memory accessor, run the shared assertions, then clean up the relay session.
- [x] **Step 7: Add** `"test:integration:interactive": "node -r dotenv/config integration/interactive.js"`; keep `npm test` and `test:integration` unchanged.
- [x] **Step 8: Run** focused support/interactive/gateway-check tests (41/41), `npm test` (16/16), and verify the two-token interface with the interactive live run. The ordinary secret-injected runner is not used for the live check because interactive sign-in keeps both tokens in memory.
- [x] **Step 9: Commit** as `test(ai-gateway-client): support in-memory interactive live auth` (`b364f1e8b`); scoped review passed with no blocking findings.

## Task 4: Verify policy-filtered tools and denied invocation

**Files:**
- Modify: `standalone/ai-gateway-client/server/integration/gateway.integration.test.js`
- Test fixture: `fixture.filteredTool`

**Interfaces:**
- `fixture.filteredTool` names a tool that the staging gateway policy denies and whose backend implementation is a harmless deterministic stub if the policy is accidentally absent.
- The client contract is `/tools/list` returns the allowed tools and a policy summary containing the filtered tool, then `/tools/call` for that safe denied stub returns HTTP 403.

- [ ] **Step 1: Add the case** `gateway filters a denied tool and rejects its call`. Configure the filtered-tool URL; assert the tool is absent from `body.tools`, present in `body.policy.filteredTools`, and `body.policy.filtered >= 1`.
- [ ] **Step 2: Call only the configured harmless denied stub** and assert HTTP 403. Do not use a transfer, deletion, write, or credential tool for this fixture.
- [ ] **Step 3: Run with the staging fixture.** If the gateway denies the entire app at listing time, treat that as the wrong fixture for this case; preserve the app-level denial test in Task 3 and provision a tool-level filtering fixture before accepting the test.
- [ ] **Step 4: Run** `npm test` and `npm run test:integration`.
- [ ] **Step 5: Commit** as `test(ai-gateway-client): verify live tool entitlement filtering`.

## Task 5: Verify aggregate namespace discovery and safe routing

**Files:**
- Modify: `standalone/ai-gateway-client/server/integration/gateway.integration.test.js`
- Test fixture: `fixture.aggregate`

**Interfaces:**
- `fixture.aggregate.tool.name` is a real namespaced tool such as `member_alias__safe_read`; its arguments must be read-only and deterministic.
- The response from `/tools/call` must retain the member server’s success result.

- [ ] **Step 1: Add the case** `aggregate exposes a namespaced member tool and routes its call`. Configure the aggregate URL, call `/tools/list`, and assert the exact configured namespaced name appears.
- [ ] **Step 2: Call the configured safe tool** with its fixture arguments; assert HTTP 200, `body.error === undefined`, and `body.result` is present. Do not assert on tenant-specific result text.
- [ ] **Step 3: Run against a fully authenticated staging aggregate.** The repo notes record that the aggregate had answered unauthenticated 401 but did not yet have a successful signed-in listing; configure and verify the aggregate fixture before treating this check as executable.
- [ ] **Step 4: Run** `npm test` and `npm run test:integration`.
- [ ] **Step 5: Commit** as `test(ai-gateway-client): verify live aggregate routing`.

## Task 6: Document fixture setup, operations, and limits

**Files:**
- Create: `standalone/ai-gateway-client/server/INTEGRATION_TESTS.md`
- Modify: `standalone/ai-gateway-client/README.md`
- Modify: `standalone/ai-gateway-client/server/.env.example`

- [ ] **Step 1: Document the staging prerequisites:** a dedicated non-production tenant, one allowed app, one app-level denied path, one tool-filtering policy on a harmless stub, and a working aggregate with a read-only member tool.
- [ ] **Step 2: Document the local run:** copy `integration/config.example.json` to ignored `integration/config.local.json`, fill only explicit staging URLs and safe tool arguments, set both door-scoped tokens for the same identity from secure local/CI secret sources, then run `npm run test:integration` from `server/`.
- [ ] **Step 3: Document outcomes:** explain that the allowed token's cross-door 401 is the audience boundary, the denied app's own token should get policy 403, and 5xx indicates infrastructure; exact Gateway prose is not asserted and tokens are never emitted.
- [ ] **Step 4: Document fixture health and expiry:** current repo notes last verified `opensearch22` as allowed on 2026-09-08, `opensearch` as a deliberate app-level 403, and did not record a successful signed-in aggregate listing. These are candidates for an operator smoke check, not immutable CI assumptions. Do not attach a policy to the shared `opensearch` app.
- [ ] **Step 5: Add commented settings** for both door-scoped token variables, `AI_GATEWAY_TEST_CONFIG`, and `AI_GATEWAY_ALLOW_HTTP_TEST_URLS` to `server/.env.example`; explain that secrets stay in the ignored local `.env` or protected CI variables.
- [ ] **Step 6: Document excluded tests:** no live mutation, no credential/user-vault forwarding, no AI Guard attack fixture, no direct-fallback proof (the existing mock test covers it), and no NHI provisioning/enforcement API assertions. Add a separate plan when an NHI test principal and its supported management API are identified.
- [ ] **Step 7: Run** `npm ci`, `npm test`, `node --test integration/support.test.js`, and one explicitly configured `npm run test:integration`; confirm normal `npm test` makes no external requests.
- [ ] **Step 8: Commit** as `docs(ai-gateway-client): document live integration tests`.

## Acceptance Criteria

- The default `npm test` remains offline and passes without integration secrets or gateway access.
- `npm run test:integration` fails before networking when fixture config or token is absent and runs only against explicit HTTPS URLs when configured; loopback HTTP requires the explicit opt-in flag.
- The live suite uses a separate audience token per door for allowed access, audience probing, and same-identity policy denial; tool filtering and aggregate routing remain planned follow-up cases.
- An operator can run the same live assertions through PKCE/DCR sign-in to each audience without exporting or persisting either bearer token.
- Every live tool call is configured as read-only or a deterministic harmless stub; tests never write gateway configuration or invoke a real business mutation.
- Test output and assertion failures never include bearer tokens.
- The integration runbook names the need for staging fixtures and distinguishes MCP app/tool policy from NHI Agent Enforcement.

## Separate Follow-up: NHI Agent Enforcement

NHI Agent Enforcement is not a route or identity-management feature in the standalone AI Gateway Client. A follow-up plan should first identify the supported NHI test-token issuance flow and policy API, provision a disposable NHI test principal, and define a harmless allowed/denied action. Do not claim this MCP integration suite proves NHI enforcement merely because it accepts a bearer token minted for an agent.
