# CI Revival — Status Handoff (2026-09-27)

Continuation of `docs/sessions/2026-09-26-ci-revival-test-debt-handoff.md`.

## Done

### Test debt (carried over from 09-26, now finished)
- Fixed the last failing UI test: `demo_api_ui/src/components/__tests__/AIAgent.pendingClaim.test.jsx`
  "when the vertical manifest never resolves" — updated for the 7342504cc
  send-not-strand behavior. Two root causes found and fixed:
  1. **Fake-timer race**: the 8s deadline tick fires at ~8s; the effect re-run
     it triggers is flushed by React *after* `advanceTimersByTimeAsync` stops
     the clock, and that re-run is what arms the 250ms send debounce. Fix:
     a second `vi.advanceTimersByTimeAsync(1000)` after the first.
  2. **Module-level TTL cache poisoning**: `cachedStatusService.getCachedStatus`
     keeps a 10s module cache that sibling tests' fetch mocks poison. Fix:
     `vi.mock` the service so `getCachedStatus` delegates straight to `fetch`.
- Local verification: 7/7 pendingClaim + 7/7 themingRatchet pass; `npm run build` OK.

### CI-gate fixes committed and pushed (PR #345, branch `fix/ci-green-followups`)
Commit `314a89b89` contains all three fixes:
1. `scripts/root-allowlist.txt` — 6 new tracked top-level session/plan files
   registered; `node scripts/check-root-allowlist.js` passes (143 entries).
2. `demo_api_ui/src/components/__tests__/themingRatchet.test.js` — pins bumped
   to radius 2627 / shadow 501 / ground-without-ink 504 (raised by #330/#332).
3. The pendingClaim test fix above.

PR: https://github.com/cmuir_pingcorp/AI-DEMO2/pull/345 — merged at
2026-09-27 03:08:52 UTC as `901a023fb`.

## Live GitHub status (2026-09-27, checked 09:38 UTC)

- [PR #345](https://github.com/cmuir_pingcorp/AI-DEMO2/pull/345) merged at
  03:08:52 UTC as `901a023fb`. Its CI run [36289001000](https://github.com/cmuir_pingcorp/AI-DEMO2/actions/runs/36289001000)
  was cancelled before any job steps ran. GitHub displays its required checks
  as failed because they did not complete; this run proves neither a test
  failure nor a pass.
- The latest main CI run was the manual dispatch [36293366101](https://github.com/cmuir_pingcorp/AI-DEMO2/actions/runs/36293366101)
  on that same SHA. It ended `cancelled` at 09:12:56 UTC. Suite selection
  succeeded; the hygiene/topology, Python, and UI jobs reported failure, while
  the API and service-suite jobs were cancelled. The affected jobs did not
  reach their test steps: checkout failed, remained in progress, or was
  cancelled. GitHub did not provide the failed job log through `gh run
  view --log-failed`, so the root cause is not established. There were no
  successful runs among the 50 most recent main CI runs queried.
- At the queue check, CI runs for PR #344 ([36309024047](https://github.com/cmuir_pingcorp/AI-DEMO2/actions/runs/36309024047))
  and PR #349 ([36290911714](https://github.com/cmuir_pingcorp/AI-DEMO2/actions/runs/36290911714))
  were queued. The earlier PR #342 run 36291186614 had since been cancelled.
  Do not start another main dispatch while those runs are waiting on the
  single self-hosted runner.
- The separate [main image build](https://github.com/cmuir_pingcorp/AI-DEMO2/actions/runs/36290565588)
  failed in `actions/checkout`; downstream image-matrix steps were skipped.
  Earlier image build 36289172542 succeeded. Image builds are not the CI test
  workflow.
- The scheduled [live-canary run 36299867341](https://github.com/cmuir_pingcorp/AI-DEMO2/actions/runs/36299867341)
  failed in the UC1 canary. It is a separate signal from the unit/integration
  CI workflow.

The hygiene path fix (`8839ef3e7`) and writable Python tool-cache settings are
present in main, but the latest CI run did not verify them: its checkout/test
steps did not complete. The workflow still uses `cancel-in-progress: true`.
The earlier `createCitationResolver` timeout and Vitest worker hang were not
re-tested by these runs.

## Environment facts that keep biting
- Single self-hosted runner `cmuir-dev-mac` serializes jobs.
- Node 22 is required for Jest: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`.
- Commits must come from a git worktree; `.husky/pre-commit` blocks main-checkout commits.
- Step-verification ledger runs can restamp hundreds of files after about 15 days; discard only that generated churn after a test run.
- OrbStack is the Docker runtime; do not use Docker Desktop.

## Next steps
1. Let the queued PR #344 and #349 CI runs finish before dispatching main CI.
2. If either run reaches the same checkout failure, inspect the self-hosted runner and action logs before changing test code; the current evidence does not identify a test regression.
3. Once the queue clears, dispatch main CI and watch the full run. Record the first completed, non-cancelled result and its required-check outcomes.
4. Mark CI green only after every required check passes. Track image-build and live-canary outcomes separately from the CI test workflow.
5. Update `MASTER-TODO-2026-09-26.md` and the 09-26 handoff links only if their current entries still point to unfinished work.
