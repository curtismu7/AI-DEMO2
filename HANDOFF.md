# Handoff — Runtime Audit Sweep (round 4 findings logged, none fixed yet)

Continuation notes for picking this up in a fresh agent session. Delete this
file once the current round is merged and there's nothing left to hand off.

**2026-08-23 update: Round 3 (#40-56) is fully FIXED, merged (PR #2297,
squash commit `34eb4fc8`), and deployed live.** Round 4 audit just ran (same
6-finder-agent + adversarial-verify Workflow, told about all 52 files rounds
1-3 touched) and found **10 new findings, #57-66, all still OPEN** — logged
in `docs/RUNTIME_AUDIT_FINDINGS.md` and committed
(`ec076fbdb`, pushed to `worktree-fix-hidden-errors-sweep`). **Nothing in
round 4 is fixed yet** — that's the next work, following the exact
per-finding rhythm below (adjust the finding-number range to #57-66 and the
file paths to the ones listed in the "What's left" section, which now
describes round 4 instead of round 3).

Round-4 finding categories: Runtime (#57-61 — worker-token cache race,
lighthouse audit-guard race, drag-listener leak, 2 stale-response races),
Swallowed (#62-64 — ID-JAG route with no error handling, consent-decline
fail-open, logout catch swallowing failure), Perf (#65-66 — configStore
rebuilding a 230-entry map per call, use-case launcher unmemoized on every
keystroke). Full detail for each is in `docs/RUNTIME_AUDIT_FINDINGS.md`'s
"## Round 4 findings" section — read each one's section before starting.

## What this is

A recurring "audit → fix → merge → deploy → audit again" loop over
`demo_api_server` + `demo_api_ui`, tracked in **`docs/RUNTIME_AUDIT_FINDINGS.md`**
(the single source of truth — read it before doing anything else). Each
round runs the same 6-finder-agent + adversarial-verify-per-candidate
Workflow (see the script pattern at the bottom of this doc if you need to
run round 5), then fixes every finding one at a time with fail-before/pass-
after test proof, docs updates, and a commit per finding.

- **Round 1** (#1–27): fixed, merged via PR #2278.
- **Round 2** (#28–39): fixed, merged via PR #2294.
- **Round 3** (#40–56): fixed, merged via PR #2297, deployed live.
- **Round 4** (#57–66): **all still OPEN — this is the current work.**

## Where things stand right now

- Branch: `worktree-fix-hidden-errors-sweep`, worktree at this path (same branch reused across rounds — squash-merging round 3 did not delete it).
- Round 4's findings are logged and pushed (commit `ec076fbdb`) to `origin/worktree-fix-hidden-errors-sweep`. Nothing in round 4 is fixed yet.
- **No PR open yet for round 4.** Don't open one until all of #57–66 are fixed (matches the round-1/2/3 rhythm — one PR per fully-fixed round), unless the user asks to push a partial batch.
- `docs/RUNTIME_AUDIT_FINDINGS.md` has full detail (issue, trigger, fix, evidence) for every finding #1–66. #57–66 currently read "OPEN" with a "Fix (not yet applied)" note each — that note already states the intended fix.

## What's left — findings #57–66

Read each one's full section in `docs/RUNTIME_AUDIT_FINDINGS.md` before starting; the summaries below are just a map.

**Runtime (2, demo_api_server):**
- **#57** `services/pingOneAuthorizeService.js:252` — worker-token single-flight cache has no credKey check, so a credential rotation mid-flight can hand a caller a token minted with stale creds.
- **#58** `services/lighthouseService.js:82` — the "single audit in progress" guard clears on the outer timeout race settling, not on the real Chrome process actually finishing teardown; a retry can launch a second Chrome instance concurrently.

**Runtime (3, demo_api_ui):**
- **#59** `pages/PrivilegeMcpClientPage.jsx:172` — sidebar/terminal drag listeners leak on `document` if `mouseup` fires outside the page (mouse released over taskbar/another window/iframe).
- **#60** `components/AgentGatewayLogPanel.jsx:44` — overlapping log fetches (filter change + 4s autoRefresh) have no request sequencing; a stale response can overwrite a fresh one.
- **#61** `components/NewRelicDashboard.jsx:70` — same stale-response race on rapid time-window changes (24h then 1h).

**Swallowed errors (1, demo_api_server):**
- **#62** `routes/enterpriseIdp.js:40` — the ID-JAG token-mint route has zero try/catch; an internal throw (e.g. malformed `ENTERPRISE_IDP_SIGNING_KEY_PEM`) hangs the request or hard-crashes the process (no `express-async-errors` wired in despite being a listed dependency).

**Swallowed errors (2, demo_api_ui):**
- **#63** `services/agentAccessConsent.js:5` — the high-value-transaction consent-decline gate fails open (`return false`, same as "never declined") when `localStorage.getItem` throws.
- **#64** `services/logout.js:21` — the logout button's fetch-failure catch navigates to `/` exactly like success, so the BFF session cookie can be left uncleared with no indication to the user.

**Performance (1, demo_api_server):**
- **#65** `services/configStore.js:1074` — `getEffective()` rebuilds a ~230-entry, ~360-line alias-map object literal from scratch on every call (~204 call sites project-wide); hoist it to module scope.

**Performance (1, demo_api_ui):**
- **#66** `pages/UseCaseLauncherPage.js:925` — ~8 unmemoized filter/map derivations (including an O(k·n) lookup) over the full use-case catalog re-run on every search keystroke; the file doesn't import `useMemo` at all.

None of #57–66 look architecturally tricky like #41 (hitlCredit race) was — should be straightforward fixes following the exact same rhythm as everything already done in #1–56.

## The per-finding rhythm (repeat for each of #57–66)

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

After #66 is done: push, open a PR titled something like "fix: round-4 runtime audit — N more bugs found", then follow the merge procedure below.

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

## Re-running the audit again (round 5, if asked)

The Workflow script pattern is identical each round — 6 finder agents (Runtime/Swallowed-errors/Perf × demo_api_server/demo_api_ui), a `pipeline()` over those 6, each finder's candidate findings fanned out to one adversarial verifier per candidate (not per finder) that defaults to REJECTED unless it can open the file and confirm the exact line/behavior. The round-4 script (used for this exact pattern, findings #57–66) is saved at:
`/Users/cmuir/.claude/projects/-Users-cmuir-Development-AI-DEMO2--claude-worktrees-fix-hidden-errors-sweep/7666cbb7-249b-41b6-bcfb-d9b3cfbf0950/workflows/scripts/runtime-audit-round-4-wf_56cfc233-d88.js`
— copy it, update the `ALREADY_AUDITED_FILES` list (add every file touched by round 4 — currently 52 + the 10 files round 4 will touch once fixed, so ~62), update the finding-number range in the prompts (start at #67), rename to `runtime-audit-round-5`.

## Key memory entries relevant to this work

Two memories were written this session and are worth reading if anything here doesn't match reality:
- `project-npx-jest-wrong-runtime-demo-api-server` — the `npx jest` hazard above.
- (Also see the pre-existing `project-npx-fetches-wrong-vitest-in-worktree` — the analogous UI-side hazard, already known before this session.)
