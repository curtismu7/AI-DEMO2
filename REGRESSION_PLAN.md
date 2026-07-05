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
