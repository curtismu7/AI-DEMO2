# CI Revival — Final Status (2026-09-27, evening)

Continuation chain:
`2026-09-26-ci-revival-test-debt-handoff.md` → `2026-09-27-ci-green-status.md` → this file.

## Done

### PR #345 merged into main ✅
Merge commit `901a023fb`. All three fixes are on main:

1. **Root allowlist** (`scripts/root-allowlist.txt`) — 6 new tracked top-level
   session/plan files registered; gate passes (143 entries).
2. **UI theming ratchets** (`demo_api_ui/src/components/__tests__/themingRatchet.test.js`)
   — pins bumped to radius 2627 / shadow 501 / ground-without-ink 504.
3. **AIAgent.pendingClaim test** — updated for 7342504cc send-not-strand:
   - Second `vi.advanceTimersByTimeAsync(1000)`: the 8s deadline tick triggers
     an effect re-run that React flushes *after* the fake clock stops, and
     that re-run arms the 250ms send debounce.
   - `vi.mock` of `cachedStatusService` so `getCachedStatus` delegates to
     `fetch`, bypassing the module-level 10s TTL cache that sibling tests'
     fetch mocks poison.

### Broader revival outcome
- ~120 pre-existing BFF Jest failures fixed (12,557 passing locally, 0 real
  failures) — suite list in the 09-26 handoff.
- Real production bug fixed: TDZ in `demo_api_server/services/mcpToolPipeline.js`
  (`routingConfig` used at ~311, declared at ~1002) → 502 on every
  gateway-routed MCP call.
- 20+ PRs merged across the revival (#325–#341, #345–#350).

## Open (what is left)

### 1. Main CI has never completed a run un-cancelled ❌
CI runs on main keep ending `cancelled` with zero executed steps —
`ci.yml` has `concurrency: cancel-in-progress: true` (group
`ci-${{ github.ref }}`) and parallel sessions keep queuing PR runs on the
single self-hosted runner. Not a code failure; do not read `cancelled` as red.
**Close-out:** pick a quiet moment, rerun/dispatch CI on main, cancel stale
sibling runs, `gh run watch <id> --exit-status` to the end.

### 2. Known red classes on main, no fix yet
- **Python agent suites**: `mkdir: /Users/runner: Permission denied` from
  `actions/setup-python@v7` on the self-hosted macOS runner. Fix at workflow
  level (`AGENT_TOOLSDIRECTORY` / `RUNNER_TEMP`) or pre-create the dir.
- **UI Vitest flake**: `createCitationResolver` 30s-timeout network-guard
  failure, intermittent.
- **Full UI suite stall**: `npm run test:unit` hangs at end (stray vitest
  workers); use targeted file runs.

### 3. Housekeeping
- Worktree `.claude/worktrees/ci-green-followups` (branch
  `fix/ci-green-followups`) is fully merged and can be pruned.
- Untracked at repo root: `MASTER-TODO-2026-09-26.md`,
  `HANDOFF-A2A-PF-FM3-2026-09-27.md`, two `scripts/pingfederate/provision-a2a-*`
  scripts, `demo_api_server/data/persistent/config.db-lock`.

## Environment facts (recap, load-bearing)
- Single self-hosted runner `cmuir-dev-mac` serializes everything.
- Node 22 for Jest: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`.
- Commits only from a git worktree (`.husky/pre-commit` blocks main checkout).
- Step-verification ledger re-stamps 600+ files after ~15 days —
  `git checkout -- demo_api_server/data/step-verification`; never commit it.
- OrbStack for Docker, never Docker Desktop.
- BFF loopback test flakes (`transactions.crud`, `clientRegistration`) pass in
  isolation.

## Bottom line
Engineering work is done: CI-triggering config fixed, test debt paid, fixes
merged to main. Between here and a green check on main: get one CI run to
complete un-cancelled (operational coordination, not code), then the two known
red classes (Python runner env, citation flake) if a fully green matrix is
desired.
