# Regression Plan — Super Banking demo

Canonical do-not-break contract for the Super Banking demo. The
`regression-guard` skill (`.claude/skills/regression-guard/`) is the discipline
layer that points here; `CLAUDE.md` also points here. This file is the source of
truth — if the skill and this file disagree, this file wins.

---

## §0 — UI style rules (hard)

- **Emoji rule (project-wide):** the only emojis allowed in skills, commands,
  code, and UI text are `⚠️` (warning), `✅` (green check), `❌` (red X),
  `🔐` (security/lock — HITL trigger chips), `✕` (close / dismiss), `✓`
  (check / confirm), `👤` (HITL consent marker), `🔑` (step-up / MFA
  marker), `🪟` (pop out to new window — draggable modals/panels), and
  `📚` (knowledge grounding — Knowledge Grounding flag + citation footer).
  Everything else is plain text or CSS icons / semantic HTML.
- **No muted modal text:** modals use solid high-contrast colors, never
  low-contrast gray hint text.
- **Minimal diff:** name the component, name the element, change only that. No
  "while I'm here" cleanup of adjacent code.
- **UI build gate:** after any `demo_api_ui/` change, `cd demo_api_ui && npm run
  build` must exit `0` before the work is complete.

---

## §1 — Critical do-not-break areas

Before editing any file below, state what you will NOT break, then make a
minimal diff.

| Area | Files |
|---|---|
| OAuth admin login | `routes/oauth.js`, `config/oauth.js`, `demo_api_server/.env` |
| OAuth user login | `routes/oauthUser.js`, `config/oauthUser.js` |
| PingOne authorize `resource` + mixed scopes | `utils/oauthAuthorizeResource.js`, `routes/oauthUser.js`, `routes/oauth.js` |
| CRA proxy setup | `demo_api_ui/src/setupProxy.js`, `demo_api_ui/.env` |
| Session persistence | `server.js`, `routes/oauth.js` (`req.session.save()`) |
| Session store callback discipline | `services/lmdb/sessionStore.js` — must call `cb(err)` on every store op |
| Token audience check | `middleware/auth.js` — never hardcode `aud` defaults |
| Status endpoint token expiry | `routes/oauthUser.js`, `routes/oauth.js` — check `expiresAt` |
| REAUTH_KEY re-auth guard | `UserDashboard.js` — clear key only on success |
| Agent form account IDs | `AIAgent.js` `liveAccounts` state |
| Transfer HITL enforcement | `services/transactionConsentChallenge.js`, `routes/transactions.js` (428 enforcement) |
| Demo accounts on cold-start | `accounts.js`, `demoScenario.js` — save/restore snapshot order |
| Middle layout start state | `UserDashboard.js` `middleAgentOpen` init |
| Bottom dock on dashboard routes | `App.js`, `EmbeddedAgentDock.js` |
| Admin role detection | `routes/oauthUser.js` 4-signal check |
| Customer-only data endpoints | `middleware/auth.js` `requireNotAdmin`, `routes/accounts.js` + `routes/transactions.js` (`/my`) — admin tokens must 403 |
| configStore / Config UI | `services/configStore.js`, `routes/adminConfig.js` |
| AI Agent FAB (`banking-agent-fab` classes) | `components/AIAgent.js`, `App.js` |
| Float panel resize | `AIAgent.js` resize caps (`MAX_W`/`MAX_H` = 95% viewport, `MIN_W`/`MIN_H` = 280/220; drag itself intentionally unclamped for second-monitor use), `AIAgent.css` float-root/panel rules |
| Agent mode taxonomy SSOT | `demo_api_ui/src/config/agentModes.js` — one client mode→provider table; must equal server `services/agentModeResolver.js` (guarded by `config/__tests__/agentModes.test.js`); don't re-inline in `AIAgent.js`/`AgentModeSelector.jsx` |
| OAuth redirect origin | `routes/oauth*.js` — no `localhost` hardcodes |
| Clinical split dashboard (`ff_agent_clinical_split`) | `demo_api_ui/src/components/agent-clinical/` — `AgentClinicalHost.jsx` owns tab state + 1/2/3/4 keyboard; `TalkPane.jsx` hosts the inline agent (auto-open, `setClinicalSplit`) + `TokenAuditTimeline` (live `TokenChainContext` events); `InspectPane.jsx` wraps `ActivityLogPanel`; `TokensPane.jsx` embeds `UnifiedTokenFlowInspector`; `ConfigurePane.jsx` wraps `AuthorizeRulesPanel` + read-only runtime card. Legacy dashboard with the flag OFF must stay unchanged |
| Code Explorer SSE | `demo_api_ui/nginx.conf`, `k8s/02-configmap.yaml` nginx-config, `k8s/aws/nginx-http-configmap.yaml`, `k8s/aws/se-ingress.yaml`, `demo_api_server/routes/codegraphProxy.js`, `langchain_agent/src/codegraph/agent.py` — `/api/codegraph/` must keep `proxy_buffering off` + 300s timeouts; agent must emit SSE keepalives while waiting on the LLM. Guarded by `scripts/check-codegraph-sse-nginx.js` + `k8s/smoke.sh` check 7 |
| Code Explorer index DB | Demo index is **`.codegraph/demo-codegraph.db` only** — never `.codegraph/codegraph.db` (host CodeGraph product daemon). `CODEGRAPH_DB_PATH` / bake (`setup:fresh` / `run.sh` / `se-update-code.sh`) / Refresh must keep that split; `builder=demo-build-codegraph` marker required; FTS stopwords + retrieve blend required. Guarded by `npm run hygiene:check` + `npm run test:codegraph-index` (CI gates job), `scripts/check-codegraph-demo-index.js` (+ negatives), `langchain_agent/src/codegraph/index_guard.py`, + `langchain_agent/tests/test_codegraph_index_guard.py`, `langchain_agent/tests/test_build_codegraph.py`, `langchain_agent/tests/test_ensure_index.py`, `langchain_agent/tests/test_retrieve.py` |

---

## §3 — Ports (authoritative from `run.sh`)

| Port | Service | Scheme |
|---|---|---|
| `3001` | Banking API Server (BFF) | `https://api.ping.demo:3001` |
| `4000` | Banking UI (React) — public origin, OAuth callbacks land here | `https://local.ping-devops.com:4000` |
| `3005` | MCP Gateway | `https://api.ping.demo:3005` |
| `3006` | Agent Service | `http://localhost:3006` |
| `3009` | HITL Service | `http://localhost:3009` |
| `8080` | Banking MCP Server | `ws://localhost:8080` |
| `8081` | MCP Invest Server | `ws://localhost:8081` |
| `8082` | Mortgage Service | `http://localhost:8082` |
| `8888` | LangChain Agent (uvicorn main) | `http://localhost:8888` |
| `8889` | LangChain Agent (chat WS) | `ws://localhost:8889` |
| `8890` | LangChain Agent (health) | `http://localhost:8890` |

**`local.ping-devops.com` is the canonical local BROWSER origin** (HTTPS via
`mkcert`); `api.ping.demo` remains valid and is still the docker-compose network
alias used for intra-network TLS. Both are SANs on the same
`certs/api.ping.demo+2.pem` — that filename is a fixed constant, not derived
from the host or SAN count, because ~10 files hardcode it.

Why two: passkeys only work on `local.ping-devops.com`. WebAuthn requires the
FIDO2 `rp.id` to be the origin's host or a registrable parent of it, and PingOne
rejects any `rp.id` whose TLD isn't public (`CONSTRAINT_VIOLATION … "must be a
valid domain name with a valid TLD"`). So `api.ping.demo` can never be a
relying-party id, while `rp.id=ping-devops.com` covers both
`local.ping-devops.com` and `ai-demo.ping-devops.com` from one PingOne
environment. Set via `FIDO2_RP_ID`.

Code must not hardcode `localhost:3001` / `localhost:4000` in OAuth callbacks —
read the configured host. A new browser origin must be added to ALL of:
`CORS_ORIGIN` (comma-separated), `vite.config.js` `allowedHosts`, `nginx.conf`
`server_name`, the mkcert SAN lists in `scripts/ensure-dev-certs.sh` and
`run.sh`, and both `KNOWN_REDIRECT_ORIGINS` arrays
(`services/knownRedirectOrigins.js`, `services/pingoneProvisionService.js`).

---

## §4 — Bug Fix Log

Reverse-chronological, newest first.

### 2026-08-02 — Intent Token minted with NO `permitted_tools` claim when the request named a prototype key (#1258)

**Files changed:** `demo_api_server/services/intentTokenService.js`,
`demo_api_server/services/nlIntentParser.js`,
`demo_api_server/services/geminiNlIntent.js`,
`demo_api_server/services/demoAgentLangGraphService.js`,
`demo_api_server/scripts/check-vertical-coercion.js`,
`demo_api_server/tests/services/verticalLookup.prototypeKeys.test.js` (new).

**What was broken:** `permittedToolsForIntent` looked up two plain-object maps
with a bare subscript and no own-property guard —
`INTENT_TO_PERMITTED_TOOLS[intent]` and `READ_ONLY_TOOLS_BY_VERTICAL[vertical]`
(`services/intentTokenService.js:175` and `:180` before the fix). Both keys
arrive from the request, and `parseVerticalParam`'s `VALID_VERTICAL_RE`
(`/^[a-z][a-z0-9-]*$/`, `services/nlIntentParser.js:818`) accepts `constructor`,
so the lookup resolved the INHERITED `Object` constructor instead of `undefined`
and the `||` fallback written for a miss never fired. `permitted_tools` became a
function, and `JSON.stringify` DROPS a function value — the minted token carried
no `permitted_tools` claim at all (`intentTokenService.js:205` feeds `sign()`).
Reached through the real route: `POST /api/agent/invoke`
(`routes/agentInvokeRoute.js:125`, mounted at `server.js:1107`) with
`vertical:"constructor"` and any prompt `extractIntentAndConfidence`
(`nlIntentParser.js:212`) leaves at `intent:'unknown'` — the common case, not an
exotic one.

Three sibling lookups carried the same defect and were guarded in the same PR:
`FEATURE_TRIGGERS` (`nlIntentParser.js` — `?.` guards only nullish, so
`featureTrigger?.test(t)` was called on a function that has no `.test`;
`POST /api/demo-agent/nl {vertical:"constructor"}` answered a hard HTTP 500
`nl_parse_failed`), `THEME_OVERRIDES` (`geminiNlIntent.js` — the `Object`
constructor's native-code source was string-concatenated into the LLM system
prompt), and `READ_PRIMARY_TOOL_BY_VERTICAL` (`demoAgentLangGraphService.js` —
truthy, so the caller's `if (activityTool)` passed and
`verticalDispatch.executeToolFor` was handed a function where a tool name
belongs).

**Effect verified, not assumed:** the dropped claim did NOT silently disable the
control. Both gateways test membership with a list check that an absent claim
fails — `Array.isArray(payload.permitted_tools) && …includes(toolName)`
(`demo_mcp_gateway/src/intentTokenValidator.ts:99-100`) and
`(permitted instanceof List) && permitted.contains(toolName)`
(`ping-gateway/scripts/groovy/p1az-decision.groovy:434`) — so `IntentMatchesTool`
went to `'false'` with `IntentTokenValid` still `'true'`, which is precisely the
mock authz server's Rule 4b DENY (`demo_authz_server/routes/decision.js:954`).
The BFF holds no local `permitted_tools` enforcement; its `?? []` reads
(`server.js:2031`, `routes/agentRun.js:288`, `routes/agentInvokeRoute.js:256`,
`services/agentMcpTokenService.js:276`) are Token Chain display payloads only. So
the observable damage was a denied tool call plus an empty permitted-tools list
in the rail — a fidelity and evidence bug on a fail-closed path, not an authz
bypass. The comment at `scripts/check-vertical-coercion.js:264` still asserts
"every consumer reads absent as unrestricted"; that reading is wrong for the
enforcement path and should be treated as stale.

**What was fixed:** an `Object.prototype.hasOwnProperty.call(map, key)` guard on
all four lookups — the same one-liner, for the same reason, as the precedent
already in `config/fallback-chips/loader.js:24-26` (#1214).
`intentTokenService` wraps it in a local `ownEntry(map, key)`. Own keys behave
identically, so no real vertical's permitted-tools list, feature trigger, prompt
theme or activity tool changes. The coercion gate's
`KNOWN_UNFIXED_PROTOTYPE_LOOKUP` pin was emptied rather than deleted, so
`constructor` and `toString` now flow into the bogus-id sweep instead of being
excluded from it, and re-adding a key stays the documented way to record a
revert.

**Do not break:** the guard must stay on all four lookups, and any NEW
`map[requestSuppliedKey]` lookup needs the same treatment — the maps are plain
objects, so every one of them inherits `constructor`, `toString`, `valueOf` and
`hasOwnProperty`. Do not "simplify" `ownEntry` back to a bare subscript.
**Never assert this class with `JSON.stringify`:** it renders a function as
`undefined` and drops the key, so an inherited-key hit reads as a clean pass —
that false-safe made this exact bug look harmless to two separate
investigations. Assertions must use `typeof` / `Array.isArray`.

Two follow-ups are open, so the class is not fully closed. (1) An absent
`permitted_tools` is fail-closed at both gateways today, but nothing *requires*
that: the guard closed the mint path we found, and a fail-closed rule at mint
time (refuse to sign a token whose `permitted_tools` is not an array) would close
the ones we have not. Branch `intent-token-fail-closed` is reserved for it and
carries no commits beyond `main` yet. (2) A class-level fix —
`Object.assign(Object.create(null), {…})` at each map definition, or a shared
`lookupByVertical(map, id)` helper — would let all four hand-written guards be
deleted. Not yet done.

**Verify:** `demo_api_server/tests/services/verticalLookup.prototypeKeys.test.js`
— 32 tests (`5N + 7`, matrixed with `it.each` over
`['constructor','__proto__','toString','valueOf','hasOwnProperty']`), plus
controls asserting that real verticals still resolve their own tool, trigger,
theme and read-tool list. `__proto__` is in the matrix but is rejected by
`VALID_VERTICAL_RE`'s leading-character rule — the map, not the router, is where
this has to be safe. Each guard was proven by individual revert-to-RED. The
coercion gate (`node demo_api_server/scripts/check-vertical-coercion.js`, wired
into root `npm run hygiene:check`) exits 0.

### 2026-08-02 — Privilege MCP sign-in stuck on "Client ID is required before auth start."

**Files changed:** `demo_api_server/routes/privilegeMcpClient.js`,
`demo_api_server/tests/routes/privilegeMcpClient.config.test.js` (new).

**What was broken:** `POST /api/privilege-mcp/config` merged the request body
over the session config unconditionally, blank strings included. The client page
posts its whole local config immediately before `/auth/start` (and before
`/chat`), and that local config starts empty — it is only filled once the
mount-time `/state` fetch resolves. One click made before that resolved sent
`clientId: ""`, which overwrote the value seeded from `PRIVILEGE_SSO_CLIENT_ID`.
The overwrite stuck for the life of the session (`clientSessions` is an in-memory
Map keyed by session id), so `/state` then returned a blank clientId, the page
re-rendered blank, and every later click re-posted blank —
`400 {"error":"Client ID is required before auth start."}` forever, with a
correctly configured environment. Only a BFF restart cleared it.

**What was fixed:** `/config` now filters `undefined`/`null`/`""` out of the body
before merging — blank means "unchanged", not "clear this". Non-blank values
still overwrite, so the settings panel keeps working.

**Do not break:** the OAuth PKCE flow, `redirect_uri` derivation from
`x-forwarded-host`, `session.pendingAuth`, and the `/auth/start` clientId guard
itself are unchanged — the guard is correct, it was being fed a blanked config.
Do not "simplify" the merge back to `{ ...session.config, ...req.body }`.

**Verify:** `cd demo_api_server && CI=true npx jest --testPathPattern='step-up-gate|authorize-gate|runtime-settings-api|transaction-flows|demo-scenario-api|privilegeMcpClient' --testPathIgnorePatterns="/node_modules/" "/tests/real/" --forceExit`
→ 10 suites, 105 tests, 0 failed. Revert-to-RED confirmed: with the old
one-line merge restored, the new spec fails `Expected: "seeded-client-id"
Received: ""`.

### 2026-08-02 — HITL consent (UC8) was decided by BFF code, and no gateway could emit a 428

**Files changed:** `ping-gateway/scripts/groovy/p1az-decision.groovy`,
`demo_hitl_service/src/receiptVerification.js` (new),
`demo_hitl_service/src/routes/challenges.js`,
`demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`,
`demo_api_server/services/mcpGatewayClient.js`,
`demo_api_server/services/mcpToolAuthorizationService.js`,
`demo_api_server/scripts/refresh-service-envs.js`.

**What was broken:** three things, all pointing the same way. (1) PingGateway —
the gateway the BFF actually calls in Docker
(`MCP_GATEWAY_HTTP_URL: http://ping-gateway:8080`) — flattened every PingOne
Authorize `INDETERMINATE` to a 403 and said so in a comment: *"HITL is not
handled at this layer."* There was no consent path through the production
gateway at all. (2) The Node gateway did run HITL but answered **403** for it, so
"a human must approve" and "you may not do this" were the same status on the
wire. (3) `mcpToolAuthorizationService._localAmountLimitFallback` re-imposed a
hardcoded $2500 DENY / $600 step-up / $300 HITL ladder in BFF JavaScript whenever
the Transaction decision endpoint PERMITted without an obligation *or* errored —
so a UC8 consent prompt could be produced entirely by BFF code and was
indistinguishable, in the demo, from a PingOne Authorize decision.

**What was fixed:** PingGateway is now a real HITL PEP: on `INDETERMINATE` it
mints a challenge at the HITL service and returns **428** with the `challengeId`,
and on retry it verifies the echoed `_hitl_challenge_id` before setting
`HitlApproved`/`HitlChallengeId` on the P1AZ request (the same attribute names
the Node gateway sends). The receipt rules are not hand-ported into Groovy —
`POST /challenges/:id/verify` on the HITL service is the one implementation, and
IG calls it. The Node gateway's INDETERMINATE now answers 428 as well (a rejected
receipt stays 403 — it is terminal). `mcpGatewayClient` learned the 428 and keeps
recognising the old 403 body for a gateway that has not been redeployed. The
local amount ladder is deleted: a bare PERMIT stays PERMIT, and an unreachable
Transaction endpoint blocks with `authorization_unavailable` (503) instead of
substituting hardcoded thresholds.

**Do not break:** no path may become fail-open. `_hitl_challenge_id` is never
trusted as a raw flag — the challenge must be approved, unexpired, and bound to
the same user + agent + tool + amount + payee, and every unproven path (HITL
service unreachable, unconfigured, unparseable, challenge creation failed) fails
closed with a 503. `Status.valueOf(428)` in the Groovy is deliberate: this IG
build's `chf-http-core` has no `PRECONDITION_REQUIRED` constant (verified with
`javap`) and naming a missing one throws at request time. The direct-transfer
HITL path (`routes/transactions.js`, `transactionConsentChallenge.js`) is
untouched, as are the gate's DENY / step-up / group-deny / UC16 branches.

**Verify:** `cd demo_api_server && CI=true npx jest --forceExit --maxWorkers=4`
(654 suites, 7876 passed, 0 failed — the default worker count flakes on
contention and fails a different disjoint set each run). `cd demo_mcp_gateway &&
npm run build` (exit 0) + `CI=true npx jest --forceExit` (473 passed).
`cd demo_hitl_service && CI=true npx jest` (44 passed; `hitl-teachlog-migration`
fails identically on clean `main`). `npm run topology:verify` (437 passed).
Groovy parsed against the running IG's own Groovy 4.0.28.

### 2026-08-02 — Token Chain rail went dark on load with no control; text as small as 9px

**Files changed:** `demo_api_ui/src/components/TokenChainTraceRail.css`,
`demo_api_ui/src/components/AIAgent.js`.

**What was broken:** PR #1212 added a 152-line dark palette to the Token Chain
rail keyed to `@media (prefers-color-scheme: dark)` — the browser's setting, not
the app's. Nothing else in the app is dark-capable and no toggle was ever added,
so any browser reporting dark (OS setting, Chrome "Auto dark mode for web
contents", or a sticky DevTools *Emulate prefers-color-scheme* override) rendered
a dark, black-bordered rail inside light chrome, on load, with no way to turn it
off. Separately, the rail's base type ran 9px–12.5px — unreadable in a demo.

**What was fixed:** the palette is unchanged; only its trigger moved. All 31
rules are now keyed to `:root[data-theme="dark"]`, set by a new "Dark mode"
switch in the agent header (`Check variant="switch"`, beside "RFC info"),
persisted to `ba_dark_mode`, defaulting to light. The attribute goes on the
document root because the rail mounts on ~28 pages, none inside the agent's
subtree. Font floor raised across the rail: 9→11, 9.5→11, 10→11.5, 10.5→12,
11→12.5, 11.5→12.5, 12→13, 12.5→13.5, 13→14 (35 declarations).

**Do not break:** the toggle must not seed from `prefers-color-scheme` — that is
the defect. Do not re-add an OS-keyed dark block to a component while the rest of
the app has no dark styling. Agent dock/FAB state, panel sizing and every
auth/session path are untouched.

**Verify:** `cd demo_api_ui && npm run build` (exit 0) and `npm run test:unit`
(2566 passed; the 9 failures — monospace regression, spinnerService ×4,
ResourceServerPage.dualView ×3, UserDashboard sha256 canary — all reproduce on
clean `origin/main`). `grep -c prefers-color-scheme TokenChainTraceRail.css` → 0.

### 2026-08-02 — Vault subsystem failed open in six places; two hardening guards were dead code

**Files changed:** `oauth-mcp/src/index.ts`, `demo_mcp_gateway/src/vault.ts`,
`demo_api_server/services/vaultLoader.js`, `demo_api_server/lib/vault/audit.js`,
`demo_api_server/lib/vault/index.js`, `demo_api_server/utils/internalSecret.js` (new),
`demo_api_server/routes/{vaultServiceKey,agentIdToken,agentTool,mcpAuditIngest,weatherMcpFlag,braveMcpFlag}.js`,
`demo_api_server/scripts/{ensure-service-keys,setupFresh}.js`,
`k8s/20-api-server-deployment.yaml`, `k8s/create-secrets.sh`, `docs/vault.md`,
`demo_api_server/tests/vault/vault.failClosed.test.js` (new),
`demo_api_server/tests/vaultServiceKey.test.js`.

**What was broken:** the high-severity findings from the same vault review that
produced the entry below.

1. **Twin MCP servers disagreed.** `oauth-mcp/src/index.ts` warned and booted on
   a vault load failure; its byte-identical twin `demo_mcp_server` exits 1.
   `docker-compose.yml` builds the `mcp-server` service from `./oauth-mcp`, so
   the Docker path ran the fail-open copy — a wrong `VAULT_PASSWORD` booted
   anyway, `loadConfiguration()` walked its secret fallback chain, and the server
   introspected as a different PingOne client (`active:false` on every token).
2. **Gateway allowlist dropped `PINGONE_`.** `config.ts` PREFERS
   `PINGONE_MCP_GATEWAY_CLIENT_ID/SECRET`, but `vault.ts` skipped that prefix, so
   a vault-stored gateway credential silently fell back to a stale `.env` value —
   RFC 8693 exchange client ≠ RFC 7662 introspection client, every tool call
   401'd, both sides logged "vault loaded".
3. **Missing vault file failed OPEN.** `vaultLoader`'s `existsSync` check ran
   BEFORE the missing-password guard, so deleting the file (or a bind mount that
   did not materialize) booted the BFF with every vault secret absent and only an
   info-level log — `server.js` logs only when `result.loaded` is true.
4. **Two hardening guards were unreachable.** `vaultServiceKey.js`,
   `agentIdToken.js`, and `agentTool.js` all keyed their insecure-default kill
   switch off `NODE_ENV === 'production'`, but `k8s/20-api-server-deployment.yaml`
   and `docker-compose.yml` both pin the BFF to `development` deliberately (the
   simulated Authorize service requires it). The guards could never fire, and
   `k8s/03-secrets.yaml.template` ships `BFF_INTERNAL_SECRET: ""` which
   `create-secrets.sh` never populated — so the committed literal
   `dev-shared-secret-change-me` was live in-cluster and any workload with
   pod-network reach to `api-server:3001` could read the backend service keys.
5. **Audit failures were swallowed.** `chmod 0444 secrets.vault.audit.log`
   silenced the entire trail while every vault operation kept succeeding, and the
   log was created at the process umask (0644) while the vault itself is 0600.
6. **The vault could not actually replace `.env`.** Vault entries reached
   configStore only, but six routes read `process.env.BFF_INTERNAL_SECRET` at
   require-time — and routes mount at `server.js:302` while the vault loads
   around line 2500. Following `vault-migrate.js`'s own instruction to strip
   migrated entries from `.env` therefore dropped every one of them to the public
   default.

Plus: `ensure-service-keys.js` swallowed EVERY `.env` read error (not just
ENOENT), so a transient EACCES/EISDIR replaced a populated `.env` with a 3-line
file and still exited 0; `setupFresh.js` prompted for the vault master password
UNMASKED (`readlineFreeText` accepts a `secret` option and ignores it) while
`docs/vault.md` T-269-26 claimed it refused to prompt at all.

**What was fixed:** oauth-mcp fails closed like its twin; `PINGONE_` added to the
gateway allowlist; `VAULT_REQUIRED=true` opts a deployment into fail-closed on a
missing vault file (default stays a no-op so a fresh clone runs); the kill
switches key off `VAULT_INTERNAL_STRICT`, which `20-api-server-deployment.yaml`
now sets and which `create-secrets.sh` backs by minting a real
`BFF_INTERNAL_SECRET` and fanning the same value to BFF + gateway + agent +
ping-gateway; `recordAudit` fails closed on `set`/`delete`/`rotate` (recorded
before anything persists) and `assertAuditWritable()` runs at open/create to
cover `save`, which audits after its rename; the audit log is created 0600; a new
`utils/internalSecret.js` resolves the shared secret per call and the six
consumers use it, with `vaultLoader` exporting a narrow
`ENV_EXPORT_ALLOWLIST` (currently just `BFF_INTERNAL_SECRET`) into `process.env`;
`upsertEnvValue` rethrows any non-ENOENT read error and writes 0600;
`setupFresh` prompts via `@inquirer/password`.

**Do not break:** the kill switches must NOT be re-keyed to `NODE_ENV` — it is
pinned to `development` on purpose. `ENV_EXPORT_ALLOWLIST` must stay an explicit
name list, never a prefix (a vault entry named `LD_PRELOAD` must never reach
`process.env` — T-269-17). `assertAuditWritable` must stay ordered AFTER the
not-found and already-exists guards so it cannot mask their more specific errors.
`internalSecret()` must not be cached at module scope.

**Verify:** `CI=true npx jest tests/vault/ tests/vaultServiceKey.test.js
tests/routes/adminVault.*.test.js src/__tests__/vaultLoader.*.test.js` (235/235);
`CI=true npx jest --testPathPattern='step-up-gate|authorize-gate|runtime-settings-api|transaction-flows|demo-scenario-api|agentTool|mcpAudit|weatherMcp|braveMcp|agentIdToken|ensure-service-keys'`
(132/132); `npx tsc --noEmit` clean in both `demo_mcp_gateway` and `oauth-mcp`.
Revert-to-RED confirmed: reverting `audit.js`, `lib/vault/index.js`,
`vaultLoader.js`, and `utils/internalSecret.js` gives 7 failed / 2 passed.

**Precedence note (docs corrected, code unchanged):** `docs/vault.md` claimed the
vault outranks `process.env`. `configStore.getEffective` does the opposite and
that is deliberate — see the 2026-07-26 entry. The doc now states the real order
(`.env` > vault > LMDB) and its consequence: a leftover `.env` value shadows its
vault entry.
### 2026-08-02 — Vault master password was readable from an unauthenticated endpoint; `save()` was not atomic

**Files changed:** `demo_api_server/services/apiCallTrackerService.js`,
`demo_api_server/server.js`, `demo_api_server/lib/vault/index.js`,
`demo_api_server/tests/vaultPasswordNotTracked.test.js`,
`demo_api_server/tests/vault/vault.atomicSave.test.js`, `.gitignore`,
`docs/incident-response/vault-history-exposure.md`.

**What was broken:** two independent critical defects found in a full vault review.

1. **Master password disclosure.** The global `/api` tracker
   (`server.js:652`) captured `req.body` unredacted; `TRACKING_SKIP_PREFIXES`
   did not cover the vault paths, so `POST /api/admin/vault/unlock` was
   tracked. `apiCallTrackerService` sanitized **headers only** — `formatBody`
   just `JSON.stringify`d the body — and dual-wrote every entry into the shared
   `__global__` bucket. `routes/apiCallTracker.js:27-31` serves that bucket by
   default, and `server.js` mounted `/api/api-calls` with **no
   `authenticateToken`**, unlike every neighbouring mount. Net: after any admin
   unlock, an unauthenticated `GET /api/api-calls?limit=100` returned the vault
   master password in cleartext; `/rotate` returned both old and new. The
   client-side ring buffer (`apiTrafficStore.js`) already redacted these keys —
   only the server twin was missed. The `Cookie` header was truncated rather
   than removed, exposing both ends of the admin session cookie on the same
   open endpoint. Directly falsified `adminVault.js:24-25` ("physically cannot
   leak a password value") and `AdminVaultPage.jsx:162-164` ("never persisted
   server-side").
2. **Non-atomic vault save.** `save()` and `createVault()` wrote to a fixed
   `filePath + '.tmp'` with no lock, no `O_EXCL`, and no fsync. Two concurrent
   savers interleaved their JSON into that one path; the surviving `rename`
   published the splice and the vault reopened as
   `VaultIntegrityError: envelope is not valid JSON` — total loss, no backup.
   `{ mode: 0o600 }` was silently ignored when the tmp file already existed
   (yielding an 0644 vault), and `writeFile` followed a symlink pre-planted at
   the predictable tmp path, writing the full envelope plus `kdf.salt` to an
   attacker-chosen target. Non-corrupting interleavings silently discarded the
   other handle's `set()`s.

**What was fixed:** `formatBody` now redacts a `REDACT_BODY_KEYS` set mirroring
the UI's, recursively (bodies nest); `cookie`/`set-cookie` are redacted in full
while bearer-token truncation is kept deliberately (this demo teaches token
shape); `/api/api-calls` is mounted behind `authenticateToken`, matching its
Telemetry/Tracing siblings. Vault writes go through a new `writeFileAtomic()` —
per-writer tmp name, `wx` (O_EXCL), explicit `0600`, fsync of file and parent
directory, tmp cleanup on failure — and `save()` compares an
mtime/size/inode generation against the one captured at open, turning a silent
lost update into a loud `VaultIntegrityError`.

**Do not break:** `/api/api-calls` must stay behind `authenticateToken`;
`formatBody` is the single choke point every tracked request AND response body
passes through — do not add a body path that bypasses it. Vault writes must not
return to a shared `.tmp` name; the generation check must run before the rename.
`/secrets.vault*.tmp` must stay gitignored — that file is complete ciphertext.

**Verify:**
`CI=true npx jest tests/vaultPasswordNotTracked.test.js tests/vault/vault.atomicSave.test.js`
(10/10). Revert-to-RED confirmed: reverting `apiCallTrackerService.js` +
`server.js` gives 5 failed / 0 passed; reverting `lib/vault/index.js` gives 4
failed / 1 passed (the concurrency case is timing-dependent, the symlink, mode,
and lost-update proofs are deterministic). Grep `server.js` for
`'/api/api-calls', authenticateToken`.

**Not fixed here — operator action required:** the vault ciphertext and the
password that opens it are both still reachable from `origin/main` in a public
repo. See `docs/incident-response/vault-history-exposure.md`. No secret was
rotated by this change.

### 2026-08-01 — Gateway actor allow-list was narrower than the policy it mirrors

**Files changed:** `demo_mcp_gateway/src/auth/toolScopes.ts`,
`demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts`,
`demo_mcp_gateway/src/config.ts`,
`demo_mcp_gateway/tests/gatewayTokenPolicy.test.ts`.

**What was broken:** `validateActClaim` compared `act.sub` for equality against a
single id (`PINGONE_TOKEN_EXCHANGER_CLIENT_ID`), while its own doc comment says it
"mirrors the check a live PingOne Authorize policy would perform via the
`ActClientId` parameter". The authored policy — `HasValidActorChain` in
`snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json` — is a
disjunction over ELEVEN registered identities: "the MCP Token Exchanger, the AI
Agent, and each A2A specialist". So the PEP rejected an actor the PDP explicitly
permits. Every `/agent/init` in every vertical logged

```
[agentToolsResolver] tool discovery failed after 3 attempts (vertical=...)
  — degrading to local catalog: Unauthorized delegation actor: act.sub
  "71e878ea-…" is not the authorized actor "f4dd707d-…"
```

and fell back to a local catalog with every tool marked permitted, so
Authorize-filtered chip affordance silently stopped rendering. Fidelity, not
security: each `tools/call` still went through the per-call decision, which fails
closed. The bug was unreachable until #1184 fixed the discovery WebSocket URL —
before that the handshake 404'd against PingGateway before any token was presented.
The depth >= 2 A2A exemption already in this function is evidence the allow-list
was known to be too narrow; depth 1 never got the same treatment.

**What was fixed:** `validateActClaim` accepts a registered chain
(`string | readonly string[]`, a bare string still works). `config.authorizedActorClientIds`
is built from `PINGONE_TOKEN_EXCHANGER_CLIENT_ID` + `PINGONE_AI_AGENT_ACTOR_CLIENT_ID`
plus an optional comma-separated `GATEWAY_ADDITIONAL_ACTOR_CLIENT_IDS`, deduped with
blanks dropped so an unset var never widens the list to "everything". The field is
optional so the hand-built `GatewayConfig` fixtures stay valid and absent ⇒ previous
single-id behaviour.

**Do not break:** the widening must never admit an unregistered actor — UC13's
confused-deputy showcase depends on `attackSimulatorService.ROGUE_ACTOR_CLIENT_ID`
(`rogue-agent-9f2a-not-allowlisted`) staying a DENY; ACT-11 pins it. Keep the
empty-allow-list skip (dev / no-actor mode) and the empty-`act.sub` skip (simple
exchange). Native-over-header actor precedence and the `X-Demo-Force-Actor` trust
gate are untouched by this change.

**Verify:** `cd demo_mcp_gateway && npm run build` (tsc, exit 0) and
`CI=true npx jest --testPathIgnorePatterns="/node_modules/"` (60 suites, 473 passed);
`cd demo_api_server && CI=true npx jest src/__tests__/attackSimulator.authorizeEvidence.test.js src/__tests__/mcpToolPipeline.confusedDeputy.test.js src/__tests__/bffMcpToolExecutor.runPipelineForSim.test.js --testPathIgnorePatterns="/node_modules/"` (12 passed);
`cd demo_authz_server && node --test decision.confused-deputy.test.js decision.mockCloudParity.test.js` (20 passed).
**mcp-gateway has no src mount — rebuild it (`docker compose build mcp-gateway && docker compose up -d mcp-gateway`) or the running stack keeps the old image.**
### 2026-08-01 — Embedded agent transcript did not scroll; page scrolled instead

**Files changed:** `demo_api_ui/src/components/UserDashboard.css`
(`.ud-body--dashboard-split3` row track + grid-child `min-height`,
`.user-dashboard--split3` sizing), `demo_api_ui/src/theme/refinedDashboardV2.css`
(`min-height: 100vh !important` split out and excluded from split3),
`demo_api_ui/src/App.css` (`:has(.user-dashboard--split3)` viewport lock). CSS only.

**What was broken:** two defects on the Embedded (middle) dashboard layout.
(1) The split3 grid used `grid-template-rows: 1fr`, which is `minmax(auto, 1fr)`,
so the row's automatic minimum grew to the agent transcript's content height, and
grid items default to `min-height: auto`. Nothing in the chain above
`.banking-agent-messages` ever had a definite height, so the transcript grew
instead of scrolling and its overflow was clipped by `.ud-agent-column`
(`overflow: clip`) — measured: injecting 40 rows took `clientHeight` 571 → 2906
with `scrollHeight === clientHeight`, i.e. no scrollbar, content unreachable.
(2) `.user-dashboard--split3` sized itself `calc(100vh - var(--topnav-height, 60px))`
while `refinedDashboardV2.css` forced `min-height: 100vh !important` over its
`min-height: unset`. The dashboard starts ~88px down the page, so at a 900px
viewport it ran to y=988 and the document scrolled 177px with the agent's
composer 15px below the fold.

**What was fixed:** row track is `minmax(0, 1fr)` and split3 grid children get
`min-height: 0`, so the columns can shrink and the transcript becomes the
scroller. The 100vh floor is now scoped `:not(.user-dashboard--split3)`, and the
shell is viewport-tall via `.App:has(.user-dashboard--split3)` + a flex
`main.main-content`, so split3 fills the remainder with no vh arithmetic.

**Do not break:** the `:has()` scoping is load-bearing — it is what keeps the
viewport lock off every other route. Bottom dock, Float, and the clinical split
(`.user-dashboard--clinical-split`) never carry `--split3` and must keep the
default scrolling shell. Do not restore `grid-template-rows: 1fr` or drop the
`> * { min-height: 0 }` rule; either one alone re-breaks the transcript. Do not
reintroduce `100vh`/`--topnav-height` math on the split3 root — the 60px default
does not match the real 88px offset. No JS changed: `middleAgentOpen` init,
bottom-dock route gating, and `banking-agent-fab` classes are untouched.

**Verify:** `cd demo_api_ui && npm run test:unit && npm run build` (build exits 0;
22 pre-existing failures in `uiRegression`, `UserDashboardPing2026`,
`executionEngine`, `spinnerService`, `tokenInspector` are identical before and
after this change). End-to-end on `/dashboard` in the Embedded layout at
1600x900: appending 40 rows to `.banking-agent-messages` must leave
`document.scrollHeight === clientHeight` (no page scroll) while the transcript
reports `scrollHeight > clientHeight` (measured 2906 > 328), and the composer
must stay inside the viewport (measured bottom 738). `/use-cases` and `/` must
keep `.App { overflow-y: visible }`.

### 2026-07-30 — AG-UI agent tool calls 400'd after JSON-RPC wire mismatch (#1108)

**Files changed:** `demo_agent_service/src/agentRunHandler.ts`,
`demo_agent_service/tests/agentRunHandler.bffToolWire.test.ts`,
`demo_api_server/tests/agentTool.wireContract.regression.test.js`.

**What was broken:** #1108 changed `executeTool` to POST MCP/JSON-RPC
`{ jsonrpc:'2.0', method:'tools/call', params:{ name, arguments, sessionId } }`
while `BFF_TOOL_URL` still points at `/internal/agent-tool`, which requires
top-level `{ tool, args, sessionId }`. Every AG-UI tool call got
`400 tool_required` (and would have dropped `tokenEvents` even if the body
had been adapted). The new `/api/rpc` sibling uses `requireSession` and is
not what agents call.

**What was fixed:** restored the `{ tool, args, sessionId }` request body and
`{ result, tokenEvents }` unwrap. Canaries lock both sides of the contract.

**Do not break:** do not send JSON-RPC to `/internal/agent-tool`; keep
`BFF_TOOL_URL` on that route (or teach the route and the client together).

**Verify:**
`cd demo_agent_service && npx jest --forceExit --testPathPattern=agentRunHandler.bffToolWire`
`cd demo_api_server && CI=true npx jest tests/agentTool.wireContract.regression.test.js --forceExit --testPathIgnorePatterns="/node_modules/"`

### 2026-07-29 — Unauthenticated `/api/token-exchanges` returned cleartext JWTs

**Files changed:** `demo_api_server/server.js` (removed insecure dual-mount),
deleted `demo_api_server/routes/tokenExchanges.js`,
`demo_api_server/routes/tokenExchangeLog.js` (`resolveSessionId`),
`demo_api_server/src/__tests__/tokenExchangeLog.test.js`.

**What was broken:** #1105 mounted two routers on `/api/token-exchanges`. The
first (`routes/tokenExchanges.js`) had **no** `authenticateToken`, stored
`subjectToken` / `resultToken` in a process-global array in cleartext, and
returned the entire log on GET. Express matched that router first, so the
second mount (`authenticateToken` + `tokenExchangeLogRouter`, which hashes
tokens and session-scopes reads) was dead code. Any unauthenticated caller
could `GET /api/token-exchanges` and harvest every JWT the demo had logged —
and `POST` accepted forged session ids from the body.

**What was fixed:** removed the cleartext router and its mount. The sole
handler is `authenticateToken` → `tokenExchangeLogRouter`. Session binding
uses `req.sessionID || req.session?.id` (never the request body).

**Do not break:** do not remount `/api/token-exchanges` without
`authenticateToken`; never persist cleartext access tokens in the audit log.

**Verify:** `CI=true npx jest src/__tests__/tokenExchangeLog.test.js
--testPathIgnorePatterns="/node_modules/" --forceExit`

### 2026-07-28 — Simple Stepper blamed a recovered tools/list failure for the halt and ghosted 13 steps that ran

**Files changed:** `demo_api_server/routes/agentRun.js` (new `markRecovered`,
exported on `__test`), `demo_api_server/tests/agentRun.recoveredToolsList.test.js`,
`demo_api_ui/src/components/TokenChainDisplay.js` (`isHaltedAt`),
`demo_api_ui/src/components/__tests__/TokenChainDisplay.haltedAt.test.js`.

**What was broken:** `agentRun` still calls the legacy HTTP
`agentGatewayClient.getAvailableTools()`, which posts to `<AGENT_GATEWAY_URL>/tools/list`.
That path is superseded by `listAvailableTools()` (WS through the gateway) and
nothing in the stack serves it — `AGENT_GATEWAY_URL` is unset, so the request hits
`http://localhost:8080` inside the BFF container and is refused on every run
(13 occurrences in 6h of logs). The run recovers: it falls back to the local tool
catalog and continues. But the `status:'failed'` event was merged into the token
chain unmarked, and `isHaltedAt`'s fallback ("first failed-bucket event that isn't
last is the halt") latched onto it. Simple Stepper then rendered rows 8-20 as
"— did not run" for a `checkout $2500` run in which those steps demonstrably ran
(actor token issued, JWKS verified, both exchanges completed, both P1AZ decision
endpoints called). The real halt — `Transaction Denied: amount $2500 exceeds the
maximum permitted limit of $2,000` — was correctly shown by the Token Chain
pipeline view, which builds from `buildTraceSteps.js`, not from raw events.

**What was fixed:** the recovery site marks the failure's events `recovered: true`;
`isHaltedAt` returns false for them. The step stays red (it did fail) but the halt
marker moves to the real stopping point and later steps keep their own status.

**Do not break:** `isHaltedStep === true` still wins over `recovered` — the A6
attack-simulator's explicit halt marker is authoritative. `recovered` must not be
set anywhere the run actually stops; it means "the server continued past this".
Do not "fix" this by pointing `AGENT_GATEWAY_URL` at a service — that revives a
deliberately abandoned path that bypasses the gateway's Authorize tool filtering.

**Verify:** `cd demo_api_server && CI=true npx jest tests/agentRun --testPathIgnorePatterns="/node_modules/" --forceExit`
(29 passed) and `cd demo_api_ui && npm run test:unit && npm run build`.
End-to-end (after merge + `docker restart ai-demo-api-server`): a `checkout
headphones for $2500` run must show Simple Stepper halting at the Authorize step,
with the tools/list row red but the rows after it keeping their real statuses.
### 2026-07-28 — Every rendered ProofStrip repainted with the newest run's verdict

**Files changed:** `demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js`
(traces carry a `runId`), `demo_api_ui/src/context/ProofOfEnforcementContext.js`
(verdicts stored per run, `verdictFor(runId)` replaces the `history` array),
`demo_api_ui/src/components/ProofStrip.jsx` (`runId` prop),
`demo_api_ui/src/components/AIAgent.js` (`addMessage` stamps `proofRunId` on
assistant bubbles; one strip per run, on that run's last bubble), plus unit
tests in both `__tests__` dirs.

**What was broken:** ProofStrip instances were selected by POSITION —
`<ProofStrip rank={assistantRankFromEnd} />` — and read live global state:
rank 0 took the current `verdict`, rank 1 indexed a `history` array. That
array was appended once per trace-store EMIT (beginTrace, every
`ingestTokenEvent`, `ingestAuthorize`, `completeTrace`), so a single run
produced ~6 entries and `history[1]` was the SAME run one event earlier, not
the previous run. Consequences: a run that emitted two assistant bubbles (e.g.
"Running Demo step 1…" + the reply) rendered its result twice, and starting
any new run repainted every visible strip with the new run's state — a green
UC1 "Verified" strip turned yellow "Incomplete" the moment UC14 ran.

**What was fixed:** `beginTrace` stamps a monotonic `runId` (a counter, not
`startedAt` — two runs can share a millisecond). The provider files each
verdict under its run and replaces rather than appends, keeping the last 20
runs. `addMessage` captures the in-flight `runId` on assistant messages;
render shows one strip per run, on that run's last bubble, resolved via
`verdictFor(msg.proofRunId)`.

**Do not break:** `verdict` (latest run) is still what `VerifiedBanner`,
`TokenChainPanel` and `LiveUseCaseWorkbenchPage` read — unchanged. `ProofStrip`
with no `runId` still renders that latest verdict. Do not reintroduce
positional/rank lookup: assistant-message index does not map to runs.

**Verify:** `cd demo_api_ui && npm run test:unit && npm run build`. The pinning
test is "a later run does not repaint an earlier run's verdict"
(`src/context/__tests__/ProofOfEnforcementContext.test.js`) — collapsing the
key in `recompute` back to a constant makes it fail.
### 2026-07-28 — `/use-cases/live` Token Chain clipped; stage stacking used a viewport breakpoint

**Files changed:** `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.css` only.

**What was broken:** stacking was gated on `@media (max-width: 1200px)` — a
*viewport* measure — while the stage's real width is `viewport − 310px sidebar −
240..640px drawer column − 7px handle`. At a 1280px viewport with the drawer open
the stage had 612px but needed 710px, so `.luw-main__stage` (default
`min-width: auto`) overflowed 63px past the viewport and `.App{overflow-x:clip}`
cut the Token Chain off with no scrollbar. The related dead-grey-band defect
(`.luw-main` at `grid-column: -1`, a grid *line* rather than a track, which put
it in an implicit content-sized column) was fixed separately on main by #1067
placing `.luw-main` at `-2 / -1`; that placement is kept here unchanged.

**What was fixed:** `min-width: 0` added to `.luw-main__stage` and
`.luw-run-layout` so they can shrink. The 1200px media query became
`@container luw-main (max-width: 780px)` (`.luw-main` carries
`container-type: inline-size`), and `.luw-run-layout` now wraps with a 320px
floor on both panes as the non-container-query fallback. The `≤860px` media
query states `.luw-main { grid-column: 1 }` explicitly, where the drawer is back
in flow.

**Do not break:** `.luw-main` placement stays `-2 / -1` (see #1067) — never
`grid-column: -1`, which is a line, not a track. Stage stacking must stay
container-queried; a viewport breakpoint cannot see the sidebar or the
presenter-dragged drawer width.

**Verify:** `cd demo_api_ui && npm run test:unit && npm run build`. The pixel
measurements originally recorded here (stage 428px at 1400px/640px drawer; panes
951px + 1143px at 2498px) were taken against an earlier `grid-column: 3` variant
of this fix, not the shipped `-2 / -1` placement — re-measure live rather than
treating them as current baselines.


### 2026-07-28 — Attack sims denied at the PingGateway perimeter, then relabeled as policy denials (UC14 false pass)

**Files changed:** `demo_api_server/services/attackSimulatorService.js`
(new `_gatewayExchangeTarget`, used by `_exchangeGatewayToken`),
`demo_api_server/services/agentMcpTokenService.js` (exports
`firstHttpResourceUri`), `demo_api_server/tests/attackSimExchangerParity.test.js`.

**What was broken:** with `ff_mcp_gateway_pinggateway=true`, the sims exchanged
the user token for tool scopes (`read write transfer`) against
`mcpgateway.ping.demo`. PingGateway's McpProtectionFilter requires the coarse
`gateway:mcp:invoke` scope and an aud exactly matching its resourceId, so it
refused the call at the perimeter:

```text
[GW→PingGateway] RESPONSE: status=403
www-authenticate: Bearer error="insufficient_scope", scope="gateway:mcp:invoke"
```

`_denyFromGateway` then overwrote that generic 403 with each sim's own canonical
code. UC14 reported `rar_amount_exceeded` and printed "PingOne Authorize DENY —
transfer exceeds the granted RAR authorization_details cap (RFC 9396)" — from
the hardcoded `CANONICAL_DENY_REASON` map — for a run in which PingOne Authorize
was never consulted. Right verdict, wrong reason. Because no Authorize decision
existed, no `authorize` node was attached, so ProofStrip correctly reported
"Unproven / Waiting on authorize-decision" and the rail read "This run stopped
with an error". Measured live: `rar-exceeded` → `authorize: False`, while
`rogue-actor` and `cross-owner-account` → `authorize: True` (those reach P1AZ
through the BFF preflight, not the gateway).

**What was fixed:** `_gatewayExchangeTarget` mirrors the production Exchange #2
recipe in `agentMcpTokenService` — behind PingGateway, mint the coarse invoke
scope for the PingGateway resource URI passed as a ONE-ELEMENT ARRAY (PingOne
honors RFC 8707 `resource=` and silently ignores `audience=`; a string maps to
the latter). Flag off, the Node-gateway audience and tool scopes are unchanged.

**Do not break:** the sims must keep using the same audience AND scope recipe as
the real chip flow. A sim that mints tool scopes behind PingGateway is refused
before any policy runs, and the canonical-code relabeling hides it — the sim
still "passes". This is the scope sibling of the 2026-07-10 audience-drift bug;
both guards live in `tests/attackSimExchangerParity.test.js`.

**Verify:** `cd demo_api_server && CI=true npx jest tests/attackSimExchangerParity.test.js --testPathIgnorePatterns="/node_modules/" --forceExit`.
End-to-end (requires this code running in the stack, i.e. after merge +
`docker restart demo-api-server`): `POST /api/demo/attack-sim/run {"sim":"rar-exceeded"}`
must return `authorize: true` with a PingOne Authorize RarMaxAmount decision,
and `/use-cases/live` UC14 must show ProofStrip "Verified (as expected)".

### 2026-07-27 — RAR demo (UC14b/UC14): quick chat result toggle + fail chip + full request/response in the Token Chain

**Files changed:** `demo_api_ui/src/config/demoUseCaseSteps.js` (UC14 added
to `DEMO_PRIMARY_USE_CASE_IDS`, now 20 steps), `demo_api_ui/src/components/DemoStepsDropdown.jsx`
(UC14b-only "Q"/"F" toggle, persisted via `rar_intent_quick_result`),
`demo_api_ui/src/components/AIAgent.js` (`handleDemoStepSelect` "link" branch
grows a quick-result path for UC14b), `demo_api_ui/src/components/AIAgent.css`
(`.ba-demo-steps-popout__rar-toggle`), `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`
("intent-binding" step gains `request`/`response` JSON blocks),
`demo_api_server/services/attackSimulatorService.js` (`_runRarPermit`'s
`intent-binding-verified` event and `_runRarExceeded`'s `sim-rar-grant` event
now carry the real `create_transfer` request/response payloads).

**Not a bug fix** — a feature addition, logged here (not just in a PR
description) because it touches the intent-binding/Token-Chain routing that
has 3 prior entries in this log (2026-07-18 ×2, 2026-07-21) for exactly this
code path.

**What was added:** UC14b ("PAR intent verified") previously only navigated
away to `/intent-binding-learning` when run from the AI Agent's Demo Steps
dropdown — no inline result, no request/response evidence anywhere. UC14
("PAR intent violation", the DENY counterpart) existed in the backend catalog
but was never listed in `DEMO_PRIMARY_USE_CASE_IDS`, so it never appeared in
that dropdown at all. Now: UC14b has a toggle between the original full-page
behavior and a new "quick result" mode that runs `POST
/api/demo/intent-binding/run` inline (same chat + Token Chain wiring the
`trigger.type === "attack"` branch already used) with no navigation; UC14 is
a visible sibling row using its existing attack-sim path unchanged. The
"Intent Binding Check" Token Chain step (pre-existing, `buildTraceSteps.js`)
now renders the real `create_transfer` request and its response/deny detail
as JSON, via the same `detail.request`/`detail.response` mechanism the
`gateway` step already uses — no new step type.

**Do not break:** `_denyFromGateway` / `_authorizeFromGatewayError` were NOT
touched (shared by the other 7 attack sims, explicitly protected in this
log's 2026-07-18 entry below). The DENY-side request block is sourced from
the sibling `sim-rar-grant` event — `buildSimRailEvents` (simTraceAdapter.js)
renames that event to `rar-authorization` on the attack-sim path, so the
lookup in `buildTraceSteps.js` matches BOTH ids; matching only the raw id
would silently drop the request block for every UC14 run through the Demo
Steps dropdown / `/use-cases/live` attack-sim path. `LiveUseCaseWorkbenchPage.js`'s
own UC14/UC14b cards (`/use-cases/live`) and `IntentBindingLearningPage.js`
itself are untouched — this only changes the AI Agent chrome's Demo Steps
dropdown. A `data-testid` on a new UC14b-only button must NOT start with
`demo-step-` — it collides with the `/^demo-step-/` row-enumeration regex
several tests use (hit and fixed live during this change; landed as
`uc14b-result-toggle`).

**Verify:** `cd demo_api_server && CI=true npx jest
src/__tests__/attackSimulator.authorizeEvidence.test.js
src/__tests__/attackSimulator.test.js --forceExit` (25 passed, 2 pending
[live-API-gated]); `cd demo_api_ui && CI=true npm run test:unit` (282 files,
2389 passed); `cd demo_api_ui && npm run build` (exit 0). Not yet
live-verified in a browser — the running Docker stack bind-mounts the main
checkout, not this worktree (see `project-docker-serves-main-checkout`);
needs an isolated worktree-pointed stack to click through.

### 2026-07-27 — In-page HITL consent never discharged the MCP-gateway/REST HITL gate, so a second consent prompt appeared after the first

**Files changed:** `demo_api_server/services/transactionConsentChallenge.js`,
`demo_api_ui/src/components/AIAgent.js` (unrelated ProofStrip fix, same session
— see next entry), `demo_api_ui/src/pages/CibaApprovalPage.js` (unrelated
phone-frame styling, same session).

**What was broken:** `services/hitlCredit.js`'s session credit
(`req.session.hitlVerified` / `hitlApprovedAmount`) is what
`mcpToolAuthorizationService.js` (MCP gateway path) and
`routes/transactions.js` (REST `POST /transactions`, line ~609) both read to
skip their own independent HITL gate on the `isRefire` retry that follows any
consent. Until this fix, **only `routes/ciba.js`** (CIBA out-of-band approval)
ever wrote that credit. A user who satisfied the in-page
`TransactionConsentModal` instead (consent-only, OTP, PingOne MFA, or
Recognize — any of `transactionConsentChallenge.js`'s four confirm paths)
got no credit at all, so the `isRefire` retry re-tripped the exact same HITL
gate and opened a second, redundant consent challenge for the transaction
they'd just approved. Live-reproduced on UC22 (banking, $150 transfer,
consent-only tier): `[BFF→P1AZ]` showed `McpFirstTool` PERMIT+HITL, then a
`transactionConsentChallenge` create+confirm round (`Acr: Agent-Consent-Login`)
— and a second identical round on retry, since `mcpToolAuthorizationService.js`
still saw `hitlAlreadyVerified: false`.

**What was fixed:** added `_grantHitlCredit(req, ch)` to
`transactionConsentChallenge.js` — the same stamp `routes/ciba.js` already
performs on CIBA approval (`hitlVerified` + amount-bound
`hitlApprovedAmount`) — called at all four places a challenge reaches
`status: 'confirmed'`: the consent-only branch of `confirmChallenge`,
`verifyOtp`, `verifyMfa`, and `verifyRecognize`.

**Do not break:** `_grantHitlCredit` only WRITES the credit; it does not
change any existing read/consume site (`mcpToolAuthorizationService.js`'s
`hitlAlreadyVerified`, `routes/transactions.js` line 609's amount-bound
`isFresh` check, or `hitlCredit.consume()`'s single-use semantics) — a
credit minted here is spent exactly like a CIBA-minted one. Do not add an
amount-unbound stamp here without a reason; `ch.snapshot.amount` is always
available on a real challenge, so binding it is strictly safer than CIBA's
`pending.amount ?? null` fallback.

**Verify:** `CI=true npx jest src/__tests__/transactionConsentChallenge.test.js
src/__tests__/transaction-flows.test.js src/__tests__/transactions.authorization.test.js
src/__tests__/transferHitlIntegration.test.js src/__tests__/hitlRoute.integration.test.js
src/__tests__/hitlRoute.regression.test.js src/__tests__/hitlPingOneMfa.integration.test.js
src/__tests__/recognizeConsent.regression.test.js src/__tests__/step-up-gate.test.js
src/__tests__/ciba.test.js src/__tests__/cibaService.test.js src/__tests__/mcpToolAuthorizationService.test.js
src/__tests__/mcpToolAuthorization.amountFromRecord.test.js --testPathIgnorePatterns="/node_modules/"`
(11+2 suites, 255 tests, all pass); `CI=true npm run test:unit` (91 pass).
Not yet re-verified live end-to-end (the live repro that found this logged
the demo account out mid-session — see the ciba-poll entry below for that
same-session hazard).

### 2026-07-27 — ProofStrip showed "Incomplete — Waiting on ciba-poll" forever after a CIBA-approved resume

**Files changed:** `demo_api_ui/src/components/AIAgent.js`
(`pollCibaThenResumeNl`), `demo_api_ui/src/pages/CibaApprovalPage.js`,
`demo_api_ui/src/pages/CibaApprovalPage.css` (new).

**What was broken:** `routes/ciba.js` stamps CIBA approval with a
`ciba-poll` token-chain event, but that event lives in
`services/tokenChainService.js`'s per-user store, which
`routes/agentInvokeRoute.js` never re-reads into a response's `tokenEvents`
(`req.tokenEvents` is built fresh per request). The resumed
`sendAgentMessage()` call also calls `tokenChainTraceStore.beginTrace()` at
its start, which only carries forward session-scoped events
(`user-token` etc.) — not `ciba-poll`. So the client-side trace ProofStrip
reads from never contains `ciba-poll`, and `computeVerdict()`
(`ProofOfEnforcementContext.js`) always reports it as a missing step —
"Incomplete" regardless of whether the underlying transfer actually
succeeded.

**What was fixed:** `pollCibaThenResumeNl`'s approved branch now calls
`tokenChainTraceStore.ingestTokenEvent({id: 'ciba-poll', ...})` itself,
right after the resumed `sendAgentMessage()` call (i.e. after that call's own
`beginTrace()` has already run), so the event lands in the trace this
resumed turn is building instead of the one that just got discarded. Also
restyled `CibaApprovalPage.js`'s popup as a phone frame (notch, rounded
bezel, home-indicator, portrait 320×600 via a new `className="ciba-phone-
modal"` on `DraggableModal`) and widened the three `window.open()` popup
calls in `AIAgent.js` to 440×760 so it isn't clipped.

**Do not break:** the `ciba-poll` event this stamps is a client-side display
marker only — it carries no real token/claims (see `routes/ciba.js`'s own
comment on why a fake token in this position is safe: never stored in
`req.session.oauthTokens`). Don't confuse it with the real server-recorded
event of the same id in `tokenChainService.js`; they're for different
consumers. The phone-frame CSS targets `.ciba-phone-modal` only —
`DraggableModal`'s own drag/resize/close/pop-out behavior is untouched.

**Verify:** `demo_api_ui` vitest — 281 files / 2383 tests pass (including
`AIAgent.cibaStepUp.test.js` and both `CibaApprovalPage.test.js`/`.test.jsx`);
`npm run build` exits 0. Not yet visually confirmed live in a browser — the
live repro session hit the shared-demo-account single-session hazard before
this could be checked; the phone-frame CSS and the ciba-poll ingest are
build/unit-verified only.

### 2026-07-27 — PingOne Authorize API Access Management (AAM) had no trace, no simulated mode, and no flag

**Files changed:** `ping-gateway/config/routes/04-aam-api-access.json`,
`ping-gateway/scripts/groovy/aam-sideband-capture.groovy` (new),
`ping-gateway/scripts/groovy/aam-trail-stamp.groovy` (new),
`demo_authz_server/routes/sideband.js` (new), `demo_authz_server/index.js`,
`demo_api_server/routes/aamProbe.js` (new),
`demo_api_server/services/mcpGatewayClient.js`,
`demo_api_server/services/configStore.js`,
`demo_api_ui/src/components/TokenChainDisplay.js`,
`ping-gateway/README.md`.

**What was broken:** PR #1025 added the stock `PingAuthorizeFilter` on a
new `/aam` route (a second, coarse-grained PingOne Authorize capability
alongside the existing `p1az-decision.groovy` decision-endpoint path). It
enforced correctly but was invisible: `PingAuthorizeFilter` consumes the
Sideband request/response internally and exposes only 200/403, so nothing
reached the token chain. It also had no mock backend (undemoable without a
live PingOne environment) and no way to turn it off.

**What was fixed:** `sidebandHandler` — a `PingAuthorizeFilter` config
property typed as a Handler reference we own — hosts
`aam-sideband-capture.groovy`, which retargets the call (real PingOne vs
`demo_authz_server`'s new `/sideband/request` + `/sideband/response` mock,
switched by `X-Authz-Simulated`, same pattern as `P1AZ_MOCK_BASE` /
`P1AZ_REAL_BASE`) and captures the exchange with `Authorization` redacted at
capture. `aam-trail-stamp.groovy` wraps `PingAuthorizeFilter` (not follows
it — a deny short-circuits downstream filters) and stamps
`X-Gw-Audit-Trail` with an `aam` section, reusing the existing header
`p1az-decision.groovy` already populates. `GET /api/aam/probe` is the only
new BFF surface: `/aam` is called directly by clients, so without it
nothing in the BFF ever sees the trail. The UI renders a `gw-aam` event in
`TokenChainDisplay.js` alongside `gw-authorize`, not instead of it — AAM
sees only method/path/headers/client IP, the fine-grained per-tool
decision still runs behind it. `ff_aam` (default `true`) gates whether AAM
runs at all.

Two IG-specific traps, both now documented in the route/script comments and
the design spec: `streamingEnabled: true` (global) means reading the
Sideband entity from a `ScriptableFilter` blocks a Vert.x event-loop thread
— the request hangs (curl exit 28) rather than failing fast — fixed with a
`CaptureDecorator` scoped to this route only (`/mcp` untouched). And the
Sideband API has two endpoints: `/sideband/request` decides, and on
**allow only** the gateway posts the backend's answer to
`/sideband/response`; a mock missing that leg produces a 404 "from the
Sideband API" on allow while deny keeps working.

**Do not break:** No existing route, heap object, or `p1az-decision.groovy`
line is modified — AAM is additive. The `/mcp` routes keep enforcing
through the decision-endpoint path regardless of `ff_aam`.

**Verify:** Live against real PingOne (env `01d89b06`), isolated container,
running stack never repointed: DENY (`decision=DENY backend=real`,
`response_code "401"`) and, via the mock, both PERMIT (`200`,
`{"service":"banking_api_resource_server"}`) and DENY (`403`) with the
Sideband JSON captured and `Authorization: <redacted>`; 11/11 routes load,
0 build errors, 0 `Thread blocked`; `/health` 200 and `/mcp` no-token 401
unchanged. `demo_authz_server` sideband 9/9 (211/217 full suite — the 6
failures are a strict subset of 14 failing on a clean `origin/main`
baseline). `aamProbe` 8/8, `ffAam` 4/4, `gw-aam` chain 9/9.
`npm run topology:verify` PASSED; UI `test:unit` 278 files / 2365 passed;
`npm run build` exit 0.

### 2026-07-27 — Landing page "Use Cases" button sent signed-out visitors through the admin login, landing them on the admin dashboard instead of the customer use-cases page

**Files changed:** `demo_api_ui/src/components/LandingPage.js`.

**What was broken:** the 2026-07-26 fix to `handleUseCases` (see below) made it
"mirror `handleAdminDashboard`" — but `handleAdminDashboard`'s redirect target,
`/api/auth/oauth/login`, is the **admin** OAuth route (`routes/oauth.js`). A
signed-out visitor clicking "Use Cases" authenticated through the admin flow,
then landed on the admin `Dashboard` (root `/` renders `Dashboard` when
`user?.role === "admin"`) instead of `/use-cases/live`. `handleAdminDashboard`
using that route is correct; `handleUseCases` copying it was not.

**What was fixed:** `handleUseCases`'s signed-out branch now hits the
end-user OAuth route with a return path — `/api/auth/oauth/user/login?return_to=/use-cases/live`
— matching the existing `return_to` convention used by
`PingOneTestPage.jsx`/`TokenExchangeTesterPage.jsx`. `routes/oauthUser.js`
already supports `return_to` (`sanitizePostLoginReturnPath`); no server change
needed.

**Do not break:** don't point `handleUseCases`'s signed-out branch back at
`/api/auth/oauth/login` (admin route) — that reintroduces this bug. Don't
change `handleAdminDashboard`, which correctly uses the admin route.
`handleCustomerDashboard` has its own unrelated unconditional-`navigate` shape
(noted in the 2026-07-26 entry below) — still out of scope here.

**Verify:** `cd demo_api_ui && npm run build` (0). Live: signed out, click
"Use Cases" → PingOne end-user `/signon` → after login, lands on
`/use-cases/live`, not `/` or the admin dashboard.

### 2026-07-27 — Token Chain step card: "More Education" on the Agent Gateway hop opened P1AZ, and its actions did not read as clickable

**Files changed:** `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`,
`demo_api_ui/src/components/TokenChainTraceRail.css`,
`demo_api_ui/src/components/TraceStepCard.jsx`,
`demo_api_ui/src/components/PingOneAuthorizePage.jsx`,
`demo_api_ui/src/components/AgentGatewayTester.jsx`,
`demo_api_ui/src/services/inspectorReplay.js` (new), plus
`src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`.

**What was broken:** the `gateway` step's `moreDetail.href` was the same literal
`/pingone-authorize` as the `authorize` step's, so "More Education" on the Agent
Gateway hop landed on the P1AZ page instead of the gateway inspector — and the
old assertion in `buildTraceSteps.test.js` pinned that wrong value, so the bug
was test-protected. Separately, `.tctr-inspect` rendered every step action
(including the "Pop out full detail" button) at 11px with
`text-decoration: none`, so nothing on the card read as clickable.

**What was fixed:** gateway `moreDetail.href` → `/pinggateway-inspector`;
`.tctr .tctr-inspect` → 13px, underlined with a hover/focus state. Added a replay
path: `buildTraceSteps` now emits `detail.replay` on the `authorize` step (the
actual P1AZ decision parameters) and the `gateway` step (the actual MCP tool +
arguments from `mcpResult.requestJson`); `TraceStepCard` renders a separate
"→ Replay in …" button that stashes the payload via `services/inspectorReplay.js`
(`?replay=<id>` in the URL) and opens the inspector, which consumes it once and
re-runs the call.

Three further defects were found only by driving the real browser — all three
looked correct in unit tests and in the served CSS/JS:

1. **The font-size never applied to the buttons.** PingOne's `end-user-nano`
   sheet ships `.end-user-nano button { font-size: inherit }`; `(0,1,1)` beats a
   lone `.tctr-inspect`, so every button action inherited the 12px step body
   while only the `<a>` variants took our size. Hence the `.tctr` scope.
2. **The handoff never arrived.** It used `sessionStorage`, but the inspector
   opens via `window.open(..., "noopener")` and a noopener context starts with a
   **fresh sessionStorage** — the tester loaded on the right tab and sat on
   "Select a tool from the tree". Now `localStorage` + an age sweep.
3. **The P1AZ hand-off was consumed and thrown away.** Reading the one-shot
   payload on mount and parking it in state lost it whenever the route remounted
   before the endpoint list arrived; and `EvaluatePanel`'s endpoint-change reset
   fires *again* once `autoPreset` settles, wiping the staged `pendingTest`.
   Now consumed only when `selectedId` is set, and guarded by `replayPendingRef`
   until the evaluation reports back through `onEvaluated`.

**Do not break:** `consumeReplay` must stay one-shot (it deletes the key on
read) — a page refresh must not re-fire a live gateway tool call. Keep the
storage as `localStorage`, keep the `.tctr` scope on the action styles, keep the
P1AZ consume gated on `selectedId`, and keep `replayPendingRef` guarding
`clearPendingTest`. Keep the two `moreDetail.href` values distinct — a shared
constant would re-create the original bug.

**Verify:** `cd demo_api_ui && npm run test:unit` (2357 pass, 24 skipped; the 1
failure is a pre-existing `TransactionConsentModal.declineScope` flake under
full-suite parallelism — passes in isolation) and `npm run build` (exit 0).
Live: `PLAYWRIGHT_BASE_URL=https://local.ping-devops.com:4444 npx playwright test
tests/e2e/tokenchain-replay.real.spec.js --config=playwright.real.config.js`
— 5 passed against the running stack.
Revert-to-RED: restore `/pingone-authorize` on the gateway step and
`buildTraceSteps.test.js` "gw-authorize parameters + rawResponse render full
request/response and moreDetail link" fails.

### 2026-07-27 — Scope audit: Holdings A2A chain half-wired; SSOT under-documented live A2A gateway scopes; non-canonical scope spellings in enforcement/metadata

**Files changed:** `scope-topology.json`, `docs/scope-topology.md` (regenerated),
`demo_api_server/services/configStore.js`, `demo_api_server/routes/pingoneTestRoutes.js`,
`demo_api_server/scripts/bootstrapPingOne.js`, `demo_api_server/package.json`,
`demo_api_server/src/__tests__/scopeTopology.regression.test.js`,
`demo_mcp_gateway/src/server/GatewayServer.ts`, `demo_mcp_server/src/server/HttpMCPTransport.ts`,
`scripts/rebuild-pingone.sh`; deleted `demo_api_server/services/oauthScopeValidator.js` (zero consumers),
`scripts/fix-pingone-scopes.{sh,py}` + `demo_api_server/scripts/cleanupPingOneApps.js` (stale pre-rename
name lists; the fix scripts wrote legacy `banking:*` scopes).

**What was broken:** `sensitive_investment_holdings` had no `a2aDelegatedScope`, the Holdings
Specialist resource was missing from `provisioning.resourceNames`, and the SSOT's A2A MCP Gateway
resource omitted the four delegated scopes (`records:read`, `tax:read`, `finaid:read`, `supplier:read`)
that live PingOne actually carries — so the manifest was wrong in both directions and the live tenant
is still missing `holdings:read` + the Holdings app rename. The enduser RFC 8707 allowlist in
`configStore.buildAllowedScopesByAudience` listed only flat legacy names (`admin`, `sensitive`,
`ai:agent`) — canonical `admin:*`/`sensitive:read`/`ai:agent:read` were silently stripped on narrowing.
`mcp_pinggateway_url` default pointed at the OrbStack-reserved port `:3006`. `pingoneTestRoutes`
defaulted `ENDUSER_AUDIENCE` to `agentgateway.ping.demo`.

**What was fixed:** SSOT documents the verified live truth (A2A gateway scopes, specialist
`grantedScopes` incl. `holdings:read`, Holdings rename-map entry, `pinggateway:invoke` alias);
allowlist edits are ADDITIVE (flat legacy names retained — UI `DEFAULT_AGENT_MCP_ALLOWED_SCOPES`
still sends them); gateway/mcp-server scope metadata unified to canonical spellings; recreate/wipe
name lists now cover all A2A apps+resources. Five new gate tests (audit hardening block) —
revert-to-RED verified: restoring the old SSOT fails 2 of them.

**Do not break:** keep the flat legacy scope names in the enduser allowlist alongside canonical ones;
`a2aDelegatedScope` values must stay present on the `Super Banking A2A MCP Gateway` resource scopes;
never collapse A2A specialist scopes to bare `read`.

**Verify:** `npm run topology:verify` (exit 0) · `cd demo_api_server && CI=true npm run test:unit`
(91/91) · after live provisioning: `npm run verify:scopes -- --manifest-diff` must be clean.

### 2026-07-27 — Gateway's 401 crashed into a 500 once signature verification was switched on

**Files changed:** `demo_mcp_gateway/src/server/GatewayServer.ts`,
`demo_mcp_gateway/tests/wwwAuthenticateHeaderSafety.test.ts` (new).

**What was broken:** `sendUnauthorized` folded quotes but not control
characters. Validator messages are multi-line (`tokenValidator.ts` builds
multi-line templates; jose/jsonwebtoken embed newlines in signature errors), so
`res.writeHead` threw `ERR_INVALID_CHAR` and a correct 401 surfaced to the
client as a 500 `internal_server_error` — losing both the status and the
`resource_metadata` hint RFC 9728 discovery depends on. MCP clients that
re-authenticate on 401 see a server error instead.

This was unreachable while the gateway accepted every token: it ran decode-only
because `tokenValidator.ts` read `PINGONE_JWKS_ENDPOINT` while the stack only
ever set `PINGONE_JWKS_URI`. **#1012 fixed that name mismatch** (accepting
`PINGONE_JWKS_URI` as an alias), which turns signature verification on — and
makes this crash reachable in the running stack. Found by enabling JWKS against
live PingOne via a throwaway compose overlay: a forged HS256 token carrying
correct `iss`/`aud`/`scope` was correctly rejected, then the 401 crashed on the
way out and the client got `{"error":"internal_server_error"}`.

**What was fixed:** header descriptions now go through the exported
`sanitizeHeaderDescription` — strips CR/LF/tab and non-ASCII, folds quotes so
the message cannot break out of its auth-param, caps at 300 chars.

**Do not break:** keep `sanitizeHeaderDescription` between any validator
message and a header value. The test imports the real exported function rather
than a copy, so it cannot pass while production drifts. No compose change is
needed for JWKS after #1012 — the alias resolves the already-present
`PINGONE_JWKS_URI`; do not re-add a `PINGONE_JWKS_ENDPOINT` line.

**Verify:** `cd demo_mcp_gateway && npm run build` (exit 0) and `npm test` —
failures byte-identical to an untouched main checkout, plus 6 new passing
(`tests/vault.test.ts` additionally needs `demo_api_server/node_modules`
symlinked inside a worktree or it fails to run on missing `argon2`).
Revert-to-RED: drop the control-character strips from
`sanitizeHeaderDescription` and 3 of the 6 header tests fail.
NOT verified live: that the rejection now returns a clean 401 rather than 500 —
that needs a gateway image rebuild, since the gateway bakes its code.

### 2026-07-27 — ProofStrip claimed "then permitted" after the user declined the step-up gate

**Files changed:** `demo_api_ui/src/context/ProofOfEnforcementContext.js`,
`demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js`,
`demo_api_ui/src/components/TransactionConsentModal.tsx`, plus tests in
`src/context/__tests__/ProofOfEnforcementContext.test.js` and
`src/components/__tests__/TransactionConsentModal.declineScope.test.jsx`.

**What was broken:** Declining a high-value transfer rendered a green
ProofStrip reading "Step-up MFA required as expected — then permitted", right
below the chat's own "Transaction declined. The transaction was not completed."
The decline was never recorded anywhere the verdict could see: the trace ended
at `authorize.outcome === 'STEP_UP'`, `computeVerdict` scored that as the
expected gate, and "then permitted" was a hardcoded literal — an assumption, not
an observation.

**What was fixed:** `tokenChainTraceStore` gained `approvalOutcome` +
`ingestApprovalDeclined()`; `TransactionConsentModal.handleDenialConfirm` calls
it (one site — every parent routes its decline through there); `computeVerdict`
reports "you declined, so the transaction was not completed" for a declined
STEP_UP / HITL_REQUIRED gate.

**Do not break:** The state stays `denied-as-expected` (green ✅) — enforcement
did its job, the gate held. Only the result wording changes. An approved gate
must still read "then permitted" (pinned by test).

**Verify:** `cd demo_api_ui && npx vitest run
src/context/__tests__/ProofOfEnforcementContext.test.js
src/components/__tests__/TransactionConsentModal.declineScope.test.jsx`

### 2026-07-27 — Passkey step-up dead-ended when the credential lived on another device; SMS had no registration path on the dashboard

**Files changed:** `demo_api_ui/src/components/OtpStepUpModal.js`,
`demo_api_ui/src/components/Fido2Challenge.js`,
`demo_api_ui/src/components/UserDashboardPing2026.js`,
`demo_api_ui/src/components/__tests__/OtpStepUpModal.fidoAssertion.test.jsx`,
`demo_api_ui/src/components/__tests__/Fido2Challenge.registerOffer.test.jsx` (new).

**What was broken:** A FIDO2 device on the PingOne **account** does not mean the
credential exists on **this** device — a passkey saved to a phone reports the
same `NotAllowedError`. Both step-up surfaces treated that as terminal:
`OtpStepUpModal`'s recovery branch was gated on `!fidoEnrolled` (false whenever
any FIDO2 device is registered), so it fell through to "Passkey verification
failed. Try another method."; `Fido2Challenge` reported "cancelled or timed
out" and called `onError`, which the dashboard uses to close the overlay.
Separately the dashboard's Set Up MFA modal offered only Email OTP and Passkey —
there was no way to register SMS from it, though `/enroll/sms-init` and
`/enroll/sms-complete` already existed.

**What was fixed:** `NotAllowedError` (or "No credential") now routes to a
`passkey-register-offer` step in `OtpStepUpModal` regardless of `fidoEnrolled`,
offering local registration plus "Choose another method". `Fido2Challenge`
takes an optional `onRegisterPasskey`; when supplied it renders the offer
inline and **returns without calling `onError`** (calling it would close the
overlay and destroy the offer) — without the prop the old fail-out is
unchanged. The dashboard passes that prop to reopen its enroll modal, which now
also carries an SMS phone → activation-code sub-flow.

**Do not break:** `Fido2Challenge` must not call `onError` on the
offer-registration path — the dashboard's `onError` unmounts the component.
Keep the `onRegisterPasskey`-absent branch failing out as before; a test covers
that control. Do not restore the `!fidoEnrolled` gate: it is precisely what made
a cross-device passkey unrecoverable.

**Verify:** `cd demo_api_ui && npm run test:unit` (2345 pass; the 1
`adminSideNav.test.jsx` failure is pre-existing and reproduces on an untouched
main checkout) and `npm run build` (exit 0). `npx biome check` on the three
changed components reports 60 errors / 15 warnings — byte-identical to `HEAD`,
so no new lint debt. Revert-to-RED verified for both behaviors: restoring the
`!fidoEnrolled` gate fails the OtpStepUpModal offer test, and disabling the
`Fido2Challenge` branch fails its offer test while the control test stays green.
SMS enrollment was verified live against PingOne with a real number:
`/enroll/sms-init` returned `status: "ACTIVE"` immediately (worker-token enroll),
so in this environment the `ACTIVE`/`ENABLED` short-circuit is the path that runs
and no activation code is issued. The phone → activation-code sub-step is the
fallback for environments where PingOne returns an activation-required status;
that branch is not exercised here. Test device was deleted afterwards (204).

### 2026-07-27 — Step-up passkey (FIDO2) verification never reached the browser: options decoder rejected PingOne's real byte-array shape

**Files changed:** `demo_api_ui/src/components/OtpStepUpModal.js`,
`demo_api_ui/src/components/__tests__/OtpStepUpModal.fidoAssertion.test.jsx` (new).

**What was broken:** `handleFidoAssertion` decoded the WebAuthn challenge with
its own local `b64ToBytes`, which threw `Invalid base64url string` on anything
that is not a string. Live PingOne (env 01d89b06) returns
`publicKeyCredentialRequestOptions` as a JSON **string** whose `challenge` and
`allowCredentials[].id` are signed **byte arrays** — captured live as
`challengeType: "array(32)"`. So the step-up passkey path threw before
`navigator.credentials.get()` was ever called, and the catch reported the
generic "Passkey verification failed. Try another method." The recovery branch
did not fire either: it is gated on `!fidoEnrolled`, which is false whenever the
user already has a FIDO2 device registered server-side.

**What was fixed:** `handleFidoAssertion` now calls
`normalizePublicKeyRequestOptions` from `utils/passkeyCeremony` — the same
array-tolerant helper `Fido2Challenge.js` already uses on the live-proven
dashboard path — which JSON-parses the string form and decodes both base64url
and signed-byte-array shapes. The local duplicate decoder was removed.

**Do not break:** the outgoing assertion encoding stays **base64url with no
`origin` field**. That shape was live-verified end-to-end against PingOne
(`status: "COMPLETED"`, `completed: true`); do not "align" it with
`formatPublicKeyCredentialAssertion`'s standard-base64 + `origin` shape without
re-testing, as the two paths legitimately differ. Only the *decode* was wrong.

**Verify:** `cd demo_api_ui && npm run test:unit` (2342 pass; the 1
`adminSideNav.test.jsx` failure is pre-existing and reproduces on an untouched
main checkout) and `npm run build` (exit 0). Revert-to-RED: restore
`OtpStepUpModal.js` from `HEAD` and
`OtpStepUpModal.fidoAssertion.test.jsx` fails with the exact defect —
`Error: Invalid base64url string`, `navigator.credentials.get` never called.

### 2026-07-27 — Declining MFA left the agent dead-ended: only a browser reload restored it

**Files changed:** `demo_api_ui/src/components/TransactionConsentModal.tsx`,
`demo_api_ui/src/components/AIAgent.js`, `demo_api_ui/src/components/AIAgent.css`,
`demo_api_ui/src/services/agentAccessConsent.js`,
`demo_api_ui/src/components/UserDashboard.js`,
`demo_api_ui/src/components/UserDashboardPing2026.js`,
`demo_api_ui/src/components/__tests__/AIAgent.chips.test.js`,
`demo_api_ui/src/components/__tests__/UserDashboardPing2026.test.js` (canary
re-baseline), plus new `AIAgent.consentDeclineDismiss.test.js` and
`TransactionConsentModal.declineScope.test.jsx`.

**What was broken:** Two faults compounded. (1) `handleCancelClick` opened the
"Confirm decline" dialog from ANY step — the modal's titlebar `✕`, Escape and
backdrop route through it — so walking away from an expired OTP counted as
declining high-value consent. (2) Confirming set
`banking_agent_blocked_consent_decline` in `localStorage`, which disabled the
chat input, chips and every action except logout, with no in-app way to clear
it: the only clears were sign-out/sign-in or a successful consent (unreachable —
the agent was disabled). A browser reload also cleared it, because `AIAgent`'s
mount effect and `checkSelfAuth` call `setAgentBlockedByConsentDecline(false)`
unconditionally — so the "not available for this session" copy was never true.

**What was fixed:** Cancelling once identity proof has started (MFA / OTP /
contact / enrollment sub-steps) now just aborts the transaction via `onClose` —
only the consent review step can decline. The decline notice moved from a
permanent `.ba-consent-denied-banner` flex child of `.ba-body` into a
`DraggableModal` portal whose dismiss (button, `✕`, Escape) clears the block, so
the agent is usable again without signing out. Decline copy updated in both
dashboards and `AGENT_CONSENT_BLOCK_USER_MESSAGE` to match.

**Do not break:** Declining at the review step must still deny the transaction
and set the block (the HITL teaching moment). Server-side 428 enforcement in
`services/transactionConsentChallenge.js` / `routes/transactions.js` is
unchanged and must stay that way. The approve path (Agree & continue → confirm →
MFA → OTP → verify) is untouched.

**Verify:** `cd demo_api_ui && npx vitest run
src/components/__tests__/TransactionConsentModal.declineScope.test.jsx
src/components/__tests__/AIAgent.consentDeclineDismiss.test.js` then
`npm run test:unit && npm run build`.

### 2026-07-27 — Inspector "Form" output tab unreadable on MCP Inspector and PingGateway Inspector; PingOne Authorize had no Form tab

**Files changed:** `demo_api_ui/src/components/McpInspectorPage.jsx`,
`demo_api_ui/src/components/AgentGatewayTester.jsx`,
`demo_api_ui/src/components/PingOneAuthorizePage.jsx`.

**What was broken:** The Form output tab (all four `McpInspectorPage`
sources, plus `AgentGatewayTester`'s Tester tab) rendered `JsonFormView` —
a flex-row label/value layout with its own font — inside
`<pre className="inspector-shell-output-code">`, a wrapper built for raw
JSON text (monospace font, `white-space: pre-wrap`, code-box padding/
border/background). Every inherited property leaked onto the form's
labels and rows, so the Form tab rendered as cramped monospace text
instead of the intended label/value layout. `pingone-authorize` had no
Form tab at all.

**What was fixed:** Form tab now renders `JsonFormView` directly in
`.inspector-shell-output-body`, outside the `<pre>` — the other output
tabs (Response/Request/History/Result/Audit/Authorize/McpAudit) still
render inside `<pre className="inspector-shell-output-code">` unchanged.
Added a matching Form tab to `PingOneAuthorizePage`'s EvaluatePanel
(Decision/Response/Request/Form), reusing `lastTrace.response`.

**Do not break:** Non-form output tabs must keep rendering inside
`inspector-shell-output-code` (JSON-highlight styling depends on it) —
only the Form branch moves outside.

**Verify:** `cd demo_api_ui && npm run build` (exit 0); Form tab on
`/pingone-mcp-inspector` (all 4 sources), `/pinggateway-inspector?subtab=tester`,
and `/pingone-authorize` renders as label/value rows, not a monospace
code block.

### 2026-07-26 — Live Workbench control bar ate 280-350px of vertical space on short/small monitors, squeezing Demo script/Chat/Token Chain to a sliver

**Files changed:** `demo_api_ui/src/components/AIAgent.js`,
`demo_api_ui/src/components/AIAgent.css`,
`demo_api_ui/src/components/AgentModeSelector.css`,
`demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.css`.

**What was broken:** The split-column control bar (`.ba-hg` groups:
Configuration / Demo controls / Inspectors / Session) rendered four
full-width, generously-padded stacked boxes unconditionally — costing
~280-350px of vertical chrome on any monitor. On a short browser window
(~735px tall, a real small/non-maximized-monitor case) that left only
~200-300px for the entire Demo script + Chat + Token Chain row, reading as
tiny/cramped with `.luw-main`'s grey background dominating. Collapsing the
left icon rail (horizontal chrome) did nothing, since the constraint was
vertical. Live-measured breakdown of the excess: `ScopePicker.jsx` always
rendered a `<p className="scope-picker__hint">` duplicating the exact text
already in its own `title` tooltip (~59px for nothing); `AgentModeSelector`'s
`.ams--compact` variant had more internal padding than its compact intent
implied; `.ba-hg`/`.luw-topbar` padding and gaps were sized for a full
settings page, not a toolbar.

**What was fixed:** Merged the Inspectors and Session groups into one row
(Inspector buttons stay gated inside `{splitChrome && ...}`, never leaking
into the floating/flat widget mode), dropped the redundant "Demo controls"
label, and moved group labels inline (`.ba-hg-label` from `flex: 1 1 100%`
to `flex: 0 0 auto`). Hid `ScopePicker`'s duplicate hint paragraph when
rendered inside `.ba-hg` (info still available via the existing `title`
tooltip — same "hide long hint" pattern already used for
`.ba-agent-popout-hdr`). Trimmed `.ams--compact` padding/select height
(compact-mode only; the non-compact/full-settings usage is untouched).
Tightened `.ba-hg`/`.ba-hg--demo` padding and `.luw-topbar`/
`.luw-topbar__agent-tools` gaps.

**Do not break:** Inspector buttons (`MCP Inspector`/`P1AZ Inspector`/
`Agent Gateway Inspector`) must stay inside the `{splitChrome && (...)}`
guard — they were never meant to render in the floating/flat widget mode,
only in the Live Workbench's split-column header. `.ba-agent-popout-hdr`'s
existing scope-picker overrides are untouched (separate context, different
background color). `AgentModeSelector`'s base (non-`--compact`) styles are
untouched — the trims are scoped under `.ams--compact` only.

**Verify:** `cd demo_api_ui && npm run build` (0). Live-measured via a
worktree dev server (`demo_api_ui/CLAUDE.md`-adjacent recipe: symlink
`node_modules`/`certs`, `.env` with `REACT_APP_API_*`, serve on a spare
port, browse `https://local.ping-devops.com:<port>` to reuse the BFF
session): `.luw-topbar` height went from ~282px (no-wrap best case) to
~154px at full width, and from ~348px to ~188px at a constrained
1450×735px window. `npm run test:unit` has 49 pre-existing failures
unrelated to this change (missing context providers, router-outside-
`<Router>`, monospace/markdown regressions elsewhere) — confirmed none
touch `AIAgent.js`/`.css`, `AgentModeSelector`, or
`LiveUseCaseWorkbenchPage.js` (the latter untouched by this diff).

### 2026-07-26 — /dashboard TopNav hidden until auth resolved; TopNav session actions clipped off-canvas at 769-1350px

**Files changed:** `demo_api_ui/src/App.js`, `demo_api_ui/src/components/TopNav.css`,
`demo_api_ui/src/components/UserMenu.js`.

**What was broken:** (1) The `/dashboard` route wrapped the entire element —
`TopNav` included — in `loading ? null : (...)`, so the nav bar didn't render
until the auth check round-trip finished, even though `/dashboard` itself
needs no auth (guests see demo data; the comment on that route says so).
(2) `.topnav-right`'s children — `.topnav-right-scroll` (search/session
controls, meant to shrink/scroll) and `.topnav-session-actions` +
`.user-menu` (`flex-shrink: 0`, "always visible" per the existing comment
protecting a prior "no way to logout" fix) — have no working responsive
path between the (dead, unused) 768px hamburger breakpoint and ~1350px,
where the content naturally fits. Below that, nothing shrinks, so
`.topnav-session-actions`/`.user-menu` spill past the viewport and get
invisibly clipped by an ancestor's overflow-x:clip. Reproduced live at
1000-1250px on both `/dashboard` and `/use-cases/live` (page-agnostic, not
specific to either route) — `Sign Out` and the user-menu avatar become
unreachable. Two exploratory CSS-only fixes (`min-width`/`flex-shrink`
tweaks on `.topnav-right`) each just moved the collapse elsewhere; reverted
both — see history if revisiting.

**What was fixed:** (1) Moved the `loading` gate in the `/dashboard` route
down to only wrap the main content, so `TopNav` renders immediately.
(2) `UserMenu`'s dropdown already had a working, always-reachable Sign Out
and role-switch — but the switch entry was gated to `user?.role === 'admin'`
only, so customers had no fallback. Removed that gate (`onSwitchView &&`
instead of `user?.role === 'admin' && onSwitchView &&`) so it shows for any
role. Then hid the wide `.topnav-session-actions` text-button pair below
1350px (`@media (max-width: 1350px)`, placed *after* the base
`.topnav-session-actions` rule — an earlier draft put it before, which lost
to source order) since `UserMenu` now fully covers the same actions.

**Do not break:** Don't remove the `user?.role === 'admin'` intent entirely
from `UserMenu` — only the *gate* on showing the switch button changed; the
label logic (`isAdminView ? 'Switch to Customer View' : 'Switch to Admin
View'`) already handled both roles correctly and was untouched. Don't
re-add `min-width: 0` to `.topnav-right` or set `flex-shrink: 0` there —
both were tried live and each re-broke it a different way (collapse
Sign Out to nothing, or make the whole cluster refuse to shrink and
overflow anyway). The true mobile breakpoint (≲860px) still has a
separate, pre-existing, unaddressed gap: the admin sidebar itself doesn't
collapse, so TopNav clipping persists there too — that's out of scope for
this fix, don't assume it's covered.

**Verify:** `cd demo_api_ui && npm run build` (0). Live: at 1000-1250px,
`.topnav-session-actions` computed `display: none`, `.user-menu`'s
`getBoundingClientRect().right` stays inside the viewport; opening the user
menu shows both "Switch to Admin/Customer View" (any role) and "Sign Out".
Above 1350px the full-text buttons return with no clipping (no regression).

### 2026-07-26 — Landing page "Use Cases" silently no-op'd for signed-out visitors, and the header overflowed instead of wrapping

**Files changed:** `demo_api_ui/src/components/LandingPage.js`,
`demo_api_ui/src/components/LandingPage.css`.

**What was broken:** Two independent home-page defects, both reproduced live
against the running stack. (1) `handleUseCases` always called
`navigate("/use-cases/live")`; that route's guard in `App.js`
(`user && appFlags.showUseCaseLauncher ? ... : <Navigate to="/" replace />`)
silently bounced signed-out visitors straight back to `/` with zero feedback —
the button looked completely dead. `handleAdminDashboard` already had the
correct pattern (kick off `/api/auth/oauth/login` when there's no `user`) but
`handleUseCases` never got it. (2) `.landing-header-actions` (the logged-out
header's button row) had `flex-shrink: 0` and no `flex-wrap`, so at narrow
viewports the 4 nowrap buttons (471px) exceeded the viewport and got clipped
inside the sticky header instead of reflowing — "Use Cases" and "Setup"
disappeared off the edge on resize.

**What was fixed:** `handleUseCases` now checks `user` and redirects to
`/api/auth/oauth/login` when signed out, mirroring `handleAdminDashboard`.
`.landing-header-actions` gained `flex-wrap: wrap`, matching the existing
`.landing-hero-actions` rule.

**Do not break:** Don't revert `handleUseCases` to an unconditional `navigate`
— that reintroduces the silent bounce-back for anonymous visitors.
`handleCustomerDashboard` has the same latent unconditional-`navigate` shape
but was out of scope for this report — do not assume it's fixed too.

**Verify:** `cd demo_api_ui && npm run build` (0). Live: at width 390 the
header actions row wraps onto its own line instead of clipping
(`.landing-header-actions` scrollWidth/clientWidth both fit within the
viewport, `flexWrap: wrap`); clicking "Use Cases" while signed out navigates
to the PingOne `/signon` URL instead of silently returning to `/`.

### 2026-07-26 — A vertical mismatch silently destroyed a user's accounts AND transaction history

**Files changed:** `demo_api_server/services/verticalAccountSnapshots.js` (new),
`demo_api_server/data/store.js`, `demo_api_server/routes/accounts.js`,
`demo_api_server/services/demoAgentLangGraphService.js`,
`demo_api_server/src/__tests__/verticalAccountSnapshots.test.js` (new).

**What was broken:** Two sites reacted to a vertical mismatch by calling
`dataStore.reseedUserForVertical()` — `routes/accounts.js` on an account read and
`demoAgentLangGraphService.ensureAccountsForVertical()` on an agent dispatch. That
function deletes **every account and every transaction** for the user, reseeds from the
target vertical's profile, and `persistAllData()`. So an SE who had built up demo state
mid-demo — transfers, HITL approvals, step-ups — lost all of it the moment anything
touched accounts under a different vertical. HTTP 200, no error, no warning. It was also
irreversible: `demoScenarioStore` held a single `accountSnapshot` slot per user, so the
switch overwrote the only copy of what was there before.

**What was fixed:** Reseeding is *also* how vertical switching works (you cannot show
healthcare with banking accounts), so the fix makes the switch lossless rather than
blocking it. `switchUserVertical()` snapshots the outgoing vertical's accounts +
transactions under a per-vertical key (`verticalSnapshots[<id>]`), restores the incoming
vertical's snapshot when one exists, and reseeds **only** when that vertical has never
been visited. `currentSeededVertical` records which vertical the live rows belong to.
Both call sites now go through it. The wipe itself was extracted to
`dataStore.purgeUserFinancialData()` so restore and reseed share one implementation of
the transaction-reference sweep.

**Do not break:** Do not restore a snapshot without purging first — restoring on top of
another vertical's rows produces the mixed-vertical state this path exists to prevent.
Do not snapshot when the outgoing vertical is unknown (cold session): the rows are
unattributable and filing them under the target corrupts that target's snapshot. Do not
write an empty snapshot over a real one. The legacy single-slot `accountSnapshot` is
still read by `restoreAccountsFromSnapshot` for cold-start recovery — leave it alone.

**Verify:** `CI=true npx jest src/__tests__/verticalAccountSnapshots.test.js` (8 pass).
Disable the restore branch in `switchUserVertical` and the "switching back RESTORES
accounts and transactions" test must fail — that is the proof the round trip is lossless
rather than merely non-throwing.
### 2026-07-26 — Chip path opened the MFA modal for CIBA-required step-up (CIBA bypass)

**Files changed:** `demo_api_ui/src/services/demoAgentService.js`,
`demo_api_ui/src/components/AIAgent.js`,
`demo_api_ui/src/services/__tests__/callMcpTool.stepUpAuthorizeIngest.test.js`.

**What was broken:** `callMcpTool` THROWS on `mcp_step_up_required` (HITL soft-resolves;
step-up does not), and the Error it built dropped `step_up_method` — so `runAction`'s
`err?.code === "mcp_step_up_required"` branch could not tell CIBA from MFA and always
ran the P1MFA challenge + OTP modal. UC22 declares `step_up_method: 'ciba'`. Both MFA
and CIBA set `session.stepUpVerified`, so satisfying the MFA modal made the retry PERMIT
with **no out-of-band approval** — a CIBA bypass on the chip/runAction path. The soft
(non-throwing) path already branched correctly; only the throw path was wrong.

**What was fixed:** `demoAgentService.callMcpTool` now carries `step_up_method`,
`step_up_acr`, `transaction_amount` and the from/to account ids onto the thrown Error.
`AIAgent.runAction`'s catch branches on `err.step_up_method === 'ciba'` and runs the same
initiate → `/ciba-approve` tab → `pollCibaStepUp` flow the soft path uses, returning
before any MFA call; the P1MFA challenge now runs only for `p1mfa` or an unspecified
method (the prior default).

**Do not break:** Never drop `step_up_method` from the Error `callMcpTool` throws — that
single omission is the whole bypass, and it is invisible because the MFA modal looks like
correct behavior. Keep the `return` after the CIBA branch so MFA can never also fire.

**Verify:** `CI=true npx vitest run
src/services/__tests__/callMcpTool.stepUpAuthorizeIngest.test.js
src/components/__tests__/AIAgent.cibaStepUp.test.js` (7 pass). Both halves are
revert-proved: restore `demoAgentService.js` alone and 1 of its 4 fails; restore
`AIAgent.js` from `origin/main` and the `ciba` case of `AIAgent.cibaStepUp` fails while
both MFA cases still pass — the exact shape of the bug. That suite asserts on the next
network call the UI makes (`/api/auth/ciba/initiate` vs `/api/auth/mfa/challenge`), which
is the observable discriminator between the two flows.
### 2026-07-26 — Stale vault worker secret wedged every getManagementToken() caller

**Files changed:** `demo_api_server/services/configStore.js` (BOOTSTRAP_ALLOWLIST),
`demo_api_server/src/__tests__/workerCredsBootstrap.test.js` (new).

**What was broken:** `BOOTSTRAP_ALLOWLIST` (where `.env` outranks vault/LMDB) listed
`pingone_mgmt_*` and `pingone_management_*` but NOT the WORKER family — and
`pingOneClientService.resolveWorkerCredentials` tries `PINGONE_WORKER_CLIENT_ID/SECRET`
**first**. The vault held a secret for worker client `89ad8921` that PingOne rejected
while `.env`'s was valid, so the vault copy won and every `getManagementToken()` caller
401'd: `/api/admin/mgmt-api`, `/api/admin/scope-audit`, `routes/demoProvisioning.js`,
`routes/demoScenario.js`.

The symptom actively misled. The `basic` attempt failed `invalid_client`, so the
basic→post self-heal in `services/pingOneTokenAuth.js` retried with `post`; the app
only accepts `client_secret_basic`, so the surfaced error was **"Request denied:
Unsupported authentication method"** — which reads as an auth-METHOD misconfiguration.
The method was correct throughout (`basic`, order `["basic","post"]`); only the secret
was wrong.

Proof: in the running container, minting BEFORE `vaultLoader.loadVaultIntoConfigStore()`
succeeded and AFTER it 401'd, with the worker client id identical and only the secret's
sha256 changing (`f08f44f8…` → `3f7f49fa…`).

**What was fixed:** added `pingone_worker_client_id`, `pingone_worker_client_secret`,
`pingone_worker_token_client_id`, `pingone_worker_token_client_secret` to
BOOTSTRAP_ALLOWLIST, so `.env` is authoritative for them exactly as it already was for
the mgmt family.

**Do not break:** entries must stay lowercase — `getEffective()` lowercases the key
before the membership test, so an uppercase entry silently never matches. Note the
tradeoff this makes explicit: worker credentials set through the /config UI (vault) no
longer override `.env`. That is the same contract the mgmt family already had, and it
is what makes a stale cached secret recoverable by editing `.env`.

**Verify:** `CI=true npx jest src/__tests__/workerCredsBootstrap.test.js` (6 pass);
revert `configStore.js` alone and 4 of the 6 fail.

### 2026-07-26 — MCP_RESOURCE_SERVER_AUDIENCE was accepted on every MCP callback, not just the portfolio read

**Files changed:** `demo_api_server/middleware/auth.js`,
`demo_api_server/tests/mcpResourceServerAudience.regression.test.js` (new).

**What was broken:** `validatePingOneCoreToken` pushed `MCP_RESOURCE_SERVER_AUDIENCE` into the
shared `gwAuds` list and folded the `/api/investment/.../portfolio` route into the same
`isMcpCallback` predicate as the banking read/write callbacks. The audience check is
`isMcpCallback && tokenAuds.some((a) => gwAuds.includes(a))`, so an A2A investment
token (`aud=mcp-resource-server.ping.demo`, scopes `invest:read`) satisfied the audience gate on
`POST /api/transactions`, `GET /api/accounts/my`, and the other write callbacks —
routes it should never reach. Confirmed by reverting the fix: the regression suite's
two rejection tests both fail against the old code.

**What was fixed:** Split the predicate. `isMcpBankingCallback` keeps the banking /
Path-B routes and matches against `gwAuds`; `isInvestPortfolioCallback` is separate and
accepts **only** `MCP_RESOURCE_SERVER_AUDIENCE`, on the portfolio path only. `MCP_RESOURCE_SERVER_AUDIENCE`
is no longer added to `gwAuds` at all.

**Do not break:** Never re-add `MCP_RESOURCE_SERVER_AUDIENCE` to `gwAuds` — that single line is
the whole bug. The gateway/PingGateway/MCP-server audiences must keep working on the
banking callbacks, and an enduser-audience token must keep working on the portfolio
route; both are covered by regression tests.

**Verify:** `CI=true npx jest tests/mcpResourceServerAudience.regression.test.js` (5 pass).
Revert `auth.js` alone and 2 of the 5 must fail — that is the proof the gate is real.

### 2026-07-26 — Generic MCP Inspector profiles were reachable by any signed-in customer (stdio = RCE on the BFF host)

**Files changed:** `demo_api_server/routes/mcpInspector.js`,
`demo_api_server/routes/mcpPingOneAdminAuth.js`,
`src/__tests__/mcpInspectorProfiles.test.js`, `src/__tests__/mcpPingOneAdminAuth.test.js`.

**What was broken:** `app.use('/api/mcp/inspector', mcpInspectorRoutes)` mounts this
router WITHOUT `authenticateToken` (so banking `tools/list` can fall back to the local
catalog for anonymous visitors). On top of that: `POST /profiles` and
`DELETE /profiles/:id` were gated by `requireSession` only — any signed-in **customer**
— and the non-default-profile branches of `GET /tools?profile=` and `POST /invoke` had
**no gate at all**, short-circuiting to `handleProfileTools`/`handleProfileInvoke`
before any user check. A `stdio` profile is dispatched by
`services/mcpTransports/stdio.js`, which runs `spawn(profile.command, profile.args)` on
the BFF host. Customer creates a stdio profile with an arbitrary command, invokes it,
gets remote code execution; `http`/`websocket` profiles are SSRF by the same path.
`mcpPingOneAdminAuth`'s `/login` used `middleware/auth.requireAdmin`, which reads
`req.user` and therefore 401'd every cookie-only browser redirect.

**What was fixed:** A local `requireAdminSession` (session-cookie based, mirroring the
`/api/mcp/audit` check — `middleware/auth.requireAdmin` cannot be used on a router
mounted without `authenticateToken`) now gates profile create/delete AND both
non-default dispatch branches. Same gate replaces `requireAdmin` on the PingOne admin
`/login`.

**Do not break:** `GET /profiles` and the DEFAULT banking profile's `tools`/`invoke`
path stay ungated on purpose — anonymous visitors must still get the local-catalog
fallback. Only the non-default (`?profile=` / `body.profile`) branches are admin-gated.
Never swap `requireAdminSession` for `middleware/auth.requireAdmin` here; this router
has no `req.user`.

**Verify:** `CI=true npx jest src/__tests__/mcpInspectorProfiles.test.js
src/__tests__/mcpPingOneAdminAuth.test.js` (28 pass), incl. a customer-role stdio
create → 403 with `mockStdioListTools` never called.

### 2026-07-25 — CIBA HITL-consent credit was session-global, unbound, and eager-consumed (code-review fixes)

**Files changed:** `demo_api_server/services/hitlCredit.js` (new), `routes/ciba.js`,
`routes/transactions.js`, `services/transactionAuthorizationService.js`,
`services/mcpToolAuthorizationService.js`, `src/__tests__/hitlCredit.test.js` (new).

**What was broken:** The CIBA out-of-band approval credit (`req.session.hitlVerified`)
that discharges the HITL consent 428 was (1) not bound to the approved amount — a
small CIBA approval discharged consent for any larger unrelated transfer within the
5-min TTL; (2) eager-consumed (zeroed on read) by two uncoordinated consumers
(`routes/transactions.js` and `services/mcpToolAuthorizationService.js`), so an
unrelated tool call burned the credit out from under a pending browser retry
(double CIBA round-trip); (3) `useCaseId` was cleared only on step-up-fresh, not
hitl-fresh, risking a re-forced CIBA loop.

**What was fixed:** New `hitlCredit.js` owns an amount-bound, consume-on-use credit.
`ciba.js` records `hitlApprovedAmount` at both approval set-sites. Consumers now call
`hitlCredit.isFresh(session, { amount })` (bound) and consume ONLY when a gate was
actually discharged: `transactionAuthorizationService` returns `hitlConsentDischarged`
and `transactions.js` consumes on that signal; the MCP engine consumes at the exact
HITL-gate site it suppresses instead of eager-zeroing at read. `useCaseId` now also
drops on hitl-fresh.

**Do not break:** DENY > STEP_UP > HITL precedence is unchanged — `hitlAlreadyVerified`
only skips the consent 428, never a step-up or amount DENY. The bearer/agent path still
uses `cibaTransactionReceipt` (amount+action bound); this change only touches the
session-cookie path. `isFresh()` must never consume; only `consume()` spends the credit.

**Verify:** `CI=true npx jest src/__tests__/hitlCredit.test.js` (9/9, incl.
amount>approved → not fresh); plus `mcpToolAuthorizationService`,
`transactionAuthorizationService`, `transferHitlIntegration`, `ciba` suites (108 pass).
### 2026-07-25 — ProofStrip "Incomplete" on successful reads: no-bearer session failed open to an ungated local read, skipping PingOne Authorize

**Files changed:** `demo_api_server/services/mcpToolPipeline.js` (no-bearer
branch), `demo_api_server/src/__tests__/mcpToolPipeline.characterization.test.js`,
`demo_api_server/src/__tests__/mcpToolPipeline.authzBypass.test.js`.

**What was broken:** UC1 "Delegated access with proof" (and every read use case
whose `evidence.tokenChain` lists `authorize-decision`) rendered the ProofStrip
"Incomplete ⚠️" on a tool call that actually succeeded. Root cause: when the
server-side session was lost but the browser `_auth` cookie survived,
`restoreSessionFromCookie` rebuilds a token-less session (`accessToken:
'_cookie_session'`, BFF pattern — the cookie carries no access/refresh token).
`getSessionBearerForMcp` then returns null, so `runMcpToolPipeline` took the
no-bearer branch and, when a session user was present, served the tool through
`callToolLocal` and `return`ed **before** the PingOne Authorize gate. No
`mcpAuthorizeEvaluation` was produced, so the UI never set `trace.authorize`,
`computeVerdict` could not match the `authorize-decision` evidence step, and the
verdict was `incomplete`. Session-state dependent ("wrong a lot"): a healthy
bearer ran the real exchange → gateway → Authorize path and showed Verified.
This is NOT the expired-token path (expired+refresh silently refreshes;
expired-no-refresh throws `TOKEN_INACTIVE` → 401). The sibling exchange-failure
fallback (F5) was already made non-bypassing (`ff_local_fallback_on_exchange_failure`,
default OFF); the no-bearer branch had been missed.

**What was fixed:** The no-bearer branch no longer falls back to the local
handler. It now returns the re-auth block from `mcpNoBearerResponse` (which
already distinguishes the cookie-only `session_not_hydrated` case from a plain
`authentication_required`) for the session-user case too, so the SPA restores
real tokens and the retry runs the real exchange → gateway → Authorize path —
producing a genuine authorize decision the ProofStrip can score. Matches
`restoreSessionFromCookie`'s own contract that token-needing routes must error
for a cookie-restored session.

**Do not break:** the no-bearer path must NOT run `callToolLocal` (that bypasses
the gateway, the MCP server, and the Authorize gate). `callToolLocal` /
`localResultOutcome` remain reachable only via the opt-in, default-OFF
exchange-failure fallback (F5). Public catalog reads (e.g. `branch_hours`) are
handled before the pipeline and are unaffected. Tradeoff accepted by the owner:
a cookie-only / unhydrated-session deployment now re-auths on the first tool call
instead of silently serving a local read.

**Verify:** `cd demo_api_server && CI=true npx jest
src/__tests__/mcpToolPipeline.characterization.test.js
src/__tests__/mcpToolPipeline.authzBypass.test.js
src/__tests__/mcpToolPipeline.confusedDeputy.test.js
--testPathIgnorePatterns="/node_modules/"` (all green). Live: with a healthy
session, dashboard "show my balance" → ProofStrip **Verified** (gate ran); after
a session-store loss (cookie-only), the same chip triggers re-auth instead of a
silent local read.

### 2026-07-25 — UC31 weather out-of-scope deny showed generic `tool_failed`/`gateway_policy_denied` instead of the real reason

**Files changed:** `demo_api_server/services/demoAgentLangGraphService.js`
(in-process `weather` handler), `demo_api_ui/src/services/demoAgentService.js`
(`ingestLegacyRunTrace`), `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`
(api-step narrative + `buildRunStory`), `demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`,
`demo_api_server/config/useCases.js` (UC31 `evidence.tokenChain`),
`demo_api_ui/src/context/__tests__/ProofOfEnforcementContext.test.js`.

**What was broken:** UC31 (`weather-mcp-texas-deny`, chip "what's the weather in
Miami", `expectedOutcome: 'DENY'`) is run via the in-process `/api/agent/invoke`
heuristic path (the weather chip forces `forceHeuristic`). The Agent Gateway
correctly denies with the specific code `weather_scope_denied` + message "weather
scope restricted to Texas — city not recognized as Texas", but the in-process
weather handler read only `parsedErr.error` (generic `gateway_policy_denied`) and
returned an envelope with no `error`/`gatewayErrorCode`/`message` fields. The UI's
`ingestLegacyRunTrace` then degraded it to `{ error: "tool_failed", message:
"gateway_policy_denied" }` and the run rendered as a failure — hiding the actual
control and making an expected deny look broken. (The external AG-UI `/api/agent/run`
SSE path preserves the reason; only the in-process path collapsed it.)

**What was fixed:** (1) The weather handler now prefers the human-readable gateway
message in the reply and carries structured `error` + `gatewayErrorCode` + `message`
on the deny envelope; it also stamps `expected: true` when `req.body.useCaseId`
maps to a catalog use case whose `expectedOutcome === 'DENY'`. (2) `ingestLegacyRunTrace`
detects a gateway denial (`data.gatewayErrorCode` / `error === 'gateway_policy_denied'`),
surfaces the specific code + reason, sets `denied: true`, and passes `expected`
through. (3) `buildTraceSteps` frames an expected deny (`mcpResult.denied &&
mcpResult.expected`): the api card narrative reads "Expected DENY — the control
working as designed" and `buildRunStory` returns `outcome: "ok"` with an
"Expected DENY — the control worked" headline instead of "stopped with an error".
(4) The prominent **ProofStrip verdict** showed "Incomplete ⚠️" because UC31's
catalog `evidence.tokenChain` listed `sim-gateway-deny` — an event only the
attack-sim path emits, never the chip/agent path — so `computeVerdict` always
found a missing step. Changed UC31's `evidence.tokenChain` to `['user-token',
'tool-dispatched']` (matching its permit twin UC30); `tool-dispatched` is
satisfied by `trace.mcpResult`, so the verdict flips to the existing
`denied-as-expected` state → ProofStrip renders "Verified (denied as expected)"
with ✅. No verdict-engine code change — `computeVerdict` already supported it.
(5) On the `/use-cases/live` external AG-UI path the verdict resolved to the wrong
weather use case (UC30 "Verified" permit instead of UC31 "denied as expected"):
the clicked `useCaseId` was dropped in the browser (the `banking-agent-prefill`
handler ignored `e.detail.useCaseId`, and `sendAsNl`→`sendAsNlInner`→`aguiRun`→
`useAgentRun.run` had no `useCaseId` slot), so the server fell back to
`deriveUseCaseId('get_weather')` which returns the FIRST `get_weather` catalog
match — UC30. Threaded `useCaseId` end-to-end (optional param) through
`demo_api_ui/src/components/AIAgent.js` and `demo_api_ui/src/hooks/useAgentRun.js`
so the AG-UI POST body carries the slug; the server already forwards a
client-supplied slug (`agentRun.js` → `agentTool.js` → `bffMcpToolExecutor.js`
`resolveChipUseCaseId`). `deriveUseCaseId` left unchanged (it can't tell Miami
from Austin — that's outcome, not tool/args).
(6) On the external LLM (AG-UI) path the banking-persona agent replied with a
greeting instead of explaining the out-of-scope weather deny. Two-part fix in
`langchain_agent`: (a) system-prompt rule 21 (`src/agent/langchain_mcp_agent.py`)
tells the agent to state a policy denial + reason and not greet/deflect; (b) a
deterministic fallback (`src/api/message_processor.py`) — if a tool result was a
policy denial (`gateway_policy_denied`/`weather_scope_denied`/…) and the model's
reply never surfaced it, emit `❌ <reason>` as its own message (parity with the
in-process path). Also captures the non-streaming (`on_chat_model_end`) reply
into `turn_reply_text` so the "did the model explain it" check works for
poll-based providers. 5 new tests in `tests/test_message_processor.py`.

**Do not break:** The deny *mechanism* is unchanged — this only surfaces the reason
and reframes an already-denied call. `expected` is gated on the catalog's
`expectedOutcome === 'DENY'`, so a non-catalog / freehand weather deny still reads
as a normal deny (real reason, no green "expected" framing). The structured fields
are only added on the two weather deny returns; the success path is untouched.

**Verify:** `cd demo_api_ui && npm run build` (exit 0);
`cd demo_api_ui && CI=true npx vitest run src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`
(43/43, incl. 3 new expected-DENY tests); BFF `node --check` on the handler +
`require('./config/useCases')` UC31 lookup returns `expectedOutcome: 'DENY'`.
Live: re-run UC31 on `/use-cases/live` (or the weather chip) — the Resource-server
card shows `weather_scope_denied` + the Texas message and the run reads "Expected
DENY", not `tool_failed`.

### 2026-07-25 — A2A investment delegation: last 2 of 5 stacked causes (fully working end to end now)

**Files changed:**

- `demo_api_server/.env.example`

**What was broken:** Continuing from the "Every A2A specialist delegation
silently denied" entry below (image rebuilds + authz-server creds), fixing
those two got the gateway chain to a full PERMIT, but the live UI test still
failed with two more stacked causes, live-diagnosed via temporary debug
logging in the running containers (reverted after diagnosis):

1. `demo_mcp_resource_server`'s running Docker image predated commit `64dbb43b7`
   ("disable TLS cert verification for internal BFF calls") by two days —
   same "stale image" class of bug as `demo_mcp_gateway`. The compiled
   `investToolHandler.js` only read `BANKING_API_BASE_URL` (unset) with a
   `http://localhost:3001` fallback — never the correct
   `DEMO_API_BASE_URL=https://demo-api-server:3001` — so `get_portfolio_summary`
   tried to call the BFF on `localhost` *inside the mcp-resource-server container*
   (ECONNREFUSED, surfaced as an empty-message `AggregateError`, which is why
   the earlier symptom was a blank `{"error":""}` instead of a real message).
2. Fixing #1 reached the real BFF and got a real `401`: `middleware/auth.js`
   already has the exact accommodation for this ("A2A investment specialist
   callback: mcp-resource-server calls the BFF with a gateway-exchanged token
   (aud=mcp-resource-server.ping.demo)") gated on `MCP_RESOURCE_SERVER_AUDIENCE` — but that env
   var was never set in `demo_api_server/.env`, so the accommodation never
   activated and the audience check rejected the token mcp-resource-server legitimately
   received from Exchange #3.

**What was fixed:** Rebuilt the `demo_mcp_resource_server` image (no source change
needed, same as `demo_mcp_gateway`). Added
`MCP_RESOURCE_SERVER_AUDIENCE=mcp-resource-server.ping.demo` (documented here in
`.env.example`; also added directly to the local `demo_api_server/.env`,
which is gitignored).

**Verify:** Live-verified via a real logged-in browser session: POST
`{"prompt":"hand off to a specialist","vertical":"banking","forceHeuristic":true}`
to `/api/agent/invoke` now returns `"Delegation complete — Investment Advisor
retrieved get portfolio summary on your behalf (act-chain depth 2)."` —
confirmed on two consecutive calls. If `MCP_RESOURCE_SERVER_AUDIENCE` or either image
goes stale again, the symptom returns as `mcp_error` / `tool_error` on this
same prompt, not this specific message.

### 2026-07-24 — UC13 confused-deputy attack sim PERMITted instead of DENY

**Files changed:**

- `demo_api_server/services/mcpGatewayClient.js` — send a new `X-Demo-Force-Actor`
  header alongside the existing rogue `X-Act-Client-Id` override.
- `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts` — honor
  `x-demo-force-actor` (same internal-secret trust gate as the other bridged
  headers) to prefer the bridged actor over an already-present native `act` claim.
- `ping-gateway/scripts/groovy/p1az-decision.groovy` — same bypass for the IG
  path (the default active route, `ff_mcp_gateway_pinggateway=true`).
- `demo_api_server/config/useCases.js` — rewrote the UC13 catalog entry
  (`pingOneSolution`/`whatLong`/`businessValue`/`whatToSay`/`codeRefs`) to teach
  the native-claim-vs-header mechanism in the Explain modal.
- `docs/use-cases/confused-deputy-actor-injection.md` — regenerated via
  `npm run use-cases:docs:gen` (auto-generated from the catalog above).

**What was broken:** The sim overrode the `X-Act-Client-Id` header to a rogue
actor, but a 2026-06-19 rollout (the null-safe `act` resource-attribute SPEL,
see `docs/ACT_CLAIM_VERIFICATION.md`) made PingOne stamp a **native** `act`
claim on this hop. Both the Node gateway and PingGateway's Groovy filter prefer
a native claim over any header — correct security behavior — so the rogue
header was silently shadowed by the real actor's native claim on every run.
PingOne Authorize saw the real actor and correctly PERMITted; the sim's
injection technique was stale, not the enforcement.

**What was fixed:** Added `X-Demo-Force-Actor`, a new internal-secret-gated
header sent ONLY by the confused-deputy sim path, that tells the gateway/IG to
prefer the bridged header over an already-present native claim for that one
call. Real traffic never sets it — native-over-header precedence is unchanged
for every normal call. Live-verified against the real PingOne Authorize
decision endpoint: `ActClientId` now carries the rogue value and the response
includes the `mcp-invalid-actor` DENY statement.

**Do not break:** Don't weaken native-over-header precedence for real traffic —
`X-Demo-Force-Actor` must stay gated behind the same `x-internal-gateway-secret`
trust check as `X-Act-Client-Id`/`X-May-Act-Sub`, and only
`attackSimulatorService`'s `rogue-actor` sim should ever set it.

**Verify:** `cd demo_mcp_gateway && CI=true npx jest tests/gatewayTokenPolicy.test.ts tests/authorizeMcpRequest-exchange.test.ts tests/authorizeMcpRequest-denyProvenance.test.ts tests/authorizeMcpRequestCore.uc16.test.ts tests/authorizeMcpRequest-validation.test.ts tests/authorizeMcpRequest.productionPath.test.ts tests/authorizeMcpRequestCore.introspectionUnavailable.test.ts --testPathIgnorePatterns="/node_modules/"` (55 passed);
`cd demo_api_server && CI=true npx jest src/__tests__/attackSimulator.authorizeEvidence.test.js src/__tests__/mcpToolPipeline.confusedDeputy.test.js src/__tests__/bffMcpToolExecutor.runPipelineForSim.test.js --testPathIgnorePatterns="/node_modules/"` (12 passed);
`cd demo_authz_server && node --test decision.confused-deputy.test.js decision.mockCloudParity.test.js` (16 passed);
`cd demo_api_server && npm run use-cases:docs:check` (48 docs current).
Live re-verified against the running stack (scratch copy into main checkout's
mount source, reverted after): real PingOne Authorize DECISION flipped from
PERMIT to DENY for the same rogue-actor sim run.

### 2026-07-24 — Every A2A specialist delegation silently denied (3 stacked causes)

**Files changed:**

- `demo_api_server/scripts/refresh-service-envs.js`
- `demo_api_server/src/__tests__/refreshServiceEnvs.authzWorkerCreds.test.js` (new)

**What was broken:** UC2/UC2.5 (A2A specialist delegation — "hand off to a
specialist") failed end-to-end. Live-diagnosed via a real browser session
(login + `/api/agent/invoke`), three independent causes stacked:

1. `demo_mcp_gateway`'s running Docker image was built 2026-07-21, two days
   before commit `701efe988` ("restore NestedAct, PEP depth skip, and
   exchanger actor mint") landed on 2026-07-23. The depth-2 nested-act
   exemption that fix added was never live — every specialist call hit the
   single-actor allow-list check and failed `unauthorized_actor`, even
   though the token itself was correctly nested (verified `actChainDepth: 2`
   both client- and gateway-side once the image was rebuilt).
2. Fixing #1 exposed `user_lookup_failed: unable to verify user status` —
   `demo_authz_server`'s `pingOneUserLookup.js` needs
   `PINGONE_WORKER_CLIENT_ID`/`PINGONE_WORKER_CLIENT_SECRET` to call the
   PingOne Management API for its Rule 0a2 user-existence check, but
   `refresh-service-envs.js`'s `demo_authz_server` block never emitted
   either — every decision request threw "not configured", which the mock
   engine turns into a fail-closed DENY.
3. Fixing #1 and #2 gets the full chain to PERMIT
   (`P1AZDecision: forwarded`, `BackendExchange: forwarded` to the real
   `mcp-resource-server` backend) — `get_portfolio_summary` itself then returns an
   empty-error envelope (`{"error":""}`). This is a separate, narrower,
   tool-specific data issue (not an auth/infra bug) and is NOT fixed by this
   entry — noted here so it isn't mistaken for a regression of #1/#2.

**What was fixed:** Rebuilt the `demo_mcp_gateway` Docker image (no source
change needed — the fix already existed, just never shipped to the running
container). Added `PINGONE_WORKER_CLIENT_ID`/`_SECRET` to the generator's
`demo_authz_server` block.

**Do not break:** This is the SAME service (`demo_mcp_gateway`) as the
"ping-gateway's mcp-delegation route" entry above — do not confuse the two;
`ping-gateway` is the separate Java/OpenIG gateway. Any future
`demo_mcp_gateway` source fix needs an image rebuild to take effect locally
(`docker compose build mcp-gateway && docker compose up -d --force-recreate
--no-deps mcp-gateway`) — a plain restart reuses the stale image.

**Verify:** `cd demo_api_server && CI=true npx jest src/__tests__/refreshServiceEnvs.authzWorkerCreds.test.js --testPathIgnorePatterns="/node_modules/"`, then live: log in, POST `{"prompt":"hand off to a specialist","vertical":"banking","forceHeuristic":true}` to `/api/agent/invoke`, confirm the gateway audit trail shows `"policy":{"passed":true}` and `"authorize":{"decision":"PERMIT"}` (the remaining `get_portfolio_summary` empty-error issue is tracked separately, not by this check).

### 2026-07-24 — ping-gateway's mcp-delegation route silently failed to build

**Files changed:**

- `demo_api_server/scripts/refresh-service-envs.js`
- `demo_api_server/src/__tests__/refreshServiceEnvs.delegationRoute.test.js` (new)

**What was broken:** `ping-gateway/config/routes/03-mcp-delegation.json`
substitutes `DELEGATION_RESOURCE_AUDIENCE` / `DELEGATION_RESOURCE_SCOPE` into
`DelegationProtection`'s `resourceId` and `DelegationResourceServerFilter`'s
`scopes`, but the generator never emitted either — PingGateway rejected the
route at boot with `JsonValueException: .../resourceId: Expecting a value`.
Gateway still started fine on its other 15 routes, so this went unnoticed.

**What was fixed:** Added both to the generator's `ping-gateway/.env` block.
`DELEGATION_RESOURCE_AUDIENCE` must be an absolute URI (same shape as every
other route's `PG_GATEWAY_RESOURCE_ID`) — a bare `"test"` string builds the
JSON fine but then NPEs in `ResourceId.resourceId()` (`URI.getScheme()` is
null without a scheme), so it's `https://test`, matching the route's own
comment that this is a fixed test resource, not a real production audience.
`DELEGATION_RESOURCE_SCOPE` is a plain scope string (`test`), not a URI.

**Do not break:** Every other `writeEnvFile('ping-gateway', ...)` key is
unchanged. This route is a Phase 2 demo/scaffold with no real backend traffic
riding on it — do not wire `DELEGATION_RESOURCE_AUDIENCE`/`_SCOPE` to a real
production resource without deliberately deciding to make this route live.

**Verify:** `cd demo_api_server && CI=true npx jest src/__tests__/refreshServiceEnvs.delegationRoute.test.js --testPathIgnorePatterns="/node_modules/"`, then `node scripts/refresh-service-envs.js && docker compose up -d --force-recreate --no-deps ping-gateway` and confirm `docker logs ai-demo-ping-gateway` shows `Loaded the route with id '03-mcp-delegation'` with no `ERROR`.

### 2026-07-24 — Three pre-existing local-CI gate failures: stale §1 row, generated-doc drift, stale test assertions

**Files changed:**

- `REGRESSION_PLAN.md` (this row + the §1 fix below)
- `docs/use-cases/audit-table.md`, `docs/use-cases/ciba-out-of-band-approval.md`,
  `docs/use-cases/demo-runbook.md`, `docs/use-cases/step-verification-report.md`
  (regenerated)
- `demo_api_server/src/__tests__/agentSessionMiddleware.test.js`

**What was broken:**

1. `regression:paths` — the §1 Code Explorer index DB row referenced
   `` `tests/test_{codegraph_index_guard,build_codegraph,ensure_index,retrieve}.py` ``.
   `check-regression-plan-paths.js` does no brace expansion, so that single
   backtick token could never match a real file regardless of path — the real
   files live at `langchain_agent/tests/test_*.py`.
2. `use-cases:check` — `docs/use-cases/audit-table.md`, `ciba-out-of-band-approval.md`
   (a flag rename, `ff_ciba` → `ciba_enabled`, never regenerated into the doc),
   and `demo-runbook.md` had all drifted from source. The command chains
   `audit:check && docs:check && ... && step-verification check` with `&&`, so
   only the first failure ever surfaced — fixing it exposed the next one, and
   so on.
3. `test:api-server` — `agentSessionMiddleware.test.js` asserted the stale
   error strings `'Unauthorized'` / `'Session expired'` on two 401 paths; the
   middleware itself consistently returns `error: 'session_expired'` on both
   (and on every other 401 path in the file) — this codebase's established
   snake_case error-code convention. The test was wrong, not the code.

**What was fixed:** Split the brace-token into 4 real file references with
the correct `langchain_agent/tests/` prefix. Ran `npm run use-cases:gen`
(from `demo_api_server/`) to regenerate the drifted docs. Updated the two
stale assertions to `'session_expired'`.

**Do not break:**
- `check-step-verification` (the last link in `use-cases:check`) still
  fails — real `missing_prereq`/`server_error` ledger entries across several
  verticals, plus ~20 orphaned ledger files for use case IDs no longer in
  `useCases.js` (`ADMIN1-4`, `agent-lifecycle-list-orders`,
  `agent-lifecycle-revoke`, `ciba-out-of-band-approval` under `retail`). Real
  product/test-data decision (restore the use cases vs. delete the stale
  ledger files), intentionally left for a separate pass.
- `test:api-server` has 8 more pre-existing failing tests, unrelated to this
  fix, spanning several subsystems (write-tool error handling, HITL/step-up
  transaction policy, oauth-teaching plugin registration, PAR config
  prerequisites, intent-binding route validation) — only fully visible once
  `demo_api_server`'s `node_modules` had `@a2a-js/sdk` installed (previously
  missing entirely, which silently truncated `npm test`'s output before these
  ever ran). Also left for a separate pass.

**Verify:** `cd demo_api_server && node ../scripts/check-regression-plan-paths.js && npm run use-cases:audit:check && npm run use-cases:docs:check && node ../scripts/gen-demo-runbook.js check && CI=true npx jest src/__tests__/agentSessionMiddleware.test.js --testPathIgnorePatterns="/node_modules/"`

### 2026-07-24 — Token Chain evidence JSON unreadable; "Show more detail" renamed

**Files changed:**

- `demo_api_ui/src/components/TraceStepCard.jsx`
- `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`
- `demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`

**What was broken:** The Token Chain panel's inline request/response JSON
(`.tctr-code` blocks) rendered with `JsonHighlight.css`'s LIGHT-background
palette (dark blue/green/amber text) against the block's own dark
`#0f172a` background — very low contrast, hard to read. The standalone
teaching pop-out window (`openStepTeachingWindow`) already had this right
(it hardcodes the dark-palette hex values inline); only the live inline
card view was missing the `jh-dark` class that switches `JsonHighlight.css`
to its bright palette.

**What was fixed:** Added `jh-dark` alongside `tctr-code` on all 6 `<pre>`
evidence blocks in `TraceStepCard.jsx`. Also renamed the "Show more detail"
link label (shown when the education panel isn't available) to
"More Education", in both the `buildTraceSteps.js` source values and the
`TraceStepCard.jsx` fallback defaults.

**Do not break:** The standalone pop-out window's own inline dark-palette
styles are untouched (already correct). `canOpenEdu`'s "Learn more" fallback
text is unchanged — only the literal "Show more detail" string was renamed.

**Verify:** `cd demo_api_ui && npx vitest run src/components/__tests__/TraceStepCard.teaching.test.jsx src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js && npm run build`

### 2026-07-24 — Gateway-side P1AZ DENY on the non-throwing success path returned httpStatus 200 instead of stopping

**Files changed:**

- `demo_api_server/services/mcpToolPipeline.js`
- `demo_api_server/src/__tests__/mcpToolPipeline.gatewayDenyOnSuccess.test.js` (new)

**What was broken:** `callToolViaGateway` returns `{ result, gwAuditTrail }`
normally even when PingGateway's own P1AZ check denies the call — it only
throws on connection/HTTP-level failures. The pipeline's success branch built
DENY evidence (`gw-authorize`/`gw-filter-chain` token events) for the trace
panel but then unconditionally returned `kind:'result', httpStatus:200`
anyway, handing the LLM a raw error envelope (e.g. `{"message":"Unauthorized"}`)
to narrate instead of stopping. The existing `gateway_policy_denied` /
`gateway_misconfigured` block handling in the `catch` block never fired,
because this path never threw. User-visible symptom: the agent reply looked
like it might have worked while the token-chain proof step showed
"Incomplete."

**What was fixed:** When `gwAuditTrail.authorize.decision === 'DENY'` on the
gateway success path, stop and return the same `kind:'block'` Outcome shape
the thrown-error path already produces. Distinguishes a genuine PingOne
Authorize verdict (has a `correlationId`) → `gateway_policy_denied` (403, the
policy's stated reason) from PingGateway's own upstream call to PingOne
failing before a real decision was ever made (no `correlationId`, bare
`"Unauthorized"` `rawResponse`) → `gateway_misconfigured` (503, "contact an
administrator") — same distinction the thrown-error handler already makes,
now applied to the non-throwing DENY shape too.

**Do not break:** A `PERMIT` decision (or no `gwAuditTrail.authorize` at all)
must keep returning the normal `kind:'result', httpStatus:200` path unchanged
— confirmed by the existing `mcpToolPipeline.characterization.test.js` suite
staying green (zero behavior change for every other exit path).

**Verify:** `cd demo_api_server && CI=true npx jest src/__tests__/mcpToolPipeline.gatewayDenyOnSuccess.test.js src/__tests__/mcpToolPipeline.characterization.test.js --testPathIgnorePatterns="/node_modules/"`

### 2026-07-23 — Consent modal was too tall and needed the screenshot's tighter layout

**Files changed:**

- `demo_api_ui/src/components/AgentConsentModal.js`
- `demo_api_ui/src/components/AgentConsentModal.css`

**What was broken:** The consent modal rendered too tall for the reference layout, with
too much vertical padding and wrapping that made the dialog feel stretched.

**What was fixed:** Reduced the modal's default height, made the panel slightly wider,
and tightened the badge/body/card/assurance/checkbox spacing so the content fits in a
shorter, more compact dialog.

**Do not break:** Keep the consent wording, approval flow, and HITL/transaction behavior
unchanged. Preserve the high-contrast modal styling and the existing footer actions.

**Verify:** `cd demo_api_ui && npm run build`

### 2026-07-23 — Demo Step 1 could fail with `delegation_chain_broken` when PingGateway URI setting was unset

**Files changed:**

- `demo_api_server/services/agentMcpTokenService.js`
- `demo_api_server/src/__tests__/agentMcpTokenService.test.js`

**What was broken:** In gateway-brokered mode, Exchange #2 needs a PingGateway
RFC 8707 URI audience (`https://.../mcp`). If `pingone_resource_pinggateway_uri`
was unset, the BFF fell back to non-URI audience values and the chain failed as
`delegation_chain_broken` (UI toast: "Token exchange failed…").

**What was fixed:** Exchange #2 now falls back safely by extracting the first
HTTP(S) URI from `MCP_GW_RESOURCE_URI` (or `mcp_gw_resource_uri`) when the
explicit PingGateway URI setting is missing. Added a regression test that pins
this fallback path.

**Do not break:** Keep `forceDirectMcpAudience` behavior unchanged for direct WS
callers, and keep gateway-brokered mode requesting exactly one URI audience.

**Verify:** `cd demo_api_server && npx jest src/__tests__/agentMcpTokenService.test.js --testPathIgnorePatterns="/node_modules/" --runInBand`

### 2026-07-23 — UC5 attack-sim died at token exchange (invalid subject_token) with a blank Token Chain; `/api/demo/attack-sim` skipped silent refresh

**Files changed:**

- `demo_api_server/server.js` — mount `refreshIfExpiring` on `/api/demo/attack-sim`
  (was missing; `/api/demo-agent` and `/api/mcp` already had it).
- `demo_api_server/services/attackSimulatorService.js` — enrich `sim-exchange-error`
  with PingOne `requestContext` / `pingoneErrorDescription`; `stampUseCaseId` on
  exchange-failure early returns.
- `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js` — exchange failure
  detail (may already be present from token-chain gap-fill; keep `exFailed` on
  `tokenEvent` + PingOne extras).
- `demo_api_server/services/stepVerificationExpectations.js` — `scoreAttackSimDeny`
  (teaching DENY vs `exchange_failed` infra).
- `demo_api_ui/tests/e2e/stepVerification.banking.real.spec.js` — UC5 live ledger row.
- Tests: `buildTraceSteps.test.js`, `stepVerificationExpectations.uc5.test.js`.

**What was broken:** Demo step 10 (UC5) ran attack-sim with a stale session AT.
PingOne rejected `subject_token` → body `status: 502` / exchange_failed. The chat
showed the error, but the Token Chain looked empty / incomplete. A 502 infra
failure must not be scored as a successful scope DENY in the step-verification
ledger.

**Do not break:** Successful UC5 path still requires `sim-exchange-ok` →
`sim-gateway-deny` with `errorCode: insufficient_scope`. Do not count
`exchange_failed` / invalid `subject_token` as teaching DENY. Keep
`refreshIfExpiring` on `/api/demo/attack-sim` whenever adding new attack routes.

**Verify:** jest `stepVerificationExpectations.uc5.test.js` + `attackSimulator*`;
vitest `buildTraceSteps` (incl. sim-exchange-error detail); live
`stepVerification.banking.real.spec.js` UC5 writes
`data/step-verification/banking/UC5.attack.heuristic.json`.

### 2026-07-23 — Resource-server dual-view merged without canaries; post-merge harden + standing rule

**Files changed:**

- `demo_api_server/routes/resourceServer.js` — `/summary-inflow` session gate parity with `/summary`
- `demo_api_server/services/resourceServerTesterService.js` — `resolveTokenAsync` mint edge cases
- `demo_api_server/src/__tests__/resourceServer.summaryInflow.regression.test.js`
- `demo_api_server/src/__tests__/resourceServerTester.test.js` — `resolveTokenAsync` suite
- `demo_api_ui/src/components/ResourceServerPage.jsx` — `startsWith('banking:')` scope badge
- `demo_api_ui/src/components/__tests__/ResourceServerPage.dualView.test.jsx`
- `scripts/check-fresh-clone-hygiene.js` — `rs-dual-view` canaries
- `.cursor/rules/post-merge-ledger-canary.mdc` — **on every merge**: ledger/tester canary + fix

**What was broken:** #780 landed Login RS / In-flow RS without route/UI tests, without
mint hardening beyond happy path, and with Greptile P2s open; CI died in ~4s (Actions
minutes exhausted) so the merge looked “done” without a green follow-up.

**What was fixed:** Harden PR #781 + hygiene/rule so dropping the canaries or the
session-gate / badge / mint contracts fails `npm run hygiene:check` immediately.

**Standing rule (every merge):** ship a ledger/tester canary and the fix in the same
landing (or same-day harden). Do not leave “no tests / happy-path only / Greptile P2”
for later. See `.cursor/rules/post-merge-ledger-canary.mdc`.

**Verify:**
```bash
node scripts/check-fresh-clone-hygiene.js
cd demo_api_server && npx jest --testPathPattern='resourceServer.summaryInflow|resourceServerTester.test' --forceExit
cd demo_api_ui && npx vitest --run src/components/__tests__/ResourceServerPage.dualView.test.jsx
```

### 2026-07-22 — CareConnect left the stack "stuck" on healthcare (Primary Care / HSA)

**Files changed:**

- `demo_api_server/routes/verticalManifest.js` — end-user `POST /api/verticals/active`
  updates **session only**; only admins (or `global:true` from admin) call `setActive`
  / SSE-broadcast the process-global default.
- `demo_api_server/routes/agentInvokeRoute.js` + `demoAgentNl.js` — explicit request
  `vertical` pins `req.session.active_vertical` so banking pages re-align a session
  left on healthcare/retail.
- `demo_api_server/services/demoAgentLangGraphService.js` — banking transfer/deposit/
  withdraw reseeds accounts when they don't match the banking vertical.
- `demo_api_ui/playwright.real.config.js` + `tests/e2e/helpers/restoreBankingVertical.js`
  — globalTeardown restores banking via admin session after `*.real.spec.js`.
- `demo_api_server/tests/verticalManifest/route.write.test.js` — asserts end-user
  switch does not move the global.

**What was broken:** CareConnect (and other) e2e / UI switches called `setActive`,
so the process-global became healthcare. New sessions pinned to that on first `/me`,
and banking transfers saw Primary Care/HSA until someone switched back.

**Do not break:** session isolation (`activeIdFor`); admin SideNav switch still moves
the room default; Reset Demo clearing session pins; emoji allowlist.

**Verify:** `cd demo_api_server && npx jest tests/verticalManifest/route.write.test.js
tests/verticalSessionPin.route.test.js --coverage=false`.

### 2026-07-22 — Token Summary only listed 1-exchange tokens (missed full 2-exchange run)

**Files changed:**

- `demo_api_ui/src/components/TraceTokenSummary.jsx` — TOKEN_META covers
  `two-ex-agent-actor`, `two-ex-exchange1`, `two-ex-mcp-actor`, `two-ex-final-token`
  (+ fallback exchanged id) so the end-of-rail accordion lists every token in the run.
- `demo_api_ui/src/services/tokenChainTrace/resolveInspectClaims.js` — Inspect falls
  back to 2-exchange event ids when 1-exchange ids are absent.
- `demo_api_ui/src/components/__tests__/TraceTokenSummary.only.test.jsx` — asserts
  2-exchange summary count/labels; MCP tab still filters to the final delegated token.
- `demo_api_server/services/stepVerificationExpectations.js` —
  `scoreTokenSummaryCoverage` requires the full 1-ex or 2-ex Token Summary id set.
- `demo_api_ui/tests/e2e/stepVerification.banking.real.spec.js` — amount-gate chips
  FAIL + ledger `tokenSummaryMode` / `tokenSummaryIds` / `tokenSummaryMissing` when
  any summary token is absent.
- `demo_api_server/src/__tests__/stepVerificationExpectations.test.js` — coverage unit tests.

**What was broken:** Token Summary hard-coded only `user-token` / `agent-actor-token` /
`exchanged-token`. On a 2-exchange demo run the accordion omitted the intermediate
and final tokens even though they were in `trace.tokenEvents`. Step verification only
checked “some event has detail,” so a blank Summary still ledged PASS.

**Do not break:** TraceRail step ids / layout; MCP tab `only="mcp"` still shows only
the delegated final token (not the full chain); auth / exchange minting untouched.

**Verify:** `cd demo_api_ui && npm test -- --run src/components/__tests__/TraceTokenSummary.only.test.jsx`
(4/4); `cd demo_api_server && npm test -- --testPathPattern=stepVerificationExpectations --coverage=false`;
`npm run build` in `demo_api_ui` (0).

### 2026-07-22 — Code Explorer (`/code-search`) loaded no UI code (and intermittently `malformed database schema`)

**Symptom:** Asking about UI symbols (e.g. `CodeExplorerPage`) returned “not in context”; queries sometimes failed with `malformed database schema (function)`.

**Root cause:** (1) Baked indexer at `/app/indexer/build-codegraph.py` resolved `REPO_ROOT=/app`, nesting paths as `live-repo/demo_api_ui/...` while `REPO_SRC_ROOT=/app/live-repo` expected unprefixed paths. (2) Demo Refresh wrote the same `.codegraph/codegraph.db` as the host CodeGraph product daemon, which overwrote/corrupted the demo schema.

**Fix:** Separate demo DB (`.codegraph/demo-codegraph.db`), pass root via `REPO_SRC_ROOT`, default index scope UI+API only, hardening checks (`builder=demo-build-codegraph` marker, refuse `live-repo/` paths, non-zero UI/API counts) on Refresh + startup. Do **not** “simplify” `CODEGRAPH_DB_PATH` back to `codegraph.db`.

**Files:** `scripts/build-codegraph.py`, `langchain_agent/src/codegraph/{index_guard,ensure_index,db}.py`, `langchain_agent/src/api/codegraph_handler.py`, `docker-compose.yml`, `demo_api_ui/src/components/CodeExplorerPage.jsx`, `langchain_agent/tests/test_codegraph_index_guard.py`.

### 2026-07-22 — CareConnect UC8 HITL (and UC7 step-up) ProofStrip Mismatch after "success"

**Files changed:** `demo_api_server/services/mcpToolAuthorizationService.js`
(`_applyTransactionPolicy` promotes Transaction HITL/consent + local amount-band
fallback), `demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js`
(preserve `HITL_REQUIRED`/`STEP_UP` outcome across approve→retry PERMIT), tests.

**What was broken:** CareConnect `pay my $300 bill` (UC8) and `$600` (UC7) ran
straight to `POST /api/path/vertical-tool` 200 with no 428. Live MCP gate often
PERMITs vertical writes; Transaction-policy consent was never promoted onto the
gate, so ProofStrip saw PERMIT vs expected `HITL_REQUIRED` → Mismatch. After a
real HITL approve→retry, ingestAuthorize also overwrote outcome with bare PERMIT.

**What was fixed:** Promote `consentRequired`/`hitlRequired` from
`evaluateTransaction`; local amount-band fallback (same thresholds as simulated
AS) when Transaction attaches nothing; keep prior gate outcome on retry PERMIT
so ProofStrip scores `denied-as-expected`.

**Do not break:** DENY > STEP_UP > HITL precedence; never clear an existing
`hitlRequired` on the gate; ProofStrip still mismatches when DENY expected but
HITL fired (and vice versa).

**Verify:** `CI=true npx jest tests/mcpToolAuthorization.transactionPolicyHitl.test.js --forceExit`;
`npx vitest run …/tokenChainTraceStore.test.js …/ProofOfEnforcementContext.test.js`;
`cd demo_api_ui && npm run build`.

### 2026-07-22 — OAuth Academy teach chips looked dead under agent_mode=llamacpp

**Files changed:**

- `demo_api_server/services/verticalDispatch.js` — `findLocalToolPlugin(name)`.
- `demo_api_server/services/bffMcpToolExecutor.js` — execute local teaching tools
  in-process before MCP (fixes LLM `Unknown tool: explain_concept`).
- `demo_api_ui/src/components/OAuthAcademyPage.jsx` — forceHeuristic for
  what-is/explain starter chips; Abort/Timeout no longer leave an empty bubble;
  do not auto-open education drawers from Academy replies.
- `demo_api_server/src/__tests__/bffMcpToolExecutor.localTool.test.js` — regression.

**What was broken:** With `agent_mode=llamacpp`, heuristic routing is off. Teach chips
did not set `forceHeuristic`, so `/api/agent/invoke` waited ~40s on the LLM; the model
called `explain_concept` through MCP and got `Unknown tool`. Typing indicator looked like
no response. After the forceHeuristic fix, `education.panel` auto-opened banking-oriented
drawers (e.g. Least-Data) over the Academy chat.

**Do not break:** Non-local vertical/banking tools still use `runMcpToolPipeline` (RFC 8693,
Authorize, HITL). `dispatchVerticalIntent` local bypass unchanged for heuristic path.
Dashboard agent education auto-open unchanged.

**Verify:** `cd demo_api_server && npx jest src/__tests__/bffMcpToolExecutor.localTool.test.js --coverage=false`;
live `POST /api/agent/invoke` with `{prompt:'what is oauth', vertical:'oauth-teaching', forceHeuristic:true}`
returns `toolsCalled:['explain_concept']` in under ~2s; `cd demo_api_ui && npm run build`.

### 2026-07-22 — `/admin` Demo Steps showed banking UCs and hit `requiresCustomerLogin`

**Files changed:**

- `demo_api_ui/src/App.js` — `forceVertical: "pingone-admin"` when
  `isPingOneAdminAgentRoute(pathname)` (`/admin` only).
- `demo_api_ui/src/utils/embeddedAgentFabVisibility.js` —
  `isPingOneAdminAgentRoute`.
- `demo_api_ui/src/services/demoAgentService.js` — `sendToAdminAgent` begins
  TraceRail + ingests admin `tokenEvents`.
- Tests: `embeddedAgentFabVisibility.test.js`, `App.structure.test.js`,
  `demoAgentService.adminRouting.test.js`.

**What was broken:** `/admin` agent used the active theme vertical (usually
`banking`), so Demo Steps loaded the customer trust-ladder catalog. Running a
step hit `customerTokenGuard` → “Log in as customer” instead of
`/api/admin-agent` (ADMIN1–4 in `config/admin/demoSteps.js`).

**What was fixed:** Force `pingone-admin` on `/admin` so Demo Steps / NL /
chips share the admin vertical and admin-agent path.

**Do not break:** Banking Demo Steps on `/` and `/dashboard`; vertical ops
under `/admin/banking` etc. (not `isPingOneAdminAgentRoute`);
`PINGONE_ADMIN_CHIP_IDS` chip path; non-admin `sendAgentMessage` →
`/api/agent/invoke`.

**Verify:** `cd demo_api_ui && npx vitest --run
src/utils/__tests__/embeddedAgentFabVisibility.test.js
src/__tests__/App.structure.test.js
src/services/__tests__/demoAgentService.adminRouting.test.js
src/components/__tests__/DemoStepsDropdown.test.jsx`. Live: post-deploy §3
**Demo Steps** row (`docs/runbooks/regression/post-deploy.md`).

### 2026-07-22 — UC30 gateway PERMIT + real weather, chat still Incomplete: prose vs parseToolResult

**Files changed:**

- `demo_api_server/services/demoAgentLangGraphService.js` — weather heuristic treats
  `executeBffTool` markdown string as success; only JSON-parse error/deny envelopes.
- `demo_api_server/src/__tests__/weatherHeuristicProse.regression.test.js`

**What was broken:** After gateway PERMIT and weather-mcp prose, `parseToolResult` JSON-failed
the markdown → `tool_result_unparseable` → `success:false` → UI
"That step couldn't be completed" / ProofStrip Incomplete (access-token).

**What was fixed:** Accept unwrapped prose for `action === 'weather'`; keep deny JSON as failure.

**Do not break:** Banking JSON tools still go through `parseToolResult`; UC31 Miami DENY.

**Verify:** unit test above; live `POST /api/agent/invoke` with `forceHeuristic:true` and
Austin prompt → `success:true`, `toolsCalled:['get_weather']`, reply contains Temperature.

### 2026-07-22 — UC30 weather chat 401'd: McpProtectionFilter `/weather` resourceId rejected BFF gateway aud

**Files changed:**

- `ping-gateway/config/routes/00-mcp-weather.json` — restored shared heap `"rsFilter"` for
  inbound auth (pre-#722 shape) instead of `McpProtectionFilter` with
  `resourceId: ${PG_GATEWAY_RESOURCE_ID}/weather`.

**What was broken:** PR #728 uniquified invest/weather/apikey `resourceId`s so well-known PRM
paths don't collide (`AlreadyRegisteredException` on
`/.well-known/oauth-protected-resource/mcp`). Weather then expected aud `…/mcp/weather`, but
the BFF still mints `aud=https://api.ping.demo:3036/mcp` → gateway 401
`Access Token resource ID does not match` → UC30 ProofStrip Incomplete. Sharing OLB's
resourceId re-triggers the well-known collision and the weather route fails to load.

**What was fixed:** Shared `rsFilter` accepts the existing gateway token without registering a
second PRM endpoint. Texas scope (`tx-weather-scope.groovy`) is unchanged.

**Do not break:** OLB `mcp-olb-primary` McpProtectionFilter + unique invest/apikey
resourceIds; weather path still `/mcp/weather` via StripWeatherPrefix.

**Verify:** recreate `ping-gateway`; logs show `mcp-weather-primary` loaded; UC30
`what's the weather in Austin, TX` reaches TxWeatherScope (not 401 resource mismatch).


### 2026-07-22 — UC30 PERMIT at gateway then Incomplete: weather-mcp rejects tool name `get_weather`

**Files changed:**

- `demo_mcp_weather/server.js` — rewrite `tools/call` name `get_weather` →
  `get_current_conditions` before forwarding to `@dangahagan/weather-mcp`.

**What was broken:** After auth + Texas-scope PERMIT, the third-party server's default
`ENABLED_TOOLS` does not include `get_weather`, so every call returned
`isError: Tool 'get_weather' is not enabled` → heuristic `success:false` → ProofStrip
Incomplete. Design/e2e already used `get_current_conditions`.

**Verify:** UC30 Austin chat returns weather prose with `success:true` / toolsCalled
`get_weather` (agent-facing name unchanged).

### 2026-07-22 — UC30 still Incomplete after 401 fix: norm() stripped comma so Texas scope DENY'd Austin

**Files changed:**

- `demo_api_server/services/nlIntentParser.js` — weather city capture uses the original
  `message`, not `norm(message)` (which turns `Austin, TX` into `austin tx`).
- `ping-gateway/scripts/groovy/tx-weather-scope.groovy` — also treat trailing
  space+abbrev (`austin tx`) as in-state, same as `, tx`.

**What was broken:** After the rsFilter restore, gateway auth passed but TxWeatherScope
returned 403 `city not recognized as Texas` because the heuristic sent `city_name:
"austin tx"` (no comma). Groovy's no-comma branch only allowlists bare city names
(`austin`), not `austin tx`.

**Verify:** `parseHeuristic("what's the weather in Austin, TX")` → `city_name: "Austin, TX"`;
UC30 PERMITs at the gateway scope filter.



### 2026-07-22 — 2-exchange TraceRail Exchange step lost coloured request JSON

**Files changed:**

- `demo_api_server/services/agentMcpTokenService.js` — when splicing
  `two-ex-exchange1-in-progress` / `two-ex-exchange2-in-progress` on success or failure,
  copy `exchangeRequest` onto the replacement success/failure event.
- `demo_api_server/tests/exchangedTokenEventExchangeRequest.test.js` — asserts
  `two-ex-final-token` can carry the teaching payload.
- `demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js` — asserts
  TraceRail Exchange step renders request JSON from `two-ex-final-token.exchangeRequest`.

**What was broken:** 2-exchange attached `exchangeRequest` only to the in-progress cards,
then spliced those out on completion. TraceRail's Exchange step reads
`two-ex-final-token.exchangeRequest`, so live runs showed claims response but no coloured
request JSON. 1-exchange already kept the payload on `exchanged-token`.

**Do not break:** RFC 8693 minting, aud/act claims, or the in-progress event shapes — teaching
metadata only; no raw token material in `exchangeRequest`.

**Verify:** `cd demo_api_server && npm test -- --testPathPattern=exchangedTokenEventExchangeRequest --coverage=false`
(2/2); `cd demo_api_ui && npm test -- --run src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`
(36/36). Live: run a 2-exchange tool call, expand TraceRail Exchange — request JSON present.

### 2026-07-22 — Customer login's post-login modal never showed `phone` (and would break for any admin-only field): admin `/api/auth/oauth/status` had no `oauthType` gate, so it falsely reported `authenticated:true` for end-user sessions too

**Files changed:**

- `demo_api_server/routes/oauth.js` — `GET /status`'s `isAuthenticated` now also requires
  `req.session.oauthType !== 'user'`.
- `demo_api_server/src/__tests__/oauthStatus.regression.test.js` — added a case for a real
  admin session (`oauthType` unset, as issued on a fresh same-instance admin login) staying
  authenticated, and a case for an end-user session (`oauthType: 'user'`) no longer matching.

**What was broken:** the frontend's `useAuth.js` (`checkOAuthSession`) queries admin status
(`/api/auth/oauth/status`) first, then user status (`/api/auth/oauth/user/status`), and stops at
the first `authenticated:true`. The admin endpoint's check was `req.session.user && hasOAuthToken
&& tokenNotExpired` — no `oauthType` check at all — so it returned `authenticated:true` for
*any* logged-in session, including end-user/customer logins. Its response shape only includes
`id/username/email/firstName/lastName/role`, omitting fields like `phone` that only the user
endpoint returns. Every customer login silently got the admin shape, so `LoginSuccessModal`
showed name and email (present in both shapes) but never phone (admin-only-shaped response,
present only in the user endpoint the app never reached).

**Do not break:** admin sessions never set `req.session.oauthType = 'admin'` on the live session
in the normal, same-instance login path — only the signed `_auth` cookie payload carries that
value, restored onto `req.session.oauthType` by `restoreSessionFromCookie`
(`services/authStateCookie.js`) solely when the live session itself is lost. A fix that gates on
`oauthType === 'admin'` breaks real admin status checks in the common case; the correct gate is
`oauthType !== 'user'`, matching the exclusion style already used elsewhere in this file (see
`oauthUser.js`'s own `oauthType === 'user'` checks).

**Verify:** `CI=true npx jest src/__tests__/oauthStatus.regression.test.js
src/__tests__/oauthStatus.integration.test.js --testPathIgnorePatterns="/node_modules/"` — 26/26
passing. Confirmed the new end-user-session test fails against the pre-fix code (`git stash` the
one-line fix, rerun) and passes with it restored. Live-reproduced the original symptom via
Playwright against the real PingOne-backed stack before diagnosing: fresh `demoUser` login's
`/api/auth/oauth/status` returned `authenticated:true` with no `phone` field, while
`/api/auth/oauth/user/status` on the same session returned the correct value.

### 2026-07-22 — Reset Demo now reverts the weather scope flags; added UC32 for the configurability itself

**Files changed:**
- `demo_api_server/routes/admin.js` — `POST /api/admin/reset-demo` now also resets
  `ff_weather_mcp_showcase` and `ff_weather_mcp_allowed_state` to their `FLAG_REGISTRY`
  `defaultValue` (`true` / `'texas'`), alongside its existing event/token-chain/audit clears.
- `demo_api_server/config/useCases.js` — new `UC32` ("Live-reconfigure the gateway's scope
  policy"), `link`-type trigger to `/agent-gateway-capabilities` (no chip/sim — this UC's whole
  point is the admin dropdown itself, not one fixed outcome).
- `demo_api_ui/src/config/capabilityLedgers/agentGatewayCapabilities.js` — `weather-tx-scope`'s
  `relatedUCIds` gains `UC32`.
- `demo_api_server/src/__tests__/useCases.config.test.js`,
  `demo_api_server/src/__tests__/useCases.route.test.js` — catalog count 46→47.
- `docs/use-cases/*` regenerated (`npm run use-cases:gen`) for the new UC32.

**Why:** Before this, `ff_weather_mcp_allowed_state` was set by Task 4's dropdown but never
reset by anything — a presenter who left a demo on "Michigan" or "Any" would silently start the
NEXT demo run in that same state, with no visible warning. UC30/UC31 each demo one fixed
outcome; neither demonstrates that the scope is a live, admin-owned value rather than
per-use-case app logic — UC32 closes that gap.

**Do not break:** `POST /api/admin/reset-demo`'s flag reset is scoped to exactly
`['ff_weather_mcp_showcase', 'ff_weather_mcp_allowed_state']` (`RESET_DEMO_FLAG_IDS` in
admin.js) — this is NOT a general "reset every flag to default" feature; do not widen it without
a separate explicit decision, since resetting arbitrary flags on every demo reset could surprise
an operator relying on some OTHER flag's value persisting across a reset.

**Verify:** live, via the running gateway/BFF (no unit test — `admin.js`'s full dependency tree
made an isolated route test disproportionate to this two-line change; mirrors this repo's own
established practice of live-verifying `tx-weather-scope.groovy` changes):
1. `PATCH ff_weather_mcp_allowed_state` to `'michigan'` via the real admin endpoint.
2. `POST /api/admin/reset-demo` — confirmed `{ok:true}`.
3. `GET /api/admin/feature-flags` — confirmed `ff_weather_mcp_allowed_state` back to `'texas'`.

### 2026-07-21 — Weather MCP gateway scope now live-configurable (Texas/Michigan/Any), not hardcoded Texas-only

**Files changed:**
- `ping-gateway/scripts/groovy/tx-weather-scope.groovy` — added STATES map (Texas, Michigan) with
  bounding boxes and city lists; modified weatherFlags() to read ff_weather_mcp_allowed_state
  flag; city/bbox validation logic now respects the currently-configured state instead of
  hardcoded Texas.
- `demo_api_server/routes/featureFlags.js` — added ff_weather_mcp_allowed_state flag endpoint
  with state options (texas/michigan/any).
- `demo_api_server/routes/weatherMcpFlag.js` — extended response to include ff_weather_mcp_allowed_state
  alongside ff_weather_mcp_showcase.

**What changed:** The weather MCP scope policy changed from a hardcoded Texas-only restriction to
a live, admin-configurable state selection. Default is Texas; operators can switch to Michigan or
open to 'any' state instantly via the feature-flag PATCH endpoint (or via the UI dropdown in
Task 4).

**Why:** Makes the gateway's enforcement policy demonstrably changeable during a demo. Operators
can watch the Capability Tour dropdown switch from Texas to Michigan mid-demo and see different
cities get denied in real time, proving the policy is administrable, not baked into code.

**What was broken (found live during verification):** The flag-check response validation used
`if (STATES.containsKey(parsed.allowedState))` alone to decide whether to accept the value
returned by the BFF. `'any'` deliberately has no `STATES` entry — it isn't a state to look up, it
means "skip the scope check entirely" — so that single check silently rejected `'any'` and fell
back to the function's default (`'texas'`). Live symptom: switching the admin dropdown to "Any"
kept enforcing Texas-only; the gateway never actually opened up.

**What was fixed:** Widened the guard to `parsed.allowedState == 'any' || STATES.containsKey(parsed.allowedState)`,
explicitly accepting `'any'` alongside the `STATES.containsKey` check. **Landmine:** do not read
`STATES.containsKey(...)` alone as sufficient validation for `allowedState` — `'any'` is a valid
value with no `STATES` entry by design, and any future refactor of this guard must keep both
checks or it will silently reintroduce this regression.

**Do not break:** `ff_weather_mcp_showcase` (master enable/disable flag) must stay independent —
when OFF, the gateway denies all weather calls ("capability disabled"), regardless of what state
is configured. The state option only matters when showcase is ON. If any error or version-skew
occurs during flag retrieval, the gateway must default to the narrowest state ('texas'), never
accidentally widen the policy.

**Verify:** (live end-to-end, mirrors Task 2 Steps 2-5)
1. Recreate `ping-gateway` from the worktree so Groovy changes are live.
2. With default state (Texas): mint a bearer token (client_credentials + RFC 8693 exchange); test
   `city_name: "Austin"` → 200 (reaches backend); `city_name: "Detroit"` → 403 ("restricted to
   Texas"); `city_name: "Miami"` → 403 ("restricted to Texas").
3. PATCH `ff_weather_mcp_allowed_state` to 'michigan': re-test the three cities — Detroit → 200,
   Austin → 403 ("restricted to Michigan"), Miami → 403.
4. PATCH `ff_weather_mcp_allowed_state` to 'any': re-test all three cities — all three → 200
   (reaching backend); also confirm a `location_name` argument now passes (previously always
   denied).
5. With `ff_weather_mcp_allowed_state` still 'any', PATCH `ff_weather_mcp_showcase` to false:
   test Austin → 403 ("weather capability disabled"), confirming the master flag still wins
   regardless of the selected state. Reset both flags to defaults (`ff_weather_mcp_showcase:
   true`, `ff_weather_mcp_allowed_state: "texas"`) when done.

### 2026-07-21 — `/mcp/weather` 502'd for in-scope Texas cities (and `/mcp/invest`'s reverse-proxy stage carried the identical latent defect): `baseURI` silently ignored, `UriPathRewriteFilter` mappings silently no-op'd

**Files changed:**
- `ping-gateway/config/routes/00-mcp-weather.json` — `ReverseProxyHandler`'s `baseURI` moved
  from nested inside `config` to a sibling of `type` (on the `Chain`'s inner `handler` object);
  `StripWeatherPrefix`'s `mappings` changed from regex form (`"^/mcp/weather(.*)$": "/mcp$1"`)
  to literal-prefix form (`"/mcp/weather": "/mcp"`).
- `ping-gateway/config/routes/02-mcp-resource-server.json` — identical fix to `StripInvestPrefix`'s
  mapping and `ReverseProxyHandler`'s `baseURI` placement (same bug, same shape, copy-pasted
  into this route originally; not yet user-visible because invest's separate, pre-existing
  `token_exchange_failed` issue fails earlier in the chain and had never let a request reach
  this stage).

**What was broken (two independent, stacked bugs, found by decompiling the actual IG jars —
`/opt/gateway/lib/openig-core-*.jar` inside the running container — since neither is
documented as a "gotcha" anywhere):**

1. **`baseURI` in the wrong place.** In this IG version, `baseURI` is a generic decorator
   (`org.forgerock.openig.decoration.baseuri.BaseUriDecorator`) that IG's heap system only
   recognizes as a **sibling key of `type`** on a heap object — e.g.
   `{"type": "ReverseProxyHandler", "baseURI": "...", "config": {...}}`. Both routes instead
   nested it *inside* `config` (`{"type": "ReverseProxyHandler", "config": {"baseURI": "..."}}`).
   Decompiling `ReverseProxyHandlerHeaplet.class` confirms it never reads a `"baseURI"` key at
   all — the class's entire config surface is `soTimeout`/`connectionTimeout`/`maxConnections`/
   `tls`/`vertx`/`proxyOptions`/`websocket`. With `baseURI` nested, it was a pure no-op: for
   weather, `ReverseProxyHandler` fell back to blindly forwarding using the *inbound* request's
   own host and port (confirmed by overriding the inbound `Host` header's port from `3036` to
   `9999` and watching the connect-refused error's target port change identically) — landing on
   whatever container the gateway's own `/etc/hosts` `api.ping.demo` entry happened to
   currently resolve to (a stale, coincidental IP-reuse artifact, not a real routing decision),
   on the *client's* port, which nothing listens on there. Hence `502`/`Connection refused`.
2. **`UriPathRewriteFilter`'s `mappings` is a literal-prefix replace, not regex.** Decompiling
   `UriPathRewriteFilter$PathMapping.class` shows `rewritePath(path)` is
   `toPath + path.substring(fromPath.length())`, matched via `path.startsWith(fromPath)` — there
   is no regex engine involved anywhere in this filter. Both routes' mappings used regex syntax
   with a capture group (`"^/mcp/weather(.*)$": "/mcp$1"`), which no request path ever literally
   starts with, so `findLongestMapping` always returned empty and the filter silently forwarded
   the request unmodified. This bug was invisible until bug #1 was fixed: once `baseURI`
   correctly reached the real backend, the un-stripped `/mcp/weather` path 404'd against
   mcp-weather's Express app (only `/mcp` is registered) — the exact same generic
   `{"error":"Not found"}` reproduced by curling mcp-weather directly at `/` or any unregistered
   path, confirming the match.

**What was fixed:** `baseURI` promoted to a sibling of `type` on the `ReverseProxyHandler` heap
object in both routes; both `UriPathRewriteFilter` mappings changed from regex form to literal
prefix-and-replacement form matching how `PathMapping` actually implements rewriting.

**Do not break:** `01-mcp-olb.json` has the identical `baseURI`-nested-in-`config` shape and
was deliberately left unchanged — real OLB traffic currently appears unaffected by this defect
class (untested/unexplained why; flagged for separate follow-up, not touched here per
minimal-diff scope). Don't assume fixing `baseURI` placement elsewhere is automatically safe
without the same live-token verification done here.

**Verify:** live end-to-end with a real, freshly-minted, introspection-passing bearer token
(same style as the rsFilter fix below) against the actually-running `ping-gateway` container:
`Austin` (Texas, in-scope) now returns `200` with the request correctly reaching mcp-weather's
tool-execution layer (blocked only by mcp-weather's own unrelated `ENABLED_TOOLS` config —
confirmed identical to curling mcp-weather directly, not a gateway defect); `New York`
(non-Texas) returns the correct `403` Texas-scope denial from `tx-weather-scope.groovy`. No
`BadGatewayFilter`/`Connection refused` in gateway logs for either call. `02-mcp-resource-server.json`
verified to hot-reload cleanly with the same fix (its own separate `token_exchange_failed` issue
still blocks full end-to-end verification of its reverse-proxy stage — out of scope here).

### 2026-07-21 — Shared rsFilter introspection has been failing closed for every real token, on every route that uses it (invest, weather, and their JWKS variants) — only discovered because weather-mcp was the first route ever live-tested with a genuine bearer token

**Files changed:**
- `ping-gateway/config/config.json` — the global `IntrospectionClientAuth` heap object
  (part of `IntrospectionProviderHandler`, used by the shared `rsFilter` heap object) changed
  from `ClientSecretBasicAuthenticationFilter` (HTTP Basic client auth) to a `ScriptableFilter`
  that injects `client_id`/`client_secret` as URL-encoded body parameters
  (`client_secret_post`), mirroring the pattern `01-mcp-olb.json`'s route-local
  `IntrospectionClientAuth` already used successfully.

**What was broken:** the PingOne client configured for gateway-side introspection
(`INTROSPECT_CLIENT_ID` / `GW_INTROSPECTION_CLIENT_ID`, the "Token Exchanger" app) is not
registered to support `client_secret_basic` at PingOne — only `client_secret_post`. Confirmed
directly: introspecting via HTTP Basic auth (curl's `-u` flag) returns `invalid_client:
Unsupported authentication method`; the identical call authenticating via `client_id`/
`client_secret` as body params instead returns a real `active:true` introspection result.
The GLOBAL `rsFilter` heap's
`IntrospectionClientAuth` used `ClientSecretBasicAuthenticationFilter` — Basic auth — so
`RsFilterTokenResolver`'s introspection call to PingOne has been failing with `invalid_client`
on every single call, and `OAuth2ResourceServerFilter` reports that as a generic `401
invalid_token` to the caller (indistinguishable from an actually-invalid token, and not
logged to stdout at INFO level — silent). Every route that references the bare `"rsFilter"`
heap object by name (`02-mcp-resource-server.json`, `00-mcp-resource-server-jwks.json`,
`00-mcp-weather.json`) has been rejecting every real, valid, correctly-scoped bearer token
since introspection was wired up — this is not new, and not specific to weather-mcp. It was
never caught before because no route using bare `rsFilter` had ever been exercised with a
real PingOne token in this dev environment: `01-mcp-olb.json` (the OLB/banking route) has its
OWN separate, route-local `IntrospectionClientAuth` that already used the working
body-param pattern (someone had already hit and fixed this exact issue there, but the fix was
never propagated to the shared heap object other routes rely on), so OLB traffic was
unaffected and nobody noticed invest/weather were broken.

**What was fixed:** replaced the global `IntrospectionClientAuth`'s
`ClientSecretBasicAuthenticationFilter` with the same Groovy body-param injection
`01-mcp-olb.json` already uses (verbatim pattern, different heap location). This is a
same-file-family copy of an already-proven-correct implementation, not a new mechanism.

**Do not break:** `01-mcp-olb.json`'s own local `IntrospectionClientAuth` (a separate heap
object, untouched by this change) must keep working exactly as before — this fix only
changes the GLOBAL heap object referenced by `rsFilter`-using routes, not OLB's route-scoped
copy. `INTROSPECT_CLIENT_SECRET` must stay available as a plain env var (already was, via
`SystemAndEnvSecretStore`/env — the new Groovy reads it via `System.getenv()` directly,
the same as `01-mcp-olb.json`'s script already does).

**Verify:** minted a real PingOne token directly (`client_credentials` +
`urn:ietf:params:oauth:grant-type:token-exchange` against the Token Exchanger app,
`aud=https://api.ping.demo:3036/mcp`, `scope=gateway:mcp:invoke`); also captured a genuine
BFF-issued, user-delegated token live via a temporary logging passthrough proxy inserted
between the BFF and `ping-gateway` (removed immediately after, `MCP_PINGGATEWAY_URL` reverted,
zero residual changes). Before the fix: both tokens got `401 invalid_token` on `/mcp/invest`
and `/mcp/weather` identically, while the same token was accepted on `/mcp` (OLB, separate
introspection path). After the fix: `bash ping-gateway/scripts/validate-config.sh` (PASS);
direct curl to `/mcp/weather` with the real delegated token — a non-Texas city
(`New York, NY`) correctly returns `403` from `tx-weather-scope.groovy` (proving introspection
now succeeds, scope check passes, and the request reaches the Texas-scope Groovy for a real
decision, not a generic auth rejection). A Texas city (`Austin, TX`) still returned `502` past
this fix — a separate issue, unrelated to introspection (the 403 path above proves this fix
works end-to-end on its own); root-caused and fixed in the entry directly above this one.

### 2026-07-21 — OLB JWKS-variant route also shadowed /mcp/weather (missed sibling of the earlier fix)

**Files changed:**
- `ping-gateway/config/routes/00-mcp-olb-jwks.json` — condition regex now excludes `/weather`
  alongside the existing `/invest` exclusion (`^/mcp(?!/invest|/weather)`), mirroring the
  same-day fix already applied to `01-mcp-olb.json`.

**What was broken:** the earlier fix (same day, this file's sibling `01-mcp-olb.json`) only
patched the PRIMARY OLB route. Its JWKS-variant sibling, `00-mcp-olb-jwks.json`, had the
identical unfixed catch-all condition (`^/mcp(?!/invest)` plus a header check). A request to
`/mcp/weather` carrying `X-Token-Validation: jwks` matched BOTH this route (name
`mcp-olb-jwks`) and the weather route (name `mcp-weather-primary`); PingGateway's
alphabetical-by-name route selection picked `mcp-olb-jwks` (`o` &lt; `w`), so that specific
request shape still silently reached the OLB/banking backend instead of the weather route's
Texas-scope filter — a final whole-branch code review caught this, no single task-level review
saw it since each only inspected the file it was actively editing.

**What was fixed:** added the same `|/weather` exclusion to this file's condition, achieving
actual parity with how `/invest` is already excluded in BOTH OLB route variants (primary and
JWKS), not just one.

**Do not break:** both `01-mcp-olb.json` and `00-mcp-olb-jwks.json` must keep matching `/mcp`
and any other `/mcp/*` path that isn't `/invest` or `/weather`. Do not narrow either further
without checking what else relies on the OLB catch-all in either variant.

**Verify:** `bash ping-gateway/scripts/validate-config.sh` (PASS); `bash
ping-gateway/scripts/e2e-pinggateway.sh` (OLB legs unchanged); `WWW-Authenticate` header on
`/mcp/weather` with `X-Token-Validation: jwks` set matches the weather route's bare-`Bearer`
pattern, not OLB's `resource_metadata` pattern.

### 2026-07-21 — /mcp/weather route silently shadowed by 01-mcp-olb.json's catch-all

**Files changed:**
- `ping-gateway/config/routes/01-mcp-olb.json` — condition regex now excludes `/weather`
  alongside the existing `/invest` exclusion (`^/mcp(?!/invest|/weather)`).

**What was broken:** PingGateway selects among matching routes by the route's `"name"`
field, sorted alphabetically — not by filename. `00-mcp-weather.json` (name
`mcp-weather-primary`) was added expecting its `00-` filename prefix to win priority over
`01-mcp-olb.json` (name `mcp-olb-primary`), matching how `00-mcp-apikey.json` (name
`mcp-apikey-primary`) already escapes the same catch-all. That precedent is coincidental —
`"apikey"` alphabetically precedes `"olb"`, `"weather"` does not — so `01-mcp-olb.json`'s
catch-all silently swallowed all `/mcp/weather` traffic, proxying it to the OLB/banking
backend instead of the weather backend. A 401 on an unauthenticated request looked identical
either way, masking the bug until response headers were compared directly.

**What was fixed:** added `|/weather` to `01-mcp-olb.json`'s condition regex, mirroring the
existing `|/invest` exclusion — the same structurally-guaranteed mechanism (not
alphabetical-name luck) that already protects the invest route.

**Do not break:** `01-mcp-olb.json`'s condition must keep matching `/mcp` and any other
`/mcp/*` path that isn't `/invest` or `/weather` — do not narrow it further without checking
what else relies on the OLB catch-all.

**Verify:** `bash ping-gateway/scripts/validate-config.sh` (PASS); `bash
ping-gateway/scripts/e2e-pinggateway.sh` (OLB legs unchanged); `WWW-Authenticate` header on
`/mcp/weather` no longer matches `/mcp`'s.

### 2026-07-21 — Kill switch had no way to stop a single rogue agent instance without disabling the shared agent client for every other user

**Files changed:**
- `demo_api_server/services/killSwitchService.js` — `killAgent` takes a new
  `scope` param (`'full'` default | `'instance'`). `scope==='instance'` skips
  `disableAgentApplicationsAtPingOne()` (step 2.5). Also returns a `steps`
  array (`token_revocation`, `user_disable`, `app_disable`,
  `session_invalidate`, `audit_log`), each with `ran`/`skipped`/`detail`, so
  callers can show what actually happened.
- `demo_api_server/routes/admin.js` — `POST /agent/:agentId/kill-switch`
  reads `scope` from the body (validated to `'full'`/`'instance'`), passes it
  to `killAgent`, and includes `scope`/`steps` in the 401 response.
- `demo_api_ui/src/components/KillSwitchConfirmModal.jsx` (+ `.css`) — added a
  scope radio (`This instance only (recommended)` vs `This agent's entire
  identity`), defaulting to instance-only. After confirm, the modal switches
  to a result view listing every step with a Done/Skipped badge and detail
  text instead of closing immediately.
- `demo_api_ui/src/components/ControlPlaneRoster.jsx` — `confirmLiveKill` now
  passes `scope` through and returns the kill result to the modal instead of
  closing it itself (`onCancel`, still wired to the modal's Cancel/Done
  button, is what closes it now).

**What was broken:** `killAgent`'s step 2.5 (`disableAgentApplicationsAtPingOne`)
unconditionally disabled the whole `AGENT_CLIENT_ID` /
`PINGONE_AI_AGENT_CLIENT_ID` PingOne application on every kill. That stops new
token issuance for **every** user of that agent identity, not just the caller
who triggered the kill switch — no way to contain a single misbehaving agent
instance without a demo-wide outage for everyone else on the same client.

**What was fixed:** `scope: 'instance'` skips the app-level disable — token
revocation (RFC 7009), the target user's account disable, and local session
invalidation still run, which is enough to stop that one instance. `scope:
'full'` (the existing default, used when a caller sends no scope — e.g.
`AgentLifecyclePage.jsx`'s unrelated self-service revoke, untouched here)
keeps the old whole-client-disable behavior for a genuinely compromised
client. The response's `steps` array is the audit-friendly explanation of
which of the five kill-switch actions ran vs. were skipped and why.

**Do not break:** `AgentLifecyclePage.jsx`'s Slot 4 self-service revoke sends
only `{ reason }` (no `scope`) and must keep hitting the same default
(`'full'`) behavior — do not change its call shape. `disableAgentApplicationsAtPingOne`
/ `enableAgentApplicationsAtPingOne` themselves are unchanged; only whether
`killAgent` calls the disable function is now conditional.

**Verify:** `demo_api_server` jest — `killSwitchService`, `agentRateLimit`
(32 tests, all green, run from the worktree with
`--testPathIgnorePatterns="/node_modules/"`). `demo_api_ui` vitest —
`ControlPlaneRoster`, `AgentLifecyclePage` (10 tests, all green;
`KillSwitchConfirmModal` is mocked in the roster test so its new scope
UI isn't exercised there). `cd demo_api_ui && npm run build` exits 0. Not yet
click-verified live against real PingOne.

### 2026-07-21 — Banking MCP Inspector Execute failed with "MCP connection closed before response (code 1008: Agent token rejected)"

**Files changed:** `demo_api_server/services/agentMcpTokenService.js` (new
`opts.forceDirectMcpAudience` on `resolveMcpAccessTokenWithEvents`, threaded
into `_performTwoExchangeDelegation`), `demo_api_server/routes/mcpInspector.js`
(`sessionTokenForDiscovery` and the default-profile `/invoke` handler now pass
`{ forceDirectMcpAudience: true }`), `demo_api_server/src/__tests__/agentMcpTokenService.test.js`
(new `forceDirectMcpAudience opt` describe block).

**What was broken:** discovered live right after the MFA-gate removal above
unblocked reaching the Banking tab's Execute button for the first time.
`demo_mcp_server` logs showed `Rejecting connection ...: Token audience does
not match MCP server resource URI` — `token_aud: ["https://api.ping.demo:3036/mcp"]`
(the PingGateway resource) vs `expected: ["mcpserver.ping.demo",
"mcpgateway.ping.demo"]` (`MCP_SERVER_RESOURCE_URI` on the raw MCP server).
Root cause: `routes/mcpInspector.js`'s Banking `/tools` and `/invoke` handlers
always connect via `mcpWebSocketClient.js`'s `getMcpServerUrl()` — a direct
WebSocket to the raw `demo_mcp_server` container, never through PingGateway —
but `agentMcpTokenService.js`'s Exchange #2 minted a PingGateway-audience
token (`gateway:mcp:invoke` scope) whenever `ff_mcp_gateway_pinggateway` was
on (the default), with no awareness that this particular caller's transport
bypasses the gateway. Never surfaced before because the step-up MFA gate
(previous entry) blocked the Banking tab from ever reaching a real invoke.

**What was fixed:** added an `opts.forceDirectMcpAudience` flag to
`resolveMcpAccessTokenWithEvents` / `_performTwoExchangeDelegation`. When set,
`routeViaPingGateway` is forced false, so Exchange #2 falls through to
`twoExFinalAud` (the existing gateway-bypass-probe resolution via
`_resolveFinalMcpAudience`) instead of the PingGateway HTTPS resource — a
bare-hostname audience `demo_mcp_server`'s `MCP_SERVER_RESOURCE_URI` allowlist
already accepts. The Banking Inspector's two `resolveMcpAccessTokenWithEvents`
call sites now pass this flag; the real agent's gateway-routed calls are
unaffected (opt defaults to unset/false).

**Do not break:** `ff_mcp_gateway_pinggateway`'s PingGateway-audience routing
must stay the DEFAULT for every other caller (the real banking agent).
`forceDirectMcpAudience` is opt-in per call site — do not flip the default, and
do not remove the flag from either Inspector call site without confirming
whatever replaces `mcpWebSocketClient.js`'s direct-WS transport for the
Banking tab.

**Verify:** `cd demo_api_server && CI=true npx jest src/__tests__/agentMcpTokenService.test.js src/__tests__/mcp-inspector.test.js src/__tests__/mcpGatewayClient.reauth.test.js src/__tests__/oauthService.test.js tests/verticalToolAudience.regression.test.js --testPathIgnorePatterns="/node_modules/"`
(273 tests, 14 suites, exit 0, confirmed). Live re-verification against the
running container not re-run in this pass — see the prior entry's live-log
evidence for how to reproduce with `docker logs ai-demo-mcp-server`.

### 2026-07-21 — Banking MCP Inspector "timeout of 10000ms exceeded" — WS client never handled a clean server-side close

**Files changed:** `demo_api_server/services/mcpWebSocketClient.js` (added a
`ws.on('close', ...)` handler in `mcpRpc()`'s connect Promise), new
`demo_api_server/src/__tests__/mcpWebSocketClient.closeHandling.test.js`.

**What was broken:** the Banking tab of `/pingone-mcp-inspector` showed
"timeout of 10000ms exceeded" toasts and only partially loaded tools.
`banking_mcp_server`'s `BankingMCPServer.handleConnection` rejects a
connection whose token audience doesn't match the server's resource URI via
`ws.close(1008, 'Agent token rejected')` — a clean WebSocket close, not a
protocol error. `mcpWebSocketClient.js`'s `mcpRpc()` only registered
`ws.on('error', ...)`, `'open'`, and `'message'` handlers — no `'close'` — so
that clean close was invisible to the pending RPC promise, which sat until
its own hardcoded 15000ms `setTimeout` finally fired and rejected with the
generic "MCP call timed out" (confirmed live: `GET /api/mcp/inspector/tools`
consistently took ~15.6-16s server-side before falling back to the local
catalog). The frontend's `apiClient.js` has a flat 10000ms axios timeout —
shorter than that 15s+ backend cycle — so the browser aborted first and the
user never even saw the (already-degraded) fallback response.

**What was fixed:** added a `ws.on('close', (code, reasonBuf) => ...)`
handler that clears the timeout and rejects immediately with the real close
code + reason (e.g. "MCP connection closed before response (code 1008:
Agent token rejected)") instead of waiting out the 15s timer for a rejection
that already happened. This turns a ~15-16s hang into a near-instant, more
informative failure — the frontend's 10s timeout is no longer in the picture
because the backend now responds well under it.

**Do not break:** this only adds a `close` listener; the existing
`error`/`open`/`message` handling, the 15s `setTimeout` fallback (for a
connection that never opens or never closes), and the WR-06 slot-release
`.finally(safeRelease)` are untouched. The underlying audience mismatch that
causes `BankingMCPServer` to reject the connection in the first place is a
separate, live-environment config concern — not addressed here — this fix
only makes that rejection surface promptly and accurately instead of hanging.

**Verify:** `cd demo_api_server && npx jest
src/__tests__/mcpWebSocketClient.closeHandling.test.js
src/__tests__/mcp-inspector.test.js --testPathIgnorePatterns="/node_modules/"`
— 13/13 pass. Confirmed the new test hangs (proving it exercises the bug)
when run against the pre-fix file.

### 2026-07-21 — Board batch3: lifecycle HITL false-complete, /check UI probe, token-validation docs link

**Files changed:** `AgentLifecyclePage.jsx` (+ test) — treat `callMcpTool`
HITL soft-success (`mcp_hitl_required`) as 428, not checkout complete;
`serverInventory.js` — probe `https://frontend:4000` (k8s Service name) so
`/check` stops false-ECONNREFUSED on Banking UI; `ConfigTokenValidation.tsx`
— real docs link, remove dead `onClick` and disallowed emoji.

**Note:** Admin-agent `insufficient_scope` NL message (#659) is already on
main — no further change in this batch.

**Verify:** vitest `AgentLifecyclePage.test.jsx`; jest `serverInventory.test.js`.

### 2026-07-21 — RAR on real path: P1AZ PDP + PingGateway PEP (no mock pin)

**Files changed:** `ping-gateway/scripts/groovy/p1az-decision.groovy` (forward
`RarMaxAmount` / `RarPermittedPayees` from TraT; honor TraT for trusted BFF),
`attackSimulatorService.js` (UC14 / intent-binding use active gateway, not
Demo Agent Gateway pin), `run-docker.sh` (lean demo-sync — stop mocks when
real flags; keep otel flag-read harden), `check-groovy-params.sh`.

**What was broken:** RAR demos were pinned to Node mcp-gateway + kept
demo-auth containers up "for RAR," even though cloud snapshot already has
`RarAmountExceeded` / `RarMaxAmount` and PingGateway already forwarded
`RarAuthorizationDetails` without the NUMBER attr the Trust Framework needs.

**What was fixed:** Practical rule — PingOne Authorize decides; PingGateway
extracts TraT and forwards attrs (incl. `RarMaxAmount`); sims call
`callToolViaGateway(null, …)`; demo-sync stops mock servers on real stack.

**Do not break:** BFF live `evaluateMcpFirstTool` already sends `RarMaxAmount`;
unsigned TraT still needs `ALLOW_UNSIGNED_TRAT_CONTEXT` or trusted BFF secret;
Node `rarEnforce.ts` remains for Demo GW path only.

**Verify:** `ping-gateway/scripts/check-groovy-params.sh` → PASS; UC10/RAR unit
tests as before.

### 2026-07-21 — Board batch: UC10 ResourceOwnerId, code-search buttons, TopNav search

**Files changed:** `mcpToolAuthorizationService.js` + `attackSimulatorService.js`
(+ tests) — ResourceOwnerId for `get_account_balance` / treat MCP ownership
errors as DENY; `CodeSearchPage.css` / `CodebaseUploader.css` — scope
button rules under `.code-search-page`; `TopNav.js` — search icon → `/code-search`.
(`run-docker.sh` flag-read harden only — RAR/demo-sync lean behavior is the
entry above.)

**Do not break:** own-account `get_account_balance` must still PERMIT when
owner oauthId equals subjectId.

**Verify:** `cd demo_api_server && npx jest src/__tests__/resolveResourceOwnerId.test.js
src/__tests__/attackSimulator.authorizeEvidence.test.js --forceExit`

### 2026-07-21 — Cleaned up dead frontend code + an unrelated broken test left after the step-up gate removal below

**Files changed:**
- `demo_api_ui/src/components/McpInspectorPage.jsx` — removed the
  `mfaRequired`/`stepUpMethod` state and banner (dead code: the backend gate
  they displayed for was removed in the entry below via a separate,
  independently-authored fix, but that fix didn't touch the frontend).
- `demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx` — removed
  the test that mocked `mfa_required:true` and asserted the banner.
- `demo_api_server/tests/pingcli.route.test.js` — unrelated pre-existing
  failure blocking the pre-push CI gate: `getPingcliConfigPath()`
  (`routes/pingcli.js`) needs `PINGONE_ENVIRONMENT_ID`/
  `PINGONE_WORKER_CLIENT_ID`/`PINGONE_WORKER_CLIENT_SECRET`, which
  `src/__tests__/setup.js` deliberately never loads (tests must never touch
  real secrets) — so `ensureAuthBootstrap()` short-circuited with "not
  configured" before ever calling `execFile`, and "runs an env-scoped
  resource command via pingone api" indexed into an empty
  `execFile.mock.calls` array. Confirmed failing on `main` independent of
  this change. Fixed by stubbing fake PingOne env vars in the test file.

**Do not break:** same invariant as the entry below — `GET
/api/mcp/inspector/tools` stays ungated; don't re-add `mfaRequired` state to
`McpInspectorPage.jsx` unless the backend starts returning it again.

**Verify:** `demo_api_ui`: `npx vitest run
src/components/__tests__/McpInspectorPage.test.jsx` (8/8), `npm run build`
(exit 0). `demo_api_server`: `npx jest tests/pingcli.route.test.js` (9/9, was
1 failing).

### 2026-07-21 — Removed the step-up MFA gate from Banking MCP Inspector tool listing (supersedes the two entries below)

**Files changed:** `demo_api_server/routes/mcpInspector.js` (dropped the
`stepUpEnabled` gate block on `GET /tools`, removed the now-unused
`runtimeSettings` import), `demo_api_server/src/__tests__/mcp-inspector.test.js`
(removed the `MFA gate` describe block).

**What changed:** `GET /api/mcp/inspector/tools` — the Banking tab's tool
discovery endpoint — no longer returns `{ tools: [], mfa_required: true, ... }`
when the session isn't step-up verified. It now always attempts the real
`tools/list` (or falls back to the local catalog), same as the PingOne MCP and
API Calls tabs already did. Reported live: user opened `/pingone-mcp-inspector`
→ Banking MCP and got "Step-up verification required" with zero tools, and
confirmed banking tool *listing* should never require auth/MFA — this route
only returns tool names/schemas, it never executes anything.

**Do not break:** this is scoped to the Inspector's read-only discovery route
only. `runtimeSettings.stepUpEnabled` still gates real money movement —
`mcpLocalTools.js` (`checkLocalStepUp`) and `routes/transactions.js` (428
enforcement on transfer/withdrawal) are untouched and must keep requiring
step-up there. The two entries below (2026-07-21 banner port, 2026-07-18
original fix) previously told future agents to preserve this gate on the
Inspector route specifically — that instruction is now superseded; do not
re-add an MFA gate to `GET /api/mcp/inspector/tools`.

**Verify:** `cd demo_api_server && CI=true npx jest src/__tests__/mcp-inspector.test.js`
(exit 0).


### 2026-07-21 — `/pingone-mcp-inspector` (Banking tab) showed zero tools with no explanation, again

**Files changed:** `demo_api_ui/src/components/McpInspectorPage.jsx` (added
`mfaRequired`/`stepUpMethod` state + banner to `useBankingSource()`; no
server-side change).

**What was broken:** the 2026-07-18 fix below (`mfa_required` handling) lived
only in `McpInspector.js`. That file was later superseded when three
standalone inspector pages were consolidated into `McpInspectorPage.jsx`
(single `InspectorShell` with a source switcher) — the consolidation copied
`refreshTools()`'s `tools`/`toolsSourceInfo` handling but not the
`mfa_required`/`step_up_method` handling, so the same silent-gate regression
came back under the new component. Confirmed live: `mcp_inspector_pingone_live`
flag is ON (not the cause); `stepUpEnabled` is `true` in the running
container; a real request to `/api/mcp/inspector/tools` from an
un-step-up-verified session returned HTTP 200 `{ tools: [], mfa_required:
true, step_up_method: 'email', _source: 'mfa_gate' }` (~107 bytes) and the
Banking tab rendered "No tools loaded." with zero indication why.

**What was fixed:** `useBankingSource()` in `McpInspectorPage.jsx` now reads
`data.mfa_required`/`data.step_up_method` from the `/tools` response and
renders the same inline info banner ("Step-up verification required...") that
`McpInspector.js` already used, placed in `middle` just above the existing
`needsLogin` banner. Verbatim port of the 2026-07-18 fix onto the new file —
no other file touched.

**Do not break:** this is UI-only — the server-side step-up gate in
`mcpInspector.js` (`stepUpEnabled` / `req.session.stepUpVerified`) is
untouched and must keep returning `tools: []` + `mfa_required: true` rather
than silently falling back to the local catalog; that would defeat the gate.
If `McpInspector.js` / `PingOneMcpInspector.js` are ever deleted as dead code,
double-check this banner (and the `mfa_required` read it depends on) survives
in whatever file replaces them — that's exactly how this regressed once
already.

**Verify:** `cd demo_api_ui && npm run build` (exit 0, confirmed). Live
full-session E2E (real OAuth sign-in + step-up) not re-run here; the
`mfa_required` payload shape was confirmed live via `docker logs
ai-demo-api-server` against the real, currently-signed-in session, and the
added code is a direct copy of the already-shipped, already-verified
2026-07-18 banner pattern.

### 2026-07-20 — PingOne Admin agent's tool schemas broke llama.cpp's grammar compiler

**Files changed:**
- `demo_api_server/config/admin/tools.js` — `buildAdminToolSchemas`/
  `executeAdminTool` now use the small `list_pingone_tools`/
  `call_pingone_tool` wrapper from
  `demo_api_server/config/verticals/pingone-admin/tools.js` instead of the
  live PingOne MCP server's raw tool catalog.
- `demo_api_server/config/admin/systemPrompt.js` — rewritten from a stale
  generic "banking admin" prompt (accounts/balances/customers — concepts
  that don't exist in PingOne) to PingOne-specific tool-discovery guidance
  (call `list_pingone_tools` first, then `call_pingone_tool`).
- `demo_api_server/tests/adminTools.schemaSize.test.js` (new) — asserts
  `buildAdminToolSchemas()` returns the 4-tool wrapper set, stays well
  under context budget, and `executeAdminTool` dispatches correctly.
- `demo_api_server/tests/adminSystemPrompt.test.js` — updated the base-prompt
  assertion from `/administrative assistant/i` to `/PingOne Admin
  Assistant/i` to match the rewritten prompt; customer-context assertions
  unchanged.

**What was broken:** once the admin agent's LLM provider was correctly
routed to llama.cpp (see the entry below), llama-server itself returned
`400 Failed to initialize samplers: failed to parse grammar`. Root cause:
`buildAdminToolSchemas()` fetched the live PingOne MCP server's full tool
catalog — 76 tools, ~160,009 bytes of JSON schema (`createApplication` and
`updateApplication` alone are ~40KB combined) — and sent it directly to
the LLM on every call. That blows past llama.cpp's 8192-token context
window and its GBNF grammar compiler chokes on schemas of that size and
complexity.

**What was fixed:** reused the already-built, already-tested 4-tool
wrapper (`list_pingone_tools`, `call_pingone_tool`, plus two demo stubs)
from `config/verticals/pingone-admin/tools.js` — the same module the
separate `/api/agent/run` AG-UI admin path already uses successfully. The
wrapper indirects through `list_pingone_tools`/`call_pingone_tool` instead
of exposing all 76 raw tools, collapsing the schema payload from ~160KB to
under 5KB while preserving full PingOne functionality (the LLM discovers
and calls tools by name through the wrapper, not by seeing every schema
upfront). No new logic was written for PingOne access itself — only
`config/admin/tools.js`'s two functions were rewired to call into the
existing wrapper.

**Do not break:** `adminAgentService.js`'s `executeTool` callback still
gets a JSON string back from `executeAdminTool`, and still does
`JSON.parse(result)` to check for a `.error` field for Token Chain step
failure marking — `executeAdminTool` preserves that contract (`JSON.stringify(result)`
on success, `JSON.stringify({error, message})` on failure). The other
`/api/agent/run` AG-UI path's own use of
`config/verticals/pingone-admin/tools.js` is untouched (only consumed, not
modified) — its own test suites (`adminChipDeadends.test.js`,
`tests/oas/pingone-admin.test.js`, `tests/oas/verticalDispatch.oas.test.js`)
were re-run and stay green.

**Verify:** `demo_api_server` jest —
`adminTools.schemaSize.test.js` (6/6), `adminSystemPrompt.test.js` (3/3),
`adminAgentService.llmProvider.test.js` (2/2),
`adminAgentService.tokenChainStep.test.js` (2/2),
`adminChipDeadends.test.js` + `oas/pingone-admin.test.js` +
`oas/verticalDispatch.oas.test.js` (27/27). Full `demo_api_server` suite
run clean except two confirmed pre-existing flakes unrelated to this
change (`rfc9728-integration.test.js`, `resourceServerTesterCC.route.test.js`
— both pass 100% in isolation).

### 2026-07-20 — PingOne Admin dashboard's LLM defaults to llama.cpp, not Helix

**Files changed:**
- `demo_api_server/services/adminAgentService.js` — both `resolveLlmProvider`
  call sites now explicitly request `provider: 'llamacpp'` instead of
  forcing `provider: undefined` (which fell through to whatever
  `resolveLlmProvider`'s own default happened to be).
- `demo_api_server/tests/adminAgentService.llmProvider.test.js` (new) —
  asserts `runReasonLoop` is always called with `provider: 'llamacpp'`,
  regardless of the session's `langchainConfig`.

**What was broken:** Helix wasn't reliably configured across environments
(discovered while fixing the PingOne Admin agent — see the entries below),
so the admin dashboard's agent returned `reasoning_unavailable` /
Helix-platform errors instead of a real reply. The two modes actually
demoed on the admin dashboard are llama.cpp and Heuristics — Helix should
not be the silent default there.

**A broader fix was tried and reverted:** changing `resolveLlmProvider`'s
own "no explicit provider" fallback (the single canonical default location
per its own doc comment) from `helix` to `llamacpp` globally. This broke
`demo_api_server/services/geminiNlIntent.js`'s "LLM-only mode" — an
unrelated banking NL-router subsystem that hardcodes `provider === 'helix'`
as its literal signal for "a real LLM is configured," with no llama.cpp
equivalent. 4 tests in `src/__tests__/geminiNlIntent.llmOnly.test.js`
failed for real (confirmed on a clean retry, not flaky) because the
global default change silently degraded that subsystem's "LLM-only mode"
to a heuristic fallback. Reverted `llmProviderResolver.js` and
`llmProviderResolver.regression.test.js` back to their original
Helix-default state — confirmed byte-identical to pre-change via
`git diff` against the prior commit.

**What was fixed instead:** `adminAgentService.js` explicitly requests
`llamacpp` via the resolver's normal `requested === 'llamacpp'`
pass-through — the same explicit-selection mechanism every other caller
in the codebase already uses, not a new inlined default. Only the admin
dashboard's LLM changed.

**Do not break:** `resolveLlmProvider`'s own default (Helix) and every
other caller (banking, ops-assistant, a2a-orchestrator, compliance,
support, geminiNlIntent, etc.) are completely unaffected — verified via
`git diff` against the pre-change commit for `llmProviderResolver.js`
itself, and via the full `geminiNlIntent.llmOnly` + related suites (30
tests) passing.

**Verify:** `demo_api_server` jest
`adminAgentService.llmProvider,adminAgentService.tokenChainStep,llmProviderResolver.regression,llmProviderResolver.lmstudio.regression,llmProviderResolver.bedrock,geminiNlIntent.llmOnly`
(30 pass). Live: PingOne Admin agent's demo steps now request `llamacpp`
end-to-end (confirmed via temporary debug logging against the live worker
token flow, then removed) — a separate llama-server "failed to parse
grammar" error surfaced for the admin agent's dynamically-fetched
PingOne tool schemas, tracked as its own follow-up, not fixed here.

**Verify:** `demo_api_server` jest `llmProviderResolver.{regression,lmstudio.regression,bedrock}`
(16 pass, including the 2 updated default-fallback cases); full
`npm run test:api-server` local CI gate.

### 2026-07-20 — Non-admin session selecting PingOne Admin got a blank generic failure

**Files changed:**
- `demo_api_ui/src/services/demoAgentService.js` — `sendToAdminAgent` now
  passes through the response `error` code.
- `demo_api_ui/src/components/AIAgent.js` (`NL_FAILURE_MESSAGES`) — new
  `insufficient_scope` entry.

**What was broken:** the "PingOne Admin" vertical is selectable from
customer-scoped pages (e.g. `/dashboard`'s vertical picker), not just the
admin console. A customer-scoped session picking it and sending a message
correctly gets a 403 `insufficient_scope` from `requireAdmin` (the
admin-only route's middleware) — but `sendToAdminAgent` dropped the
response's `error` field, so `reportNlFailure`'s `NL_FAILURE_MESSAGES[err.code]`
lookup never matched anything and fell to the generic
`"That step couldn't be completed. Try again, or pick another demo step."`,
with no indication the fix is simply switching to an admin session.

**What was fixed:** `sendToAdminAgent` passes through `data.error`, and
`NL_FAILURE_MESSAGES` gained an `insufficient_scope` entry pointing at the
existing "Switch to admin" top-nav button — reuses the same
code-to-message lookup already used for `mcp_scope_denied` etc., no new UI
component.

**Do not break:** this only adds one map entry and one passthrough field —
no other `NL_FAILURE_MESSAGES` codes or `sendToAdminAgent` fields changed.

**Verify:** `demo_api_ui` vitest `demoAgentService.adminRouting` (7 pass,
including the new `insufficient_scope` passthrough case); `npm run build`
exits 0. Live: a customer-scoped session on `/dashboard` selecting PingOne
Admin and sending a message now sees "This needs an admin session — click
'Switch to admin'..." instead of the blank generic fallback.

### 2026-07-20 — Admin agent demo-step replies labeled `[CUSTOMER AGENT]`

**Files changed:**
- `demo_api_ui/src/services/demoAgentService.js` — `sendToAdminAgent` now
  passes through the backend's `agentHeader` field.
- `demo_api_ui/src/components/AIAgent.js` (`handleNlResumeResponse`'s
  success branch) — labels the reply with `response.agentHeader` when
  present, falling back to the existing literal `[CUSTOMER AGENT]` string
  otherwise.

**What was broken:** `handleNlResumeResponse` (the function every demo-step
click funnels through, for every vertical) hardcoded the `[CUSTOMER AGENT]`
prefix on every successful reply, never reading any dynamic field. Harmless
until the PingOne Admin routing fix (previous entry) started reaching the
real admin backend — its replies then displayed the wrong agent label even
though the backend and routing were correct.

**What was fixed:** `sendToAdminAgent` passes through `agentHeader` from
`/api/admin-agent/message`'s response (e.g. `🤖 [ADMIN AGENT - LangGraph -
Claude 3.5 Sonnet]`), and the display label now prefers it when present.

**Do not break:** every other vertical's response envelope never sets
`agentHeader`, so `response.agentHeader || "[CUSTOMER AGENT]"` preserves the
exact current label for banking/healthcare/etc. — verified this is the only
line changed in `handleNlResumeResponse`; the HITL/step-up/CIBA/token-
accounting logic above and below it is untouched.

**Verify:** `demo_api_ui` vitest `demoAgentService.adminRouting` (6 pass,
including the new `agentHeader` passthrough case); `npm run build` exits 0.
Live click-through: PingOne Admin demo step reply now shows `[ADMIN AGENT -
LangGraph - ...]`, banking vertical still shows `[CUSTOMER AGENT]`
unchanged.

### 2026-07-20 — Agent Lifecycle step-up checkout (UC22 CIBA) 428-looped forever after approval; kill-switch had no recovery path

**Files changed:**
- `demo_api_ui/src/pages/AgentLifecyclePage.jsx` — `StepUpSlot`'s checkout call
  now goes through `callMcpTool` (same as `ScopedCallSlot`) instead of a bare
  `fetch`, so it shows up in the Token Chain rail; waiting-approval copy no
  longer implies a push confirmation screen that doesn't exist.
- `demo_api_server/routes/ciba.js` — both CIBA-approved branches (simulated
  and real) now also set `req.session.hitlVerified`, mirroring the existing
  `stepUpVerified` flag.
- `demo_api_server/services/mcpToolAuthorizationService.js` — new
  `hitlAlreadyVerified` (single-use, same pattern as `stepUpAlreadyVerified`)
  gates all three `mcp_hitl_required` 428 branches (live, simulated,
  fallback_simulated).
- `demo_api_server/services/killSwitchService.js` — new
  `enableAgentApplicationsAtPingOne()`, the inverse of
  `disableAgentApplicationsAtPingOne()`.
- `demo_api_server/routes/admin.js` — new
  `POST /api/admin/agent/:agentId/re-enable` route.
- `demo_api_ui/src/components/ControlPlaneRoster.jsx` (+ `.css`) — "Re-enable"
  button on the live agent row when revoked.

**What was broken:** checking out $600 headphones (or UC22's "extend my rental
$600") correctly 428'd for step-up, CIBA approved (this env runs the
simulated CIBA fallback — no real PingOne bc-authorize provisioning yet, see
`docs/superpowers/plans/2026-07-20-ciba-real-platform-provisioning.md`,
`stepUpVerified` cleared it — but the SAME decision endpoint call also always
carries a `HITL Approval Required` statement with `obligatory:false`, and
`classifyObligations` ignores `obligatory` entirely (by design — confirmed via
live payload diff that a genuine $300 consent-required transfer carries the
identical `obligatory:false`, so filtering on it would have silently disabled
real HITL/consent enforcement too). `hitlRequired` had no "already verified"
counterpart the way `stepUpRequired` did, so it 428'd on every retry forever.
Separately, `AgentLifecyclePage`'s step 4 kill-switch button — a real,
one-way PingOne application disable — had no UI-reachable undo, so testing it
broke the whole demo (every agent tool call) until an admin manually
re-enabled the app in PingOne.

**What was fixed:** CIBA approval now sets `hitlVerified` alongside
`stepUpVerified` (CIBA out-of-band approval IS a human-in-the-loop event) and
the gate consumes it the same single-use way. The kill switch gets a real
inverse action, surfaced on the AI Control Plane roster (not the killed page
itself — that session is destroyed by the kill-switch route).

**Do not break:** `classifyObligations` (`services/authorizeObligations.js`)
is untouched — do not filter on `obligatory` there; live evidence shows it is
not a reliable advisory-vs-binding signal in this PingOne policy. The
existing HITL-receipt-challenge path (`hitlChallengeId`/`hitlApproved`) is
unaffected — `hitlAlreadyVerified` is an additional, independent way to clear
the gate, not a replacement.

**Verify:** `demo_api_server` jest —
`mcpToolAuthorizationService,ciba,cibaService,cibaSimulatedService,step-up-gate,killSwitchService`
(156 tests, all green); `demo_api_ui` vitest `AgentLifecyclePage`,
`ControlPlaneRoster` green; `cd demo_api_ui && npm run build` exits 0. Live:
confirmed the original 428-loop via Docker log capture of two real
`BFF→P1AZ` decision-endpoint round trips; re-enable button not yet
click-verified live (server routes + unit tests only).

### 2026-07-20 — PingOne Admin AI Agent messages misrouted to the customer/banking agent

**Files changed:**
- `demo_api_ui/src/services/demoAgentService.js` — `sendAgentMessage` branches
  to a new `sendToAdminAgent` helper when `vertical === 'pingone-admin'`,
  posting to `/api/admin-agent/message` instead of `/api/agent/invoke`.

**What was broken:** every `sendAgentMessage()` call site (demo-step clicks,
free-typed chat, heuristic-resolved vertical re-dispatch) sent
`pingone-admin`-vertical messages to `/api/agent/invoke`, which always calls
the customer/banking agent (`processAgentMessage` in
`demoAgentLangGraphService.js`). That service's admin-token guard
(`customerTokenGuard.js`'s `isVerticalExemptFromAdminTokenGuard`, exempting
only `{admin, oauth-teaching}`) correctly refused with `requiresCustomerLogin`
for an admin token — but the request was going to the wrong backend
regardless. The real admin backend (`adminAgentService.js`, live PingOne
Management API tools) was only reachable via a narrow
`PINGONE_ADMIN_CHIP_IDS.has(chipId)` gate in `AIAgent.js` that demo steps and
typed chat never passed through.

**What was fixed:** `sendAgentMessage` now checks `vertical` first and routes
`pingone-admin` messages to `/api/admin-agent/message` directly, normalizing
the response into the same return shape every caller already expects.

**Do not break:** the `PINGONE_ADMIN_CHIP_IDS`-gated inline block in
`AIAgent.js` still exists unchanged and still works for its pre-wired chips —
this fix doesn't consolidate into it. Non-admin verticals (banking,
healthcare, retail, …) must keep hitting `/api/agent/invoke` exactly as
before; `customerTokenGuard.js`'s exempt list and `agentInvokeRoute.js` are
untouched.

**Verify:** `demo_api_ui` vitest `demoAgentService.adminRouting` (5 pass,
including the non-admin-vertical-unchanged regression case) +
`demoAgentService.{tokenEventCallback,hitlRetry,timeoutSync,legacyTrace}`
still green; `cd demo_api_ui && npm run build` exits 0. Live click-through:
each of the 4 PingOne Admin demo steps gets a real tool-backed reply, typed
chat in the admin agent works, banking vertical chat/chips unaffected.

### 2026-07-20 — Banking Demo Steps: Step 3 (UC7 step-up) went permanently silent after an interrupted first run

**Files changed:** `demo_api_ui/src/components/AIAgent.js` (the NL-resume
replay effect, ~line 6567 — same effect touched by the 2026-07-18 entry
below, different bug).

**What was broken:** `handleDemoStepSelect` fires this effect by calling
`setNlResumeAfterAuth(trigger.text)`. The effect sets
`pendingNlResumeRef.current = text` synchronously, then delays 250ms before
actually sending; the ref is only reset back to `null` inside the `finally`
of that delayed callback. If the effect's cleanup ran before the 250ms timer
fired (deps change, remount) — nothing was ever sent, but the ref stayed
wedged at `text` forever. `setNlResumeAfterAuth(trigger.text)` with the same
string is a React no-op (`Object.is` bails), so the effect would never
re-fire, and the guard at the top of the effect also blocked on the stale
ref match. Net effect: click "Demo step 3" once, get an interrupted run, and
every subsequent click prints "Running Demo step 3…" and then does nothing —
no request, no error, stale Token Chain state left over from the poisoned
run. Each vertical's amount-gated chip uses different wording
(`amountTriggerByVertical` in `useCases.js`), so only the vertical whose text
got stuck was affected — banking uses the base entry's text
("transfer $600 from checking to savings"), so this reproduced as
"works on other verticals, not banking."

**What was fixed:** track whether the 250ms timer actually fired
(`timerFired`). In the effect's cleanup, if it never fired, also reset
`pendingNlResumeRef.current = null` — releasing the guard so a later click
with the same trigger text can retry. The in-flight-send path (timer already
fired) is untouched: its own `finally` still skips resetting state on
supersede, per the 2026-07-18 entry's "do not clobber a newer
`nlResumeAfterAuth`" rule.

**Do not break:** the monetary/consent branch inside this same effect
(banking `create_transfer` payload shape, `verticalOpts` must not carry
`signal`) — untouched by this fix, which only edits the cleanup function.

**Verify:** `cd demo_api_ui && CI=true npx jest src/__tests__/BankingAgent
src/components/__tests__/AIAgent.chips.test.js
--testPathIgnorePatterns="/node_modules/"` (79 pass); `npm run build`
(exit 0).

### 2026-07-20 — UC22 CIBA demo transfer never completed — re-forced another CIBA prompt forever after approval

**Files changed:** `demo_api_server/routes/transactions.js` (the `evaluateTransactionPolicy`
call, ~line 599), `demo_api_server/src/__tests__/step-up-gate.test.js` (2 new tests).

**What was broken:** UC22's `useCaseId` (`ciba-out-of-band-approval`) makes
`transactionAuthorizationService.evaluateTransactionPolicy` force the CIBA
step-up block unconditionally (see `CIBA_DEMO_USE_CASE_ID`, by design —
regardless of `acr`, so the presenter never sees a consent/permit instead of
CIBA). AIAgent.js's post-approval retry (`pollCibaStepUp` /
`pollCibaThenResumeNl`) re-sends the same `useCaseId` on the retry, and this
route forwarded it unconditionally too — so the retry got re-forced into
*another* CIBA prompt instead of completing, even though
`req.session.stepUpVerified` was fresh and already being consumed into
`effectiveAcr = 'Multi_Factor'` two lines above. Net effect: CIBA approval
never "returned a response to the user" — it looped, and whatever broke the
loop client-side surfaced as a confusing "MFA request was cancelled" +
"Incomplete" verdict (missing `authorize-decision` token-chain evidence,
since the transaction never permitted).

**What was fixed:** `useCaseId` is now dropped (`''`) on the specific request
that just consumed a fresh `req.session.stepUpVerified`
(`sessionStepUpFresh`) before calling `evaluateTransactionPolicy`. The
CIBA-forcing check itself is untouched (still unconditional on `acr`, by
design) — the retry simply no longer carries the useCaseId that triggers it,
so it falls through to the policy engine's normal acr-aware decision and
permits.

**Do not break:** the UC22 override must stay unconditional on `acr` — do not
add an `acrLooksStrong`-style guard inside
`transactionAuthorizationService.js` itself (tried first; it broke because
several other test files mock `simulatedAuthorizeService` without that
export, and reaching through a mocked module for a plain string check is
fragile — silently threw and got swallowed into a generic 503 in three call
sites at once). Keep the loop-breaking logic in `routes/transactions.js`
right next to where `sessionStepUpFresh` is already computed.

**Verify:** `cd demo_api_server && CI=true npx jest src/__tests__/step-up-gate.test.js
src/__tests__/transactionAuthorizationService.test.js
tests/services/transactionAuthorizationService.rfc9470.test.js
--testPathIgnorePatterns="/node_modules/"` (41/41 pass). Live: run UC22 from
`/use-cases`, approve the CIBA prompt, confirm the transfer completes on the
first retry instead of prompting again.

### 2026-07-19 — Demo Config page (`/demo-config`) applied a sidebar selection but the side nav never refreshed

**Files changed:**
- `demo_api_ui/src/components/DemoConfigPage.js` — `saveSelection` and
  `applyConfig` now dispatch `window.dispatchEvent(new CustomEvent("nav-config-changed"))`
  after a successful `PUT /api/user/nav-config`.
- `demo_api_ui/src/components/AdminSideNav.jsx` — the hidden-nav-labels fetch
  is extracted into `loadNavConfig` (was inline in a mount-only `useEffect`),
  called on mount, on the new `nav-config-changed` event, and from a new
  "Refresh" button in the quick-links row (same pattern already used for
  `vertical-list-changed` / the vertical picker).

**What was broken:** `AdminSideNav` fetched `/api/user/nav-config` only once,
on `[user]` change (mount/login). `DemoConfigPage`'s Save/Apply actions PUT
the new hidden-labels selection to the server but had no way to tell the
already-mounted sidebar to reload it, so the side nav kept showing the old
item set until a full page reload (login/logout).

**Do not break:** don't touch `AdminSideNav`'s expansion-state-by-key
persistence (role-scoped `sessionStorage`, gated on `loadedSectionsKeyRef`) —
unrelated state, untouched by this fix.

**Verify:** `cd demo_api_ui && npx vitest run src/components/__tests__/adminSideNav.test.jsx src/__tests__/DemoConfigPage.test.js` (16 pass); `npm run build` (exit 0).

### 2026-07-19 — Agent Gateway / Use Cases still red after the env-var fix — admin OAuth client had no PingOne grant

**Files changed:** none (live PingOne config only — no code, no `.env`).

**What was broken:** after the `PINGONE_RESOURCE_PINGGATEWAY_URI` fix
(entry further below) the SAME error persisted (`token-exchange: ...At
least one scope must be granted`). Traced which client performs this
exchange — `gatewayCheck.js` and `agentMcpTokenService.js`'s no-actor-token
branch both call the plain `oauthService.performTokenExchange`, which uses
the **admin** OAuth client (`8a711944…`, "Demo AI App - Admin Login",
`WEB_APP` type). Checked that client's live PingOne grants (worker creds,
read-only): it had grants on Demo MCP Server / Demo API / openid but
**zero grant on "Demo PingGateway MCP" (resource `6635cfb8`)** — whose only
scope is `gateway:mcp:invoke`. Every other MCP resource already grants the
admin client; this one never got it (matches the "durable provisioning
still deliberately absent" gap noted in `[[project-pinggateway-half-built]]`).

**What was fixed (user-confirmed live write):** `POST
/applications/8a711944.../grants` with
`{resource:{id:"6635cfb8..."}, scopes:[{id:"4b2917d1..." /* gateway:mcp:invoke */}]}`
→ HTTP 201. Re-fetched the client's grants afterward — resource `6635cfb8`
now present. Confirmed the app type is `WEB_APP` (grants API works),
not `WORKER` (which PingOne restricts to `openid`-only grants) before
writing.

**Do not break:** additive-only — one new application grant, no existing
grant/resource/scope/code touched.

**Verify:** live PingOne grant list for `8a711944` includes `6635cfb8 ->
[gateway:mcp:invoke]`. Full end-to-end proof needs a real signed-in
browser run (a genuine user token, not something replicable with worker
creds) — re-run "Run demo check" signed in.

### 2026-07-19 — Demo check PINGONE AUTHORIZE card red — check required a field PingOne doesn't return

**Files changed:** `demo_api_server/services/checks/authorizeCheck.js` only.

**What was broken:** `authorize.realDecision` required every P1AZ decision
response to carry a truthy `decisionId` or it hard-failed. Replicated the
exact live call the check makes (worker token + `POST
/decisionEndpoints/{id}` with the real `authorize_decision_endpoint_id`,
`84d45731-4c43-4ab1-ab6a-0350e9dfe8e1`) — the live response never includes
`id`/`decisionId`, only `correlationId`. Confirmed via
`grep -rn '\.decisionId\b'` that every OTHER consumer in this codebase
(attackSimulatorService, mcpToolAuthorizationService,
transactionAuthorizationService, agentPreflightService, …) already treats
`decisionId` as optional (`|| null`) — this check alone hard-required it,
so it failed unconditionally regardless of the real decision. Confirmed
this is a genuinely different bug from the Agent Gateway/Use Cases fix
above (user pushed back on assuming same cause — correctly; this check
uses a completely different PingOne API, `pingOneAuthorizeService.js`, not
the PingGateway MCP token-exchange path).

Secondary finding, same investigation: the `SMALL` test amount ($2,500,
comment says "expect PERMIT") is above the live policy's $2,000 PERMIT
threshold, so it was also getting DENY'd — verified live that $500 gets
PERMIT.

**What was fixed:** guard now only requires `d.decision` (the actual
PERMIT/DENY/INDETERMINATE effect), not `d.decisionId`. `SMALL` amount
500 → 500 (restores the PERMIT-vs-DENY discrimination the check was
designed to prove).

**Do not break:** did not touch `pingOneAuthorizeService.js`'s shared
`_postDecisionEndpoint`/`decisionId` extraction — that's consumed by the
real transfer/HITL/attack-sim paths; out of scope for a check-only fix.

**Verify:** `CI=true npx jest --testPathPattern="checks/authorizeCheck.test.js"`
— 6/6 pass. Live: replicated the fixed guard against the real decision
endpoint response for both test amounts — old guard fails both (missing
decisionId), fixed guard passes and PERMIT/DENY discriminate →
`status: 'pass'`.

### 2026-07-19 — Demo check SERVERS card red on a stock lean-core checkout (profile-gated services)

**Files changed:** `demo_api_server/data/serverInventory.js`,
`demo_api_server/services/checks/serversCheck.js`.

**What was broken:** even after the UI/LangChain Agent probe fixes (entry
below), `servers.all_up` still returned `status: 'fail'` on a default
`./run-docker.sh` checkout because 7 services aren't started: OpenAI Agent,
Mastra Agent, Pydantic Agent, Mock Authz Server, Weaviate, Embeddings, MCP
Code Search. Verified via `docker-compose.yml` these are ALL gated behind
Compose `profiles:` (`agents` / `demo-auth` / `rag`) that are off by default
in lean-core — their absence is expected, not a broken deploy. User
confirmed intent: keep lean-core as-is, don't gate overall readiness on
optional profiles (asked via clarifying question — the alternative was
starting all profiles, which was declined).

**What was fixed:** added `optional: true` to those 7 `SERVER_INVENTORY`
entries (each commented with its compose profile). `serversCheck.js` now
splits `down` into `requiredDown`/`optionalDown`; `status` is `'fail'` only
if a required service is down, `'warn'` if only optional ones are, `'pass'`
otherwise. Detail text reports both groups separately.

**Do not break:** required-service semantics unchanged — any core/mcp/authz
service actually going down still fails the check exactly as before
(`tests/checks/serversCheck.test.js` down-service scenario untouched, still
passes since that test's fixture services aren't marked optional).

**Verify:** `CI=true npx jest --testPathPattern="serverInventory.test.js|checks/serversCheck.test.js"`
— 2 suites / 6 tests pass. Live: `docker exec ai-demo-api-server node -e
"require('/app/services/checks/serversCheck').run().then(r=>console.log(r.status))"`
→ `warn` (was `fail`) on this lean-core checkout.

### 2026-07-19 — Demo check SERVERS card: Banking UI + LangChain Agent falsely reported down

**Files changed:** `demo_api_server/data/serverInventory.js` only.

**What was broken:** both containers were running/healthy but `servers.all_up`
reported them down. `ui` probed `https://frontend:4000` — not a real compose
DNS name (service key is `ui`); confirmed live via `docker exec
ai-demo-api-server curl https://frontend:4000` → could not resolve host.
`langchain-agent` probed `:8890/health`, which `langchain_agent/src/api/health.py`
deliberately binds to `127.0.0.1` only (that port also serves
`/inspector/mcp-host`, which leaks the full MCP tool registry — kept off
the network on purpose, confirmed via the `/proc/net/tcp` bind address
inside the container).

**What was fixed:** `ui` candidate → `https://ui:4000` (correct compose
hostname, verified `curl` now 200). `langchain-agent` candidate → AG-UI
port `:8888` with `acceptAnyStatus: true` (a 401-without-auth response is
still proof the process is up), same pattern already used for the
`ui`/`ping-gateway` entries. Verified both live via `docker exec` before
and after.

**Do not break:** did not touch `HEALTH_HTTP_HOST`/docker-compose — the
loopback-only bind on :8890 is intentional (security boundary for
`/inspector/mcp-host`), not a bug to "fix" by opening it up. The other
services this check reports down (OpenAI/Mastra/Pydantic Agent, Mock Authz
Server, Weaviate, Embeddings, MCP Code Search) genuinely aren't running in
this lean-core compose profile (`docker ps -a` confirmed no such
containers) — those reds are correct and were left unchanged.

**Verify:** `docker exec ai-demo-api-server` probe script — `ui` → 200,
`langchain-agent` → 401 (accepted). `servers.all_up` no longer lists either
in `Down:`.

### 2026-07-19 — Demo check page still unreadable after opacity fix — real cause was a dead dark-mode CSS block

**Files changed:** `demo_api_ui/src/pages/CheckPage.css` only (supersedes,
does not replace, the opacity fix logged just below — both were real bugs).

**What was broken:** removing the `opacity: 0.6-0.8` dimming (previous
entry) wasn't enough — user reported the page was still unreadable after a
hard refresh. Root cause: the file had a `@media (prefers-color-scheme: dark)`
block plus `:root[data-theme="dark"]` / `[data-theme="light"]` blocks, "so
the page follows the app's theme toggle" — but no theme toggle exists anywhere in
this app (confirmed: nothing sets `data-theme` on `documentElement`). On a
browser/OS with dark mode on, the media query fired and flipped `--text` to
`#e7eaf2` (near-white), while the page's actual background stayed light
(from the app's global `body` rule + a `.card` class name collision with
`index.css` — neither theme-aware) → near-white text on a light background.

**What was fixed:** deleted the dark-mode media query and both unreachable
`data-theme` attribute blocks; kept only the light `:root` token block,
matching how the rest of the app already renders (fixed light theme).

**Do not break:** no JS change; no other page uses `CheckPage.css`. If a
real theme toggle is ever added app-wide, dark tokens should come back
wired to whatever mechanism sets `data-theme`, not a bare media query.

**Verify:** `cd demo_api_ui && npm run build` (exit 0, confirmed); live
Vite bundle checked to contain zero `@media (prefers-color-scheme` /
`:root[data-theme` occurrences post-fix.

### 2026-07-19 — Demo check page AGENT GATEWAY / USE CASES cards red — missing local env var, not a PingOne gap

**Files changed:** `demo_api_server/.env` (gitignored, local runtime config only — no
tracked file changed). Container `ai-demo-api-server` recreated to load it.

**What was broken:** `gateway.real_path` (Agent Gateway card) and
`usecase.permit_accounts` (Use Cases card) both failed exercising the real
PingGateway path — `token-exchange: ... At least one scope must be granted`
and `gateway_policy_denied`. Read-only PingOne audit (worker creds,
`verify-scope-configuration.js` + `--manifest-diff`) proved live PingOne is
fully correct — resource `Demo PingGateway MCP` already has `gateway:mcp:invoke`
granted. Root cause: `demo_api_server/.env` had no
`PINGONE_RESOURCE_PINGGATEWAY_URI` line, so `configStore.getEffective()`
returned `''` and the BFF requested a token-exchange audience of empty
string — PingOne correctly refused. This exact var/fix was already documented
in `[[project-pinggateway-half-built]]` (2026-07-10, PR #277) but was absent
from this checkout's `.env`.

**What was fixed:** added `PINGONE_RESOURCE_PINGGATEWAY_URI=https://api.ping.demo:3036/mcp`
to `.env`, `docker compose up -d demo-api-server` (recreate — `node --watch`
does not reload env vars). No PingOne config was changed.

**Do not break:** did not touch any PingOne resource/scope/grant, any code
path, or any other `.env` value.

**Verify:** inside the container, `configStore.getEffective('pingone_resource_pinggateway_uri')`
now returns `"https://api.ping.demo:3036/mcp"` (was `""`). Re-run "Run demo
check" on `/check` signed in — AGENT GATEWAY / USE CASES expected to go green.

### 2026-07-19 — Demo check page (`/check`) text unreadable — muted opacity on every label

**Files changed:** `demo_api_ui/src/pages/CheckPage.css` only.

**What was broken:** card titles, tab labels, step labels, row/rail detail
text all rendered `var(--text)` at `opacity: 0.6-0.8`, washing out contrast
against the light-theme background and making the whole page hard to read —
violates the `§0` no-muted-text rule.

**What was fixed:** removed the opacity dimming; primary text now renders
`var(--text)` at full strength, secondary/hint text (`.card-foot .hint`,
`.group-head .count`, `.chk-row .chev`, `.rail-item .n`) uses the
`--text-muted` token instead of arbitrary opacity so hierarchy is preserved
without going low-contrast.

**Do not break:** no layout/JS change — only text color/opacity
declarations in this one CSS file.

**Verify:** `cd demo_api_ui && npm run build` (exit 0, confirmed); live
Vite-served bundle at `https://api.ping.demo:4000/src/pages/CheckPage.css`
checked to contain zero `opacity: 0.6/0.7/0.8` declarations post-fix.

### 2026-07-18 — MCP Inspector page showed zero tools with no explanation when step-up wasn't verified

**Files changed:** `demo_api_ui/src/components/McpInspector.js` (added
`mfaRequired`/`stepUpMethod` state + banner; no server-side change).

**What was broken:** `GET /api/mcp/inspector/tools`
(`demo_api_server/routes/mcpInspector.js:161-171`) already had a step-up MFA
gate that returns HTTP 200 `{ tools: [], mfa_required: true, step_up_method }`
when `runtimeSettings.get('stepUpEnabled')` is on and the session isn't
step-up-verified. The page's `refreshTools()` did `setTools(data.tools || [])`
and never read `data.mfa_required`, so the gate fired silently — the page just
rendered "No tools loaded." with no indication an MFA gate, not a broken MCP
connection, caused it. Confirmed live: `runtimeSettings.get('stepUpEnabled')`
is `true` in the running container.

**What was fixed:** `McpInspector.js` now reads `data.mfa_required` /
`data.step_up_method` from the `/tools` response and renders an info banner
("Step-up verification required...") using the same inline-banner pattern as
the existing `needsLogin` block, instead of leaving the tool list blank with
no explanation.

**Do not break:** this is UI-only — the server-side step-up gate in
`mcpInspector.js` (`stepUpEnabled` / `req.session.stepUpVerified`) is
untouched and must keep returning `tools: []` + `mfa_required: true` rather
than silently falling back to the local catalog; that would defeat the gate.

**Verify:** `cd demo_api_ui && npm run build` (exit 0).

### 2026-07-18 — UC10/UC13 attack sims still "direct": bypassed the real BFF pipeline (agent-token/BFF-preflight-Authorize), only the gateway's own downstream call was real

**Files changed:** `demo_api_server/services/bffMcpToolExecutor.js` (new export
`runPipelineForSim` — thin wrapper around `runMcpToolPipeline` using the same
production `_pipelineDeps` every chip/agent call uses), `demo_api_server/services/attackSimulatorService.js`
(`_runRogueActor`/`_runCrossOwnerAccount` rewritten to call it instead of a
hand-rolled `_exchangeGatewayToken` + `callToolViaGateway`; new
`_denyFromPipeline`/`_authorizeFromPipelineOutcome`/`_normalizeAuthorizeDecision`
helpers; `PIPELINE_ROUTED_SIMS` set gates the redundant manual `user-token` push).

**What was broken:** the previous fix (below) surfaced the gateway's real Authorize
decision, but UC13/UC10 still called `callToolViaGateway` directly after their OWN
minimal exchange — skipping the agent-token step, the BFF-preflight
`evaluateMcpFirstToolGate` Authorize gate, and the compliance-audit/HITL machinery
every real tool call goes through. Only the gateway's own downstream PingOne
Authorize call was genuine; everything upstream of it was a shortcut. User
correctly called this "direct, not full flow."

**What was fixed:** UC13 (rogue-actor) and UC10 (cross-owner-account) now run
through `runPipelineForSim` → `runMcpToolPipeline` with the REAL, authenticated
Express `req` — the exact same entry point `executeBffTool` uses for a real
chip/agent call. The rogue actor is injected via `req.body._testActClientId`
(a pre-existing production affordance `mcpToolPipeline.js` already read at its
gateway-call site — not a new sim-only hook), restored in a `finally` so it never
leaks past the call. `_authorizeFromPipelineOutcome` prefers the BFF-preflight's
structured `body.mcpAuthorizeEvaluation` (present on permit AND deny/step-up/HITL
branches) and falls back to the `gw-authorize` token event the pipeline already
builds from the gateway's real audit trail when the preflight permits and the
gateway itself denies — whichever real stage actually decided.

**Do not break:** the OTHER 7 sims (insufficient-scope, wrong-aud, rate-limit-burst,
replayed-token, rar-exceeded, tampered-intent-token, impersonation-no-act) stay on
the direct exchange+gateway path deliberately — they are gateway-PERIMETER probes
(checked before Authorize by the real architecture) or need a deficiency
(forced narrow scope, raw un-exchanged token, tampered signature) the pipeline's
own exchange helper has no override hook for; adding one would touch
`resolveMcpAccessTokenWithEvents`, which every real call depends on — out of
scope here, flagged in the module header instead of silently expanded.
`_denyFromGateway`/`_authorizeFromGatewayError` are unchanged and still used by
those 7. `PIPELINE_ROUTED_SIMS` is the single source of truth for which sims get
the (now redundant) manual `user-token` skipped.

**Verify:** `cd demo_api_server && CI=true npx jest src/__tests__/attackSimulator.authorizeEvidence.test.js
src/__tests__/bffMcpToolExecutor.runPipelineForSim.test.js src/__tests__/attackSimulator.test.js
src/__tests__/attackSimulator.wrongAudFields.test.js src/__tests__/securityShowcase.test.js
tests/attackSimExchangerParity.test.js tests/use-cases-maturity.test.js tests/pingAiTestLab.route.test.js
src/__tests__/bffMcpToolExecutor.regression.test.js src/__tests__/oauth-teaching-demonstrate.test.js
src/__tests__/bffMcpEnvelopeUnwrap.regression.test.js src/__tests__/dispatchVerticalIntent.localBypass.test.js
src/__tests__/a2aExecution.test.js src/__tests__/verticalIntentDispatch.test.js
src/__tests__/mcpToolPipeline.authzBypass.test.js src/__tests__/bffMcpToolExecutorUseCaseId.test.js
tests/agentToolUseCaseId.test.js tests/checks/usecaseCheck.test.js
tests/services/heuristicBankingWr07.regression.test.js tests/services/heuristicBankingWr07.integration.test.js
tests/services/bankingHitlNormalize.regression.test.js --testPathIgnorePatterns="/node_modules/"`
(358 passed, 2 pending [live-API-gated, skip without creds], 0 failed); `cd demo_api_ui && npm run build` (exit 0).

### 2026-07-18 — Authorize-reaching attack sims (UC10/UC13/UC14/UC16) looked fake: only the chatbot step lit, generic deny reason, "Incomplete" verdict

**Files changed:** `demo_api_server/services/attackSimulatorService.js`
(`_denyFromGateway` surfaces the real Authorize decision; `runAttackSim` emits a
`user-token` sign-in step), `demo_api_ui/src/services/tokenChainTrace/simTraceAdapter.js`
(new — maps sim event ids onto the rail's vocabulary),
`demo_api_ui/src/components/AIAgent.js` (attack-sim handler feeds the trace-rail store).

**What was broken:** the attack-sim handler reset the `TokenChainTraceRail`
(`beginTrace`) then routed the sim's real token events ONLY to the API Traffic
panel (`appendTokenEvents`) and the legacy `tokenChain` context — never to
`tokenChainTraceStore`, which drives the rail. So the pipeline showed only the
Chatbot step. Separately, `_denyFromGateway` discarded `err.gwAuditTrail` — the
gateway's `X-Gw-Audit-Trail` header carrying the REAL PingOne Authorize decision
(DENY + decisionId + reason + statements) — and reported the gateway's generic
403 body ("Gateway policy denied the tool call"), identical for every sim. And
because the sim never set `trace.authorize`, `computeVerdict`'s
`'authorize-decision'` evidence check (satisfied by `!!trace.authorize`) failed,
so UC10/UC13/UC14/UC16 rendered "Incomplete" on a correct, real DENY.

**What was fixed:** `_denyFromGateway` now extracts `err.gwAuditTrail.authorize`
into a decision object returned on the result (`result.authorize`) and derives a
control-specific reason (engine reason > per-code description > generic). The
handler feeds the rail via `ingestTokenEvent` (through `buildSimRailEvents`,
which maps `sim-exchange-ok` → `exchanged-token`), `ingestAuthorize(data.authorize)`,
and `completeTrace(status < 400)`. Result: Sign-in ✓ → Token exchange ✓ →
PingOne Authorize ✗ DENY (real decisionId + specific reason) light up, and the
verdict flips to "denied-as-expected".

**Do not break:** the surfacing is gated on `err.gwAuditTrail.authorize` EXISTING
— gateway-perimeter denials (UC5/UC11/UC12: aud/scope checked before Authorize)
carry no `authorize` node, so `result.authorize` stays unset and their
`sim-exchange-ok`/`sim-gateway-deny` evidence contracts are unaffected. The
backend still emits the original `sim-*` events (API Traffic panel + product-badge
map depend on them); `simTraceAdapter` reshapes only the copy fed to the rail.
`computeVerdict`'s short-circuit is unchanged.

**Verify:** `cd demo_api_server && CI=true npx jest src/__tests__/attackSimulator.authorizeEvidence.test.js
src/__tests__/attackSimulator.test.js src/__tests__/attackSimulator.wrongAudFields.test.js
tests/attackSimExchangerParity.test.js tests/use-cases-maturity.test.js
--testPathIgnorePatterns="/node_modules/"` (green); `cd demo_api_ui && CI=true node_modules/.bin/vitest run
src/services/tokenChainTrace src/context/__tests__/ProofOfEnforcementContext.test.js
src/utils/pingProducts.test.js src/components/__tests__/AIAgent.confusedDeputy.test.js
src/components/__tests__/AIAgent.chips.test.js` (green); `cd demo_api_ui && npm run build` (exit 0).

### 2026-07-18 — Attack-sim denies (UC5/UC11/UC12) rendered nowhere in the trace rail — the run looked like it died at the chatbot

**Files changed:** `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`,
`demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js`
(`ingestTokenEvents`), `demo_api_ui/src/components/AIAgent.js` (attack-sim
trigger branch only).

**What was broken:** The sims DO reach the gateway and get denied there
(PingGateway 403 `insufficient_scope` for `gateway:mcp:invoke`, verified in BFF
logs), but the TokenChainTraceRail ignored every `sim-*` token event except the
two RAR error codes, and the attack-sim branch in `AIAgent.js` never called
`completeTrace`. Result: after "Demo step 10: UC5" the rail showed sign-in +
prompt done and everything downstream stuck "pending" — the failure appeared to
happen at the chatbot instead of at the gateway. `ingestTokenEvents` also
replaced the whole event array, wiping the carried `user-token` so even the
sign-in step regressed.

**What was fixed:** `sim-exchange-ok`/`sim-exchange-error` now count as exchange
evidence; a non-RAR `sim-gateway-deny` marks the gateway step `error` with the
DENY label (RAR codes still feed intent-binding only); the sim branch completes
the trace; evidence-free steps (agent, llm, agent-token, authorize, reply, api)
resolve `notinpath` once the trace completes, matching the existing
gateway/stepup pattern; `ingestTokenEvents` carries session events forward.

**Do not break:** RAR sim denies must keep feeding the intent-binding step, not
the gateway step. `SESSION_EVENT_IDS` carry-over in both `beginTrace` and
`ingestTokenEvents`. Steps must stay "pending" (never "notinpath") while
`outcome` is null.

**Verify:** vitest `src/services/tokenChainTrace/__tests__/` (50 pass; includes
"attack sim (UC5 gateway scope deny)" block) + `ProofOfEnforcementContext` /
`AIAgent.chips` suites (82 pass); `npm run build` exit 0.

### 2026-07-18 — authz hardening round 2/3 + cloud import file (three review passes)

**Files changed (round 2/3, on top of the round-1 split work below):**
`demo_mcp_server/src/auth/{lastHopAuthorization.ts (new),actorChain.ts,TokenIntrospector.ts}`,
`demo_mcp_server/src/server/{HttpMCPTransport,MCPMessageHandler,BankingMCPServer}.ts`;
`demo_mcp_gateway/src/{config.ts,authzPosture.ts,auth/PingOneAuthorizeClient.ts,pingAuthorizeGuard.ts,middleware/authorizeMcpRequest.ts,index.ts}`;
`demo_api_server/{routes/verticalManifest.js,services/{pingOneAuthorizeService,mcpToolAuthorizationService,mcpToolPipeline}.js,scripts/refresh-service-envs.js}`;
`demo_authz_server/routes/{decision,import-snapshot}.js`;
`snapshots/{gen-authorize-snapshot.js,Super_Banking_Transaction_Authorization_P1AZ.snapshot.json}`;
`ping-gateway/scripts/groovy/p1az-decision.groovy`, `docker-compose.yml`, `.gitignore`,
`package.json`, `scripts/test-snapshots.sh (new)`, plus new/updated tests across all five services.

**What was broken (found by two audits of the round-1 fixes, confirmed by a 3rd pass):**
Round 1 shipped several fixes that were inert, tautological, or forgeable.
(1) CRITICAL — the F10 actor allow-list trusted an unsigned base64 JWT decode, so an
`alg:none` token naming a whitelisted actor passed. (2) A session could be established via
`initialize` params, skipping the actor + D-05 check; D-05 ran only on HTTP, not the WS
connect path that is the primary transport. (3) `verticalManifest.js` re-introduced the
audience tautology (`TokenAudience = McpResourceUri = expected`). (4) Degraded PERMITs shipped
with no `policy_source`; the health block and decision path derived real-vs-mock differently
and could disagree. (5) Commit 1e8619d09 widened the *cloud* `IsMcpFirstToolRequest` but left
the mock denying `McpRequest` — opposite verdicts for the same context. (6) The snapshot-drift
and cloud-delta tests were gitignored, so `test:snapshots` ran zero files (exit 0) in CI.

**What was fixed:** actor claims now read only from a signature-verified source
(`TokenIntrospector` `verifiedClaims`/`signatureVerified`), `verifyActorChain` fails closed
by default, and all three session entry points run one shared `authorizeLastHop` (actor +
D-05) — verified by reverting the guard and watching `forged-token-actor-chain.test.ts` go RED.
Provenance on every decision incl. PERMIT via one `usingRealPdpEndpoint` predicate. Mock gained
a lifecycle PERMIT (Rule 2.9) so `McpRequest` agrees with cloud; routing vs applicability context
sets kept separate (a blind copy would be inert). Audience tautology removed on every caller
(omit-not-fabricate). Snapshot tests tracked + `scripts/test-snapshots.sh` fails loudly on an
empty glob.

**Cloud P1AZ import file (`snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json`,
73→98 objects):** `HasValidMcpAudience` rewritten from `TokenAudience == McpResourceUri` string
equality (which post-fix would DENY ALL MCP TRAFFIC) to an OR-of-equals over the two gateway
identities read from `scope-topology.json`; plus six inert-by-default fine-grained deny rules
(D-05, resource-owner, RAR-amount, intent-invalid, intent-mismatch, admin-role-on-write).
`routes/import-snapshot.js` now 409-blocks the broken audience shapes. Temporal and per-tool-scope
are deliberately NOT modelled (not faithfully expressible in the P1AZ DSL) — PEP + mock only.

**Do not break:** actor claims must never again be read from an unverified decode — only from
`verifiedClaims`. Keep the actor + D-05 check on ALL session entry points incl. WS connect and
`initialize`-params. `HasValidMcpAudience` must stay an OR-of-equals derived from SoT, never
attribute-to-attribute equality (the import parity check 409-blocks a regression). Two operator
decisions recorded: `ALLOW_UNSIGNED_TRAT_CONTEXT` stays default `true` (demo evidence flow;
labelled in `/health failOpen`) and the admin-session-on-write-tool DENY stays (mirrors
`requireNotAdmin`). The gateway/authz suites run NON-BLOCKING in CI by default (`SUITE_BLOCKING=0`)
because of pre-existing stale-stub failures — a suite that cannot RUN still fails the gate.

**Verify:** `demo_mcp_gateway` 362 passed; `demo_mcp_server` 886 passed; `demo_authz_server`
181 passed (4 `user_lookup_failed` need live PingOne creds — identical on origin/main);
`snapshots` 20/20 via `npm run test:snapshots`; `node snapshots/gen-authorize-snapshot.js --check`
clean; the regenerated snapshot drives the 409 parity checker to `valid:true`, a foreign-audience
variant to 409. Failing sets byte-identical to their pre-change baselines. **Import step
(manual, live env):** export the current policy first as rollback, then import the regenerated
snapshot — there is no scripted import.

### 2026-07-18 — the decision-split regression protection never ran (test-wiring gap)

**Files changed:** `scripts/test-service-suite.sh` (new),
`scripts/run-all-tests.sh`, `scripts/ci-local.sh`, `.github/workflows/ci.yml`,
`package.json`, `snapshots/gen-authorize-snapshot.js`,
`snapshots/authorizeSnapshotDrift.test.js` (new),
`snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json`,
`demo_api_ui/src/pages/SnapshotImport.jsx`,
`demo_api_ui/src/__tests__/SnapshotImport.test.jsx` (new),
`demo_api_ui/src/pages/SnapshotImport.tsx` (deleted).

**What was broken:** the strongest tests the two entries below added ran nowhere.
`demo_authz_server` was in no runner and no CI job; `demo_mcp_gateway` appeared in
CI only to `npm install` its deps so `topology:verify` could run an unrelated
drift check. ~90 cases (incl. `decision.contract`, `importSnapshot.parity`, five
gateway suites) executed only if a human `cd`'d into the directory. Separately,
commit `1e8619d09` widened `IsMcpFirstToolRequest` in the generator but (a) added
no test and (b) never committed the regenerated snapshot, so `--check` was red on
a clean tree. And the UI page that renders the 409 conflict report had a stale
`.tsx` twin still carrying `if (!res.ok) throw` (drops the report), plus a
hardcoded `http://localhost:9001` (§3 violation, and mixed-content-blocked anyway).

**What was fixed:** `scripts/test-service-suite.sh` runs both services and is
wired into `run-all-tests.sh`, `ci-local.sh` (pre-push), and a new `ci.yml` job.
authz uses `node --test *.test.js tests/*.test.js` — **both** globs, because
`node --test` does not recurse on Node 20 and the second glob is where the UC16 /
tier suites live. gateway uses `CI=true … --maxWorkers=2`. Pre-existing failures
report but do not block (`SUITE_BLOCKING=1` flips that; it is the intended end
state); a suite that cannot **run** always blocks — the counts print every run,
no stale name-allowlist. The generator now guards `main()` behind `require.main`
and exports `reconcile`/constants; the snapshot was regenerated (73 objects, one
changed); `authorizeSnapshotDrift.test.js` asserts the condition lists exactly
`MCP_DECISION_CONTEXTS`, is idempotent, and touches one object. Stale `.tsx`
deleted; `.jsx` reads `REACT_APP_AUTHZ_BASE || ''` (same-origin default); a
vitest suite proves the 409 report renders and the request carries no host.

**Do not break:** authz must keep **both** `node --test` globs — dropping
`tests/*.test.js` silently skips ~68 cases with a green result. The generator's
`if (require.main === module) main()` guard is load-bearing: `decision.mockCloudParity.test.js`
(authz) `require()`s the module, and without the guard the import would re-run
`main()` and rewrite the committed snapshot as a side effect. Keep the suite gate
non-blocking until the documented pre-existing failures are fixed, then set
`SUITE_BLOCKING=1` — do not silence failures by narrowing what the suites check.

**Verify:** `npm run test:authz-server` → "181 passed, 4 failed" and RAN (not
skipped); `npm run test:mcp-gateway` → "passed / failed" with a real Jest summary;
`npm run test:snapshots` → 4/4; `cd demo_api_ui && npm run build` exit 0. The four
new snapshot tests and the four UI tests each fail under a one-line mutation of the
invariant they guard.

### 2026-07-18 — Agent Gateway / P1AZ decision split: the real policy was inert (WS-A/B/C/D)

**Files changed:** `demo_mcp_gateway/src/{config.ts,authzPosture.ts (new),auth/*,middleware/authorizeMcpRequest.ts,pingAuthorizeGuard.ts,server/GatewayServer.ts}`,
`ping-gateway/scripts/groovy/{p1az-decision,olb-token-exchange,uc18-rate-limit,apikey-dispatch,p1az-readiness}.groovy` + 4 route JSONs,
`demo_api_server/services/{pingOneAuthorizeService,mcpToolAuthorizationService,mcpToolPipeline,agentMcpTokenService,configStore}.js` + `routes/{featureFlags,verticalManifest}.js`,
`demo_authz_server/routes/{decision,import-snapshot}.js`,
`demo_api_ui/src/pages/SnapshotImport.jsx`, `docker-compose.yml`.
Analysis: `docs/authorization-decision-split.md`; contract: `planning/authz-fix-contract.md`.

**What was broken:** the demo looked policy-driven while the mock PDP did the
enforcing and the real PingOne Authorize policy decided almost nothing.
(1) Both gateways hardcoded `TokenAudience` **and** `McpResourceUri` to the same
value, making the cloud rule `HasValidMcpAudience` and mock Rule 0c tautologies.
(2) Neither gateway sent `Acr` or `Amount`, so tier/group rules were dead and a
completed MFA could never discharge step-up. (3) `MCP_GW_P1AZ_ENABLED` defaulted
**false**, so the gateway silently substituted its own local scope engine — a
second PDP, unlabelled. (4) The BFF skipped the entire gate for admin sessions
and returned an unmarked `{ran:false}` when `failoverMode='permit'`, so a skipped
gate was indistinguishable from a PERMIT. (5) Exchange failure fell back to the
local tool handler, bypassing gateway and MCP server. (6) The Intent Token and
`X-TraT-Context` were minted and sent but verified nowhere on the **default**
PingGateway path. (7) `X-BFF-Exchanged` let any caller suppress Exchange #3,
ungated, while its sibling headers were secret-gated. (8) Snapshot parity
failures were advisory, so importing a snapshot that drops consent tools silently
un-gated them.

**What was fixed:** `TokenAudience` now carries the token's real `aud` on all
three callers, with mock Rule 0c comparing audience **sets** so the normal flow
still PERMITs and a foreign aud DENYs. Canonical parameter set (contract C1)
across BFF + both gateways, so the two evaluations can no longer disagree.
`MCP_GW_P1AZ_ENABLED` defaults true; the local engine survives only as an opt-in
and every decision carries `policy_source` (C2), with `local-fallback` also
setting `degraded`. Admin bypass deleted — role now flows as a PDP input. Every
skipped gate returns an explicit `skipReason` (C4). Intent Token and TraT are
verified in PingGateway groovy. `X-BFF-Exchanged` is secret-gated. Snapshot
parity returns 409 with the conflict report, and the UI renders it. New
`GET /health` `authz` block lists every active bypass by name (C3).

**Do not break:** `TokenAudience` must never be reset to the expected URI — that
is the tautology this entry removed; `McpResourceUri` resolves to whichever
accepted gateway identity the aud targeted (`PG_GATEWAY_RESOURCE_URI` and the
real aud are different strings for the same gateway, so naive equality DENYs
everything). Mock statements carry **`code` only** — adding an `id` or `type`
makes the shared classifier shadow the code, classify to `null`, and silently
defeat every step-up/HITL gate. `MCP_GW_ALLOW_UNVERIFIED_TOKENS: "true"` in
compose preserves long-standing decode-only behaviour; removing it without
configuring real JWKS makes the gateway refuse every token. Keep the BFF
`McpFirstTool` gate — the Delegated Access page renders it.

**Verify:** `demo_mcp_gateway` 331 passed / `tsc` clean; `demo_authz_server` 163 +
68 (incl. `decision.pinggateway-parity.test.js` 15/15); `demo_api_server`
6165 passed; `demo_api_ui` `npm run build` exit 0. Failing-suite lists are
byte-identical to their pre-change baselines in every service.

**Still open (deliberately unarmed — each needs a value only an operator has):**
`MCP_ALLOWED_ACTORS`, `authorizedActorClientId` (falls back to
`AGENT_OAUTH_CLIENT_ID`), `MCP_GW_ALLOW_UNVERIFIED_TOKENS`, and the cloud policy
delta (widen `IsMcpFirstToolRequest` to `McpToolsList`/`McpRequest`, add the
missing Trust Framework attributes) — deliverable only by snapshot import, since
PingOne Authorize has no policy API for COMPARISON conditions.

### 2026-07-18 — MCP server discarded every authorization fact the gateway proved (WS-E, F10)

**Files changed:** `demo_mcp_server/src/auth/actorChain.ts` (new),
`demo_mcp_server/src/server/HttpMCPTransport.ts`,
`demo_mcp_server/src/server/BankingMCPServer.ts`; deleted
`demo_mcp_server/src/middleware/{mcpTokenValidator,mcpScopeValidator,validateTokenAtGateway}.js`.

**What was broken:** the last hop enforced per-tool scope and nothing else.
(1) F10 — the RFC 8693 `act` delegation chain was verified at the gateway and
then dropped; neither transport inspected it. (2) The D-05 anti-bypass check
(gateway-audience token must not reach the backend directly) ran only under
`MCP_GATEWAY_MODE=true`, a var set in no compose file and no `.env.example` —
so it was off in every deployment. (3) Three Express-shaped security middleware
modules sat in `src/middleware/` imported by nothing; with no Express dependency,
no `req.user` producer, and `allowJs` off in `tsconfig.json` they were never even
compiled — one carried a comment claiming it was "Used by the WebSocket/Express
path". (4) `X-DPoP-Verified` — a header asserting the gateway checked the DPoP
proof — was trusted unauthenticated whenever `GW_MCP_BRIDGE_SECRET` was unset.
(5) TraT context was extracted and logged, binding nothing.

**What was fixed:** `verifyActorChain` (new, pure) checks `act.client_id`/`act.sub`
against `MCP_ALLOWED_ACTORS`, wired into both the HTTP POST path and the
WebSocket connect path (HTTP-only would be bypassable by switching transport —
the LangChain agent connects over `ws://mcp-server:8080`). D-05 now runs
unconditionally; to keep "unconfigured" from becoming "deny everything" its
`!aud` early-return became a no-op when neither audience is configured. The DPoP
bridge secret is now mandatory when `REQUIRE_DPOP_PROOF=true`. TraT `reqctx.tool`
is bound to the `tools/call` tool name (403 on mismatch). Dead middleware deleted.

**Do not break:** both new gates are armed by config and disarmed by default —
`MCP_ALLOWED_ACTORS` unset ⇒ actor check reports `ran:false` + `skipReason`
(contract C4: an unarmed gate must stay distinguishable from a PERMIT, never
silent). Do not make the actor check fail-closed-by-default until the gateway
sends `actor_token` on Exchange #3 (WS-A); until then real tokens carry no `act`
and arming it would deny every call. Keep the HTTP and WS actor checks in sync.
`enforceUpstreamContract` must stay a no-op when no audience is configured —
`MCP_UPSTREAM_RESOURCE_URI`/`MCP_GW_RESOURCE_URI` are unset in compose today.

**Verify:** `cd demo_mcp_server && CI=true NODE_ENV=test npx jest --forceExit`
(53 failed / 881 passed — byte-identical failing-suite list to the pre-change
baseline of 53 failed / 852 passed; the 5 failing suites are pre-existing);
`npx tsc --noEmit` (clean). Targeted: `npx jest tests/authz-last-hop.test.ts
tests/no-dead-security-middleware.test.ts` (29 passed).

### 2026-07-18 — A2A delegation part 2: three more stacked causes behind get_portfolio_summary mcp_error

**Files changed:** `docker-compose.yml` (mcp-gateway `MCP_GW_RESOURCE_URI` tri-list),
`demo_authz_server/routes/introspect.js` (+`introspect.clientcreds.test.js`),
`demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts` (per-tool exchange),
`demo_mcp_gateway/src/server/GatewayServer.ts` (HTTP-ingress invest WS routing),
`demo_mcp_gateway/tests/authorizeMcpRequest-exchange.test.ts` (contract update),
new `demo_api_ui/tests/e2e/a2a-steps-check.real.spec.js`.

**What was broken:** after the #610 routing pin, the A2A specialist call still
failed at three successive hops. (1) The Node gateway's own container env had a
single-value `MCP_GW_RESOURCE_URI` — the tri-list comment lived on
demo-api-server/authz-server but was never wired onto the gateway service, so
the dedicated A2A audience 401'd ("Audience mismatch"). (2) With upstream
(real PingOne) introspection, the authz-server introspected every token with
the default exchanger credentials; RFC 7662 only affirms a client's OWN
tokens, so the specialist-minted A2A token always came back `active:false`
("Token is revoked or no longer active"). (3) The gateway's HTTP ingress
exchanged every tool for the OLB audience and forwarded to mcp-server — which
does not serve invest tools — so `get_portfolio_summary` died with
mcp-server's "Invalid or expired token" (its act-chain validator rejects
depth-2 chains, and the tool doesn't exist there anyway). Invest tools only
routed correctly on the WS ingress.

**What was fixed:** compose now sets the tri-list on the mcp-gateway service
itself (environment: beats the env_file single value); the authz introspect
route selects introspection credentials by the token's `client_id` claim
(matching `*CLIENT_ID`/`*CLIENT_SECRET` env pair, fallback to configured
default); the HTTP-ingress middleware exchanges per tool
(`exchangeClient.exchange(token, toolName)`), and `forwardToUpstream` proxies
invest-routed tools over WS to mcp-resource-server exactly like the WS ingress.

**Do not break:** non-invest HTTP-ingress traffic still exchanges to OLB and
forwards to mcp-server unchanged; default-client tokens still introspect with
the configured credentials; mcp-gateway and authz-server have NO src mounts —
these fixes require an image rebuild to take effect (a `restart` serves the
old code). The offline use-case trigger audit reports UC2/UC2.5 as unmatched
when run cold — that is the un-awaited configStore default (`ff_a2a_delegation`
off), not a routing regression.

**Verify:** `cd demo_mcp_gateway && npx tsc --noEmit && npx jest
tests/authorizeMcpRequest-exchange.test.ts` (3 pass); `cd demo_authz_server &&
node --test introspect.clientcreds.test.js` (3 pass); live:
`npx playwright test tests/e2e/a2a-steps-check.real.spec.js
--config=playwright.real.config.js` from demo_api_ui → reply "Delegation
complete — Investment Advisor retrieved get portfolio summary on your behalf
(act-chain depth 2)".

### 2026-07-18 — A2A delegation (UC2/UC2.5, demo steps 7–8) 401'd on the PingGateway path

**Files changed:** `demo_api_server/services/mcpGatewayClient.js` (A2A-audience
pin in `callToolViaGateway`), new
`demo_api_server/src/__tests__/mcpGatewayClient.a2aPin.test.js`.

**What was broken:** with `ff_mcp_gateway_pinggateway=true`, "hand off to a
specialist" minted the nested-act token audienced to the dedicated A2A gateway
resource (`a2a_gateway_audience` = `mcpgateway-a2a.ping.demo`) — an audience
only the Node Demo Agent Gateway accepts (comma-list `MCP_GW_RESOURCE_URI`) —
then executed the specialist's tool through the flag's chokepoint, which
resolved PingGateway. IG introspects aud against its own resource URI
(`https://api.ping.demo:3036/mcp`) and its McpProtectionFilter requires scope
`gateway:mcp:invoke`, so the call always failed (401 wrong_audience; the A2A
token's `invest:read` would 403 regardless). UC2 rendered "That step couldn't
be completed"; UC2.5 rendered "❌ Delegated to Investment Advisor, but
get_portfolio_summary failed: mcp_error".

**What was fixed:** `callToolViaGateway` now pins a bearer whose `aud` includes
the resolved A2A gateway audience to the Node gateway
(`MCP_DEMO_GATEWAY_URL`/`mcp_demo_gateway_url` — NOT `MCP_GATEWAY_HTTP_URL`,
which is baked per-container and can point at IG, #375). Same Node-only routing
as the dual-token/bankingdata tools and the #603 RAR-sim pin.

**Do not break:** normal-audience tokens must keep routing per
`ff_mcp_gateway_pinggateway`; the pin fires only when the base resolved to
PingGateway AND the token carries the dedicated A2A audience. The 401
aud-mismatch classification and `resolveExpectedMcpResourceUri()` are
untouched. Do not "fix" the aud mismatch by widening PingGateway's accepted
audiences or the BFF resource URI — the fix hint the 401 handler prints is
wrong for this case (the A2A audience is deliberate, not drift).

**Verify:** `npx jest src/__tests__/mcpGatewayClient.a2aPin.test.js
src/__tests__/mcpGatewayClient.reauth.test.js tests/mcpGatewayResolver.test.js
src/__tests__/intentBindingDemo.test.js src/__tests__/a2aDelegationService.test.js
--testPathIgnorePatterns="/node_modules/"` (42 pass). Live: Demo steps 7 (UC2)
and 8 (UC2.5) with the PG flag on — reply is "Delegation complete — Investment
Advisor retrieved…" and the Node gateway logs the PERMIT.

### 2026-07-18 — Step-up OTP mailed to an undeliverable synthetic address; passkey rp.id error told admins to do the impossible

**Files changed:** `demo_api_server/routes/oauthUser.js` (new
`resolveEnrolledContact` + `maskContact`, delivery-target selection in
`POST /initiate-otp`), `demo_api_server/routes/mfa.js` (`GET /devices` phone
masking), `demo_api_server/tests/oauthUser.test.js`,
`demo_api_server/tests/mfaDevices.route.test.js` (new),
`demo_api_ui/src/components/OtpStepUpModal.js` (rp.id error copy only).

**What was broken:** two separate defects behind one symptom ("verify your
identity" step-up not working).

1. `/initiate-otp` took its delivery target from the PingOne user *profile*
   email (`getPingOneUserContact().email`). Provisioning synthesizes that field
   as `demoUser@${demoEmailDomain(publicAppUrl)}` — for local dev,
   `demoUser@api.ping.demo`, a well-formed but undeliverable address. The code
   was really sent there, so step-up only ever completed via the `123123`
   bypass. Meanwhile demoUser had a genuine registered EMAIL MFA device
   (`cmuir@pingidentity.com`) that the one-time-OTP path ignored, because it
   passes an explicit `to` instead of selecting an enrolled device.
2. The passkey rp.id failure told the operator to fix the Relying Party ID in
   PingOne "or restart the API server to auto-configure it". On `api.ping.demo`
   that is impossible: the boot bootstrap does run, but PingOne's Management API
   rejects the value — `CONSTRAINT_VIOLATION target=relyingPartyId "must be a
   valid domain name with a valid TLD"` — so the policies stay pinned to
   `ai-demo.ping-devops.com` and the browser refuses with "'rp.id' cannot be
   used with the current origin". No number of restarts fixes it.
3. Two contact-display defects from the same root confusion about PingOne's
   device shape. `GET /api/auth/mfa/devices` read `d.phone?.number`, but PingOne
   returns a bare E.164 string, so every SMS device came back with
   `maskedContact: null` — and since that route strips the raw `phone` field,
   the modal had no fallback and rendered "your phone". Separately,
   `pingMaskedContact` in `/initiate-otp` returned PingOne's echoed address
   verbatim despite its name, so the full address reached the client.

**What was fixed:** (1) `resolveEnrolledContact(userId, method)` lists ACTIVE
MFA devices and returns the enrolled `email` (or `phone`) for the requested
channel; `to` prefers it and falls back to the profile field only when nothing
is enrolled or the lookup throws. (2) The rp.id message now branches on whether
the host's TLD is one PingOne will accept, and on `.demo`/`.local`/`localhost`/
`.test`/`.invalid`/`.internal`/no-TLD hosts states plainly that the host cannot
be set and to demo passkeys on the public-domain deployment instead. (3) The
`/devices` SMS branch accepts both the bare-string and `{ number }` phone
shapes, and a new `maskContact()` masks the echoed address so `maskedContact`
is always actually masked. `/initiate-otp` no longer returns a raw `email`
field at all — nothing consumed it and it carried the synthetic address.

**Do not break:** PingOne returns an SMS device's number as a bare
string (`"phone": "+19725231586"`), NOT `{ number }` — `resolveEnrolledContact`
and the `/devices` masking both read `phone?.number || phone` and must keep
both shapes. The profile fallback must stay: users with no enrolled device
still need step-up. Do not "simplify" the rp.id branch back to one message —
the two cases have opposite remedies, and the public-domain branch's restart
advice is correct. `GET /devices` must keep stripping the raw `phone`/`email`
off the response; only `maskedContact` goes to the client.

**Verify:** `cd demo_api_ui && npm run build` (exit 0);
`CI=true npx jest oauthUser mfaDevices mfaTest hitlPingOneMfa --testPathIgnorePatterns="/node_modules/"`
(70 passed). Mutation-checked: reverting the enrolled-device preference fails 2
`initiate-otp delivery target` tests, reverting either masking fix fails 1 more
each.

### 2026-07-18 — Per-step explain icon on the Demo Steps dropdown (feature)

**Files changed:** `demo_api_ui/src/components/DemoStepsDropdown.jsx`,
`demo_api_ui/src/components/AIAgent.css` (additive block after
`.ba-demo-steps-popout__title`), `demo_api_ui/src/components/__tests__/DemoStepsDropdown.test.jsx`.

**What was missing:** Demo Steps rows rendered only `uc.id` + `uc.title`, so a
presenter had no way to read what a step actually demonstrates without leaving
the agent for `/use-cases`. The long-form copy already existed — `whatLong`,
`businessValue`, `productRoles` are returned whole by `GET /api/use-cases` and
`DemoStepsDropdown` already held the full `uc` object in state — and
`UseCaseExplainModal` already rendered exactly those fields. Neither was wired
to the dropdown.

**What was added:** each `<li>` becomes `ba-demo-steps-popout__row` (flex) with
a new `ba-demo-steps-popout__explain` button as a **sibling** of the existing
run-step button — not nested, since a `<button>` inside a `<button>` is invalid
HTML and swallows the row click target. The icon is a CSS circle with
`::before { content: 'i' }` (no emoji, per §0). Clicking it sets `explainUc`
and opens the existing `UseCaseExplainModal`; no new fetch, no new field, no
change to `onSelect`. The modal renders OUTSIDE the `{open && ...}` popout block
so it survives the dropdown's outside-pointerdown close.

**Do not break:** the icon must never call `onSelect` — explain and run are
separate targets (covered by the new test's `expect(onSelect).not.toHaveBeenCalled()`).
The explain testid is `demo-explain-<id>`, deliberately NOT `demo-step-explain-<id>`:
the existing order assertion does `getAllByTestId(/^demo-step-/)` and a shared
prefix silently doubles its match count (6 → 12). Keep new row-level testids off
the `demo-step-` prefix. CSS is additive only — `__item`, `__item--done`,
`__check`, `__title` rules are untouched, so completion checkmarks and the done
row tint keep working. Because the item button no longer spans the row, the
done and hover tints are re-applied at row level via
`.ba-demo-steps-popout__row:has(…)` — drop those and the row shows an untinted
seam under the icon. Hover is declared after done so it still wins on a
completed row.

**Verify:** vitest `DemoStepsDropdown` (incl. the new explain-icon case) +
`UseCaseExplainModal` — 12 passed; UI build gate `npm run build` exit 0.
### 2026-07-18 — Demo steps showed raw backend error prose; demo-sync stopped authz-server while the BFF still required it

**Files changed:** `demo_api_ui/src/components/AIAgent.js`
(`NL_FAILURE_MESSAGES` and `NL_FAILURE_FALLBACK`, `reportNlFailure`,
vertical-branch reply render),
`demo_api_server/services/verticalMcpExecution.js` (carry `errorCode`),
`demo_api_server/services/demoAgentLangGraphService.js` (put the code on the
response envelope), `run-docker.sh` (`_read_demo_stack_flags` awaits
`ensureInitialized()`), test in
`demo_api_ui/src/components/__tests__/AIAgent.chips.test.js`.

**What was broken:** (1) Sporting-goods Demo Step 1 ("My gear") rendered
`Could not parse: ❌ Gateway policy denied the tool call`. The tool-failure path
kept only `err.message` and dropped the code (`verticalMcpExecution.js`), so the
response envelope carried no `error`; the UI had no branch for it and echoed the
backend's own prose as a parse failure. The vertical branch separately rendered
`response.reply` verbatim, leaking the same string a second way. (2) The
underlying DENY: `configStore` initialises **asynchronously**, but
`_read_demo_stack_flags` called `getEffective()` in a fresh `node -e` without
awaiting `ensureInitialized()`, so it read env/registry defaults. With
`ff_authorize_simulated` persisted ON, demo-sync read `simulated=0`, stopped
`authz-server`, and PingGateway then failed closed on every tool call
(`[P1AZ] httpPost failed … authz-server` → `DECISION: DENY`).

**What was fixed:** the machine code now survives to the client, and both UI
render paths resolve it through `NL_FAILURE_MESSAGES` to one plain sentence per
failure class, falling back to `NL_FAILURE_FALLBACK` for unknown codes instead
of echoing `err.message`/`response.reply`. `_read_demo_stack_flags` awaits
`ensureInitialized()` so demo-sync sees the value the BFF actually enforces.

**Do not break:** the agent transcript must never render a raw backend error
string — new failure codes get a `NL_FAILURE_MESSAGES` entry, and anything
unmapped must fall through to `NL_FAILURE_FALLBACK`. HITL/step-up codes
(`hitl_required`, `mcp_hitl_required`, `step_up_required`,
`mcp_step_up_required`) are gated responses, not failures, and must keep their
existing approval-prompt text. `needsParams` is likewise `success:false` but its
reply is the useful "I need: Order ID" clarification — it must stay exempt from
the failure-sentence mapping. Any fresh-process `configStore` read must await
`ensureInitialized()` or it silently reports defaults.

**Verify:** vitest `AIAgent.chips` 64 pass (includes the three "agent failure
envelopes render a plain sentence, not the raw error" tests); `npm run build`
exits 0; jest `demoAgentLangGraphService.{modes,tokens,heuristicVerticalTokenGuard}`
9 pass; `bash -n run-docker.sh`. Live proof of the read defect: with
`ff_authorize_simulated` persisted ON, an un-awaited one-shot read reports
`sim=0` while the awaited read reports `sim=1`. Live proof of the message fix:
authz-server down + simulated ON, Demo Step 1 (sporting-goods "my gear") renders
"That step couldn't be completed…" while the gateway logs
`DECISION: DENY | tool=list_gear` and the BFF logs the old raw string.

**Also fixed here:** three stale `AIAgent.chips` tests that selected the Actions
popout via `document.querySelector(".ba-actions-trigger[aria-haspopup='dialog']")`
— `DemoStepsDropdown.jsx` renders the same class/attribute earlier in the header,
so they opened the Demo steps popout instead. They now query by accessible name;
the admin-chips test awaits the async manifest load (`findByText`). Test-only
change; no component behaviour altered.
### 2026-07-18 — Gateway-denied attack sims (UC5/UC11/UC12) always rendered "Incomplete"

**Files changed:** `demo_api_server/config/useCases.js` (UC5/UC11/UC12
`evidence.tokenChain`), `demo_api_ui/src/utils/pingProducts.js` (sim step ids),
`demo_api_server/services/mcpToolAuthorizationService.js`
(`resolveExpectedMcpResourceSetting`), `demo_api_server/services/mcpGatewayClient.js`
(401 aud-mismatch message), `demo_api_server/services/attackSimulatorService.js`
(`simulatedAttack` opt on the two wrong-aud sims).

**What was broken:** UC5/UC11/UC12 declared `evidence.tokenChain:
['user-token','authorize-decision']`, but all three sims are blocked at the
gateway (aud binding / scope check) BEFORE PingOne Authorize is consulted, so
`trace.authorize` is never set. `ingestTokenEvents` also *replaces* the event
array, wiping any earlier `user-token`. `computeVerdict` short-circuits on
`missingSteps.length > 0` before `expectedOutcome` is ever compared, so a
correct 401 DENY still rendered "Incomplete" on every run. Separately, the
401 handler hardcoded `Fix: set MCP_SERVER_RESOURCE_URI=<expectedAud>` — wrong
on the PingGateway path (that audience comes from
`pingone_resource_pinggateway_uri`), so following the advice would have broken
a correct config; and it framed the sims' *deliberate* wrong audience as
configuration drift.

**What was fixed:** the three evidence contracts now declare the events the
sims actually emit (`sim-exchange-ok` / `sim-replay-start` + `sim-gateway-deny`);
those ids were added to the product-badge map (idp + gw — Authorize genuinely
is not involved). The remediation text now names the setting that drives the
audience in the *active* mode, and an attack sim passes `simulatedAttack: true`
so the mismatch is reported as the expected block, not as drift.

**Do not break:** `resolveExpectedMcpResourceUri()` must keep returning exactly
what it returned before (the mode branches were extracted to `_resolveResourceMode()`
with no behavior change); `computeVerdict`'s short-circuit on missing evidence
is unchanged — only the catalog's declared evidence moved. A use case whose sim
DOES reach Authorize (UC10/UC13/UC14/UC16) must keep `authorize-decision`.

**Verify:** `npx jest demo_api_server/src/__tests__/attackSimulator.test.js
demo_api_server/src/__tests__/mcpGatewayClient.reauth.test.js
demo_api_server/tests/use-cases-maturity.test.js
demo_api_server/src/__tests__/attackSimulator.wrongAudFields.test.js
--testPathIgnorePatterns="/node_modules/"` (26 passed); `cd demo_api_ui &&
npx vitest run src/context/__tests__/ProofOfEnforcementContext.test.js
src/utils/pingProducts.test.js` (33 passed); `cd demo_api_ui && npm run build`
(exit 0).

### 2026-07-18 — Demo Steps HITL/step-up gates printed the denial text and never opened the approval modal

**Files changed:** `demo_api_ui/src/components/AIAgent.js` (the NL-resume
replay handler, ~line 6396 — the sibling path called out in the 2026-07-17
entry below).

**What was broken:** Demo Steps (`handleDemoStepSelect`) runs a use case by
setting `nlResumeAfterAuth`, which replays through `sendAgentMessage` directly
and never reaches the `kind:'vertical'` handler at ~5627. Its own gate branch
(a) echoed the raw `error_description` ("PingOne Authorize requires human
approval before MCP tools can run.") as the agent reply, and (b) opened the
consent modal only when `response.transactionAmount != null` — true for
banking `create_transfer/deposit/withdrawal`, never for vertical plugin tools
(`extend_rental`, `pay_bill`, `checkout`, …), which are gated by
`authz: { consent: true }` and carry no amount. Step-up had no modal branch at
all. Net effect on Super Sports: UC8 ("extend my rental $300") and UC7
("extend my rental $600") both blocked correctly server-side, rendered as a
canned refusal plus a "denied as expected" proof badge, and the user was never
prompted to approve.

**What was fixed:** in that branch, gate on the four approval codes
(`hitl_required`/`mcp_hitl_required`/`step_up_required`/`mcp_step_up_required`)
and (a) render the same single "needs your approval — check the approval
prompt" line the vertical handler uses, (b) always open the modal: monetary
responses keep the existing `transactionAmount` intent verbatim, amount-less
ones use the `isVerticalConsent` shape (`verticalMessage` = the replayed text,
`verticalOpts` rebuilt WITHOUT the request's abort signal so the approve-retry
can re-send). A hard DENY (`authorization_denied`) still echoes its reply.

**Do not break:** the monetary branch — banking `create_transfer` consent must
keep sending `{type, fromAccountId, toAccountId, amount, description}` and
`threshold`, since `hitlPendingIntent` drives the transfer retry. The
`verticalOpts` here must not carry `signal`: it is aborted by the time the user
approves. Keep both this handler and the `kind:'vertical'` handler in sync —
they are two entry points to one flow and have now drifted twice.

**Verify:** `cd demo_api_ui && npm run build` (exit 0);
`CI=true npx jest src/__tests__/BankingAgent`. Live: Demo steps → UC8 then UC7
on Super Sports → approval modal opens (UC7 adds the OTP step), and approving
runs the tool.

### 2026-07-17 — #539 amount-from-record dead on session-only `/api/mcp/tool`

**Files changed:** `demo_api_server/services/mcpToolAuthorizationService.js`,
`demo_api_server/src/__tests__/mcpToolAuthorizationService.test.js`.

**What was broken:** `#539` added `resolveAmountForPolicy()` so `pay_bill`
policy uses the bill's `amountDue`, not a figure parsed from the phrase
(e.g. id `402` → Amount `$402`). The call site passed only
`req.user && req.user.id`. `POST /api/mcp/tool` (chip / MCP path) is gated by
`requireSession`, which never sets `req.user`, so `userId` was always falsy →
`resolveAmountForPolicy` always returned null → the gate fell back to the
fabricated phrase amount. Agent `/api/agent/invoke` (authenticateToken) was
fine; the primary chip path was not.

**What was fixed:** Resolve `policyUserId` as
`req.user.id || userSub || session.oauthId || session.id` before calling
`resolveAmountForPolicy`. Added regression tests for session-only and
userSub-only reqs asserting Amount=`amountDue` (25), not 402.

**Do not break:** `admin_role_exempt`, HITL receipt verification, aud/scope
checks, fail-closed behaviour when authorize is unconfigured, or the soft
null fallback when no record id is present.

**Verify:** `npx jest src/__tests__/mcpToolAuthorizationService.test.js
tests/mcpToolAuthorization.amountFromRecord.test.js
--testPathIgnorePatterns="/node_modules/"`.

### 2026-07-17 — HITL-blocked vertical actions echoed the raw error text twice instead of a clear pending-approval notice

**Files changed:** `demo_api_ui/src/components/AIAgent.js` (`kind:'vertical'`
chip-dispatch handler, ~line 5634).

**What was broken:** clicking a consent-gated chip (e.g. "Extend my rental"
on Super Sports, `authz: { consent: true }` in
`config/verticals/sporting-goods/tools.js`) correctly got blocked
server-side (`mcpToolAuthorizationService.js` returns 428
`mcp_hitl_required` — genuine PingOne Authorize gate, tool correctly did not
run) but the UI rendered the raw `response.reply` (which already contains
PingOne Authorize's `error_description`, "requires human approval before MCP
tools can run") as a plain heuristic-labeled chat bubble, then separately
triggered the approval modal via `setHitlPendingIntent`. Result: confusing
duplicated/canned-looking text alongside (or instead of, if the modal wasn't
noticed) the actual approval prompt.

**What was fixed:** when `response.error` is one of
`hitl_required`/`mcp_hitl_required`/`step_up_required`/`mcp_step_up_required`,
render a single clear line ("This action needs your approval before it can
run — check the approval prompt.") instead of echoing the raw reply text. The
`setHitlPendingIntent` modal trigger below is untouched — this only changes
what's shown in chat, not the consent flow itself.

**Do not break:** the `setHitlPendingIntent` call in this handler (unlike a
similar handler at ~line 6300+ used for the OAuth-resume replay path) does
NOT gate on `response.transactionAmount != null` — keep it unconditional for
this path, since vertical actions like `extend_rental` aren't monetary
transfers and have no `transactionAmount`.

**Verify:** `cd demo_api_ui && npm run build` (exit 0). Live: click a
consent-gated vertical chip (e.g. "Extend my rental") → one clear
pending-approval message, approval modal opens, no raw duplicated error text.

### 2026-07-17 — Chip clicks ignored the "LLM only" Routing toggle in every vertical

**Files changed:** `demo_api_ui/src/components/AIAgent.js` (suggestion-chip
click handler, ~line 7623).

**What was broken:** clicking a suggestion chip (e.g. "My gear" on Super
Sports) always answered `source=heuristic` even with Agent mode=llama.cpp and
Routing="LLM only" selected. Root cause: the chip-click fetch to
`/api/demo-agent/nl` decided `provider` from `(requiresLlm ||
agentProviderMode === "helix_google") ? (activeLlmProvider || "heuristic") :
"heuristic"` — `requiresLlm` comes from the chip's static `chip.mode ===
'llm'` flag (`BankingChips.jsx`), not from the Routing dropdown
(`heuristicEnabled` state). Chips backed by a heuristic regex action (e.g.
`list_gear` in `config/verticals/sporting-goods/index.js`) are never flagged
`mode:'llm'`, so they always sent `provider:"heuristic"` regardless of
Routing. This is one shared component, so the same behavior affected every
vertical's fast-path chips uniformly — not vertical-specific config.

**What was fixed:** added `!heuristicEnabled` to the condition, so
Routing="LLM only" now forces every chip through the active provider, matching
what the dropdown label says. Routing="Fallback (Heuristics)" (default)
behavior is unchanged — fast-path chips still answer heuristically for speed.

**Do not break:** the direct-MCP-path chip handler (a separate call site,
`AIAgent.js` ~line 7439, `direct: true` chips) intentionally always sends
`provider:"heuristic"` unconditionally by design (it only resolves a tool name
via regex, never calls an LLM) — do not fold that branch into this one.
`agentModes.js` / `agentModeResolver.js` SSOT provider tables are unrelated
and untouched.

**Verify:** `cd demo_api_ui && npm run build` (exit 0). Live: Routing="LLM
only" + Agent mode=llama.cpp, click any fast-path chip (e.g. "My gear" on
Super Sports) → response now sources from the LLM, not heuristic.

### 2026-07-17 — LLM-only routing fell back to heuristics on every chip phrase

**Files changed:** `demo_api_server/services/geminiNlIntent.js`,
`demo_api_server/tests/geminiNlIntent.llmOnly.test.js` (new).

**What was broken:** in LLM-only mode (routing toggle = "LLM only", i.e.
`ff_heuristic_enabled=false`) every dashboard chip phrase still answered as
"Heuristic". The llama.cpp intent-router grammar (`INTENT_JSON_SCHEMA`) only
required `{ kind: <string> }`. Under grammar-constrained decoding gpt-oss-20b
satisfied that by emitting `{"kind":"banking"}` — with no `banking.action` —
and stopping (confirmed by replaying the real router prompt: it returned
`{"kind":"banking"}` and, on the balance query, malformed `{"kind":"banking,"}`).
`validateIntent` correctly rejected the incomplete shapes, so the JSON router
"missed" (twice, including after the JSON-only retry nudge) and the
deterministic heuristic chip floor answered. The LLM *did* run
(`llm_attempted:true`) and the rendered answer was correct, but LLM-only mode
was structurally unable to route action phrases.

**What was fixed:** replaced the flat schema with `buildIntentSchema(activeVertical)`,
which forces the COMPLETE per-vertical shape via anyOf — banking verticals must
emit `banking.action`, other verticals must emit `vertical`+`action` — while
still allowing `education` and `none` so open questions fall through to the
conversational path (kind:none → validateIntent null → conversational) instead
of being forced to fabricate an action. Replayed against the live model: all
three banking phrases now route `source=llamacpp` with the correct action;
"weather" still yields kind:none. validateIntent remains the strict post-parse
check.

**Do not break:** `buildIntentSchema` must keep `none` in the anyOf (else the
grammar forces a fabricated action on genuine free text). Only the llama.cpp
branch passes the schema; mlx passes none (unchanged). The llamacppLlmService
proxy drops the schema on an HTTP 400, so the schema must stay within llama.cpp
grammar support (the anyOf form is accepted — verified live, no 400).

**Verify:** `cd demo_api_server && npx jest tests/geminiNlIntent.llmOnly.test.js`
(5 pass: schema-shape guards + LLM-only routes through llama.cpp, not the
floor). Live: set ff_heuristic_enabled=false, POST /api/demo-agent/nl
{message:"show my accounts", provider:"llamacpp"} → source=llamacpp,
action=accounts. Test note: the shared setup.js runs jest.resetModules() in
afterEach, so the test re-requires the module-under-test + its mock together
per test (loadFresh) to keep the lazy-require mock identity aligned.

### 2026-07-17 — Agent write tools 401 at the BFF + evidence-spec echo race (bk4/bk7 red)

**Files changed:** `demo_api_server/middleware/auth.js`,
`demo_api_server/tests/verticalToolAudience.regression.test.js` (PR #566);
`demo_api_server/services/simulatedAuthorizeService.js`,
`demo_api_server/tests/simulatedConsentTypes.test.js` (PR #567);
`demo_api_ui/tests/e2e/evidence-screenshots.real.spec.js` (this PR).
Live-env only (no commit): ping-gateway container recreate (stale single-file
bind mount of `mcp-tool-schemas.json` — macOS VirtioFS loses the mount when
the host file is replaced, PingGateway then 500s every `/mcp` POST),
`API_RESOURCE_SERVER_API_KEY` re-mint + vault sync, and
`SIMULATED_AUTHORIZE_CONSENT_TYPES=` (explicit empty) in `demo_api_server/.env`.

**What was broken:** three stacked faults surfaced once the PingGateway `/mcp`
route was restored. (1) The July-16 audience hardening allowlisted only READ
MCP-server→BFF callbacks (`/my`, `/:id`, `/balance`, `/vertical-tool`,
`/identity`) for gateway-audience tokens; the same `BankingAPIClient` POSTs
`/api/transactions` and the account write callbacks, so every agent-initiated
write 401'd (`aud mcpgateway.ping.demo != enduser.ping.demo`) and the chat
turn hung on a spinner. (2) The simulated-authorize consent-types getter's
`||` fallback made an explicitly-empty `SIMULATED_AUTHORIZE_CONSENT_TYPES`
fall through to the `'transfer'` default — type-based consent could never be
turned off, so a $100 transfer 428'd despite the amount tiers starting at the
confirm threshold. (3) The evidence spec's render poll counted the echoed
prompt + "You" chrome as a reply, passed ~1.6s after Enter, waited 500ms, and
asserted assistant text — losing the race against the restored PingGateway
pipeline's ~3s round-trip, so bk4 failed "assistant reply is EMPTY" while the
reply landed a second later.

**What was fixed:** write callbacks matched on `method` + `req.baseUrl`
(router-relative path is `/`) so exactly `POST /api/transactions`,
`POST /api/accounts/:id/fee-waiver-request`, and
`PATCH /api/accounts/:id/contact-email` accept gateway-audience tokens;
nullish fallbacks in `getConsentTypes()` so explicit empty means "no
type-based consent" (unset default unchanged); the spec's poll now strips the
echo/chrome exactly like its EMPTY assert and only resolves on real assistant
text.

**Do not break:** every non-callback route still rejects gateway-audience
tokens (locked by 18 checks in `verticalToolAudience.regression.test.js`);
Authorize decision, HITL 428, scope and role enforcement on the widened
routes run downstream of the audience check and were untouched; the spec's
EMPTY/error-card asserts remain the hard gate after the poll.

**Verify:** `cd demo_api_server && npx jest tests/verticalToolAudience.regression.test.js tests/simulatedConsentTypes.test.js`
(16 pass); full evidence suite green both modes:
`E2E_EVIDENCE_MODES="heuristics" npx playwright test tests/e2e/evidence-screenshots.real.spec.js --config=playwright.real.config.js`
(13 passed) and the same with `llamacpp` (13 passed).

### 2026-07-16 — Settings consolidation: step-up threshold dual-store gap + ThresholdControls duplicate writers

**Files changed:** `demo_api_server/services/configStore.js`, `demo_api_server/routes/admin.js`,
`demo_api_server/src/__tests__/configStore-stepUpThresholdSave.test.js`,
`demo_api_server/src/__tests__/adminSettings.stepUpThresholdBridge.test.js`,
`demo_api_server/src/__tests__/transactionConsentChallenge.test.js`,
`demo_api_ui/src/config/setupDefaults.js`,
`demo_api_ui/src/components/SetupPage.js`, `SetupWizard.js`, `SetupWizardTab.js`,
`demo_api_ui/src/components/ThresholdControls.js`, `ThresholdControls.css`,
`demo_api_ui/src/components/__tests__/ThresholdControls.test.js`.

**What was broken:** (1) `confirm_stepup_threshold_usd` — read by
`transactionConsentChallenge.js`'s `device_picker` HITL MFA gate — was never
registered in `configStore`'s `FIELD_DEFS`, so `setConfig()` silently dropped
it; no UI could ever actually change that gate's real threshold, which always
fell back to a hardcoded `500`. (2) `ThresholdControls.js`'s global-threshold
and feature-flag sections duplicated write paths that already exist at
`/settings` and `/feature-flags` respectively, with no indication which was
authoritative. (3) `stepUpAcrValue`'s setup-wizard default was hardcoded
independently in 6 places across 3 files.

**What was fixed:** registered the missing `FIELD_DEFS` key; extended
`routes/admin.js`'s existing `maxTransactionAmount` dual-store-bridge pattern
to also mirror `stepUpAmountThreshold` into `configStore` (closing the
`device_picker` gap); `ThresholdControls.js`'s global-thresholds and
feature-flags sections are now read-only with links to their real editors;
its per-vertical thresholds section (which has no duplicate anywhere else)
is untouched; consolidated the 6 hardcoded ACR-value literals onto one
`demo_api_ui/src/config/setupDefaults.js` constant. Also removed a stale §1
row ("Demo Controls diagnose") that referenced code no longer present in
`ThresholdControls.js`.

**Do not break:** the per-vertical threshold section in `ThresholdControls.js`
must stay fully editable — it's not a duplicate of anything. HITL enforcement
*logic* (amount comparisons, `mfaMode` branch selection, 428 handling) was
not touched, only a previously-dead config key's write path.

**Verify:** `cd demo_api_server && npx jest src/__tests__/configStore-stepUpThresholdSave.test.js src/__tests__/adminSettings.stepUpThresholdBridge.test.js src/__tests__/transactionConsentChallenge.test.js --testPathIgnorePatterns="/node_modules/"`;
`cd demo_api_ui && npx vitest run src/config/__tests__/setupDefaults.test.js src/config/__tests__/setupDefaults.usage.test.js src/components/__tests__/ThresholdControls.test.js && npm run build`.
### 2026-07-16 — Silent-reauth infinite redirect loop (`?silent_reauth_failed=1` refreshing forever)

**Files changed:** `demo_api_ui/src/components/StaleSessionBanner.jsx`,
`demo_api_ui/src/components/StaleSessionBanner.test.jsx` (new).

**What was broken:** Commit `af059d9e7` (same day, "fix: 10 real bugs...")
fixed bug #35 (`StaleSessionBanner`'s `silentFailed` URL check) and bug #39
(`useOAuthUrlCleanup` stripping the `?silent_reauth_failed=1` param) in the
same patch, but the two interact: `useOAuthUrlCleanup`'s effect strips the
param from the URL *synchronously* on mount, while `StaleSessionBanner` only
read the param *after* an `await getCachedJson(...)` — by which point the
param was already gone, so its `silentFailed` guard was always `false`.
Separately, `StaleSessionBanner`'s sessionStorage-guard-clear effect
(`if (!stale) sessionStorage.removeItem(...)`) fired on the component's very
first mount too, because `stale` initializes to `null` — wiping the
sessionStorage guard on the exact page load meant to be protected by it. With
both loop guards defeated at once, the banner immediately re-redirected to
`/api/auth/oauth/user/silent-reauth`, PingOne failed again (no SSO session),
and the browser looped on `?silent_reauth_failed=1` forever. The server-side
half of the flow (`demo_api_server/routes/oauthUser.js`) was already correct
and single-shot; the loop was entirely client-side.

**What was fixed:** `StaleSessionBanner` now captures `silent_reauth_failed`
from `window.location.search` in a `useRef` lazy initializer — evaluated
during the component's initial render, strictly before any effect (including
`useOAuthUrlCleanup`'s) runs, so the read can no longer race the URL cleanup
regardless of effect mount order. The sessionStorage-guard-clear effect now
skips its first invocation (tracked via a ref) so it only fires on a genuine
stale→valid transition, not on the initial `null` mount.

**Do not break:** the two loop guards (`silentAttemptedRef` in-memory,
`SILENT_ATTEMPTED_KEY` in `sessionStorage`) still exist and must both survive
a page landing on `?silent_reauth_failed=1` without being cleared before the
async status check reads them. `useOAuthUrlCleanup`'s param-stripping effect
was left untouched — stripping the param from the visible URL is correct
UX; the bug was only in `StaleSessionBanner` reading it too late.

**Verify:** `cd demo_api_ui && npx vitest run src/components/StaleSessionBanner.test.jsx`
(2 pass — one reproduces the loop against the pre-fix code by mounting
`StaleSessionBanner` under `useOAuthUrlCleanup()` the way `App.js` really
does); `npm run build` (exit 0).

### 2026-07-16 — 7/16 punch-list batch 2 (graphify framing, may_act terminology sweep, debug log detail)

**Files changed:** `demo_api_ui/src/components/GraphifyPage.jsx`,
`demo_api_ui/src/components/GraphifyPage.css`,
`demo_api_ui/src/components/DelegationPage.js`,
`demo_api_server/utils/logger.js`, `demo_api_server/routes/logs.js`.

**What was broken / requested:**

1. `/graphify` — user reported "I do not see how to actually run this?" The
   page already stated (in small body text under "Try it") that it's a
   canned-snapshot showcase with no live backend, but nothing above the fold
   said so — easy to miss.
2. `/delegation` — 4 leftover `may_act` mentions in user-facing copy
   (`OIDC Core` chip label, validation-mode status line, a demo talk-track
   step, one code comment) hadn't been swept to the "act claim" terminology
   already used everywhere else in the education surfaces.
3. `/logs?mode=learn` (Debug tab) — the "Details" column was always empty.
   `logger.js`'s `log()` method stringified the entire structured entry
   (including `metadata`) into ONE colored string and passed it as the sole
   `console.log` argument; `routes/logs.js`'s `captureLog()` never populated
   `detail` at all, and had no clean object to derive it from even if it had.

**What was fixed:**

1. Added a high-contrast info banner (matching the existing
   `.mfa-test-info-banner` convention in `MFATestPage.css`) right after the
   page thesis, before the stats: explicitly states this is a showcase with
   no "Run" button and no backend call, and points at "Try it" below.
   Tightened the "Try it" section's copy to spell out copy → paste in a
   terminal → run. No backend/live-execution work — this was explicitly
   scoped to framing only, not a live runner (three options were on the
   table; smallest was chosen).
2. Swept the 4 remaining `may_act` UI-copy mentions in `DelegationPage.js` to
   "act claim" language, consistent with `ActorTokenEducation.tsx`'s already
   -completed sweep. Left the backend `may_act` *mechanism* itself untouched
   (it's real, load-bearing PingOne attribute logic, not deprecated — see the
   `may_act` grep summary in the 2026-07-16 entry above this one).
3. `logger.js`'s `log()` now passes the structured `entry` object as a
   second, separate `console.log` argument instead of folding it into one
   stringified/colored message. `routes/logs.js`'s `captureLog()` now picks
   the first object-type arg (if any) as `detail` (pretty-printed JSON) and
   keeps `message` as the joined string args only — so `logger.info()`/
   `.warn()`/`.error()` calls made through `utils/logger.js` now show real
   structured detail in the Debug tab instead of "—".

**Do not break:** `captureLog()`'s `detail` derivation only looks at
console-captured args, not `appEventService`'s data (Activity Log stays a
separate, intentionally-not-merged data source — see the settings/logs
cluster note in the 2026-07-16 punch-list report). Plain `console.log('a
string')` calls elsewhere in the app (the vast majority, unrelated to this
logger) are unaffected — `detail` stays `undefined` for them, same as before.

**Verify:** `cd demo_api_ui && npm run build` (exit 0); `cd demo_api_server &&
npx jest src/__tests__/logs.test.js tests/agentRestrictionsGate.test.js
src/__tests__/agent-module-smoke.test.js --testPathIgnorePatterns="/node_modules/"`
(53 pass, 0 fail).

### 2026-07-16 — 7/16 punch-list batch (onboarding close button, code-search error text, banking token-chain jump)

**Files changed:** `demo_api_ui/src/components/AgentOnboardingFlowDiagram.jsx`,
`demo_api_ui/src/components/CodeSearchAsk.jsx`,
`demo_api_ui/src/components/verticalOps/VerticalOpsConsole.jsx`,
`demo_api_ui/src/components/verticalOps/VerticalOpsConsole.css`.

**What was broken:**

1. Agent Onboarding Flow's `FloatingPanel` (`/agent-onboarding-flow`) never passed
   an `onClose`, so the panel's close (`✕`) button never rendered — every other
   `FloatingPanel` consumer in the app passes one.
2. `/code-search`'s Ask tab (`CodeSearchAsk.jsx`) called `await r.json()`
   unconditionally with no error guard; a non-JSON error response (e.g. an
   nginx 502 HTML page when an upstream RAG service is down) threw a raw
   `SyntaxError` that surfaced verbatim in the chat bubble
   (`"Unexpected token '<' ... is not valid JSON"`).
3. `/admin/banking` (and every other vertical ops console — healthcare, retail,
   sporting-goods, workforce, all sharing `VerticalOpsConsole.jsx`) had no way
   to jump to the collapsed "Token Chain — MCP Route" section at the bottom of
   a potentially long record list.

**What was fixed:**

1. Added `onClose={() => window.history.back()}` to the onboarding page's
   `FloatingPanel`, matching the existing `DevToolsRoute` convention for
   standalone (non-toggle) `FloatingPanel` pages.
2. `CodeSearchAsk.jsx` now parses the response body with `.catch(() => ({}))`
   (same defensive pattern already used in `services/codeSearchAPI.js`'s
   `throwIfNotOk`) and falls back to `` `assistant unavailable (status ${r.status})` ``
   instead of throwing the raw parse error.
3. Added a "Jump to token chain ↓" button in `VerticalOpsConsole`'s header that
   opens the `<details>` token-chain section and smooth-scrolls it into view
   (`traceRef`, `jumpToTrace`).

**Do not break:** `FloatingPanel`'s `onClose` button only renders when a
consumer passes `onClose` — don't remove it from onboarding without deciding
what "close" should do first. `CodeSearchAsk.jsx`'s fallback message shape
(`message`/`error`/`detail` chain) must stay compatible with both the BFF/MCP
error shape (`message`/`error`) and the FastAPI llamaindex-agent shape
(`detail`, possibly an array of `{msg}`). `VerticalOpsConsole` is shared by
five verticals — `traceRef`/`jumpToTrace` must stay generic (no vertical-specific
logic).

**Verify:** `cd demo_api_ui && npm run build` (exit 0, confirmed). No automated
test coverage added — manual click-through recommended for the jump button and
close button; the code-search fix needs a live 502/down-upstream scenario to
fully confirm the friendlier message renders.

**Investigated further, live against `ai-demo.ping-devops.com`, after this
commit (see the two entries immediately below for what was found/fixed):**
`/check` reporting services down and `/admin/verticals` "completely broken."
Both earlier static theories in this entry were wrong; live reproduction found
the real causes.

### 2026-07-16 — `/admin/verticals` manifest editor invisible (Monaco container collapsed to 5px)

**Files changed:** `demo_api_ui/src/vertical/AdminEditor/VerticalEditorPage.css`
(new), `demo_api_ui/src/vertical/AdminEditor/VerticalEditorPage.jsx` (added the
CSS import).

**What was broken:** live repro (signed in as `demoAdmin` against
`ai-demo.ping-devops.com/admin/verticals`) showed the page chrome (Active
selector, Clone/Delete/Reset/Save-state buttons, tabs) rendering correctly,
but the manifest editor area was blank white space. `page.evaluate` against
the live DOM confirmed Monaco had genuinely mounted with the real manifest
(`data-mode-id="json"`, a populated model) — this was never a data-loading or
`pageManifest`/`agentManifest` wiring bug (an earlier theory in this file,
above, guessed the latter and was wrong). `VerticalEditorPage.jsx` had **no
CSS file at all** — `.vertical-editor__body`/`.vertical-editor__main` had no
explicit height, so Monaco's default `height: '100%'` resolved against an
`auto`-height ancestor chain and collapsed to a measured 5px tall, rendering
the fully-loaded editor invisible.

**What was fixed:** added `VerticalEditorPage.css` giving `.vertical-editor__body`
an explicit `height: calc(100vh - 180px)` (matching the height already used
for this page's Pipeline Map tab), `.vertical-editor__main` a flex column with
`min-height: 0`, and `.vertical-editor__main > div:first-child` (Monaco's own
wrapper, which has no class of its own) `flex: 1; min-height: 0` so its
`height: 100%` now resolves against a real pixel height instead of collapsing.

**Do not break:** `.vertical-editor__main > div:first-child` is a fragile
selector — it assumes Monaco is the first child of `.vertical-editor__main`
(true today; the JSX renders `<Monaco />` then `<div className="vertical-editor__actions">`
below it). If Monaco's position in that JSX changes, this selector must move
with it.

**Verify:** `cd demo_api_ui && npm run build` (exit 0, confirmed). Not yet
re-verified live against the deployed site (this fix hasn't shipped yet) —
next deploy should confirm the manifest editor is visible and scrollable at
`/admin/verticals`.

### 2026-07-16 — `/check` reports "Banking UI" down while it's serving the browser running the check (live finding, not yet fixed)

**Not fixed — root cause needs cluster access I don't have from this session.**
Live run of `/check` against `ai-demo.ping-devops.com` (signed in as
`demoAdmin`) returned, verbatim, for the `servers.all_up` check:
`{"key":"ui","name":"Banking UI","up":false,"error":"ECONNREFUSED"}` — reported
down at the exact moment the browser was using that same Banking UI to run the
check. This is the punch-list #22 complaint, confirmed reproducible, and it is
specifically about `ui` (and to a lesser extent `mcp-proxy`, also
`ECONNREFUSED`) — most of the rest of that run's "Down" list (LangChain/OpenAI/
Mastra/Pydantic agent variants, Mock Authz Server, llama-tier-1/6) are
plausibly genuine absences in this environment's lean-core deploy profile, not
false positives (`authorize.mode` passed with "Real PingOne Authorize",
consistent with Mock Authz Server intentionally not being deployed; `llm.status`
correctly showed only 1/3 tiers healthy).

**Two earlier theories in this file (above) were checked and ruled out:**
TLS verification is not the cause (`NODE_ENV=development` override in
`k8s/20-api-server-deployment.yaml` already relaxes it), and it's not an
HTTP-vs-HTTPS scheme mismatch either — `k8s/02-configmap.yaml` confirms nginx
inside the `frontend` container does `listen 3000 ssl;`, matching the probe's
`https://frontend:4000` candidate (Service port 4000 → container port 3000)
in `demo_api_server/data/serverInventory.js`. `ECONNREFUSED` means the TCP
connection was actively refused, not timed out or TLS-rejected — from within
this coding session I can't distinguish between "frontend pod not Ready by
k8s's accounting despite serving external traffic," "a NetworkPolicy blocking
api-server→frontend pod-to-pod traffic while allowing ingress traffic through
a different path," or another cluster-networking cause. That needs `kubectl`
access (checking Service endpoints, NetworkPolicies, pod readiness) that this
session doesn't have.

**Do not break:** nothing changed here — this is a diagnosis-only entry so the
next pass (with cluster access) doesn't re-derive the same evidence from
scratch, and doesn't re-chase the TLS/scheme theories already ruled out above.

**Verify (for whoever picks this up next):** `kubectl -n ai-demo get endpoints
frontend`, `kubectl -n ai-demo get networkpolicy`, and `kubectl -n ai-demo exec
deploy/api-server -- curl -vk https://frontend:4000/` to see the actual refusal
point.
### 2026-07-16 — MFA step-up `return_to` open redirect (CWE-601)

**Files changed:** `demo_api_server/routes/oauthUser.js`,
`demo_api_server/tests/oauthUser.test.js`.

**What was broken:** `GET /api/auth/oauth/user/stepup?return_to=` stored the
raw query value in `req.session.stepUpReturnTo`. After PingOne MFA, the OAuth
callback did `res.redirect(stepUpReturnTo)` with no same-origin check — an
attacker link like `…/stepup?return_to=https://evil.example/phish` sent the
victim to the attacker site after authenticating.

**What was fixed:** `sanitizeStepUpReturnTo` accepts only relative SPA paths
or absolute URLs whose origin matches `getFrontendOrigin()`; otherwise falls
back to `${origin}/dashboard`. Appends `stepup=done` with `?`/`&` correctly.

**Do not break:** UserDashboard / UserDashboardPing2026 step-up links that pass
`${CLIENT_URL}/dashboard` must keep working. Normal login still uses
`sanitizePostLoginReturnPath` (path-only, unchanged).

**Verify:** `cd demo_api_server && npx jest tests/oauthUser.test.js --forceExit`.

### 2026-07-15 — Code Explorer browser "network error" (nginx SSE buffering)

**Files changed:** `demo_api_ui/nginx.conf`, `k8s/02-configmap.yaml` (nginx-config),
`k8s/aws/nginx-http-configmap.yaml`, `k8s/aws/se-ingress.yaml`,
`demo_api_server/routes/codegraphProxy.js`, `langchain_agent/src/codegraph/agent.py`
(retrieve keepalives), `demo_api_ui/src/services/bankingRestartNotificationService.js`,
`demo_api_ui/src/services/apiTrafficStore.js`, `scripts/check-codegraph-sse-nginx.js`,
`k8s/smoke.sh` check 7, `package.json` `hygiene:check`.

**What was broken:** frontend nginx buffered `/api/codegraph` until the LLM
finished (~60–70s). Browsers then reported a network/timeout error. A global
fetch restart-wrapper also treated AbortError as "server restarting".

**What was fixed:** dedicated `/api/codegraph/` location with `proxy_buffering off`
+ 300s timeouts on all nginx surfaces; ingress annotations; BFF flushes SSE
headers; agent emits `: keepalive` SSE comments every 10s while waiting on the
LLM; fetch wrapper no longer invents a 5s abort and ignores streaming API
aborts; traffic store skips cloning SSE bodies.

**Do not break:** the three nginx surfaces must stay in sync (CI:
`node scripts/check-codegraph-sse-nginx.js`). Smoke check 7 asserts SSE TTFB
< 5s with a status frame. Retrieve-then-answer remains the default for
non-tool-capable LLMs.

**Verify:** `npm run hygiene:check`; `cd langchain_agent && bash scripts/run-pytest.sh tests/test_codegraph_agent.py -q`;
live: `SE_NAMESPACE=ping-devops-<you> ./k8s/smoke.sh` check 7 PASS.

### 2026-07-14 — Another user's vertical switch yanked your screen mid-demo

**Files changed:**
- `demo_api_server/routes/verticalManifest.js` — `GET /me` pins the resolved
  vertical onto the session (`req.session.active_vertical`) on first hydration,
  if the session has no preference yet.

**What was broken:** the READ path was session-scoped, but only for sessions that
had explicitly switched. `setActive()` writes the process-GLOBAL active vertical
and SSE-broadcasts `vertical-switched` to every connected client; each client then
refetches `/me`. A session that never pinned a vertical fell back to that global on
every read — so when any other user (shared AWS demo) switched verticals, unpinned
sessions followed them to Great Buy / CareConnect / etc. mid-demo.

**What was fixed:** first `/me` pins the vertical to the session, making the global
a first-load DEFAULT rather than a live channel between sessions. Fresh sessions
still inherit the global (admin's demo default still governs new loads); already-open
sessions can no longer be moved by anyone else.

**Do not break:** the pin must not overwrite an existing `req.session.active_vertical`
(an explicit user switch wins), must tolerate a missing `req.session`, and stays
fire-and-forget on save (a failed save just re-pins next `/me` — never 500 a read).
A forced global re-theme (e.g. Reset Demo) must explicitly CLEAR the session pin;
it can no longer rely on the global-fallback side effect.

**Verify:** `cd demo_api_server && npx jest tests/verticalSessionPin.route.test.js
--testPathIgnorePatterns="/node_modules/"` (5 pass, incl. "another session switching
the global does NOT move a pinned session"); full vertical surface
`npx jest tests/vertical tests/verticals --testPathIgnorePatterns="/node_modules/"`
(17 suites, 204 pass).

### 2026-07-14 — Duplicate side nav on every AppShell route (two sidebars stacked)

**Files changed:**
- `demo_api_ui/src/routes/sideNavOwner.js` (new) — single source of truth for which
  layer renders `<AdminSideNav>`: `appRendersSideNav()` (App.js owns it) and its
  complement `shellRendersSideNav()` (AppShell fills the gap).
- `demo_api_ui/src/routes/AppShell.js` — renders `<AdminSideNav>` only when App.js
  does not.
- `demo_api_ui/src/App.js` — side-nav condition now calls `appRendersSideNav()`;
  the orphaned `isHomePage` local is gone (`isApiTrafficOnlyPage` still drives the
  other chrome opt-outs and is unchanged).

**What was broken:** App.js rendered a global `<AdminSideNav>` for signed-in users
(`user && !isApiTrafficOnlyPage && !isHomePage`) AND `AppShell` rendered its own
unconditionally. Every AppShell-wrapped route (`/use-cases`, `/oauth-academy`,
`/code-search`, `/mcp-inspector`, …) therefore painted two identical sidebars on
top of each other — the second one intercepted pointer events, so nav clicks landed
on the wrong tree.

**Do not break:** the no-chrome routes (`/api-traffic`, `/logs`) DO use AppShell
while App.js suppresses its global nav for them — AppShell must keep supplying
their sidebar. Same for any AppShell route viewed logged-out. Exactly one layer
renders the side nav for any (route, user); never delete AppShell's copy outright.
`AdminSideNav.jsx` itself is untouched (its expansion-state-by-key invariant stands).

**Verify:** `cd demo_api_ui && npx vitest run src/routes/__tests__/sideNavOwner.test.js`
(12 pass — pins "never both" across signed-in, logged-out, and no-chrome routes),
plus `npx vitest run src/__tests__/App.structure.test.js src/__tests__/uiRegression.test.js
src/components/__tests__/adminSideNav.test.jsx` (82 pass) and `npm run build` exit 0.

### 2026-07-12 — Chat-driven transfer used wrong tool name, bypassing amount-aware HITL step-up

**Files changed:** `demo_api_server/config/verticals/banking/index.js`,
`demo_api_server/services/verticalDispatch.js`.

**What was broken:** `getToolsWithActionAliases()` returns both the real MCP
tool defs (`create_transfer`, `create_deposit`, `create_withdrawal`, ...) and a
parallel set of legacy action-alias tools (`transfer`, `deposit`, `withdraw`,
...) meant only for the heuristic parser's `dispatchVerticalIntent` name
lookups. `verticalDispatch.js`'s `toolSchemasFor()` exposed both sets to the
LLM's chat tool-calling schema. When the LLM picked the alias `transfer`
instead of `create_transfer`: (1) PingGateway's `mcp-tool-schemas.json` doesn't
recognize `transfer`, so `McpRequestValidation` rejected it with a plain 400
before the request ever reached PingOne Authorize; (2) even on the local
`McpFirstTool` gate (`mcpToolAuthorizationService.js`), `WRITE_TOOL_TYPE_MAP`
is keyed by the real tool names only, so the wrong name made `transactionType`
resolve to `null` and the amount never got extracted or evaluated — Authorize
PERMITted with no step-up obligation, and the $500 HITL threshold was
silently bypassed for chat-driven transfers.

**What was fixed:** tagged `actionAliases` entries with `heuristicOnly: true`
in `banking/index.js`, and filtered on that flag in `verticalDispatch.js`'s
`toolSchemasFor()` before building the LLM-facing tool schema (all three
merge points: base vertical, admin overlay, A2A overlay). Aliases remain
available to `getTools()`/`getAuthz()` for heuristic dispatch — only the
LLM-callable schema is filtered. No changes to the amount-aware gate itself:
`evaluateMcpFirstToolGate` and `WRITE_TOOL_TYPE_MAP` were already correct once
they receive the real tool name.

**Do not break:** `getTools()` must still return the full alias set for
heuristic-path lookups (`dispatchVerticalIntent`, `getAuthz()`) — only the LLM
schema seam (`toolSchemasFor`) filters by `heuristicOnly`. Any new vertical
adding its own action-alias pattern should tag aliases the same way rather
than adding per-vertical filtering logic.

**Verify:** `verticalDispatch.noFallback.test.js`,
`verticalDispatch.fallback.test.js`, `agentTool.verticalDispatch.test.js`,
`verticalDispatch.oas.test.js` — all pass. Live: chat "Transfer $600 from
checking to savings" now resolves through `create_transfer` and correctly
triggers the HITL step-up challenge instead of a 400.

### 2026-07-11 — Restored clobbered AI-Attacks inline-agent fix; UI suite back to green

**Files changed:** `demo_api_ui/src/components/AIAgent.js`,
`src/hooks/__tests__/useDraggablePanel.test.js`,
`src/components/__tests__/AgentModeSelector.test.jsx`,
`src/__tests__/uiRegression.test.js`.

**What was broken:** the working-tree snapshot commit `5f5770de8` (made in the
shared main checkout, not a worktree) swept in a stale copy of `AIAgent.js`,
silently reverting `855f8a78a`'s removal of the `isInline` guards — AI Attacks
drawer events (`banking-agent-prefill` autoSend, `banking-run-showcase`,
sessionStorage replay) went dead for the inline agent again and its 5 tests
failed. Separately: a `simport` typo (bulk commit `db2a1a074`) broke
`useDraggablePanel` at parse time; an AgentModeSelector test queried the
post-probe "— unavailable" label synchronously; three newer CSS files
(PrivilegeDemoPage, ServersPage, CheckPage) used monospace without allowlist
entries.

**What was fixed:** re-applied 855f8a78a's AIAgent patch verbatim; fixed the
typo; `findByRole` for the async probe label; allowlisted the three CSS files
(identifier / data-column / check-log displays). Full `demo_api_ui` vitest:
1455 passed, 0 failed.

**Do not break:** the inline agent MUST handle drawer run events (no
`isInline` early return — single-instance mount confirmed in 855f8a78a);
working-tree snapshot commits from the shared checkout are how this fix was
lost — use worktrees.

**Verify:** vitest `AiAttacksPanel.inlineAgent`, `useDraggablePanel`,
`AgentModeSelector`, `uiRegression`.

### 2026-07-11 — "Skipped" steps re-rendered as "Not in path" (bypass rail + checklist cross-out)

**Files changed:** `demo_api_ui/src/components/TokenChainDisplay.js` (+`.css`),
`ComplianceModalContent.js` + `ComplianceModal.css`,
`__tests__/TokenChainDisplay.haltedAt.test.js`. Follow-on sweep (same day):
`SimpleStepperPanel.js` (+`.css`), `agent-clinical/TokenAuditTimeline.jsx` +
`clinical.css`, `ApiTrafficPanel.js`.

**What was broken:** token chain steps the BFF emits as `skipped` (mTLS off,
gateway not in route, introspection not enabled) and compliance checklist steps
not applicable to the chip's action rendered as gray "Skipped" / pending "○" —
reading as an alarming omission when the step was simply never part of the run.

**What was fixed/changed:** new `notinpath` visual bucket — status `skipped`
now maps to it (label "Not in path"); `synthesized` stays in the old `skipped`
bucket. Not-in-path chain cards are shunted right onto a dashed spur with a
solid rail passing them (`.tcd-event-wrap--notinpath`), title struck through,
dashed badge; connectors touching them go dashed (`.tcd-connector--bypass`).
Checklist non-applicable steps: `–` icon (the `☑️` violated the §0 emoji
allowlist), strikethrough, dashed outline, "N/A this run" tag; footer wording
"not triggered" → "not in this run's path".

**Do not break:** `resolveStatusVisual` unknown/negative statuses must still
fall to the red `failed` bucket (fail loud); `notinpath` must never absorb a
failure or should-have-run status — a step that should have run and didn't
surfaces via `isHaltedAt`/`failed`, never as "Not in path". Downstream
consumers now render `notinpath` deliberately: `SimpleStepperPanel` crossed-out
row (`sstp-row--notinpath`, distinct from ghost "did not run" and halted rows),
`TokenAuditTimeline` bucket map is active/exchanged → done, acquiring/waiting →
pending, notinpath → bypass (dashed open dot), anything else → error — real
failures must never land in bypass; `ApiTrafficPanel` token-event badge
relabels raw `skipped` → "not in path" (HTTP-status badges untouched); history
rollup still treats it as neutral "~".

**Verify:** vitest `TokenChainDisplay.haltedAt` (bucket assertions included),
`SimpleStepperPanel`; UI build gate.

### 2026-07-12 — "Not in path" extended to the embedded Token Chain rail (all verticals/agents)

**Files changed:** `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`,
`demo_api_ui/src/components/TraceStepCard.jsx` (+`.css` on
`TokenChainTraceRail.css`), plus tests.

**What was broken:** the 2026-07-11 sweep above never reached
`TokenChainTraceRail`/`buildTraceSteps.js` — the rail embedded in every
dashboard/vertical (`UserDashboard`, `Dashboard`, `TokenChainModal`,
`VerticalOpsConsole`; see the 2026-07-05 entry below). Its status model only
had `pending/active/done/error`, so a step never applicable to a run (gateway
not in route, OAuth-bearer path with no API-key swap, no step-up demanded)
stayed gray "pending" forever instead of resolving — same alarming-omission
read the 07-11 fix addressed everywhere else.

**What was fixed/changed:** new `notinpath` status in `buildTraceSteps.js`,
gated on `trace.outcome` (`traceComplete`) so in-flight steps are unaffected —
only once a trace has a terminal outcome does an evidence-free step resolve to
`notinpath` instead of sitting `pending`. Applies to: the `gateway` step (no
gateway evidence, or only a `status:"skipped"` `gw-introspection`/`gw-mtls`
event — a real `gw-authorize`/`evt-inbound`/`evt-scope` signal still wins and
marks it `done`); the `api-key-swap` step (OAuth-bearer runs with no swap
evidence); and the `stepup` step (previously omitted entirely when not
triggered — now appears, once the trace completes, as `notinpath` instead of
silently vanishing). `TraceStepCard.jsx` renders `notinpath` with a
struck-through title and a dashed "Not in path" pill in place of the lane
badge (`.tctr-step-title--notinpath`, `.tctr-lane--notinpath`), matching the
`TokenChainDisplay` convention.

**Do not break:** `notinpath` must only ever replace a still-`pending`
resolution, never a `done`/`active`/`error` one — real evidence always wins.
Mid-flight (`trace.outcome === null`) behavior is unchanged; `stepup` still
only appears in the array once a challenge phase fires or the trace completes.

**Verify:** vitest `src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`
(22 tests), `src/components/__tests__/TokenChainTraceRail.test.jsx` (7 tests).

### 2026-07-11 — P1AZ policy-not-found handling + reliability hardening (deliberate posture change)

**Files changed:** `demo_api_server/services/pingOneAuthorizeService.js`
(NOT_APPLICABLE normalization, 404 → `err.code='policy_not_found'`, worker-token
cache + 401 refresh, 5s timeout + one transient retry, circuit breaker,
`checkPolicyReadiness()`), `transactionAuthorizationService.js` +
`mcpToolAuthorizationService.js` (policy_not_found blocks, fallback-signal
`reason`), `configStore.js` (authorize_mode default), `routes/authorize.js`
(GET /policy-readiness), `server.js` (boot readiness log),
`demo_api_ui/src/services/demoAgentService.js` + `components/AIAgent.js`
(chat message). Specs: `docs/superpowers/specs/2026-07-11-p1az-*.md`.

**What was broken:** a policy missing from P1AZ (deleted endpoint → 404, or
code sending attributes no policy matches → NOT_APPLICABLE) was
indistinguishable from an outage — users saw "service unavailable" and the
misconfiguration stayed hidden. A real outage also stalled every action for the
full 15s timeout and, under the old `authorize_mode='pingone'` default,
503-blocked the demo.

**What was fixed/changed:** NOT_APPLICABLE and 404 now surface
`policy_not_found` → chat shows "Policy not found, please contact
administrator." (NOT_APPLICABLE blocks in every failover mode; 404 respects
failover). **POSTURE CHANGE:** `authorize_mode` FIELD_DEFS default is now
`'pingone_fallback_simulated'` — an unreachable/unconfigured P1AZ falls back to
the simulated engine (+ operator modal) instead of failing closed; explicit
`authorize_mode='pingone'` still fails closed.

**Do not break:** only the literal `NOT_APPLICABLE` effect maps to
policy_not_found — every other unknown decision still collapses to DENY
(fail-closed); the gates must always RUN (never `ran:false`/ungated) when P1AZ
is unconfigured; `policy_not_found` and the circuit breaker must never mask a
real DENY; explicitly stored `authorize_mode` always wins over the default.

**Verify:** jest `pingOneAuthorize.policyNotFound`, `pingOneAuthorize.reliability`,
`authorizePolicyNotFound.gates`, `authorizeMode.resolve`,
`authorizeNotConfiguredFailClosed`, `authorize.parity`, `mcpDelegationParity`;
UI build + `AIAgent.chips` vitest.

### 2026-07-11 — Agent chips vanished/locked when tool discovery degraded (non-banking verticals)

**Files changed:** `demo_api_server/services/agentToolsResolver.js`,
`demo_api_ui/src/utils/chipPermissions.js`, tests
(`agentToolsResolver.degraded.test.js`, `BankingChips.states.test.jsx`).

**What was broken:** when WS tool discovery failed (`discovery_unreachable` —
e.g. PingGateway active: the discovery token's aud never matches the Node
gateway, so discovery is ALWAYS degraded in that mode), the fallback catalog
was banking-only. `chipPermState` then hid every chip whose tool was absent
("vertical-foreign") — chips rendered for ~1.7s and disappeared in every
non-banking vertical — and `toolsError` disabled chips outright.

**What was fixed:** (1) the degraded fallback now merges the ACTIVE vertical's
manifest chips10 tools (via `verticalManifest.loader` + `scopeTopology`) into
the banking baseline, all `permitted:true`; (2) `chipPermState` only greys on
an EXPLICIT Authorize deny (`permitted:false`) — absent-from-list, still
loading, and fetch-error states all render active and clickable. Chip state is
affordance only; the gateway's per-call Authorize decision (fail-closed) is the
enforcement point.

**Do not break:** explicit-deny greying (Read-only scope demo: write chips grey
with the deniedReason tooltip) must keep working; chip `id`/`message`/`tool`
routing keys unchanged; the sign-in CTA for tokenless sessions unchanged.

**Verify:** `jest --runTestsByPath src/__tests__/agentToolsResolver.degraded.test.js`
(server), `vitest run src/components/__tests__/BankingChips.states.test.jsx`
(UI), then live: switch to Super University, open Actions — all 8 curated chips
must stay rendered while `/api/demo-agent/tools` returns `degraded:true`.

### 2026-07-11 — Local-K8s flow also built onto dev image tags (same class as the SE clobber)

**Files changed:** `run-k8.sh` (K8_COMPOSE_PROJECT, `-p` on all 3 build sites,
expanded `tag_k8_images`), `k8s/update.sh` (`-p` + retag targets),
`k8s/*.yaml` (19 locally-built images renamed `ai-demo-X` → `ai-demo-k8-X`),
`k8s/aws/deploy.sh` (IMAGE_MAP local keys renamed; GHCR names unchanged),
`k8s/check-cluster.sh` + `k8s/deploy.sh` (operator hints).

**What was broken:** the local-K8s manifests deliberately shared image tags
with the dev compose stack (`ai-demo-ui:latest`, …), so every
`run-k8.sh`/`k8s/update.sh` build wrote production-stage images onto the dev
tags — the same mechanism that crash-looped the dev UI (exit 127) when the SE
script did it.

**What was fixed:** the K8 flow now has its own namespace end to end — builds
run under compose project `ai-demo-k8`, manifests reference `ai-demo-k8-*`
names, `tag_k8_images` bridges the BFF (compose `demo-api-server` → manifest
`api-server`) and the explicit-image services (llm-proxy, tier-manager,
mcp-code-search, llamaindex-agent), and `k8s/aws/deploy.sh` rewrites the new
local names to the SAME GHCR URIs as before.

**Do not break:** GHCR image names and k8s Deployment names are unchanged —
only local tag names moved. `patch_images` in `k8s/aws/deploy.sh` string-matches
`image: <local-name>:latest`; its IMAGE_MAP keys must exactly equal the
manifest image names. Explicit-image compose services (`image: ai-demo-…`) are
NOT renamed by `-p` — their k8 builds still write the dev tag first, then
retag (single-Dockerfile services, so identical bits; do not add a multi-stage
`target:` to one without also parameterizing its compose `image:`).

**Verify:** `bash -n` on all 4 scripts; `python3 yaml.safe_load_all` over
`k8s/*.yaml` (24 files, 0 invalid); no `ai-demo-(ui|api-server):latest`
references remain outside GHCR right-hand names. First local-K8s rollout after
this change requires a fresh `./run-k8.sh` build (pods reference the new
`ai-demo-k8-*` names, which don't exist until built).

### 2026-07-11 — SE builds overwrote the dev stack's image tags (dev UI crash-looped with exit 127)

**Files changed:** `se-update-code.sh` (SE_COMPOSE_PROJECT + `-p` on both
`docker compose build` calls; `local_img` derives `ai-demo-se-<service>`).

**What was broken:** the SE deploy script built production-stage images with
`docker compose -f docker-compose.yml build` (no `-p`, no dev override), which
tags straight onto the dev stack's `ai-demo-*` image names. For multi-stage
services this swaps the dev image for prod under the same tag — the next
`docker compose up -d` recreated `ai-demo-ui` from the nginx (prod) image while
the dev override still ran `npm start`, and the container crash-looped with
exit 127 (`npm: not found`).

**What was fixed:** SE builds now run under compose project `ai-demo-se`, so
they produce `ai-demo-se-*` tags and the GHCR retag/push reads those. Dev
`ai-demo-*` tags are never touched by an SE deploy.

**Do not break:** `local_img` must stay in sync with compose default naming
(`<project>-<service>` from `compose_svc`); the GHCR image names (`ghcr_img`)
and k8s deployment names are unchanged. Known same-pattern follow-up:
`run-k8.sh` (local-K8s flow) still builds onto dev tags and its
`retag_compose_to_k8s` consumers read them — trace those together before
changing it.

**Verify:** `bash -n se-update-code.sh`; naming semantics proven with a
throwaway compose file (`-p ai-demo-se` → `ai-demo-se-ui`); dev tag image ID
unchanged after an SE-project build of the same service.

### 2026-07-11 — /nl error envelopes crashed the agent; otel single-file mounts crash-looped services after git pull

**Files changed:** `demo_api_ui/src/components/AIAgent.js` (guard at the top of
`dispatchNlResult`), `docker-compose.yml` (7 otel mounts), plus a test in
`demo_api_ui/src/components/__tests__/AIAgent.chips.test.js`.

**What was broken:** (1) while the BFF restarts, the Vite proxy answers
`POST /api/demo-agent/nl` with 502 `{"error":"proxy_error"}` — valid JSON with
no `result`. All three dispatch call paths passed `undefined` into
`dispatchNlResult`, which threw reading `result.kind`, and the chat showed the
raw TypeError ("Could not parse: Cannot read properties of undefined"). (2) The
compose files bind-mounted `scripts/otel-instrument.js` as a SINGLE FILE into 7
services; any `git pull`/checkout that rewrites that file re-inodes it, the
mount goes stale, and every `node --watch` restart after that dies with
`Cannot find module '/otel/otel-instrument.js'` — the BFF crash-loops until the
container is restarted (this instability masqueraded as agent bugs:
"Unknown action: lookup_customer", mode-select flips in the evidence e2e suite).

**What was fixed:** (1) `dispatchNlResult` now returns a friendly
"backend may be restarting" assistant message when `result?.kind` is not a
string. (2) The 7 otel mounts are directory mounts (`./scripts:/otel:ro`) —
the in-container path `/otel/otel-instrument.js` is unchanged, so no
`NODE_OPTIONS` edits; directory mounts survive file replacement.

**Do not break:** the guard must stay ABOVE the first `result.kind` read in
`dispatchNlResult` and must not intercept `kind:"none"` results (those carry
catalog messages). Keep `NODE_OPTIONS: "-r /otel/otel-instrument.js"` in sync
with the `/otel` mount path. Containers need `docker compose up -d` (not just
restart) to pick up the mount change.

**Verify:** vitest `AIAgent.chips` (58 pass, incl. "NL error envelope … degrades
gracefully", which fails without the guard); `npm run build` exits 0;
`docker compose config -q` valid; live — stop the BFF, send a chat message,
see the friendly message instead of the TypeError.

### 2026-07-10 — Heuristics mode silently used an LLM on typed sends; bk9/bk10 threw "Unknown action"

- **Files changed:** `demo_api_ui/src/components/AIAgent.js`
- **What was broken:** (1) `activeLlmProvider` fell back to stale `nlMeta.activeLlmProvider`
  in heuristics mode, so "Heuristics only" typed messages carried the last LLM provider on
  `/nl` — and, with `ff_agui_enabled=true`, streamed to `POST /api/agent/run` where the BFF
  resolves a missing provider to the default LLM (`agentRun.js` → 'anthropic'). (2) The
  heuristic parser resolves `unusual_patterns`/`afford_check` (bk9/bk10 chips) but
  `runAction` had no case for them — "❌ Unknown action" toast.
- **What was fixed:** `activeLlmProvider` trusts the `agentModes.js` SSOT for every known
  mode (heuristics → null is authoritative); both AG-UI branches require an LLM provider so
  heuristics uses the legacy `/nl` parser; `runAction` handles the two LLM-analysis actions
  (LLM modes → `sequential_think`, heuristics → explicit needs-an-LLM reply).
- **Do not break:** heuristics mode must send `provider:"heuristic"` on `/nl` (server
  short-circuits to heuristic-only, `demoAgentNl.js`); pure-LLM modes keep their AG-UI
  streaming path; the mode→provider table stays imported from `config/agentModes.js`.
- **Verify:** `npm run test:e2e:evidence` (asserts each `/nl` request carries the picker's
  provider and no error-card/toast renders).

### 2026-07-10 — PingGateway Exchange #2 sent `audience=` (ignored) instead of `resource=`

**Files changed:** `demo_api_server/services/agentMcpTokenService.js` (finalAudiences
array for the PingGateway path), `service-topology.json` + `k8s/02-configmap.yaml`
(`PINGONE_RESOURCE_PINGGATEWAY_URI`).

**What was broken:** for the PingGateway path the BFF passed `finalAudiences` as a
single STRING, and `oauthService.applyAudienceParam()` maps a string to `audience=`.
PingOne SILENTLY IGNORES `audience=` (honors only RFC 8707 `resource=`), so the
exchanged token kept the subject/actor aud `mcpgateway.ping.demo` instead of the
gateway resource aud. The IG's `McpProtectionFilter` then rejected it (400) BEFORE
`olb-token-exchange.groovy` ran, so tool calls failed and chips fell back to
heuristic. Verified live via the PingOne Management API: `resource=https://api.ping.demo:3036/mcp`
yields `aud=[that] scope=gateway:mcp:invoke`; the PingOne resource (6635cfb8) + scope
(gateway:mcp:invoke) + exchanger grant (f4dd707d) + IG `PG_GATEWAY_RESOURCE_ID` were
all already correct — only the BFF's request param was wrong.

**What was fixed:** pass the PingGateway audience as a one-element ARRAY so it goes
out as `resource=`; single-source `PINGONE_RESOURCE_PINGGATEWAY_URI` (the aud the IG
expects) into the configmap so `pingGatewayResourceAud` no longer falls back to
`mcpgateway.ping.demo`.

**Do not break:** the non-PingGateway audience path (single-resource string) is
unchanged; the two-exchange structure, `gateway:mcp:invoke` scope, actor tokens, and
`finalAudTarget` (later aud-match checks) are unchanged. `applyAudienceParam` array->
`resource=` mapping is the load-bearing behavior — do not "simplify" it to always use
`audience=`.

**Verify:** `node --check`; live — set the same value on the BFF, click a banking chip,
confirm `[OlbExchange] REQUEST` appears in the ping-gateway pod and the tool returns a
real (non-heuristic) result.

### 2026-07-10 — Admin agent chips silently no-op ("Look Up Customer" no response)

**Files changed:** `demo_api_ui/src/components/AIAgent.js` (transcript render
filter), `demo_api_server/services/customerTokenGuard.js` (new
`isVerticalExemptFromAdminTokenGuard` helper + export),
`demo_api_server/services/demoAgentLangGraphService.js` (guard uses the helper),
plus tests `demo_api_ui/src/components/__tests__/AIAgent.chips.test.js` and
`demo_api_server/src/__tests__/customerTokenGuard.test.js`.

**What was broken:** on the admin dashboard, clicking a floating-agent admin chip
(e.g. "Look Up Customer") produced NO visible response. Two stacked bugs: (1) the
BFF's admin-token guard in `processAgentMessage` fired for every vertical except
`oauth-teaching`, so the `admin` vertical — whose chips ARE admin-only tools
(`lookup_customer`, `freeze_account`, …) — was wrongly bounced with a "log in as
a customer" envelope. (2) The SPA turned that envelope into a `role:"error"` chat
card via `maybeHandleCustomerLogin`, but the transcript render filter only passed
`user`/`assistant`/`token-event`, so the card (and every other error-role card:
re-auth, session-fix) was added to state and never rendered — the agent looked
silent.

**What was fixed:** (1) extracted the exempt-vertical list into
`isVerticalExemptFromAdminTokenGuard` (now `{admin, oauth-teaching}`) in
`customerTokenGuard.js` and switched the guard to use it — admin chips run under
the admin token; customer verticals (banking, healthcare, …) still require
customer sign-in. (2) added `msg.role === "error"` to the transcript filter so
the three error-card render branches (customer-login, re-auth, session-fix) are
reachable.

**Do not break:** the per-tool guard in `bffMcpToolExecutor`
(`isCustomerBankingTool` + `isAdminClientToken`) still protects money-moving
tools regardless of vertical — the vertical exemption only bypasses the blanket
short-circuit, not the tool-level check. Customer verticals must still return the
`requiresCustomerLogin` envelope for an admin token. The transcript filter still
gates `token-event` behind `showRfcInfo`; only `error` was added.

**Verify:** `demo_api_server` jest `customerTokenGuard` (12 pass, incl. admin/
oauth-teaching exempt, banking/healthcare not) + real module load of
`demoAgentLangGraphService`; `demo_api_ui` vitest `AIAgent.chips` (57 pass, incl.
the new "login-as-customer error card renders" case that fails without the filter
fix); `cd demo_api_ui && npm run build` exits 0. Live click-through pending deploy
(the running containers bind-mount the main checkout).

### 2026-07-10 — Authorize policies card: render tree from repo snapshot on 403

**Files changed:** `demo_api_server/services/pingOneAuthorizeService.js`
(`getAuthorizationPoliciesFromSnapshot`), `demo_api_server/routes/authorize.js`
(403 branch), `demo_api_server/Dockerfile` (COPY snapshot to `/snapshots/`),
`demo_api_ui/src/components/PingOneAuthorizePage.jsx` (note renders above the
tree instead of replacing it).

**What was broken:** the `/pingone-authorize` policies card always failed —
PingOne's policy-editor API (`GET /authorizationPolicies`) rejects worker
client_credentials tokens regardless of roles/license (verified live). The
real configuration flow never used that API: policies are edited in
`snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json` and
imported via the console (see `pingone/pingone-authorize-configure/SKILL.md`).

**What was fixed:** on a 403 the BFF now builds the policy tree from that
snapshot (the import source of truth) and returns it with `source: 'snapshot'`
plus a note; the UI shows the note above the tree.

**Do not break:** the live-API success path is still tried first and returns
with no note; the snapshot parser maps `type: PolicySet|Policy|Rule` +
`children` refs + `disabled` to the `_normalizePolicyNode` shape — keep the
two shapes in sync; the snapshot file name in the service, Dockerfile, and
skill must stay identical.

**Verify:** `node -e "require('./services/pingOneAuthorizeService').getAuthorizationPoliciesFromSnapshot()"`
returns 1 root / 2 policies / 14 rules; jest `--testPathPattern=authorize`
(204 passed); `demo_api_ui && npm run build` exit 0.

### 2026-07-10 — Board-feedback batch (12 items: nginx 404, authz 403 note, pingcli auth, attack-demo buttons, CodeGraph reindex, code-search agent, settings write-through, delegation credentials, MCP-route rail, scope docs, Exploring nav)

**Files changed:** `k8s/aws/nginx-http-configmap.yaml`, `routes/authorize.js` +
`services/pingOneAuthorizeService.js`, `routes/pingcli.js` + `PingCliPage.js`,
`components/education/AiAttacksPanel.js` + `AIAgent.js` (listener effects only),
`langchain_agent/src/api/codegraph_handler.py` + `scripts/build-codegraph.py`,
`pages/CodeSearchPage.jsx/.css` + `CodeSearchAsk.jsx` + `CodebaseUploader.jsx` +
`services/codeSearchAPI.js`, `routes/admin.js` (settings) + `SecuritySettings.js`,
`services/delegationService.js` + `DelegationPage.js`, `TokenChainTraceRail.jsx` +
`verticalOps/VerticalOpsConsole.jsx/.css`, `SCOPE_VOCABULARY.md` +
`ScopeReferencePage.js`, `AdminSideNav.jsx` ("Exploring" group).

**What was broken / fixed (one line each):**
- Prod nginx configmap (AWS override) lacked the `/pinggateway-test.html` proxy
  block the base configmap has → SPA shell served; block added.
- PingOne Authorize policy-list 403 surfaced as a raw error dump → now routed
  through the friendly `note` channel. Live-verified root cause (2026-07-10):
  NOT roles or license — the worker app holds Environment Admin + Identity Data
  Admin (env-scoped) + Authorize Gateway Policy Evaluator and the INTERNAL
  license has allowDynamicAuthorization, yet `/authorizationPolicies`,
  `/trustFramework/*`, `/deploymentPackages` all 403 for worker tokens while
  `/decisionEndpoints` + `/authorizationVersions` return 200. The policy-editor
  API appears to accept only admin user (console) tokens — escalate to the
  PingOne Authorize team. A spare "AI Demo Authorize Worker" app
  (226934ee-6c73-4761-baec-2b8735cf040d) was created during diagnosis.
- pingcli commands failed "Authentication is not configured": container has no
  writable `$HOME` so the file_system token store can't init, and no auth
  bootstrap existed → children now get a writable HOME + lazy shared
  `pingone auth login` bootstrap; `GET /version` added; UI shows installed
  version + `brew upgrade pingidentity/tap/pingcli`; run() gets a 30s abort +
  `finally` reset so Run buttons can't stay stuck. NOTE: committed
  `bin/pingcli` is stale 0.8.3 (runtime uses the brew-staged 1.x binary).
- AI Attack Demos run buttons dispatched window events that the inline agent
  ignored (`if (isInline) return` — added to prevent a floating+inline double-run
  that can't happen; only one agent instance ever mounts) and that dropped
  silently when no agent was mounted → guards removed; `window.__bankingAgentMounted`
  flag + sessionStorage `banking-agent-pending-attack` replay-after-navigate
  fallback added.
- CodeGraph "index not available" masked LLM-backend failures, and reindex wrote
  the DB to `repo-src/.codegraph/` while queries read `CODEGRAPH_DB_PATH` → error
  now differentiates index-missing vs LLM-unavailable; indexer gained `--out`;
  reindex passes the query path and resets `_graph_cache` on success.
- `/code-search`: `.cs-tabs` buttons had zero CSS; "Ask the agent" was a single
  input → styled segmented tabs; Ask rewritten as an OAuth-Academy-style chat
  (messages, chips, stop button); uploads drive the global spinner; file-size
  limits fire native `window.alert`.
- `/settings`: `maxTransactionAmount` saved to runtimeSettings which nothing
  reads (enforcement reads configStore `MAX_TRANSACTION_AMOUNT`) → PUT now
  writes through to configStore and GET reads the effective value; the inert
  `authorizeEnabled` toggle became a read-only status row driven by
  `getAuthorizationStatusSummary()`.
- `/delegation`: newly created delegate users had no password and no credentials
  shown → password set (DEMO_PASSWORD; failure = warning, not grant failure),
  `credentials` returned only for new users, dismissible credential card in UI
  (silent re-auth deferred until dismissal in that case).
- Vertical ops pages had no token chain → `TokenChainTraceRail` gained opt-in
  `mcpRouteOnly` prop (MCP steps only, dots relabeled "Agent (MCP Client) →
  MCP Server", MCP tab default), mounted collapsed in `VerticalOpsConsole`.
- `SCOPE_VOCABULARY.md` was stale Phase-146 `banking:*` content → rewritten from
  `scope-topology.json` (25 scopes, 4 aliases, 6 resources); `/scope-reference`
  now shows `missingRequired` drift warnings.
- Code Explorer / Code Search / OAuth Academy / OAS Demo grouped under a new
  "Exploring" nav group (slug `exploring` added to `AUTO_EXPAND_SECTIONS`).
- OAuth Academy chips reworked to core OAuth/OIDC learning topics (12 chips,
  `STARTER_CHIPS` + manifest `chips10` kept in sync); `CONCEPTS` entries in
  `config/verticals/oauth-teaching/index.js` gained structural `rfc` (always
  rendered as "Spec: …") and `code` (real snippet from this app) fields plus
  three new concepts (OAuth overview, refresh tokens, client credentials —
  overview catch-all must stay LAST in the array); bubble renderer in
  `OAuthAcademyPage.jsx` renders ``` fences as `.msg-code` blocks.

**Do not break:** `TokenChainTraceRail` without `mcpRouteOnly` must render
exactly as before (dashboards); AIAgent changes must stay confined to the
drawer-event listener effects (FAB/resize/dock/session untouched); the settings
PUT must keep writing runtimeSettings for all other keys; delegation grant must
still succeed when password-set fails; `build-codegraph.py` without `--out`
must write to `.codegraph/demo-codegraph.db` (separate from the host
CodeGraph CLI/MCP `codegraph.db`); the base
`k8s/02-configmap.yaml` proxy block and the AWS override must stay in sync.

**Verify:** `cd demo_api_ui && npm run build` (exit 0); `npx jest
tests/pingcli.route.test.js --testPathIgnorePatterns=/node_modules/` (8/8);
jest `--testPathPattern=delegation` (101 passed); vitest
`AiAttacksPanel.runButtons` + `AiAttacksPanel.inlineAgent` (13/13); vitest
`TokenChainTraceRail` + `VerticalOpsConsole` (8/8); `python3 -m py_compile`
on both .py files; live: `/pinggateway-test.html` returns the BFF test page
after redeploy.

### 2026-07-10 — Dual token-exchange broker flag (`ff_gateway_brokered_exchange`)

**Files changed:** `demo_api_server/routes/featureFlags.js` (new flag + pin-alias),
`demo_api_server/services/agentMcpTokenService.js` (`usePingGatewayForExchange`),
`demo_api_server/services/mcpGatewayClient.js` (`X-BFF-Exchanged` header),
`ping-gateway/scripts/groovy/olb-token-exchange.groovy` (skip on header),
`docs/dual-exchange-broker.md`.

**What was added:** a flag choosing WHO performs the final RFC 8693 exchange to
`mcpserver.ping.demo` when routing via PingGateway — the IG (gateway-brokered,
default) or the BFF (bff-brokered). See `docs/dual-exchange-broker.md`.

**Do not break:** with the flag unset or `true`, `usePingGatewayForExchange` MUST
resolve exactly as `ff_mcp_gateway_pinggateway === 'true'` (gateway-brokered
default) — the Exchange #2 `gateway:mcp:invoke` scope, the pinggateway audience
handling, and the two-exchange delegation structure are unchanged. The bff path
only activates when the flag is explicitly `false` and reuses the existing
`!usePingGatewayForExchange` branch. `viaPingGateway` dual-spelling
(`gateway:mcp:invoke` + legacy `pinggateway:invoke`) is untouched.

**Verify:** `node --check` on the four files; toggle the flag on `/config` with
`ff_mcp_gateway_pinggateway` ON and confirm the Token Chain shows the final
exchange at the IG (on) vs. the BFF (off). Two IG/PingOne live-verify items
remain — see `docs/dual-exchange-broker.md` "Live-verify checklist".

### 2026-07-07 — AG-UI agent: multi-turn memory, per-run provider on MCP path, tool timeout

**Files changed:**
- `demo_api_ui/src/components/AIAgent.js` — the two fresh-turn AG-UI send sites
  (`sendAsNlInner` and the typed-query branch) now send prior visible turns from
  the `messages` thread, not just the current message, so the agent has
  multi-turn context ("reverse that"). `messages` is the render-time closure, so
  the current turn is appended explicitly (no duplication); the BFF already
  windows the array (`agent_history_limit`). Only the `messages:` array passed to
  `aguiRun` changed — dock/FAB/layout/session/token logic untouched.
- `langchain_agent/src/api/message_processor.py` — the per-run LLM override now
  (1) supports `helix`, and (2) is honored on the MCP graph path too: when a run
  picks a provider different from the startup LLM, a graph is built from that LLM
  over the MCP tools + shared checkpointer (previously the MCP path silently used
  the startup LLM and, when startup=none, returned "No LLM configured" despite a
  valid selection).
- `langchain_agent/src/agui/bff_tool_adapter.py` — the BFF tool-callback timeout
  is raised from 30s to a configurable `BFF_TOOL_TIMEOUT_SECONDS` (default 120s)
  with a short connect timeout, and a timeout returns a "do NOT auto-retry"
  message to the LLM instead of a hard error — so a slow-but-successful
  non-idempotent tool (e.g. a transfer) isn't spuriously aborted and then
  double-executed on retry.

**Do not break:** the agent still never receives a user access token. The UI must
keep appending the current turn (not rely on `messages` including it) to avoid
duplicating the latest message. Per-run provider override must not change the
default (no-override) behavior.

**Verify:** live against the patched agent container — MCP-path run with
`provider=llamacpp` answers instead of "No LLM configured"; a 3-message history
array is correctly recalled ("teal"); UI build gate `cd demo_api_ui && npm run
build` exits 0; `bff_tool_adapter.py` / `message_processor.py` compile.

### 2026-07-05 — TopNav: dark-on-blue labels and controls painting over each other

**Files changed:**
- `demo_api_ui/src/components/TopNav.css` — new rule `.topnav-right-scroll > * { flex-shrink: 0; }`. The right-side row is an `overflow-x: auto` scroll container, but its items were allowed to shrink; a squashed item's nowrap content (search button, Reset Demo, token pill text) painted over its neighbors instead of triggering the scroll.
- `demo_api_ui/src/components/AgentUiModeToggle.css` — the `--config` variant (only mount: TopNav) had `color: #374151` on the "Choose layout" label and "Always float" checkbox; now `var(--brand-topnav-text, #ffffff)`.
- `demo_api_ui/src/components/QuickFlagsPill.css` — `.qfp-pill` used `color: inherit`, which picks up the dark app body color on the topnav; now `var(--brand-topnav-text, #ffffff)`.

**What was broken:** on branded (blue) topnavs, "Choose layout", "Always float", and the JWKS/Introspect pill were near-invisible dark gray; below ~1100px viewport width the right-side controls (Reset Demo, token pill, search) overlapped and bled over each other.

**What was fixed:** all three text surfaces follow `--brand-topnav-text`; the scroll row scrolls instead of squashing its items, so nothing overlaps at any width.

**Do not break:** `.topnav-right-scroll` children must keep `flex-shrink: 0` — the overflow design relies on the row scrolling, not shrinking. The `--config` toggle variant and `.qfp-pill` are topnav-only; if either is ever mounted on a light background it needs its own color override.

**Verify:** `cd demo_api_ui && npm run build` exits 0; on /dashboard at 1000–1100px width the topnav shows no overlapping controls (row scrolls) and "Choose layout" / "Always float" / the Introspect pill render in the topnav text color.

### 2026-07-05 — Token Chain trace rail (embedded + floating) showed no step details

**Files changed:**
- `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js` — recognizes BOTH token-event vocabularies: 1-exchange (`agent-actor-token`, `exchanged-token`) and 2-exchange (`two-ex-agent-actor`, `two-ex-final-token`, `two-ex-exchange1`). Sign-in / agent-token steps now expose full claims as a response block; exchange step adds exchange-method + audience-binding kv rows; gateway step renders a DENY decision from the `gateway_policy_denied` phase; MCP step goes `error` (not stuck `active`) on a gateway denial.
- `demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js` — `beginTrace` carries session-scoped events (`user-token`, `session-token-introspection`, `user-token-introspection`) into the new trace so the sign-in step doesn't regress to pending on every chip click.
- `demo_api_ui/src/components/AIAgent.js` — the action catch block pushes `err.tokenEvents` into TokenChainContext (denied calls carry the full minted-token trail; it was dropped). Both typed-send funnels (`handleNaturalLanguageInner` — the chat input box — and `sendAsNlInner` — message-carrying chips) begin a fresh trace with the actual prompt.
- `demo_api_ui/src/services/demoAgentService.js` — on `gateway_policy_denied`, records the denial phase into `agentFlowDiagram` locally (SSE can close before the server phase arrives).
- `demo_api_ui/src/hooks/useAgentRun.js` — AG-UI flow SSE handler dispatches `mcp-tool-result-sse` (parity with the chip path) so typed runs fill the MCP/API steps.

**What was broken:** the Token Chain rail (embedded in dashboards and in the floating agent modal) rendered only static narratives when steps were expanded — no tokens, requests, responses, or decisions. Four stacked causes: event-id vocabulary mismatch (2-exchange ids never matched), error paths dropped tokenEvents, typed sends never began a trace, and `beginTrace` wiped sign-in evidence.

**What was fixed:** both id vocabularies light up the rail; error responses feed the rail; typed prompts start the pipeline header; sign-in evidence survives new turns; gateway denials render as DENY with the error code.

**Do not break:** `buildTraceSteps` must keep accepting BOTH id vocabularies — the BFF's exchange mode is config-driven. The step list/order (`signin … reply`, conditional `stepup`) is consumed by `MCP_STEP_IDS` users. `beginTrace` must keep dropping per-call events (only session-scoped ids survive).

**Verify:** `cd demo_api_ui && npx vitest run src/services/tokenChainTrace` (24 tests); `npm run build` exits 0; in the app: sign in, open agent → Token Chain toggle, run "My accounts" chip and a typed message — each expanded step shows claims/requests/responses, and a gateway denial shows DENY on the gateway step.
### 2026-07-05 — AG-UI agent: identity, streaming content, usage, and terminal-event fixes

**Files changed:**
- `demo_api_server/routes/agentRun.js` — the outbound `/run` payload `context` now
  carries `userIdentity: { userId, email }` (non-sensitive; sourced from
  `req.agentContext`). The agent still receives NO user access token — RFC 8693
  token exchange stays entirely in the BFF. This is only a display-identity hint.
- `langchain_agent/src/api/agui_run_handler.py` — threads `context.userIdentity`
  through `_run_stream` → `_invoke_agent` → `process_agui_message`.
- `langchain_agent/src/api/message_processor.py` — (1) on the BFF-tool path, when
  `auth_token` is absent but `user_identity` is present, marks the session
  identified via `conversation_memory.set_user_identified` so the system prompt
  says "USER IDENTIFIED" instead of instructing the LLM to ask for the user's
  email; (2) flattens streamed `chunk.content` via `_content_to_text` (Anthropic
  providers stream block lists that otherwise render as `[object Object]`);
  (3) reads `usage_metadata` as a dict (it is a TypedDict → attribute access
  always returned 0).
- `langchain_agent/src/agui/emitter.py` — `on_run_end` and `on_error` are now
  idempotent via a `_terminated` flag: exactly one terminal event (RUN_FINISHED
  or RUN_ERROR) is emitted per run. Previously the MCP-graph error path emitted
  RUN_ERROR then the /run handler appended RUN_FINISHED, which the client narrated
  as success.

**Do not break:** the agent must NEVER receive the user's access token on the
`/run` path — `userIdentity` is display-only (userId + email); token exchange
stays in the BFF. Exactly one terminal AG-UI event per run (RUN_FINISHED XOR
RUN_ERROR); RUN_FINISHED must not follow RUN_ERROR.

**Verify:** behavioral: `POST /run` with `context.userIdentity` → system prompt
shows "USER IDENTIFIED" and the agent does not ask for email (verified live);
emitter idempotency + content-flatten + dict-usage asserted directly against the
patched module; `langchain_agent` tests `tests/agui/ tests/test_message_processor.py`
(18 passed); BFF `tests/agentSessionIdentity.regression.test.js` +
`tests/agentRun.framework-routing.test.js` (10 passed).
### 2026-07-05 — AG-UI agent surface hardening (whole-app gate, trace IDOR, fail-closed secret)

**Files changed:**
- `langchain_agent/src/main.py` — the port-8888 FastAPI gate now covers the ENTIRE
  app (AG-UI `/run` AND `/codegraph/*`), not just `/run`. Previously
  `/codegraph/query` (drives an LLM, reads the source tree) and
  `/codegraph/reindex` (spawns the indexer) were reachable with no auth on the
  0.0.0.0-published port. The gate is also fail-closed: outside dev/test it
  refuses ALL requests (503) when `BFF_INTERNAL_SECRET` is unset or equals the
  well-known default, instead of silently accepting `dev-shared-secret-change-me`.
- `demo_api_server/routes/codegraphProxy.js` + `services/aguiSseProxy.js` — both
  BFF→agent proxies now send `x-internal-gateway-secret`, so the whole-app gate
  does not break the legitimate codegraph page / legacy SSE path.
- `demo_api_server/routes/agentRun.js` — the `/runs/:runId/events` trace store now
  binds each run to the user who started it (`_recordTraceEvents(runId, chunk,
  userId)`), and the read route returns 404 when a different user requests it.
  Closes an IDOR that let any authenticated user read another user's conversation
  and decoded token claims by guessing the runId.

**Do not break:** the agent's port-8888 app must require `x-internal-gateway-secret`
on every route (both `/run` and `/codegraph/*`); the two BFF proxies must send it
or the codegraph page 401s. Outside dev, a missing/default secret must fail closed
(503), never accept the public default. `/runs/:runId/events` must stay
owner-scoped (other user → 404, not the events). The agent must still never
receive a user access token.

**Verify:** live against the patched agent container — `/codegraph/query` and
`/run` return 401 with no secret, 403 with a wrong secret, 200 with the correct
secret (verified). Trace-ownership guard unit-checked (owner→200, other→404,
null-owner→200 back-compat). BFF `tests/agentRun.framework-routing.test.js`,
`tests/agentSessionIdentity.regression.test.js`, `tests/agentRunStore.test.js`
(15 passed). Note: the LLM proxy (`:8090`) remains unauthenticated and reachable
via `host.docker.internal` — see the PR notes; a safe fix requires moving it onto
the Docker network, not a loopback bind (which breaks the agent's LLM path).

### 2026-07-05 — Conversation summary panel + conversations route hardening

**Files changed:**
- `demo_api_server/routes/conversations.js` — (1) `GET /admin/queue-stats` is now
  admin-only (it has no `:userId`, so the ownership guard never fired — any
  authenticated user could read queue stats); (2) the `router.param('userId')`
  guard accepts `me` as an alias that always resolves to `req.user.sub` (the UI
  never sees the token sub). `me` cannot widen access — it maps to the caller.
- `demo_api_ui/src/components/ConversationSummaryPanel.jsx` + `.css` (new) —
  collapsible "Earlier in this conversation" panel; fetches
  `GET /api/conversations/me/:vertical/summaries` with `credentials:'include'`;
  renders null when no summaries exist; silent on fetch failure.
- `demo_api_ui/src/components/AIAgent.js` — one import + one mount below the
  ReasoningPanel, gated on `isLoggedIn`, vertical = `effectiveVerticalId || 'banking'`.

**Do not break:** the conversations `router.param('userId')` ownership guard —
`me` must resolve to `req.user.sub` and nothing else; non-admin access to another
user's thread must stay 403; `/admin/queue-stats` must stay admin-only. The
summary panel must render null (not an error state) when the fetch fails or
returns zero summaries.

**Verify:** behavioral: `me` → 200 own data, other-user → 403, anon → 401,
queue-stats non-admin → 403 / admin → 200. `cd demo_api_ui && npm run build`
exits 0.

### 2026-07-05 — Feature: live agent reasoning visibility (Phase 3 UI)

**Files changed:**
- `demo_api_ui/src/hooks/useAgentState.js` — added a `reasoningState` slice
  (`{ phase, toolOptions, contextTokens }`) to `INITIAL_STATE`, `onStateSnapshot`,
  and the `onStateDelta` whitelist (`slicePrev`). The agent service emits
  `STATE_DELTA` `replace` ops on `/reasoningState/phase|toolOptions|contextTokens`.
- `demo_api_ui/src/components/ReasoningPanel.jsx` + `.css` (new) — presentational
  panel reading `aguiState.reasoningState`; renders null until a phase is reported.
- `demo_api_ui/src/components/AIAgent.js` — one import + one mount after
  `<SimpleStepperBar />` inside `.ba-right-col`, gated on `aguiEnabled`.

**What was added:** the agent now surfaces what it is thinking (current phase,
selected tools + confidence, token usage / % of context window) as it runs.
Anthropic-only for now (other providers report no phase, so the panel stays
hidden). Backend emission landed in the Phase 1 commit (`8365ab319`).

**Do not break:** `onStateDelta` in `useAgentState.js` applies `STATE_DELTA` only
to a WHITELISTED set of slices (`slicePrev`) and then strips `messages`/`toolCalls`
before merging back — a new delta-driven field is INVISIBLE to the UI unless it is
added to that whitelist. If you add another `/foo/*` STATE_DELTA path, add `foo`
to `slicePrev` or the ops silently no-op. Keep the panel mount gated on
`aguiEnabled` so the legacy (non-AG-UI) path is unaffected. Do not add
`max-width`/`max-height` in `ReasoningPanel.css` inside the float panel (§1).

**Verify:** `cd demo_api_ui && npm run build` exits 0.

### 2026-07-04 — PingGateway (IG) audit: real P1AZ URL, apikey authz gap, dead route

**Files changed:**
- `ping-gateway/scripts/groovy/p1az-decision.groovy` — real-backend decision URL now appends `/decisionEndpoints/{P1AZ_WORKER_ID}` when `P1AZ_REAL_BASE` is a bare environment base.
- `ping-gateway/config/routes/00-mcp-apikey.json` + `00-mcp-apikey-jwks.json` — added the `p1az-decision.groovy` filter so api-key tools get the PingOne Authorize decision (parity with the Node gateway).
- `ping-gateway/config/routes/03-oauth-passthrough.json` — removed (never built: `ClientHandler` in a Chain `filters` array → ClassCastException; `/as/token` 404s; unused).
- `ping-gateway/scripts/check-groovy-params.sh` — stopped forbidding `decisionEndpoints` (the stale check that enforced the bug); now requires both mock policy path AND real decisionEndpoints URL.

**What was broken:** with `ff_authorize_simulated=false` (the default), the IG
gateway POSTed the P1AZ decision to the environment base URL, which 403s → no
`decision` field → fail-closed DENY on every request (403 doesn't trigger the
0/5xx mock failover). The default real-P1AZ path denied 100% of calls. Separately,
`/mcp/apikey` (both introspection and jwks variants) skipped the Authorize
decision, and the dead `oauth-passthrough` route logged a build error every boot.

**Do not break:** the real decision URL must target
`.../v1/environments/{envId}/decisionEndpoints/{id}` — a bare env base fails
closed silently. Keep P1AZ fail-closed on DENY/error/timeout. Do NOT add
`mcp-request-validation` (schema) to the apikey routes: `show_investment` is
absent from `mcp-tool-schemas.json` and would be `-32602`'d.

**Verify:** `bash ping-gateway/scripts/check-groovy-params.sh` (PASS, both
backends), `bash ping-gateway/scripts/validate-config.sh` (PASS),
`bash ping-gateway/scripts/e2e-pinggateway.sh` (PASS); restart
`ai-demo-ping-gateway` → 0 route-build errors, unauthenticated `/mcp`,
`/mcp/apikey`, jwks-variant all 401, `/as/token` 404.

### 2026-07-05 — run-docker.sh aborts on cold start when :8090 is empty

**Files changed:**
- `run-docker.sh` — `_clear_8090_squatter`: the `pids=$(lsof … | awk … | sort -u)` assignment now ends with `|| true`.

**What was broken:** under `set -euo pipefail`, when nothing listens on `:8090` (the normal cold-start state — the `llm-proxy` container not yet up), `lsof` exits `1`, `pipefail` propagates it, and this standalone assignment returns non-zero → `set -e` aborted the whole launcher right before `docker compose up`. The stack silently failed to start (only pre-pulled images like ping-gateway were left). It only survived previously because a running `llm-proxy` held `:8090`, so `lsof` exited `0`.

**What was fixed:** `|| true` guards the assignment — an empty `:8090` is the expected case (no squatter to clear), not an error.

**Do not break:** keep the `|| true` (or use `local pids=$(…)` so `local` masks the exit). Any `var=$(pipeline)` under `set -e`+`pipefail` where the pipeline's first stage can legitimately exit non-zero (grep/lsof/…) must be guarded.

**Verify:** `bash -n run-docker.sh`; reproduce: `bash -c 'set -euo pipefail; x=$(lsof -iTCP:59999 -sTCP:LISTEN 2>/dev/null | awk "{print \$2}") ; echo reached'` aborts before `reached`, and the same with `|| true` prints it.

### 2026-07-05 — §1 anti-rot guard, stale AIAgent rows, pingone-mcp skill + smoke test

**Files changed:**
- `REGRESSION_PLAN.md` §1 — three rows still protected `BankingAgent.js`/`.css`, renamed to `AIAgent.js`/`.css` months ago, so the FAB/float-panel/account-ID invariants guarded nothing. Rows updated to current reality (resize caps are `MAX_W`/`MAX_H` = 95% viewport, `MIN_W`/`MIN_H` = 280/220; drag intentionally unclamped).
- `scripts/check-regression-plan-paths.js` — NEW anti-rot guard: every file referenced in a §1 row must exist as a tracked file (shorthand paths resolve by suffix; globs supported; `.env` and code identifiers skipped). `npm run regression:paths`; wired into the CI gates job.
- `.claude/skills/pingone-mcp/SKILL.md` — NEW repo-local skill making CLAUDE.md's "MCP-first" rule executable: hosted-server URL/auth per consumer, camelCase tool conventions, worker-role gating (~67-tool healthy baseline), direct-API exceptions (createEnvironment, resources/scopes, grants), fallback rule, pointer to the stale SUPERSEDED docs.
- `scripts/smoke-pingone-mcp.js` — NEW live health check (`npm run smoke:pingone-mcp`): worker token + `tools/list`, JSON-or-SSE tolerant, mirrors `mcpPingOneHttpAdapter.js`. Verified live: 67 tools. Not in CI (needs credentials).

**What was broken:** §1 was hand-maintained prose with zero drift detection — the exact failure mode the rest of the repo gates against — and there was no correct agent-facing guidance for the hosted PingOne MCP server (the only docs describing it are SUPERSEDED and describe the retired stdio binary).

**Do not break:** keep `regression:paths` in the CI gates job. When renaming/moving any file listed in §1, update the row in the same PR (the guard now forces this). The smoke script must stay credential-gated and out of CI.

**Verify:** `npm run regression:paths`; `npm run smoke:pingone-mcp` (needs `demo_api_server/.env`).

### 2026-07-05 — feat(agent-ui): clinical-split Tokens tab + real TokenAuditTimeline (plan Phase 3d)

**Files changed:**
- `demo_api_ui/src/components/agent-clinical/TokenAuditTimeline.jsx` — was a `return null` stub; now renders live `TokenChainContext` events as the `.ac-tstep` card rail. Status buckets via `resolveStatusVisual` from `TokenChainDisplay` (active/exchanged → done, acquiring/waiting → pending, else error). Honest empty state before the first agent action.
- `demo_api_ui/src/components/agent-clinical/TalkPane.jsx` — right column now renders `TokenAuditTimeline`; static placeholder cards, the visible "Phase 3d wires…" note, and the four dead narrate-tab buttons (MCP calls / Rules / Tools never existed) removed.
- `demo_api_ui/src/components/agent-clinical/TokensPane.jsx` — NEW: rail tab 3 embeds `UnifiedTokenFlowInspector` (`floatingByDefault={false} showToggle={false}`, same as DevToolsDashboard). The inspector previously had no nav entry outside `/agent-flow-inspector`.
- `demo_api_ui/src/components/agent-clinical/AgentTabsRail.jsx` + `AgentClinicalHost.jsx` — Tokens tab inserted at position 3; Configure moves to key 4.
- `demo_api_ui/src/components/agent-clinical/clinical.css` — `.ac-tstep--pending/--error` variants, `.ac-tstep-empty`, `.ac-tokens*`; dead `.ac-narrate-tabs` styles removed; narrate column grid now `auto 1fr`.

**What was broken:** the Talk tab's audit timeline showed three hard-coded fake token cards plus a visible "Phase 3d wires the real TokenAuditTimeline here" note, and there was no way to reach the full token chain inspector from the clinical layout.

**Do not break:** timeline reads `useTokenChainOptional()` (must render the empty state, never throw, outside the provider); keyboard map is 1=Talk 2=Inspect 3=Tokens 4=Configure; `UnifiedTokenFlowInspector` embedded with `showToggle={false}` so no floating/close chrome inside the tab.

**Verify:** `/dashboard?ff_agent_clinical_split=on` → ask the agent for a balance → right column fills with real chain steps (done teal / waiting gold); key 3 shows the inspector; key 4 Configure; flag OFF dashboard unchanged.

### 2026-07-05 — feat(agent-ui): clinical-split Inspect + Configure tabs (plan Phases 4/5)

**Files changed:**
- `demo_api_ui/src/components/agent-clinical/InspectPane.jsx` — was a `return null` stub; now wraps the existing `ActivityLogPanel` (SSE stream, filter pills) in clinical chrome. Data layer untouched.
- `demo_api_ui/src/components/agent-clinical/ConfigurePane.jsx` — was a `return null` stub; now mounts `AuthorizeRulesPanel` as-is (left) + a read-only runtime status card from `GET /api/langchain/config/status` (right). Deliberately does NOT duplicate the Agent-mode/Wiring write controls — one writer (chat header on Talk), one surface (see "Missing Input" entry 2026-07-03 for why the provider write path is fragile).
- `demo_api_ui/src/components/agent-clinical/AgentClinicalHost.jsx` — renders the real panes; `PlaceholderPane` removed. Panes mount only while active (stream/fetches start on tab enter, stop on leave).
- `demo_api_ui/src/components/agent-clinical/clinical.css` — placeholder-only styles removed; `.ac-inspect*`, `.ac-config*`, `.ac-runtime*` added (existing `--ac-*` tokens only).

**What was broken:** Inspect and Configure tabs on the `ff_agent_clinical_split` dashboard were dead — plan Phases 4/5 were never built, so both tabs showed placeholder copy ("Phase 4 wraps ActivityLogPanel here").

**Do not break:** Talk tab default view + agent auto-open (`TalkPane` `banking-agent-open` dispatch); legacy dashboard when the flag is OFF (all changes live under `agent-clinical/`); 1/2/3 keyboard shortcuts skip inputs/textareas.

**Verify:** `cd demo_api_ui && npm run build` exits 0; `/dashboard?ff_agent_clinical_split=on` → key 2 shows live activity log ("Live" after first event), key 3 shows Authorize Rules + runtime card, key 1 returns to chat.

### 2026-07-05 — LaunchAgent must supervise SWAP MODE, not load all 5 tiers

**Files changed:**
- `demo_llm_proxy/supervise-swap.sh` (NEW) — low-RAM supervisor: keeps the tier-manager daemon (:8097) up and ensures ONLY the smallest tier (8091) is loaded, and only when nothing is loaded (so it never evicts a bigger tier the router swapped up for a live request). This is the swap-mode design run.sh uses.
- `demo_llm_proxy/install-launchd.sh` — the LaunchAgent now runs `supervise-swap.sh` instead of `start-local-models.sh start`. The previous version loaded all 5 tiers (~30GB) at login + every 5 min.

**What was broken:** the model-supervision hardening from the entry below installed a LaunchAgent that ran `start-local-models.sh start`, which loads ALL FIVE llama-server tiers simultaneously (~30GB RAM). The demo's intended local-LLM design is swap mode — tier-manager (:8097) + at most ONE resident tier, the router (:8090) swapping up on demand and decaying back to the smallest after idle (see `run.sh` "SWAP MODE").

**What was fixed:** at most one model is resident at a time; the tier-manager handles on-demand swap-up. `supervise-swap.sh` is idempotent and safe on a timer — it only loads the smallest tier when nothing is loaded.

**Do not break:** the LaunchAgent / any supervisor must NEVER call `start-local-models.sh start` (all-5). Load the smallest tier via `ensure 8091` and let the tier-manager swap. Do not force `ensure` on a timer unconditionally — it evicts an in-use tier and fights the router; only ensure when nothing is loaded.

**Verify:** `bash -n demo_llm_proxy/supervise-swap.sh`; run it and confirm only one tier is up (`for p in 8091 8092 8093 8094 8096; do curl -s 127.0.0.1:$p/health -o /dev/null -w "$p:%{http_code}\n"; done`); `launchctl list | grep llama-models`.

### 2026-07-17 — Heuristics silently called a frontier API; /api/conversations mounted without auth

**Files changed:**
- `demo_api_server/routes/agentRun.js` — `/run` resolved the LLM provider without ever consulting `agent_mode`, so a run that arrived with no explicit provider (Heuristics selected, a stale session provider, or the HITL resume/cancel runs which send none) fell through to a hard-coded `'anthropic'` — the `401 invalid x-api-key` seen on the SE deploy. Now resolves the mode first (`resolveAgentMode`) and pins `provider='none'` for heuristics before the provider chain.
- `demo_api_server/routes/langchainConfig.js` — `POST /config` only wrote the provider when `am.provider` was truthy, so switching *to* heuristics left the previous LLM provider in the session for `agentRun` to pick up. Now writes `am.provider || null` on every mode change.
- `demo_api_server/server.js` — `/api/conversations` was mounted **without** `authenticateToken`, so `req.user` was always undefined and every ownership-guarded request 401'd (the route's own docstring wrongly claimed it was authenticated). Added the middleware.
- `demo_api_ui/src/hooks/useAgentRun.js`, `demo_api_ui/src/components/AIAgent.js` — thread the selected `mode` through every run path (including HITL resume/cancel), so "Heuristics only" is authoritative and cannot be overridden by a server-wide `AGENT_MODE` pod env.
- `demo_api_ui/src/components/ConversationSummaryPanel.jsx` — latch a 401/403 per page-load so a stale session stops re-firing the summaries request (~10 console 401s in seconds → ask once).
- `demo_api_server/tests/agentRunHeuristicsProvider.test.js` (NEW) — pins that heuristics resolves to `provider='none'` across the body-mode, stale-session, and HITL-resume paths, and that LLM modes still resolve their provider.

**Do not break:** heuristics MUST resolve `provider='none'` — never fall through to `'anthropic'`. `/api/conversations` MUST stay behind `authenticateToken`. (Extracted from PR #405; its agent-hidden/clinical-split third was dropped — PR #527 already shipped that fix more completely.)

**Verify:** `CI=true npx jest tests/agentRunHeuristicsProvider.test.js` (6/6); grep `server.js` for `'/api/conversations', authenticateToken`.

### 2026-07-05 — Agent dock silent-failure when "llama.cpp only" selected but provider down (+ hardening)

**Files changed:**
- `demo_api_ui/src/config/agentModes.js` (NEW) — single source of truth for the four core agent modes (`heuristics`/`llamacpp`/`claude`/`helix_google`) and their provider mapping. Mirrors the server resolver `demo_api_server/services/agentModeResolver.js`. Everything (`CORE_MODE_IDS`, `MODE_PROVIDER`, `PURE_LLM_MODES`, `PURE_LLM_LABELS`, `DEFAULT_MODE`) is derived from one `AGENT_MODES` table.
- `demo_api_ui/src/components/AIAgent.js` — deleted the three drifted local maps (`PURE_LLM_MODES`/`PURE_LLM_LABELS`/`_MODE_PROVIDER_MAP`, which still named the retired `ollama` mode instead of `llamacpp`) and now imports them from the SSOT. Gave the `llamacpp` provider the 60s fetch timeout (was 15s) other local providers get.
- `demo_api_ui/src/components/AgentModeSelector.jsx` — imports `CORE_MODE_IDS`/`MODE_PROVIDER`/`DEFAULT_MODE` from the SSOT; auto-deselects a mode whose provider is unavailable (at load or when it drops) → switches to Heuristics with a `.ams-autoswitch` notice; re-probes llama.cpp health on focus + every 20s (was one-shot on mount).
- `demo_api_ui/src/config/__tests__/agentModes.test.js` (NEW) — internal-consistency + a drift guard that parses the server resolver and asserts the client id→provider mapping equals it.
- `demo_api_ui/src/components/__tests__/AgentModeSelector.test.jsx` — tests for auto-deselect (switches on unavailable) and no-switch-when-available.
- `demo_llm_proxy/install-launchd.sh` (NEW) — installs a per-user LaunchAgent that runs the already-idempotent `start-local-models.sh start` at login + every 5 min (self-heal). Points at the MAIN-checkout script (resolved via `git rev-parse --git-common-dir`) so it survives worktree cleanup.

**What was broken:** with the agent mode set to "llama.cpp only" (id `llamacpp`) and the local llama.cpp backend unreachable, the dock produced NO response. Because `llamacpp` was absent from `PURE_LLM_MODES` (the map still named the long-retired `ollama` mode), the existing "provider selected but not configured — answer with Heuristics instead?" safety prompt never fired, so the failure was silent. A single `<AIAgent>` portals into both the admin and customer docks (shared `_sharedMode` singleton), so both surfaces were affected. Root cause was taxonomy duplicated across three client sites with no test.

**What was fixed / hardened:** one SSOT for the mode taxonomy + a test that fails on client↔server drift; `llamacpp` is now a recognised pure-LLM mode (unreachable llama.cpp shows the explicit ⚠️ "want Heuristics?" prompt); a stuck/dead selected mode auto-switches to Heuristics with a visible notice; health re-probes live so recovery clears "not configured" without a reload; and a LaunchAgent keeps the local tiers alive across reboots.

**Do not break:** `config/agentModes.js` is the ONLY place the mode→provider table lives on the client — do not re-inline it in `AIAgent.js` or `AgentModeSelector.jsx`, and keep it equal to the server resolver's `CORE_MODES` (the drift test enforces this). Heuristics stays the always-available deterministic fallback (provider `null`, `DEFAULT_MODE`). Auto-deselect must only fire for a genuinely unavailable provider and must switch to `heuristics` (never loop). No change to dock mounting, FAB visibility, `liveAccounts`, or float-panel resize.

**Verify:** `cd demo_api_ui && npm run build` (exits 0); `npx vitest run src/config/__tests__/agentModes.test.js src/components/__tests__/AgentModeSelector.test.jsx` (green — 16 tests). With llama.cpp down, "llama.cpp only" auto-switches to Heuristics with the notice; sending a prompt in a pure mode whose provider then dies shows the ⚠️ fallback prompt. LaunchAgent: `launchctl list | grep llama-models`.

### 2026-07-05 — Security/CI hardening: leaked GitHub PAT, unwired two-exchange reconciler, CI gates, test-runner exit codes

**Files changed:**
- `.air/mcp.json` — untracked + gitignored (held a live `gho_` GitHub PAT, committed to history — the token must be revoked at GitHub → Settings → Applications → GitHub CLI). The `github` MCP server entry now resolves the token at launch via `$(gh auth token)`; `.air/mcp.json.example` (secret-free) is the tracked template.
- `.claude/settings.json` — emptied to `{}`; the 38-entry personal allowlist moved to gitignored `settings.local.json` (this is what hygiene Check 3 enforces).
- `demo_api_server/server.js` — `twoExchangeReconciler` is now invoked at startup (it was exported but never called anywhere, so the two-exchange self-healing documented in the 2026-06 hardening never actually ran). Non-fatal; opt out with `TWO_EXCHANGE_RECONCILE_ON_STARTUP=false`.
- `scripts/run-all-tests.sh` — missing python3 / agent `.venv` now skips that suite instead of failing the whole run (matches the comment's stated intent).
- `run-tests.sh` — e2e mode now FAILS when the API server is not reachable on :3001 (was `return 0`, a silent pass that ran nothing).
- `scripts/check-fresh-clone-hygiene.js` — `.mcp.json` lint only runs when the file exists (no root `.mcp.json` exists anywhere, so the script always crashed); removed the check for `.claude/agents/{coverage-checker,dead-code,error-analyzer}.md` — those files were never committed (no git history) and cannot pass.
- `demo_llm_proxy/download-models.sh`, `demo_llm_proxy/start-local-models.sh`, `scripts/export-learning-hub.mjs` — hardcoded `/Users/cmuir/...` paths replaced with `$HOME`/repo-relative equivalents.
- `NEW-MACHINE.md` — subagents row removed (assets never existed); MCP registry row points at `.air/mcp.json.example`.
- `.github/workflows/ci.yml` — NEW: first CI. On PR/push-to-main runs `hygiene:check`, `topology:verify`, and the `demo_api_server` Jest suite.
- `demo_api_server/services/pingOneAuthorizeService.js` — `_normalizeDecision` implemented + exported and wired into `_postDecisionEndpoint` and `_evaluateViaPdp`. PR #162 merged the C1 fail-closed TEST and the entry below, but the service still carried the `raw.decision || raw.status` fail-open read — the first CI run caught the half-landed fix (8 failing tests on main).

**What was broken:** a live GitHub OAuth token (repo/workflow scopes — the active `gh` CLI credential) sat in plaintext in the tracked `.air/mcp.json` and in remote history. The banking-chip self-healing reconciler was dead code, so any PingOne-side grant/scope drift went unrepaired at boot. `hygiene:check` crashed on every run (dead guardrail), no CI existed, and two test runners reported the wrong color (fresh clones red for missing venvs; e2e green without running).

**Do not break:** never put credentials back in `.air/mcp.json` (it is gitignored; the example file is the template). `.claude/settings.json` must stay free of a `permissions` block. Keep the reconciler invocation non-fatal (wrapped in try/catch) so a PingOne outage can never block BFF boot. `run-tests.sh` e2e must keep failing when :3001 is down. CI must keep running `hygiene:check` and `topology:verify` — they are the fresh-clone/drift gates.

**Verify:** `npm run hygiene:check`; `npm run topology:verify`; `bash -n run-tests.sh scripts/run-all-tests.sh`; boot the BFF and check startup logs for `[TwoExchangeReconciler]` (OK / Healed / Skipped).

### 2026-07-05 — P1AZ hardening: decision fail-close, sim/real parity, snapshot tracking, opt-in flag auth

**Files changed:**
- `demo_api_server/services/pingOneAuthorizeService.js` — decision-endpoint + legacy PDP responses normalise fail-closed: read the authz effect from `decision`/`result.decision`/`details.decision` only (never the transport `status`), collapse anything not positively PERMIT to DENY unless an enforceable obligation is present. Previously `raw.decision || raw.status` could turn a live DENY into a PERMIT.
- `demo_api_server/services/simulatedAuthorizeService.js` + `services/scopeTopology.js` — simulated engine now gates no-amount consent/step-up tools by SoT tool name (new `toolDeclaresChallenge`), matching the P1AZ snapshot; amount-threshold behaviour unchanged.
- `demo_authz_server/routes/decision.js` — no-amount step-up tools return STEP_UP (were collapsed into HITL_CONSENT); a HITL receipt no longer discharges a step-up tool; removed the `acr.length > 8` clause that treated any long ACR as MFA.
- `snapshots/gen-authorize-snapshot.js` + `snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json` — now version-controlled (were fully gitignored); `.gitignore` uses `snapshots/*` + negations.
- `demo_api_server/server.js` + `middleware/featureFlagsAuthGate.js` — `/api/admin/feature-flags` gains an OPT-IN auth gate.

**What was broken:** real-P1AZ path could fail open on an unrecognised decision envelope; simulated engine diverged from real policy on no-amount tools; the P1AZ snapshot/generator lived on one machine only.

**What was fixed:** fail-closed decision parsing; sim/mock/snapshot parity on no-amount tools; snapshot+generator tracked; opt-in flag-endpoint auth.

**Do not break:** `/api/admin/feature-flags` stays UNAUTHENTICATED BY DEFAULT — the gate only engages when `FF_ADMIN_REQUIRE_AUTH` is truthy, and even then reads (GET/HEAD) stay open for the header pill. Do not flip the default. The simulated engine's amount thresholds ($250/$500/$2000) are unchanged.

**Verify:** `npm --prefix demo_api_server test -- authorize simulatedAuthorize featureFlagsAuthGate pingOneAuthorizeDecisionNormalize`; `npm --prefix demo_authz_server test`; `npm run topology:verify`.

### 2026-07-04 — Hardening batch 2: outbound timeouts, SSE mid-stream errors, MCP-gateway XSS, crypto fallback, real-.env scope drift

**Files changed:**
- `demo_api_server/services/pingoneManagementService.js` — axios import is now `require('axios').create({ timeout })` (`PINGONE_MGMT_TIMEOUT_MS`, 15s); all ~15 calls inherit it.
- `demo_api_server/services/pingOneAuthorizeService.js` — a `fetchT()` wrapper adds `AbortSignal.timeout` (`PINGONE_AUTHZ_TIMEOUT_MS`, 15s) to all 9 Authorize fetch calls; `fetch` is resolved from `globalThis` at call time so test mocks still apply.
- `demo_api_server/services/aguiSseProxy.js` — request timeout (`AGENT_SSE_TIMEOUT_MS`, 120s) + explicit `agentRes` error handler (pipe doesn't forward source errors) + single-fire guard so a dying agent always yields one RUN_FINISHED.
- `demo_mcp_server/src/server/BankingMCPServer.ts` — HTML-escape the OAuth-callback `error` query param (was a reflected-XSS sink).
- `demo_api_server/services/lmdb/sdkDemoTokenStore.lmdb.js` — throw in production when no `CONFIG_ENCRYPTION_KEY`/`SESSION_SECRET`; warn once in dev (was silently AES-encrypting tokens with an in-source constant).
- `scripts/verify-pinggateway-parity.js` — added a skip-if-absent check of the sibling real `.env` so a drifted `PG_*_SCOPE` (e.g. `server:mcp:invoke`) is caught, not just `.env.example`.

**What was broken:** outbound PingOne calls had no timeout (provider outage → indefinite hang instead of a controlled failure); the AG-UI SSE proxy could hang the browser stream forever if the agent died mid-reply; the MCP OAuth callback reflected a query param into HTML unescaped; SDK demo tokens fell back to an in-source encryption key with no guard; and the PingGateway parity gate never inspected the real `.env` the gateway loads.

**Do not break:** keep the outbound timeouts (a regressed infinite hang is the failure mode). In `pingOneAuthorizeService`, `fetchT` must resolve `globalThis.fetch` at call time — do not capture it at module load or you break the fetch-mocking tests. Keep the OAuth-callback `error` HTML-escaped. `sdkDemoTokenStore` must refuse the fallback key in production.

**Verify:** `npm run topology:verify`; `cd demo_mcp_server && npx tsc --noEmit`; `cd demo_api_server && npx jest src/__tests__/authorize.parity.test.js tests/aguiSseProxy.test.js src/__tests__/transaction-consent-challenge.test.js`

**Note:** requires `express-async-errors` in `demo_api_server/node_modules` (added to package.json in the previous entry's sweep) — run `npm install` in `demo_api_server` after pulling, or server.js load throws MODULE_NOT_FOUND.

### 2026-07-04 — Security/hardening sweep: conversations IDOR, token-in-git, authz/BFF crash-proofing, vacuous scope guard

**Files changed:**
- `demo_api_server/routes/conversations.js` + `server.js` — `/api/conversations` now mounts behind `authenticateToken`; a `router.param('userId')` guard scopes every route to the authenticated subject (admin may access any); POST enforces a role allowlist (`user`/`assistant` only) and string/size validation. Closes an unauthenticated IDOR and a stored-prompt-injection path (history is replayed verbatim into the LLM).
- `demo_api_server/data/store.js` — `getSnapshot()` redacts the captured `Authorization` header from the persisted/exported copy; in-memory logs keep it for the cURL feature.
- `.gitignore` — `demo_api_server/data/runtimeData.json` is now ignored/untracked (was tracked and accumulating bearer JWTs). Seed data stays in the tracked `bootstrapData.json`; `store.js` falls back to it.
- `demo_api_server/server.js` — `require('express-async-errors')` so a rejected async route reaches the error middleware instead of the dev-mode `process.exit(1)` on unhandledRejection.
- `demo_authz_server/index.js` — async wrapper on all routes + generic error middleware (400 bad JSON / 500 else, `headersSent`-guarded) + process-level handlers.
- `demo_authz_server/routes/decision.js` — string coercion at the `.split()`/`.trim()` sites so a non-string body field yields a normal DENY, not a thrown (crashing) request.
- `demo_api_server/src/__tests__/scopeTopology.regression.test.js` — the `/authorize`-covers-grant guard was vacuous after the scope rename (filtered on a `banking:` prefix no scope has); rebuilt to compare every non-`category:feature` granted scope against the base request.

**What was broken:** `/api/conversations` had no auth — any caller could read, wipe, or inject any user's agent history, and injected messages were fed straight into the LLM. `runtimeData.json` was committed with live `Authorization` headers (110 JWTs in HEAD). demo_authz_server had no error middleware or process handlers, so one malformed (numeric) `TokenScopes` body threw in an async handler and terminated the process while leaking a stack trace; the BFF had the same class via ~77 unwrapped async handlers plus a dev-mode hard exit. The scope drift guard silently passed on any drift, which is why offline `topology:verify` was green while live PingOne lacked the `invest:read` User-App grant.

**Do not break:** keep `authenticateToken` on the `/api/conversations` mount and the subject-ownership guard — do not "simplify" it back to an open internal endpoint. The conversations role allowlist must exclude `system`. `getSnapshot()` must keep redacting `authorization` on the persisted copy (never let it write tokens to disk/export). `decision.js` `viaPingGateway` scope acceptance is unchanged and must stay dual-spelling (see the entry below). The scope guard compares non-feature scopes — if you add a new always-on scope to an app grant, add it to the base `/authorize` list too.

**Verify:** `npm run topology:verify`; `cd demo_authz_server && node --test`; `cd demo_api_server && npx jest src/__tests__/scopeTopology.regression.test.js src/__tests__/scope-integration.test.js src/__tests__/scopeEnforcement.test.js`

**Not fixed here (needs live ops / user decision):** grant `invest:read` to the Super Banking User App in the live PingOne env (env `01d89b06` still lacks it; guardrail-blocked surgical script prepared), and scrub the historical tokens from git history.

### 2026-07-04 — Code-review sweep: scope-rename completion, EROFS admin save, side-nav persistence, code-search contracts

**Files changed:**
- `demo_authz_server/routes/decision.js` — `viaPingGateway` accepts `gateway:mcp:invoke` (new Exchange #2 default) AND legacy `pinggateway:invoke`.
- `demo_api_server/services/agentMcpTokenService.js` — Exchange #2 scope read falls back to the legacy `pinggateway_invoke_scope` config key.
- `demo_api_server/services/envReconcile.js` — `gateway_mcp_invoke_scope` added to ENV_AGNOSTIC_KEYS.
- `demo_api_server/services/scopeTopology.js` — memo now invalidates on file mtime change (hot-reload); boot still fails fast, post-boot reload failures keep the last good manifest.
- `docker-compose.yml` — `/repo` directory mount is RW again (was `:ro`): the `/agent-gateway-config` editor saves `scope-topology.json` through it (writeAtomic + `.backups/`, now gitignored). Still a DIRECTORY mount — single-file mounts stay banned.
- `ping-gateway/scripts/groovy/jwks-token-validation.groovy` — unset `PG_INBOUND_SCOPE` now falls back to `gateway:mcp:invoke` (matches BFF default).
- `ping-gateway/scripts/groovy/p1az-decision.groovy` — `parseActClaim` returns only Maps; JSON scalars/arrays no longer crash the decision.
- `demo_api_ui/src/context/SessionTokenContext.js` — single derived `hasActiveToken`; consumed by TopNav, UserMenu, BankingChips (`needsSignIn` no longer prop-drilled from AIAgent).
- `demo_api_ui/src/components/AdminSideNav.jsx` — expansion state reloads when the role/key changes after mount; persist gated on the loaded key (guest→admin no longer clobbers).
- `demo_api_ui/src/components/AdminSideNav.css` + `adminSkinPing2026.css` — nav search box themed via `--sidenav-filter-*` variables; skins override variables only.
- `demo_api_server/src/services/mcpCodeSearchClient.js` + `routes/codeSearch.js` — errors carry `err.status` (503 for outages incl. network errors); routes switch on status, not message text.
- `demo_api_ui/src/pages/CodeSearchPage.jsx` — server codebase list is authoritative (localStorage = offline fallback); uploads use the server-returned `codebase_id`.

**What was broken:** the `pinggateway:invoke → gateway:mcp:invoke` rename never
reached the mock authz server (every PingGateway tool call denied in demo-authz
mode), old config-key overrides were silently dropped, and an unset
`PG_INBOUND_SCOPE` denied everything. The `:ro` repo mount 500'd every admin
scope-topology save. AdminSideNav wrote guest expansion state into the admin
bucket on public routes. Code-search outages surfaced as 500s, and a fresh
upload's invented id never matched the server's, so searching it always failed.

**Do not break:** `viaPingGateway` must accept BOTH scope spellings until the
legacy name is retired everywhere. Keep the `/repo` mount a RW DIRECTORY mount.
`hasActiveToken` in SessionTokenContext is the only token-liveness predicate —
never re-derive it in components. Code-search 503 mapping keys on `err.status`,
never on message substrings.

**Verify:** `cd demo_authz_server && node --test decision.pinggateway-parity.test.js`
(7 pass, incl. both scope spellings); `cd demo_api_server && npx jest codeSearch
mcpCodeSearchClient` (route + client error contracts); `cd demo_api_ui && npx
vitest run src/components/__tests__/adminSideNav.test.jsx` (6 pass) and
`npm run build` exit 0.

### 2026-07-04 — BFF crash-loop from stale single-file bind mount of scope-topology.json

**Files changed:**
- `docker-compose.yml` — replaced the fragile single-file mount `./scope-topology.json:/scope-topology.json` with a read-only DIRECTORY mount of the repo root (`./:/repo:ro`) and set `SCOPE_TOPOLOGY_PATH=/repo/scope-topology.json`.
- `demo_api_server/services/scopeTopology.js` — read `process.env.SCOPE_TOPOLOGY_PATH || <repo-root>/scope-topology.json` (default unchanged when unset).
- `demo_api_server/services/configStore.js` — same `SCOPE_TOPOLOGY_PATH` override for its topology read.
- `.husky/post-merge` — when a merge changes `scope-topology.json`, restart `ai-demo-api-server` so it reloads the SSOT (no-op if Docker/BFF is down).

**What was broken:** `scope-topology.json` was bind-mounted into the BFF as a
single file. Single-file bind mounts are pinned to the host file's inode, so when
a `git merge`/`checkout` (or regen) replaced the file with a new inode, the mount
went stale and the file vanished inside the container. `services/mcpWebSocketClient.js`
calls `scopeTopology.allTools()` at require time with no catch, so the next
`node --watch` restart hit `ENOENT: /scope-topology.json` and crash-looped the
whole BFF (all APIs 502).

**What was fixed:** the topology is now read from a directory-mounted path via
`SCOPE_TOPOLOGY_PATH`; directory mounts re-resolve the file on each open, so host
file replacement no longer breaks the container. A post-merge hook restarts the
BFF when the SSOT content changes so the frozen `MCP_TOOL_SCOPES` reload.

**Do not break:** keep `SCOPE_TOPOLOGY_PATH` pointing at a **directory**-mounted
copy (never re-introduce a single-file `:/scope-topology.json` bind mount). The
env override must default to the repo-root path when unset so host/tests/image
builds are unaffected. Do not change tool→scope mapping in `scopeTopology.js`.

**Verify:** `cd demo_api_server && npx jest scopeTopology` → 67 pass. In Docker,
replace the host `scope-topology.json` with a new-inode copy and confirm
`docker exec ai-demo-api-server node -e 'require("/repo/scope-topology.json")'`
still parses and login stays 200 (would ENOENT under the old single-file mount).

### 2026-06-20 — Block admin tokens from the customer dashboard + always-visible Sign Out / Switch

**Files changed:**
- `demo_api_server/middleware/auth.js` — added `requireNotAdmin` (403 `admin_token_forbidden`) and exported it.
- `demo_api_server/routes/accounts.js` — `GET /my` now runs `requireNotAdmin` after `authenticateToken`.
- `demo_api_server/routes/transactions.js` — `GET /my` now runs `requireNotAdmin` after `authenticateToken`.
- `demo_api_ui/src/utils/authUi.js` — added `switchAuthRole(targetRole)` doing a real sign-out + re-login via `POST /api/auth/switch`.
- `demo_api_ui/src/components/TopNav.js` — moved Sign Out out of the scrolling area into an always-visible `.topnav-session-actions` group; added a Switch button; wired the user menu's switch to the real token switch.
- `demo_api_ui/src/components/TopNav.css` — styles for `.topnav-session-actions` / `.topnav-switch-btn`.
- `demo_api_ui/src/components/AdminBlockedDashboard.js` + `.css` — block screen shown on `/dashboard` for admin tokens.
- `demo_api_ui/src/App.js` — `/dashboard` renders `AdminBlockedDashboard` when `user.role === 'admin'`.

**What was broken:** (1) On narrow/zoomed views the only Sign Out lived inside the
horizontally-scrolling toolbar and scrolled off behind the user-menu badge, so
there appeared to be no way to log out. (2) The menu's "Switch view" only changed
the route while keeping the admin token, and `/dashboard` had no role guard — an
admin token could load the customer dashboard and its `/api/*/my` data.

**What was fixed:** Sign Out + a real role/token Switch are now always visible in
the header. `/dashboard` shows a block screen for admin tokens prompting a switch
to a user token, and `/api/accounts/my` + `/api/transactions/my` return 403 for
admin tokens so the enforcement holds at the API too.

**Do not break:** `requireNotAdmin` must stay on the `/my` endpoints, and the
`/dashboard` admin branch must keep rendering `AdminBlockedDashboard` — these are
the enforcement points. The guard intentionally also 403s the `/webmcp` and
`/mcp-traffic` demo panels (which fetch `/api/accounts/my`) for admin tokens.

**Verify:** Sign in as admin → navigate to `/dashboard` → block screen appears
with "Switch to user token". `curl` `GET /api/accounts/my` with an admin session
returns 403 `admin_token_forbidden`. Sign in as a customer → `/dashboard`
hydrates normally. `cd demo_api_ui && npm run build` exits 0.
