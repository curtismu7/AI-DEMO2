# Regression Plan — Super Banking demo

Canonical do-not-break contract for the Super Banking demo. The
`regression-guard` skill (`.claude/skills/regression-guard/`) is the discipline
layer that points here; `CLAUDE.md` also points here. This file is the source of
truth — if the skill and this file disagree, this file wins.

---

## §0 — UI style rules (hard)

- **Emoji rule (project-wide):** the only emojis allowed in skills, commands,
  code, and UI text are `⚠️` (warning), `✅` (green check), `❌` (red X),
  `🔐` (security/lock — HITL trigger chips), `✕` (close / dismiss), and `✓`
  (check / confirm). Everything else is plain text or CSS icons / semantic HTML.
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
| Demo Controls diagnose | `ThresholdControls.js` — `data.checks?.userAttribute?.pass` shape |
| AI Agent FAB (`banking-agent-fab` classes) | `components/AIAgent.js`, `App.js` |
| Float panel resize | `AIAgent.js` resize caps (`MAX_W`/`MAX_H` = 95% viewport, `MIN_W`/`MIN_H` = 280/220; drag itself intentionally unclamped for second-monitor use), `AIAgent.css` float-root/panel rules |
| Agent mode taxonomy SSOT | `demo_api_ui/src/config/agentModes.js` — one client mode→provider table; must equal server `services/agentModeResolver.js` (guarded by `config/__tests__/agentModes.test.js`); don't re-inline in `AIAgent.js`/`AgentModeSelector.jsx` |
| OAuth redirect origin | `routes/oauth*.js` — no `localhost` hardcodes |
| Clinical split dashboard (`ff_agent_clinical_split`) | `demo_api_ui/src/components/agent-clinical/` — `AgentClinicalHost.jsx` owns tab state + 1/2/3/4 keyboard; `TalkPane.jsx` hosts the inline agent (auto-open, `setClinicalSplit`) + `TokenAuditTimeline` (live `TokenChainContext` events); `InspectPane.jsx` wraps `ActivityLogPanel`; `TokensPane.jsx` embeds `UnifiedTokenFlowInspector`; `ConfigurePane.jsx` wraps `AuthorizeRulesPanel` + read-only runtime card. Legacy dashboard with the flag OFF must stay unchanged |

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

`api.ping.demo` is the canonical local host (HTTPS via `mkcert`). Code must not
hardcode `localhost:3001` / `localhost:4000` in OAuth callbacks — read the
configured host.

---

## §4 — Bug Fix Log

Reverse-chronological, newest first.

### 2026-07-11 — "Skipped" steps re-rendered as "Not in path" (bypass rail + checklist cross-out)

**Files changed:** `demo_api_ui/src/components/TokenChainDisplay.js` (+`.css`),
`ComplianceModalContent.js` + `ComplianceModal.css`,
`__tests__/TokenChainDisplay.haltedAt.test.js`.

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
surfaces via `isHaltedAt`/`failed`, never as "Not in path"; downstream bucket
consumers (`SimpleStepperPanel`, `TokenAuditTimeline`, history rollup) key on
active/exchanged/failed only and treat `notinpath` as neutral, same as
`skipped` before.

**Verify:** vitest `TokenChainDisplay.haltedAt` (bucket assertions included),
`SimpleStepperPanel`; UI build gate.

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
