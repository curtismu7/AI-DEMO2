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

---

## §3 — Ports (authoritative from `run.sh`)

| Port | Service | Scheme |
|---|---|---|
| `3001` | Banking API Server (BFF) | `https://api.ping.demo:3001` |
| `4000` | Banking UI (React) — public origin, OAuth callbacks land here | `https://api.ping.demo:4000` |
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

### 2026-07-20 — Generic MCP Inspector (#646): stdio profile RCE + PingOne admin login always 401

**Files changed:**
- `demo_api_server/routes/mcpInspector.js` — `requireAdminSession` (session.user.role)
  on POST/DELETE `/profiles` and on non-default `?profile=` / `body.profile` tools +
  invoke dispatch (was: any signed-in user could create; invoke had no auth at all).
- `demo_api_server/routes/mcpPingOneAdminAuth.js` — same session.user.role gate instead
  of middleware `requireAdmin` (req.user), which is unset on this mount.
- Tests: `mcpInspectorProfiles.test.js`, `mcpPingOneAdminAuth.test.js`.

**What was broken:** #646 let any session POST a `transport:"stdio"` profile
(`command`/`args`/`env`), then GET `/tools?profile=` or POST `/invoke` with that
id spawned the command on the BFF host — and `/invoke` with a profile id skipped
auth entirely (profile UUIDs are listed on unauthenticated GET `/profiles`).
Separately, PingOne admin login used `requireAdmin` → always 401 in the browser
because `/api/mcp/inspector` is not behind `authenticateToken`.

**Do not break:** default banking profile path (no `profile` / `default-banking`)
still allows anonymous local-catalog fallback; MFA gate on default tools/list
unchanged; secrets still never echoed from `listProfiles`/`createProfile`.

**Verify:** `cd demo_api_server && npx jest src/__tests__/mcpInspectorProfiles.test.js src/__tests__/mcpPingOneAdminAuth.test.js`

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
invest-routed tools over WS to mcp-invest exactly like the WS ingress.

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
`MORTGAGE_SERVICE_API_KEY` re-mint + vault sync, and
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
must write to `.codegraph/codegraph.db` as before; the base
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
