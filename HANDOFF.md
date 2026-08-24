# Handoff — Runtime Audit Sweep (round 3 — all findings fixed, PR pending)

Continuation notes for picking this up in a fresh agent session. Delete this
file once round 3 is merged and there's nothing left to hand off.

**2026-08-23 update: #46–56 are now all FIXED and committed** (3 commits:
#46-48, #49-52, #53-56). Round 3 (#40-56) is fully complete. What's left is
just the push + PR + merge procedure below — no more fixes to write.

## What this is

A recurring "audit → fix → merge → deploy → audit again" loop over
`demo_api_server` + `demo_api_ui`, tracked in **`docs/RUNTIME_AUDIT_FINDINGS.md`**
(the single source of truth — read it before doing anything else). Each
round runs the same 6-finder-agent + per-category adversarial-verify
Workflow (see the script pattern at the bottom of this doc if you need to
run round 4), then fixes every finding one at a time with fail-before/pass-
after test proof, docs updates, and a commit per finding.

- **Round 1** (#1–27): fixed, merged via PR #2278.
- **Round 2** (#28–39): fixed, merged via PR #2294.
- **Round 3** (#40–56): **#40–45 FIXED and committed. #46–56 still OPEN — this is the current work.**

## Where things stand right now

- Branch: `worktree-fix-hidden-errors-sweep`, worktree at this path.
- All work through #45 is committed **and pushed** to `origin/worktree-fix-hidden-errors-sweep`.
- **No PR open yet for round 3.** Don't open one until all of #46–56 are fixed (matches the round-1/round-2 rhythm — one PR per fully-fixed round), unless the user asks to push a partial batch.
- `docs/RUNTIME_AUDIT_FINDINGS.md` has full detail (issue, trigger, fix, evidence) for every finding #1–56. #46–56 currently read "OPEN" with a "Fix (not yet applied)" note each — that note already states the intended fix.

## What's left — findings #46–56

Read each one's full section in `docs/RUNTIME_AUDIT_FINDINGS.md` before starting; the summaries below are just a map.

**Swallowed errors (3, demo_api_server):**
- **#46** `routes/mcpGatewayConfig.js:483` — persist failure still reports `ok:true`.
- **#47** `routes/agentConsentRoute.js:22` — no try/catch at all; a Redis failure hangs the request forever (unhandledRejection).
- **#48** `services/groupPolicy.js:49` — manifest-resolution error collapses to the same `null` as "no groups configured," fails open for non-banking verticals.

**Swallowed errors (4, demo_api_ui):**
- **#49** `components/Users.js:115` — `updateAgentRestrictions` catch is bare `console.error`, no `notifyError`.
- **#50** `components/ActivityLogs.js:124` — `exportLogs`/`clearOldLogs` catches are bare `console.error`.
- **#51** `components/ThemeZonePanel.js:33` — `persist()` never checks `response.ok`, reports success on a rejected save.
- **#52** `pages/ResourceServerJourneyPage.jsx:258` — `on401` swallows every error, not just 401s.

**Performance (3, demo_api_server):**
- **#53** `middleware/activityLogger.js:105` — computes a response-body capture, then discards it (`logEntry.responseBody` hardcoded `null`). Likely just delete the dead block.
- **#54** `services/tokenValidationService.js:146` — re-derives PEM from JWK on every call despite a 10-min JWKS cache.
- **#55** `services/agentScopes.js:71` — N `fs.statSync` calls (one per tool) instead of one manifest load.

**Performance (1, demo_api_ui):**
- **#56** `components/UserDashboard.js:2517` — recent-transactions sort/group re-runs on every render, unmemoized. Same pattern duplicated in `UserDashboardPing2026.js:~2662` — fix both.

None of #46–56 looked architecturally tricky like #41 (hitlCredit race) was — should be straightforward fixes following the exact same rhythm as everything already done in #1–45.

## The per-finding rhythm (repeat for each of #46–56)

1. Read the finding's full section in `docs/RUNTIME_AUDIT_FINDINGS.md`.
2. Read the actual file/lines named — the doc's "Fix (not yet applied)" note is a starting hypothesis, verify against current code (may have shifted slightly).
3. Implement the minimal fix.
4. Find or write a test:
   - Check for an existing test file first; extend it if the file/behavior is already covered.
   - If none exists, write one following the nearest sibling test file's mocking conventions in the same directory.
   - **Prove it**: `cp <file> /tmp/<file>.fixed`, swap in `git show HEAD:<repo-relative-path> > <file>`, run the new test (must fail), `cp /tmp/<file>.fixed <file>` back, run again (must pass). This is the standing convention for every fix in this sweep — don't skip it.
5. Run scoped tests for the touched area (see "Test commands" below).
6. If the change touches shared/security-sensitive code (session, auth, config store) run the full suite too.
7. Update `docs/RUNTIME_AUDIT_FINDINGS.md` **in the same commit**: flip the finding's heading and summary-table row to `FIXED`, replace "Fix (not yet applied)" with "Fix:" describing what actually happened, add an "Evidence:" paragraph with the verification commands/results, add a Changelog bullet at the top of the `## Changelog` section (reverse-chronological).
8. `git add` the touched files + docs (never `git add -A` — `demo_api_server/data/*` gets jest-regenerated on every server test run; `git checkout -- demo_api_server/data/` and `git clean -f demo_api_server/data/step-verification/` before any merge/diff review if it shows up dirty).
9. Commit with a detailed message (root cause, fix, evidence with exact commands+results) ending in `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

After #56 is done: push, open a PR titled something like "fix: round-3 runtime audit — N more bugs found", then follow the merge procedure below.

## Test commands (hazards baked in — read this before running anything)

**demo_api_server — do NOT use `npx jest`.** It resolves a stale globally-cached jest-runtime from `~/.npm/_npx/` in this worktree that mis-transforms ESM deps (`jose`, `@a2a-js/sdk`) and produces false failures (or in one case, an actual process crash). Use the local binary directly, from inside `demo_api_server/`:
```bash
cd demo_api_server
CI=true ./node_modules/.bin/jest <test paths> --forceExit --maxWorkers=4
```
For a full-suite run (only when warranted — shared middleware, >3 route files, or a scoped run came back red):
```bash
CI=true ./node_modules/.bin/jest --forceExit --maxWorkers=4
```
A handful of suites (`mfaDevices.route.test.js`, `scope-integration.test.js`, `oauth-scope-integration.test.js`, etc.) flake under full-suite parallel load with timeouts/ECONNRESET — always re-run any failure in isolation before treating it as a regression; every one so far this session has passed 100% alone.

**demo_api_ui:**
```bash
npm --prefix <absolute-path-to-this-worktree>/demo_api_ui run test:unit -- <pattern>
npm --prefix <absolute-path-to-this-worktree>/demo_api_ui run build   # gate, not optional after any UI change
```

## Merge procedure (repeat after all of #46–56 are done)

Every PR in this sweep so far has hit the same two things — expect them again:

1. **CI does not reliably auto-trigger** on push/PR-open in this repo. Before trusting any "green," manually dispatch and watch it against the actual branch tip:
   ```bash
   gh workflow run ci.yml --ref worktree-fix-hidden-errors-sweep
   gh run watch <run-id> --exit-status
   gh run view <run-id> --json status,conclusion,headSha,jobs
   ```
   Confirm `headSha` matches `git rev-parse HEAD` before merging.

2. **The PR will very likely show `mergeable: CONFLICTING`** against `main` by the time you're ready to merge (other sessions land other PRs continuously). Resolve locally:
   ```bash
   git fetch origin main
   git checkout -- demo_api_server/data/ 2>/dev/null; git clean -f demo_api_server/data/step-verification/ 2>/dev/null
   git merge --no-commit --no-ff origin/main
   ```
   Conflicts have so far always been in `TECH_DEBT.md` and `docs/RUNTIME_AUDIT_FINDINGS.md` (both reverse-chronological append-only docs — resolve by keeping both sides' content, in order, with no data loss; HEAD's side is usually the more complete one). Then:
   ```bash
   git add TECH_DEBT.md docs/RUNTIME_AUDIT_FINDINGS.md   # plus anything else that conflicted
   git commit --no-edit
   git push origin worktree-fix-hidden-errors-sweep
   ```
   Re-run the CI dispatch+watch above against the new merge commit before merging — don't reuse the pre-merge result.

3. Merge: `gh pr merge <number> --squash`.

4. **After merge:** the shared main checkout needs syncing and the live Docker stack needs a targeted redeploy (this repo's demo is a running stack that bind-mounts the main checkout). From inside the worktree (use `EnterWorktree` with `path` set to this worktree if a `cd` into the main checkout ever leaves your session's cwd stuck there — it happens if you ever run a bare `cd /main/checkout && <cmd>`):
   ```bash
   npm run serve:worktree     # confirm no other session is being served from a worktree first
   bash scripts/deploy-live.sh --dry-run
   bash scripts/deploy-live.sh
   ```

## Re-running the audit again (round 4, if asked)

The Workflow script pattern is identical each round — 6 finder agents (Runtime/Swallowed-errors/Perf × demo_api_server/demo_api_ui), each followed by one adversarial verifier per finder that defaults every candidate to REJECTED unless it can open the file and confirm the exact line/behavior. The `ALREADY_AUDITED_FILES` list passed into each finder's prompt needs updating to include every file touched by rounds 1–3 (currently ~50 files) so finders don't just re-report already-fixed patterns. The exact script used for rounds 2 and 3 is in this conversation's history — copy it, update the file list and finding-number range in the prompts, rename to `runtime-audit-round-4`.

## Key memory entries relevant to this work

Two memories were written this session and are worth reading if anything here doesn't match reality:
- `project-npx-jest-wrong-runtime-demo-api-server` — the `npx jest` hazard above.
- (Also see the pre-existing `project-npx-fetches-wrong-vitest-in-worktree` — the analogous UI-side hazard, already known before this session.)
