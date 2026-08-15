# RESUME HERE — act claim nested-object → array migration (paused 2026-08-12)

Planning done, zero code changed yet. Worktree + plan both exist, nothing committed.

## State
- Worktree: `act-claim-array-migration`, branch `worktree-act-claim-array-migration`.
- Plan file (uncommitted, untracked): `docs/superpowers/plans/2026-08-12-act-claim-array-migration.md`
  — 12 tasks + Task 2f addendum, full TDD steps, code blocks, exact file:line refs.
- No implementation started. `git status` in the worktree shows only the plan file as `??`.

## Decisions already locked in (don't re-litigate)
- Array shape: **ordered, all hops**, index 0 = oldest delegate, last index = current actor.
  Rejected "array holds only the newest actor" (would discard delegation history).
- Scope: **full stack** — demo_api_server (BFF) + demo_mcp_gateway (TS, real agent-traffic
  path) + demo_authz_server (mock P1AZ parity engine) + demo_api_ui (React).
- PingOne's own SpEL mint (`pingoneProvisionService.js:3328-3329`) stays **nested, untouched**.
  No array-construction precedent exists in this repo's SpEL and the live-tenant risk of
  getting it wrong was judged too high — normalize in code at every decode boundary instead.
- `may_act` claim and `xaaIdJagDemo.js`'s unrelated `act:{iss}` are explicitly **out of scope**.

## NEXT: execute the plan
**Plan file:** `docs/superpowers/plans/2026-08-12-act-claim-array-migration.md`
- Task 1 first (shared `normalizeActChain` in `demo_api_server/utils/tokenUtils.js`) —
  everything in demo_api_server depends on it.
- Task 9 (TS gateway) and Task 7 (mock authz mint) are independent of demo_api_server —
  can run in parallel with Tasks 1-8.
- Task 10 (UI) can be written in parallel too but needs live integration verification
  (Task 10a Step 6) only after the backend tasks are actually deployed.
- Ask user: subagent-driven-development vs inline executing-plans (was asked at end of
  planning session, not yet answered).

## Watch out
- Several plan steps say "check the existing test file first" / "confirm exact line" instead
  of asserting byte-exact current content — those are real verification gates (plan built
  from direct reads + one research agent's quotes across ~50 files), not placeholders. Do them.
- Task 5's `reconstructDelegationChain` fix changes behavior for chains >2 hops deep (was
  silently capped at 1 intermediate node before). Its Step 4 greps for callers assuming a
  fixed chain-array position — don't skip that grep.
- `TokenChainDisplay.jsx` (Task 10a) will render **silently blank**, not throw, if the array
  fix is missed there — it won't fail CI. Manual live-app check is mandatory (Task 10a Step 6).

## Standing rules
- Worktree required for all edits (root CLAUDE.md) — this worktree already exists, reuse it.
- Verify per-subsystem before claiming done: demo_api_server jest, demo_mcp_gateway
  `npm run build && npm test`, demo_authz_server jest, demo_api_ui `test:unit && build`,
  root `npm run topology:verify`.
- Stage explicitly, never `git add -A` (root CLAUDE.md worktree rule).
