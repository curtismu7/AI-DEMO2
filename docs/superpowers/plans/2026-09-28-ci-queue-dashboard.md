# Local CI Queue Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local read-only dashboard that shows this repository's GitHub Actions runs and job queue using the machine's existing `gh` login.

**Architecture:** A standalone Node HTTP server binds to loopback, calls the GitHub CLI with fixed `gh api` GET arguments, normalizes bounded run/job data, and serves static HTML/CSS/JavaScript. The browser polls one local read-only endpoint every 15 seconds; GitHub credentials remain inside the CLI and never reach the server response or page.

**Tech Stack:** Node.js >= 22, built-in `http`, `child_process.spawn`, browser HTML/CSS/JavaScript, and Node's built-in `node:test`; no added dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-ci-queue-dashboard-design.md`

## Global Constraints

- The tool is local and read-only; do not add run cancel/retry/dispatch controls.
- The server binds only to `127.0.0.1`, does not enable CORS, and accepts only its local host/origin.
- Reuse authentication through `gh`; never call `gh auth token`, read CLI credential files, or send credentials/raw CLI output to the page.
- Spawn `gh` with fixed argument arrays and `shell: false`; validate repo slugs and run IDs before constructing API paths.
- Poll every 15 seconds and bound history/request concurrency; include active runs before completed history.
- Preserve the project emoji allowlist; use plain text and CSS status markers.
- Keep changes to `scripts/ci-queue-dashboard/`, root `package.json`, and a concise usage document within the new tool.

---

## File Structure

- `scripts/ci-queue-dashboard/github.js` — repo identity validation, fixed GitHub CLI GET calls, bounded run selection, response normalization, and queue/history ordering.
- `scripts/ci-queue-dashboard/server.js` — loopback HTTP server, static asset serving, JSON endpoint, safe errors, and startup/shutdown behavior.
- `scripts/ci-queue-dashboard/index.html` — accessible page structure and summary/run/job containers.
- `scripts/ci-queue-dashboard/dashboard.css` — responsive, high-contrast status and queue layout.
- `scripts/ci-queue-dashboard/dashboard-model.js` — pure run-state grouping shared by the browser and Node tests.
- `scripts/ci-queue-dashboard/dashboard.js` — fetch/poll loop, timestamp formatting, safe DOM rendering, and loading/stale/error/empty states.
- `scripts/ci-queue-dashboard/github.test.js` — normalization, bounded selection, queue ordering, and CLI error tests using injected command results.
- `scripts/ci-queue-dashboard/dashboard-model.test.js` — asserts running and queued runs stay in separate visual groups.
- `scripts/ci-queue-dashboard/server.test.js` — endpoint, loopback/origin, static route, and sanitized failure tests using injected snapshot data.
- `scripts/ci-queue-dashboard/README.md` — prerequisites, startup, `gh` login, local-only behavior, and troubleshooting.
- `package.json` — add `ci:dashboard` and focused `test:ci-dashboard` scripts.

## Task 1: Normalize and bound GitHub run/job data

**Files:**
- Create: `scripts/ci-queue-dashboard/github.js`
- Test: `scripts/ci-queue-dashboard/github.test.js`

**Interfaces:**
- `normalizeRun(run)` returns `{ id, workflow, title, branch, event, status, conclusion, createdAt, startedAt, updatedAt, completedAt, url }`.
- `normalizeJob(job)` returns `{ id, name, status, conclusion, startedAt, completedAt, runnerName, runnerGroup, labels }`.
- `buildSnapshot({ repository, queuedRuns, runningRuns, completedRuns, jobsByRun, now })` returns `{ repository, updatedAt, summary, runs }`. It puts queued work oldest-first, then in-progress work, then the newest five completed runs; it computes summary counts from only the returned window and retains each run's jobs.
- `createGitHubReader({ repoRoot, spawn })` returns `getSnapshot()` and injects the process launcher for isolated tests.

- [x] **Step 1: Write failing tests for the output contract.** Use fixtures shaped like the GitHub Actions workflow-runs and jobs REST responses. Assert normalized IDs/statuses/timestamps/runner labels, oldest-first queued order, active-run inclusion, five-run completed history bound, and summary counts.

```js
test('buildSnapshot puts queued runs oldest-first and bounds completed history', () => {
  const snapshot = buildSnapshot({
    repository: 'cmuir_pingcorp/AI-DEMO2',
    queuedRuns: [run(12, '2026-09-28T10:02:00Z'), run(11, '2026-09-28T10:01:00Z')],
    runningRuns: [runningRun(20)],
    completedRuns: Array.from({ length: 7 }, (_, i) => completedRun(30 + i)),
    jobsByRun: {},
    now: new Date('2026-09-28T10:03:00Z'),
  });
  assert.deepEqual(snapshot.runs.slice(0, 3).map((item) => item.id), [11, 12, 20]);
  assert.equal(snapshot.runs.filter((item) => item.status === 'completed').length, 5);
});
```

