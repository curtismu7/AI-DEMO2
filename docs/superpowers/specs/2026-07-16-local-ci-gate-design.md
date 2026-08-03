# Local CI gate — design

**Date:** 2026-07-16
**Status:** implemented
**Related:** issue #524 (authz drift + CI billing), PR #532 (worktree write guard)

## Problem

GitHub Actions is not running. Every job exits in ~3s with **zero steps executed**;
the check-run annotation reads:

> The job was not started because recent account payments have failed or your
> spending limit needs to be increased.

So `API server tests (Jest)` and `Hygiene + topology gates` are not failing —
they are not starting. Every PR is red regardless of the code (#512, #514, #515,
#529 and every PR opened 2026-07-16), which means **no merge has been verified**.

That is not hypothetical. In the same window, `85f2b1e44` silently reverted three
commits (TokenStepIndicator ×3 + the MFA step-up line) with no test or build
failure; it was found by hand and recovered in #516. CI is what should have
caught it.

## Goal

Restore CI's protection at the push boundary, locally, until Actions bills again.
Remove it when CI is green — this is a stand-in, not a permanent fixture.

## Non-goals

- Replacing CI. Local runs cannot gate other people's pushes.
- Scoping checks by changed files. Inference about "what this could affect" is
  unreliable; a UI change can break an API test through shared config.
- Fixing the flaky tests themselves (see Known limitations).

## Design

**Enforcement point:** `.husky/pre-push`, appended after the existing
force-push guard, which is unchanged. Push is the same boundary CI used
(`on: push` + `pull_request`).

**Checks — exact parity with `.github/workflows/ci.yml`:**

| ci.yml job | Step | Local | Time |
|---|---|---|---|
| Hygiene + topology gates | `npm run hygiene:check` | same | ~1s |
| | `npm run regression:paths` | same | ~1s |
| | `npm run topology:verify` | same | ~5s |
| API server tests (Jest) | `npm test --prefix demo_api_server` | same, +retry | ~60s |

**Total ~67s.** Fast enough not to create bypass pressure — which matters, because
`--no-verify` also disables the secret and backup-artifact guards in `pre-commit`.

**Entry points:** `npm run ci:local` (manual) and `.husky/pre-push` (automatic).

**Dependencies:** worktrees get no `node_modules` (every lockfile here is
gitignored). The gate symlinks the main checkout's — instant — and falls back to
`npm install` only if there is nothing to link.

**Escape hatch:** `git push --no-verify`, printed in the failure output so the
bypass is a deliberate, visible choice.

## Two problems found while building this

### 1. `topology:verify` fails locally for a reason CI never sees

`scripts/verify-pinggateway-parity.js` `parseEnv()` took everything after `=`
verbatim, so a quoted value (`PG_OLB_SCOPE="read write mcp:invoke"` — legal in a
`.env`, and what dotenv strips) parsed into tokens `"read` and `mcp:invoke"`,
each reported as an undeclared scope.

It only fires on real `.env` files, which are **gitignored** — so it never
reproduced in CI and only ever broke local runs. Fixed by stripping one matching
pair of surrounding quotes.

Without this fix the gate would fail on every push over a file CI cannot see —
guaranteeing `--no-verify`.

### 2. Jest finds no tests when run from a worktree

`demo_api_server/jest.config.js` ignores `/\.claude/worktrees/` so a main-checkout
run does not walk into agent worktrees. Run *from* a worktree, every test's own
path matches, and jest exits 1 with `No tests found` — a false failure. Worktrees
are mandatory (#532), so the two controls would have fought each other.

Fixed by overriding on the CLI **only when inside a worktree**. The override
*replaces* the array, so `/node_modules/` and `/tests/real/` are re-stated to keep
CI's exclusions and drop only the worktree ones. In the main checkout the config
is left alone, where that exclusion is load-bearing.

## Known limitations

**The suite is flaky locally, ~1-2 failures per 6,004 (~0.03%), a different test
each run.** Observed across five runs: 0 failures (main checkout), then
setupWizard+adminVault, then transactions, then agent/delegate, then two more.
A 16-core box spawns ~15 jest workers that contend with the running Docker stack;
CI's 2-core runner never sees it. `--maxWorkers=50%` did **not** fix it (one green
run was luck — three subsequent runs still flaked).

Mitigated with **retry-once**: on failure, re-run only the failed suites via
`jest --onlyFailures` (~2s). A real break fails both times and blocks; flake passes
on retry and is reported as `[flaky: ...]`. This trades a small chance of masking a
genuinely intermittent bug for not training everyone to bypass the hook. The
underlying flakiness is worth fixing separately.

**Local-only.** It protects this machine. It does nothing for a teammate, or for
an agent that pushes with `--no-verify`.

## Success criteria

- `npm run ci:local` exits 0 on clean `main` — met (67s).
- Runs from a worktree without a false "No tests found" — met.
- `topology:verify` green against a real quoted `.env` — met (exit 0).
- A real test failure blocks the push; flake does not — met (retry confirms).
- Existing force-push guard unchanged — met.

## Removal — DONE 2026-08-02

When Actions runs again, delete the `local CI gate` block from `.husky/pre-push`.
Keep `npm run ci:local` (useful for pre-PR checks) and both bug fixes — the quote
fix and the worktree jest override are correct regardless of CI's state.

Carried out as written. Actions resumed 2026-07-28 and main went green on
2026-08-02 (run 30757733337); the gate block is gone from `.husky/pre-push`, the
force-push guard and `npm run ci:local` both stay. Do not re-add it — one of the
two premises above ("a real test failure blocks the push; flake does not") did
not survive contact: the gate invoked jest at `--maxWorkers=50%`, above the
`maxWorkers: 2` that `demo_api_server/jest.config.js` sets under CI *because*
higher counts flake the supertest suites, so it blocked pushes on suites that
pass in isolation. It also ran on `git push --delete`, so deleting a merged
branch meant sitting through the full suite and then being refused.
