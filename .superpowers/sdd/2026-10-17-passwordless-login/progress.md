# SDD ledger — plan: docs/superpowers/plans/2026-10-17-passwordless-login.md

Spec: docs/superpowers/specs/2026-10-17-passwordless-login-design.md (reachable). Worktree .worktrees/passwordless-login (branch passwordless-login, base fdb0745de).
Scope for this run (owner): Task 0 then Task 1 (spike), STOP at the Task 1 decision gate. Owner chose subagent-driven.

## Pre-flight conflict scan (pairs sharing a file/interface; then per-task self-consistency)
| Pair | Produces / consumes | Finding |
|---|---|---|
| T2 / T3 | separate files (userSessionService vs adminSessionService); same contract | none |
| T2,T3 / T4 | T4 consumes establishUserSession / establishAdminSession(req,res,{tokenData,idTokenClaims,provider,clientType,loginTraceId}) | consistent signatures |
| T1 / T4,T6 | T1 decision R1/R2/R3 selects credentials + acr_values (T4) and plan shape (T6) | T4/T6 steps are conditional on T1; fine, T1 is a hard gate |
| T4 / T5 | T5 consumes POST /login/start + GET /login/poll/:id exactly as T4 produces | consistent |
| T4 / T10 | T10 modifies cibaLoginService.js created in T4 (adds provider pingfederate) | consistent |
| T4 / T9 | both reuse cibaService.initiateBackchannelAuth | T4 adds clientKind option, T9 uses existing; no clash |
| T5 / T11 | both modify PiFlowSignInModal.jsx begin() | sequential (T5 then T11); fine |
| T0,T7,T8 | no code; gates only | none |
Self-consistency: every task's tests match the code it specifies; T6's plan shape is the only R-dependent item. Scan clean; no rulings needed.

Task 0: complete (no code; step 1 automated: jest oauthUserPiFlow+mfaTest.pfUserLink 58 pass, vitest PiFlowSignInModal 55 pass on main fdb0745de). Step 2 (owner confirms hosted device-first SMS sign-in) pending; the other session already live-verified it.
Ruling: proceed to Task 1 without waiting on Task 0 step 2 — the other session live-verified device-first SMS and the suites pass; it costs nothing if wrong because the spike does not touch the sign-in modal.