- [x] **Step 2: Run the focused tests and confirm they fail because the module is missing.**

Run: `node --test scripts/ci-queue-dashboard/github.test.js`

Expected: module-load failure for the not-yet-created `github.js`.

- [x] **Step 3: Implement normalization and pure snapshot assembly.** Keep source GitHub field names inside `github.js`; renderers consume only the normalized response contract above. Treat absent runner fields and `null` timestamps as unassigned/not started.

- [x] **Step 4: Add the fixed-argument CLI reader.** Resolve repository identity once with `gh repo view --json nameWithOwner --jq .nameWithOwner`, validate `owner/repo`, paginate `queued`, `waiting`, `pending`, `requested`, and `in_progress` runs until each response is shorter than 100, request the five newest completed runs, and fetch jobs for selected runs with a concurrency limit of five. Paginate each selected job list as well. Use `spawn('gh', args, { cwd: repoRoot, shell: false })`; apply a 15-second command timeout and enforce an output-size cap by counting stdout/stderr bytes in the child-process handlers. Cache completed-run job data while those runs remain in the history window; refresh active-run jobs on each snapshot. Do not retain or expose stderr/stdout on failed commands.

- [x] **Step 5: Test GitHub CLI failures and pass the focused suite.** Inject fake spawn results for missing executable, unauthenticated/API failure, malformed JSON, and successful requests. Assert the public error is sanitized and no raw output is included.

Run: `node --test scripts/ci-queue-dashboard/github.test.js`

Expected: all normalization, ordering, bounds, and failure tests pass.

- [x] **Step 6: Commit the data adapter.**

```bash
git add scripts/ci-queue-dashboard/github.js scripts/ci-queue-dashboard/github.test.js
git commit -m "feat: add GitHub Actions queue data reader"
```

## Task 2: Serve the local read-only dashboard endpoint

**Files:**
- Create: `scripts/ci-queue-dashboard/server.js`
- Test: `scripts/ci-queue-dashboard/server.test.js`

**Interfaces:**
- `createDashboardServer({ getSnapshot, host = '127.0.0.1', port = 0 })` returns the Node HTTP server; tests inject `getSnapshot` and use an ephemeral loopback port.
- `GET /api/snapshot` returns the normalized snapshot as JSON or a fixed safe error object `{ error: { code, message } }`.
- `GET /`, `/dashboard.js`, and `/dashboard.css` serve only the three local static assets; all other paths/methods receive `404`/`405` without proxying.

- [x] **Step 1: Write failing server tests.** Cover JSON success, static assets, unknown path, unsupported method, foreign Host/Origin, sanitized snapshot failures, and that the listener is loopback-only.

- [x] **Step 2: Run the focused tests and confirm they fail because `server.js` is missing.**

Run: `node --test scripts/ci-queue-dashboard/server.test.js`

Expected: module-load failure for the not-yet-created server module.

- [x] **Step 3: Implement `createDashboardServer`.** Serve files from the fixed dashboard directory only; do not derive paths from request input. Bind explicitly to `127.0.0.1`, set JSON/HTML content types and `Cache-Control: no-store` on the snapshot, allow same-origin GETs, reject foreign origins/hosts, and do not set CORS headers. Return a generic status code and remediation message for `gh` errors without echoing child-process output.

- [x] **Step 4: Pass the server tests.**

Run: `node --test scripts/ci-queue-dashboard/server.test.js`

Expected: all route, host/origin, and error-sanitization tests pass.

- [x] **Step 5: Commit the local HTTP boundary.**

```bash
git add scripts/ci-queue-dashboard/server.js scripts/ci-queue-dashboard/server.test.js
git commit -m "feat: serve local CI queue dashboard data"
```

## Task 3: Build the queue page and live refresh behavior

**Files:**
- Create: `scripts/ci-queue-dashboard/index.html`
- Create: `scripts/ci-queue-dashboard/dashboard.css`
- Create: `scripts/ci-queue-dashboard/dashboard-model.js`
- Test: `scripts/ci-queue-dashboard/dashboard-model.test.js`
- Create: `scripts/ci-queue-dashboard/dashboard.js`

- [x] **Step 1: Test state grouping before wiring the page.** `classifyRuns(runs)` in `dashboard-model.js` returns three arrays named `inProgress`, `queued`, and `completed`. A run with `status: 'in_progress'` goes only into `inProgress`; `queued`, `requested`, `waiting`, and `pending` go into `queued`; `completed` goes into `completed`. Write and run a failing test for the mixed fixture before implementing the helper.

