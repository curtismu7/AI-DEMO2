# AI-DEMO2 Code Review — Major Components

Design/maintainability review (2026-08-16) across the 5 highest-value components: `demo_api_server` (BFF), `demo_mcp_gateway`, `demo_authz_server` (PDP), `demo_api_ui`, `demo_hitl_service` + `ping-gateway`. This is a **review-quality** pass (architecture, consistency, drift, test gaps) — distinct from the 52-bug correctness audit (see BUGS.md). All paths relative to repo root; read-only, nothing changed.

> Note on freshness: reviewers read the synced `main` checkout. A few UI JWT-decode findings may name files this session already patched via merged PRs (#1827/#1839/#1840) — the *structural* point (no shared helper, fix-per-instance left duplication) holds regardless of whether a given instance is currently patched. Verify current line state before acting.

## Cross-cutting themes (the real story)

### 1. God files — decomposition is the top maintainability debt
| File | Size | Issue |
|---|---|---|
| `demo_api_ui/src/components/AIAgent.js` | **11,200-line single function** (`BankingAgent`) | 89 `useState`, 73 `useEffect`, 40 `useRef`, 28 ref-mirrors, 20 exhaustive-deps suppressions. Ref-mirroring is a direct symptom of stale-closure pressure. |
| `demo_api_server/server.js` | 2,808 lines | 171 `app.use` + 33 inline endpoints incl. session-critical auth (`/reauth`, `/logout`, `/clear-session`) that REGRESSION_PLAN §1 protects but lives outside `routes/`. |
| `demo_api_server/services/agentMcpTokenService.js` | 2,752 lines | Only 28 functions → huge bodies. |
| `demo_api_server/services/pingoneProvisionService.js` | 3,896 lines | Largest file, ~1 adjacent spec. |
| `demo_authz_server/routes/decision.js` | 760-line `decisionHandler` | ~25 rules inlined as sequential blocks; not independently testable. |
| `demo_api_ui/.../UnifiedConfigurationPage.tsx` | 3,728 lines | — |

**Recommendation:** AIAgent.js decomposition has *started* (`agentFormatters`/`agentResultPanels` already extracted + re-exported for tests) — the 30 test files hit that re-export surface, so further extraction along those seams is low-risk. Proven next seams: a `useStepUpFlow` hook (OTP/FIDO/HITL handlers), per-vertical result mapping → `src/vertical/`, float-panel drag/resize → hook. For `decision.js`, extract each rule to `(params, ctx) => verdict|null` in an ordered array (also fixes theme 5).

### 2. Duplication / drift-by-prose (highest-risk for silent divergence)
- **HITL receipt-binding logic has 4 hand-maintained copies**, despite `receiptVerification.js:4` claiming to be "the authoritative copy." Ports exist in `demo_mcp_gateway/src/hitlClient.ts:132`, `demo_api_server/services/hitlServiceClient.js:140`, and `transactionInvariants.js:189` — same literal messages, same `HITL_BIND_ACCOUNT_KEYS`. Only the Groovy consumer actually calls `/verify`; the two highest-traffic callers each carry their own port. **This is the single most dangerous drift risk found.**
- **JWT decode has 6 independent copies** across the UI (`tokenInspector.js`, `Dashboard.js`, `UserDashboard.js`, `UserDashboardPing2026.js`, `TokenInspectModal.jsx`, `education/TokenExchangePanel.js`) — the base64url-safety bug class was fixed per-instance, not by extracting one helper. Two copies (`UserDashboard`/`Ping2026`) are `eslint-disable no-unused-vars` dead code.
- **Groovy ↔ Node parity asserted by comments, not tests.** `ping-gateway/README.md:19` says `p1az-decision.groovy` builds "the SAME 18-key payload" as Node's `buildAuthorizeParameters` — nothing verifies it. Same for `NNP8_TIER_POLICY` (`decision.js:88`: "must be identical" — no test pins it, unlike `MCP_DECISION_CONTEXTS` which is).
- `VERTICAL_TOOL_MAP` (`authz rules.js:20`) hand-duplicates `config/verticals/` with no drift guard.

**Recommendation:** For each duplicated body, either collapse to one shared module callers import, or (where a network hop makes that impossible, e.g. Groovy) add a cross-file/golden-fixture test asserting the copies agree. This turns "documented parity" into "enforced parity."

### 3. ~2,945 lines of untested security-critical Groovy
`ping-gateway/scripts/groovy/` does HMAC intent-token verification, RS256/HS256 signature checks, worker-token refresh, step-up decisions — with **zero test harness**. `p1az-decision.groovy` alone is 1,208 lines. Not unit-testable in place (no mock `Request`/`globals`/`contexts`). Single biggest maintainability risk in that directory. **Recommendation:** minimal Groovy/Spock harness stubbing IG bindings, cover at least fail-closed branches + signature comparison. Also catches the parity drift in theme 2.

### 4. Fragmented cross-cutting infrastructure (pick one, lint the rest)
- **Logging:** `utils/logger.js` (+ redaction) exists but only 15/251 service files use it; **107 files log via `console.*`** (206 raw calls). Redaction only protects the minority path.
- **Config:** `configStore.js` (2,280 lines) vs **205 direct `process.env` reads in 165 files** (memory already records env-vs-runtime drift bites).
- **HTTP clients (UI):** 4 coexisting patterns — `apiClient` (110 files, the standard, with traffic capture + session-expiry toast), `bffAxios` (79), raw `fetch` (~197 sites), raw `axios` (22 legacy). Raw-fetch sites bypass inspector capture and session-expiry handling.
- **`normalizeAxiosError`** mandated by CLAUDE.md, adopted in 16 files; 149 catch blocks still return `error: err.message` (the documented token-leak anti-pattern).

**Recommendation:** the repo already proves lint gates work (the session-expired toast rule). Add `no-console`, `no-restricted-imports` (freeze raw fetch/axios), and a grep gate for `err.message` responses — codemod incrementally. Docs alone haven't moved these.

### 5. Fail-open posture is scattered, not auditable
Fail-open is per-gate and env-toggleable (`tokenIntrospection.js:58` `INTROSPECTION_FAIL_OPEN`, `agentRestrictionsGate.js` legacy mode) plus 22 empty catch blocks in the BFF. Each is individually documented, but there's **no single table of gate → default posture** — and memory shows one gate ("LLM-path approval") already shipped open. **Recommendation:** a posture table in REGRESSION_PLAN, or a startup log line printing effective gate modes.

### 6. Docs-vs-reality drift
- UI `CLAUDE.md` says "plain JS/JSX — no TypeScript sources" but **10+ `.tsx` files exist** (incl. the 3,728-line `UnifiedConfigurationPage.tsx`) + a `tsconfig.json`.
- PDP `/rules` display (`rules.js`) shows only 6 of ~25 rules, mislabels HITL-on-empty-amount (false since NNP-6), and still exposes the `hitlThresholdUsd` knob whose old `getHitlThreshold()` display path was left behind when enforcement moved to a new override getter.
- Stale header comments in `decision.js:44-50` contradict the actual Rule 2/Rule 4 behavior below them.

## Per-component strengths (worth preserving)
- **PDP:** parity is a first-class concern — per-rule parity comments + 4 dedicated parity tests pinning cloud/pinggateway/import/topology.
- **ping-gateway:** constant-time comparison (`MessageDigest.isEqual`) used consistently for *every* secret/signature check; fail-closed vs fail-open is deliberate and documented. A lint rule forbidding `==`/`.equals` on secret bytes would lock it in.
- **HITL:** challenge state machine (`create/get/resolve/consume`) is cleanly centralized in the store.
- **BFF:** gate family (`requireSession/requireAdmin/requireScopes/requireNotAdmin`) is well-designed; error shape is near-uniform `{ error }`.
- **Overall:** 435 BFF test files + 30 AIAgent test files — strong raw coverage, just skewed.

## Residual thread-safety (not covered by the #40/#41 fixes)
`p1az-decision.groovy` writes `globals._p1azTokenCache` **unsynchronized** at `:119`, `:167`, `:889` — the 401-refresh path (`:889` clear-then-refetch) is a check-then-act race. Benign today (torn cache just refetches) but inconsistent with the `synchronized(globals)` discipline now applied in `uc18-rate-limit.groovy` and `jwks-token-validation.groovy`. Standardize on one helper.

## Suggested priority order
1. Add cross-file/golden tests pinning the 4 HITL-receipt copies and the Groovy↔Node 18-key payload (cheap, stops the most dangerous drift).
2. Extract one shared `decodeJwt()` helper; delete the 6 UI copies + 2 dead ones.
3. Stand up a minimal Groovy test harness for fail-closed + signature paths.
4. Lint-gate logging/HTTP-client/error-shape fragmentation; codemod incrementally.
5. Continue AIAgent.js and decision.js decomposition along the seams already proven safe.
6. Doc reconciliation pass (TS policy, /rules display, stale decision.js header, fail-open posture table).
