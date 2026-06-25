# Code Maturity Assessment — AI-Demo

**Framework:** Trail of Bits Code Maturity Evaluation v0.1.0, **adapted to a web/services stack**.
**Scope:** whole repo, high-level. **Date:** 2026-06-16 · **Reconciled:** 2026-06-17 (see Addendum — the balance-race CRITICAL has since been fixed).
**Platform:** Node.js BFF (`demo_api_server`) + React UI (`demo_api_ui`) + MCP gateway (`demo_mcp_gateway`) + MCP server (`demo_mcp_server`) + mock authz (`demo_authz_server`) + pluggable agent runtimes, PingOne OAuth/Authorize.

> **Context:** This is an intentional **security teaching demo**, not a production system. Several "unsafe" patterns are deliberate and guarded for production. Findings are rated honestly against the framework, with a note where a finding is teaching-intent vs. genuine technical debt. The Trail of Bits framework is contract-oriented; on-chain-only categories are reinterpreted for web/services or marked N/A.

---

## Executive Summary

**Overall maturity: Moderate — 2.38 / 4** (8 rated categories; Decentralization N/A). *(Was 2.25; Concurrency raised 1 -> 2 after the balance-race fix — see Addendum.)*

**Top 3 strengths**

1. **Documentation (Strong / 4)** — `docs/ARCHITECTURE-TRUTHS.md` invariants, `CHANGELOG` / `FEATURES.md` / `REGRESSION_LOG.md` / `REGRESSION_PLAN.md`, 163 files in `docs/`, 38 skills, RFC 8693/9728 compliance reports.
2. **Authentication / Access Control (Satisfactory / 3)** — fail-closed audience validation, scope enforcement, RFC 8693 delegation (`act`/`may_act`), MCP-gateway authz delegated to PingOne Authorize, dedicated authz tests.
3. **Testing & Verification (Satisfactory / 3)** — ~1,100 tests, 86 regression files + active regression log, 23 live-PingOne tests, 4-shard CI with SoT-drift gate.

**Top 3 gaps**

1. **Complexity (Weak / 1)** — `demo_api_ui/src/components/AIAgent.js` is **9,873 lines** (god-component), `AIAgent.css` 5,811; 155 flat services with overlapping token/logging services.
2. **Testing baseline is red on `main` (undermines CI gating)** — ~7 known-failing tests (`PINGONE_JWKS_URI` configStore env-coverage and others) force routine commits to bypass the pre-commit hook. *(Surfaced in the 2026-06-17 reconciliation; replaces the now-fixed balance-race gap.)*
3. **Low-level / Unsafe (Moderate / 2)** — `innerHTML` interpolation + wildcard `postMessage('*')` in `HistoryModal.js`; `rejectUnauthorized:false` in ~15 files, several without a production guard.

---

## Maturity Scorecard