- [x] **Step 2: Add semantic page structure.** Include a repository heading, last-updated and refresh controls, summary totals, separate in-progress and waiting sections, a recent-completed section, and accessible live-status, loading, empty, and error containers. Use only emoji glyphs listed in `REGRESSION_PLAN.md` §0; prefer text labels and CSS markers.

- [x] **Step 3: Add the responsive visual states.** Use solid text contrast, visible status text alongside color, keyboard-visible focus, responsive job rows, and the demo's theme-neutral design tokens only if available to this standalone page; define local CSS variables otherwise. Keep font sizes at or above 10px.

- [x] **Step 4: Implement safe rendering and 15-second polling.** Fetch only `/api/snapshot`; render all API-provided strings through `textContent`/text nodes, not `innerHTML`. Use `classifyRuns` to render active runs separately from queued runs, then render completed history. Create GitHub links only for validated `https://github.com/` run URLs and use `rel="noopener noreferrer"`. Show queued age, elapsed running time, completion time, and runner name/group/labels when provided. Preserve the last successful snapshot and mark it stale if a later refresh fails. Prevent overlapping refreshes and allow a manual refresh.

- [x] **Step 5: Check the page bundle references and copy rules.** Run a focused Node static check (added to `server.test.js`) that `GET /` references the dashboard model/JavaScript/CSS and that the source contains no disallowed emoji or inline event handlers.

Run: `node --test scripts/ci-queue-dashboard/server.test.js`

Expected: static route and page-contract assertions pass.

- [x] **Step 6: Commit the page.**

```bash
git add scripts/ci-queue-dashboard/index.html scripts/ci-queue-dashboard/dashboard.css scripts/ci-queue-dashboard/dashboard-model.js scripts/ci-queue-dashboard/dashboard-model.test.js scripts/ci-queue-dashboard/dashboard.js scripts/ci-queue-dashboard/server.js scripts/ci-queue-dashboard/server.test.js
git commit -m "feat: add live CI queue dashboard page"
```

## Task 4: Add startup, documentation, and end-to-end verification

**Files:**
- Modify: `package.json`
- Create: `scripts/ci-queue-dashboard/README.md`
- Modify: `scripts/ci-queue-dashboard/server.js` (CLI entry point)

- [x] **Step 1: Add scripts to root `package.json`.** Add `"ci:dashboard": "node scripts/ci-queue-dashboard/server.js"` and `"test:ci-dashboard": "node --test scripts/ci-queue-dashboard/*.test.js"` without changing other scripts.

- [x] **Step 2: Add the executable startup path.** When run directly, verify Node >=22, start the reader/server, and print only the local URL. Let the dashboard endpoint show a fixed, safe `gh auth login` remediation when the CLI is missing or unauthenticated; never echo `gh auth status` output. Open no browser automatically and close the listener on SIGINT/SIGTERM.

- [x] **Step 3: Document first-run and troubleshooting.** Explain `gh auth login`, `npm run ci:dashboard`, opening the printed `http://127.0.0.1:<port>` address, `npm run test:ci-dashboard`, required read access to Actions runs/jobs, the 15-second refresh, and that the page is local/read-only.

- [x] **Step 4: Run focused tests and a live authenticated smoke check.**

Run: `npm run test:ci-dashboard`

Expected: all dashboard unit/server tests pass.

Run: `npm run ci:dashboard`

Expected: process binds to loopback and prints its local URL. Open that URL, confirm queued/in-progress runs and per-job states render, wait for one refresh, then stop the process with Ctrl-C. Confirm requests from a different Host/Origin are rejected.

- [x] **Step 5: Run the repository allowlist check and inspect the final diff.**

Run: `npm run root:allowlist:check`

Expected: the new nested script files require no root allowlist entry and the check passes.

Run: `git diff --check`

Expected: no whitespace errors.

- [x] **Step 6: Commit the entry point and usage guide.**

```bash
git add package.json scripts/ci-queue-dashboard/server.js scripts/ci-queue-dashboard/README.md
git commit -m "docs: add local CI queue dashboard command"
```

## Final Review Checklist

- The normalized response includes all queued and in-progress runs within API pagination bounds and five most recent completed runs.
- Queued runs/jobs, running jobs, completed outcomes, wait/run durations, runner details, freshness, stale data, empty state, and authentication errors are visible.
- The dashboard uses the machine's `gh` authentication only; neither server response nor page includes a GitHub credential or raw CLI error output.
- The listener is bound to `127.0.0.1`; methods/routes are read-only, foreign hosts/origins are rejected, and CORS is absent.
- Polling occurs every 15 seconds without overlapping requests; active runs are prioritized and API calls are bounded/concurrent-limited.
- `npm run test:ci-dashboard`, the live smoke check, `npm run root:allowlist:check`, and `git diff --check` have fresh passing evidence before the implementation is reported complete.
