# 2026-07-17 — Triage: other open PRs (1+ day old)

Assessed 16 open PRs not authored in this session, to decide what should merge to
`main`. All red GitHub CI checks on these PRs are the known billing-block
(#524) — 2-4s runs, 0 real steps — and are not meaningful signal either way.

Check a box once the PR is actually closed/merged/fixed; leave unchecked while
still open. Re-run `gh pr view <n>` before acting — main moves fast in this repo.

## Close — already merged elsewhere, no-op or worse if merged

- [ ] **#484** — fix: resolve bugs #6-#10 (precision, timing, signals, shutdown, debug)
  Every fix already landed on main via separate direct commits (same bot,
  verified byte-identical across all 5 files). Close with a comment, no merge.

- [ ] **#489** — fix(mfa): harden MFA — cache TTL, FIDO2 retry, rate limit, store warning
  Identical commit already on main (`7015745af`, same author/message/diff).
  Close with a comment, no merge.

- [ ] **#493** — fix: resolve bugs #41-#50 (auth, logging, retry, CORS, timeouts)
  Byte-identical to already-merged `9acedbddf`. Close with a comment, no merge.

## Needs rebase — real unmerged work, but stale or conflicting

- [ ] **#384** — Add commitment-grounding guardrail across all 3 AI agents
  Real feature, not on main yet. 441 commits behind, real conflicts in
  `AIAgent.js`/`Dockerfile`/`attackSimulatorService.js`. Local tests were green
  (langchain 34/34, openai 30/30, pydantic 35/35, UI 7/7) before going stale.
  Greptile flagged a tool-result pairing bug in `pydantic_agent/src/run_handler.py`
  — re-verify after rebase.
  Test: `https://api.ping.demo:4000` → AI Agent chat → ask it to do something it
  can't complete, check for a `grounding_correction` bubble instead of an
  overclaim. Also the AI Attacks showcase page for the 4 chip fixes.

- [ ] **#405** — fix: heuristics never calls an LLM; agent no longer hidden; /api/conversations authenticated
  2 of 3 fixes still needed on main (`agentRun.js` never reads `agent_mode`;
  `/api/conversations` mounted without `authenticateToken`). 3rd fix (clinical-split
  visibility) is now redundant — already fixed independently via PR #527. 317
  commits behind; needs rebase to drop the redundant hunk.
  Test: `https://api.ping.demo:4000/dashboard` → set mode picker to **Heuristics
  only** → confirm no LLM call fires (network tab, no outbound call to :8090);
  separately hit `GET /api/conversations` and confirm it 401s without a session.

- [ ] **#416** — fix(ui): keep session tokens so Simple Stepper does not go blank
  Fix still needed on main, but conflicts with a same-bug fix main landed
  independently a day later (in `setupTests.js`, different implementation).
  Test: wherever the "Simple Stepper" token-preview UI renders (agent flow /
  onboarding flow) — reload mid-session and confirm it falls back to the
  login-session token preview instead of going blank.

- [ ] **#488** — fix: resolve bugs #11-#20 (memory, security, correctness)
  138 commits behind with real conflicts, AND the fix itself has a bug
  (compares `issued_at` instead of `revoked_at` in `clientCredentialsTokenService.js`,
  collapsing a 5-min grace window to zero). Fix that bug too before merging.
  Test: no single URL — backend-only conditions (memory cleanup, path
  traversal input, OTP bypass gating, JWKS enforcement). Needs targeted
  requests, not browser navigation.

- [ ] **#492** — fix(ui): resolve stale closures and lint violations in MFA components
  135 commits behind with conflicts, and Greptile caught the fix as incomplete
  (`handleDelete`/`handleRename` in `SecurityCenter.js` have the identical
  unguarded pattern the PR set out to fix, left unaddressed).
  Test: `https://api.ping.demo:4000` → Security Center → trigger a FIDO2
  step-up modal, then navigate away mid-flow to check for stale-closure
  console warnings.

- [ ] **#495** — fix(ui): resolve 10 UI bugs — leaks, closures, hardening
  130 commits behind with conflicts, AND a self-verified genuine syntax error
  in `apiClient.js` — dangling code after an early `return` inside
  `refreshToken` that would crash the app on load. Fix that before anything else.
  Test: don't test yet — the app likely fails to build/load at all on this branch.

## Needs human review — mergeable, unverified, or has an open concern

- [ ] **#404** — Phase 1-3: Multi-user safety, restart resilience, and horizontal scaling
  Title is stale/misleading (diff is only 4 UI files wiring `TokenStepIndicator`
  in). Greptile flagged a real overflow bug: `HitlSequenceDiagram.js` renders 51
  step-circles in a 280px panel via non-compact mode.
  Test: wherever `HitlSequenceDiagram`/`AgentOnboardingFlowDiagram`/
  `AgentOnboardingSubwayPage` render (onboarding/demo-guide flow) — check the
  HITL panel doesn't overflow horizontally.

- [ ] **#457** — Simplify Compliance toggle to open checklist modal
  Clean small diff (2 files, net negative), no conflicts, but zero review and
  zero verification evidence despite an explicit unchecked test plan in the body.
  Test: `https://api.ping.demo:4000` → AI Agent panel → toggle **Compliance** →
  confirm it opens the 12-step checklist modal directly, and closing it syncs
  state on reload.

- [ ] **#464** — fix(agent): stop process-global vertical from stealing heuristics
  Real multi-tenant bug, still live on main (confirmed `nlIntentParser.js` still
  calls process-global `activeId()`). But its own new test setup silently
  weakens 2 existing test files' coverage (they now always get `null` ctx).
  Test: not reproducible on a single-vertical local stack — needs a shared
  multi-session cluster (e.g. SE AWS) with one session on manufacturing and
  another on banking; confirm banking's "My accounts" doesn't return a
  manufacturing catalog.

- [ ] **#482** — docs(agents): Cursor Cloud dev environment setup notes (draft)
  Content is complete and low-risk (docs-only addition to `AGENTS.md`), just
  145 commits stale and still marked draft. No test URL — verify by reading
  the new section.

- [ ] **#483** — fix: resolve top 5 bugs across auth, HITL, and agent services
  Looks correct on inspection (missing `extractClientCredentials` middleware,
  HITL `requireSecret` fail-closed default, dead-code dup handler, session-save
  race, agent max-iterations silent-empty-success) but touches protected
  auth/HITL surfaces with zero verification evidence in the body.
  Test: `POST https://api.ping.demo:3001/token` with client credentials (was
  crashing pre-fix); HITL transfer consent flow for the `requireSecret`
  fail-closed check.

- [ ] **#491** — fix: resolve bugs #31-#40 (DoS, XSS, leaks, timeouts)
  9 of 10 fixes look correct and are still needed (not superseded). Bug #33's
  fix (`rejectAllPendingElicitations()`) is defined but never wired into the WS
  `close`/`error` handlers — that leak is still live at runtime.
  Test: no single URL — MCP server hardening (body-size cap, WS origin check,
  rate limiter, session cleanup). Needs direct requests against the MCP
  server, not a UI page.

- [ ] **#505** — fix(ui): friendly 502 error page when BFF is down
  Additive, low-risk (416 new lines, 0 deletions), mergeable with no
  conflicts. Greptile found a real timer-cleanup bug: `startAutoRetry()` gets
  cancelled by React's effect cleanup before the 10s auto-poll ever runs.
  Test: `https://api.ping.demo:4000` with the BFF stopped/scaled to 0 — should
  show the static 502 page pre-load, and the `ServiceUnavailableOverlay`
  mid-session (though the auto-retry itself is likely broken per Greptile).