| # | Category (adapted) | Rating | Score | Key evidence |
|---|---|---|---|---|
| 1 | Arithmetic / numeric correctness | Moderate | 2 | Entry rounding `Math.round(amt*100)/100` + bounds (`demo_api_server/routes/transactions.js:408-437`); balance updates not re-rounded, float compares, no accumulation tests |
| 2 | Auditing / logging / monitoring | Moderate | 2 | `utils/logger.js` (`StructuredLogger`), `services/auditLogService.js`, `middleware/delegationAuditLogger.js`, token-chain UI; no incident runbooks, correlation ID not propagated cross-service, no SIEM sink, not tamper-evident |
| 3 | Authentication / access control | Satisfactory | 3 | `middleware/auth.js` (audience fail-closed, scopes, `requireDelegation`), `demo_mcp_gateway/dist/pingAuthorizeGuard.js`, authz tests; weak: admin role trusted from session, `may_act` optional, no central route-gate registry |
| 4 | Complexity management | **Weak** | 1 | 9,873-line `AIAgent.js`; multiple 2k–3.9k-line files; 155 flat `services/`, duplicate token/logging services |
| 5 | Decentralization (on-chain) | N/A | — | Single-operator demo; analog (vault/configStore secret centralization) handled adequately |
| 6 | Documentation | **Strong** | 4 | `ARCHITECTURE-TRUTHS` (T-1…T-13), CHANGELOG 100+ entries w/ paths, REGRESSION_PLAN (~97 rows), 38 skills, compliance audits |
| 7 | Txn ordering / concurrency | Moderate | 2 | Balance race FIXED — atomic `dataStore.applyTransfer` (`data/store.js:449`, used at `routes/transactions.js:640`) + `tests/applyTransfer.concurrency.test.js`; remaining: no idempotency/replay on writes, session/config last-write-wins |
| 8 | Low-level / unsafe patterns | Moderate | 2 | No eval/raw-SQL; risky: `HistoryModal.js:186` innerHTML + `postMessage('*')`, 15× `rejectUnauthorized:false`; security-bypass env vars guarded in prod |
| 9 | Testing & verification | Satisfactory | 3 | ~1,100 tests, 86 regression + log, 23 live tests, 4-shard CI; weak: no coverage gate, no property/fuzz/load tests, flaky integration suites |

---

## Detailed Analysis

### 3. Authentication / Access Control — Satisfactory (3)

The spine of the project. BFF token custody; RFC 8693 chain with `act`/`may_act` enforcement (`demo_authz_server/routes/decision.js:287`); gateway delegating decisions to PingOne Authorize with fail-closed defaults (`pingAuthorizeGuard.js:22-26`); mock-authz parity contract. Held below Strong by: admin role inferred from `azp`/session without per-request re-verification (`middleware/auth.js:802-811`), `may_act` enforcement being a toggle, and no single registry of which routes carry which gate (some demo routes like `routes/apiCallTracker.js` are ungated by design).

### 4. Complexity Management — Weak (1)

Layering (`middleware`/`routes`/`services`/`config`) and the vertical-plugin system are good; topology is documented. But `AIAgent.js` (9,873 lines, ~133 functions) is a maintenance hazard, and the flat 155-file `services/` namespace has unclear boundaries (`agentMcpTokenService` vs `agentTokenService` vs `agentTokenCache` vs `agentCCTokenService`; five separate logging services). Any single Weak criterion caps the category.

### 7. Transaction Ordering / Concurrency — Moderate (2) *(was Weak; fixed 2026-06-17)*

The balance read-modify-write race is now resolved: `dataStore.applyTransfer(from, to, amount)` (`data/store.js:449`) performs the existence + sufficient-funds check and BOTH balance mutations in a single synchronous critical section (no `await` between check and write), called from `routes/transactions.js:640`; `tests/applyTransfer.concurrency.test.js` asserts exactly one of two concurrent full-balance debits succeeds and the balance never goes negative.
**Remaining gaps:** no idempotency/replay protection on write tool calls or transfers (a replayed `POST` double-applies); `configStore.setRaw` and session writes are still last-write-wins; the `LmdbSessionStore` double-callback hazard persists. These keep the category at Moderate rather than Satisfactory.

### 6. Documentation — Strong (4)

The standout. Architecture invariants, a maintained regression log tied to test files, per-feature "touchpoints," and compliance reports exceed the typical bar. Minor drift only: stale `README (2).md` copies, lingering SQLite references where it's now LMDB, no 5-minute user quickstart.

*(Categories 1, 2, 8, 9 summarized in the scorecard; full evidence in the assessment session transcript.)*

---

## Improvement Roadmap

### CRITICAL (do first if productionizing)

- ~~**Guard the balance race**~~ **DONE (2026-06-17)** — `dataStore.applyTransfer` atomic critical section + `applyTransfer.concurrency.test.js`. See Addendum.
- **Green the test baseline on `main`** — fix or `xfail` the ~7 known failures (`PINGONE_JWKS_URI` configStore env-coverage and friends). A red baseline makes CI gating meaningless and forces commits to bypass the pre-commit hook. *(Effort: S)*
- **Gate `rejectUnauthorized:false` behind an explicit non-prod check** in all ~15 sites; fail-fast in production like `SKIP_TOKEN_SIGNATURE_VALIDATION` already does. *(Effort: S)*

### HIGH (1–2 months)

- **Decompose `AIAgent.js`** (9,873 → focused modules) and split the parallel `AIAgent.css`. *(Effort: L)*
- **Escape `HistoryModal.js` interpolation** and replace `postMessage('*')` with a specific origin. *(Effort: S)*
- **Propagate correlation IDs** through gateway + authz-server; route failed-delegation/authz-deny events to the audit sink with structured fields. *(Effort: M)*
- **Add a coverage threshold gate** in CI (fail under target). *(Effort: S)*

### MEDIUM (2–4 months)

- **Sub-group `services/`** (`tokens/`, `agents/`, `logging/`) and consolidate duplicate token/logging services. *(Effort: M)*
- **Harden money math** — store cents as integers (or re-round after balance mutations) + accumulation tests. *(Effort: M)*
- **Add incident-response runbooks** (`docs/incident-response/`) and a central route→gate registry for auth auditability. *(Effort: M)*
- **Doc hygiene** — remove stale `README (*)` copies, fix SQLite→LMDB references, add a QUICKSTART. *(Effort: S)*

---

## Method Notes

- **Decentralization** marked **N/A** (on-chain-only); its analog — secret/config centralization — is handled via vault + configStore.
- Off-chain processes (incident response, SIEM, monitoring) were assessed from artifacts only. If runbooks or a log backend exist outside the repo, the Auditing rating moves up.

---

## Addendum — 2026-06-17 reconciliation

A second independent pass re-ran the framework against current `main` (`46f671ce`). It agreed with the 2026-06-16 ratings on every category except Concurrency, and surfaced a few items worth recording:

**Corrected (now stale in the original):**
- **Balance race — FIXED.** `dataStore.applyTransfer` (`data/store.js:449`) is an atomic check-then-mutate critical section, called from `routes/transactions.js:640`, with `tests/applyTransfer.concurrency.test.js` as the regression guard. Concurrency raised Weak (1) -> Moderate (2); overall 2.25 -> 2.38.

**Additional findings (not in the original):**
- **Red test baseline on `main` (new CRITICAL).** ~7 known-failing tests (`PINGONE_JWKS_URI` configStore env-coverage among them) mean CI either does not gate or is routinely bypassed (`--no-verify`). This is now the top productionizing blocker after the balance-race fix.
- **Money as floats.** Balances are floats with cent-rounding (`Math.round(x*100)/100`, `data/store.js:456-460`) rather than integer cents — a known anti-pattern, mitigated but not eliminated. (HIGH: store cents as integers.)
- **`X-Authz-Simulated` is client-influenceable.** The new PingOne Agent Gateway picks its authorize backend (mock vs real) from a request header the BFF stamps; a request reaching the gateway directly on its host port could spoof it. Documented as a demo-acceptable trust boundary in `ping-gateway/scripts/groovy/p1az-decision.groovy` and `ping-gateway/README.md`. (Auth: acceptable for the demo; strip at the edge in production.)
- **No idempotency on writes.** Transfers/write tool calls are atomic but not replay-safe (a re-submitted request double-applies). (HIGH.)

**Operational note (Category 5 angle):** the original marks Decentralization N/A; the operational-robustness analogue is genuinely Moderate — fault-tolerant session store, PingOne->simulated authorize failover, an at-the-IdP kill switch, 29 feature flags, an encrypted vault, and config migration export/import are real strengths, offset by the BFF + LMDB config store being un-redundant single points of failure with no fault-tolerant wrapper on config reads.
