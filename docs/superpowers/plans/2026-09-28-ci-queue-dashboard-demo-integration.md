# CI Queue Dashboard Demo Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a demo navigation entry that opens the existing local CI queue dashboard in a separate browser tab at a stable localhost URL, add an in-dashboard run detail panel that explains job and step timing, and show active step timing on running cards.

**Architecture:** The dashboard server defaults to port `57500` and remains bound to `127.0.0.1`. The demo's visible Observability group gains a child action that opens that URL in a new tab; GitHub requests and the machine's `gh` login remain inside the standalone dashboard process. The run detail panel uses the existing run snapshot and job response, including steps, without changing the authentication or mutation boundaries.

**Tech Stack:** Node.js >=22, Node's built-in test runner, React 19, Vite 8, Vitest 3, and the existing `gh` CLI dashboard.

**Spec:** `docs/superpowers/specs/2026-09-28-ci-queue-dashboard-demo-integration-design.md` (PR #383)

## Global Constraints

- The dashboard listens on `127.0.0.1:57500` by default and continues to reject foreign Host/Origin headers.
- The demo opens `http://127.0.0.1:57500/` in a new tab using `noopener,noreferrer`.
- GitHub credentials, dashboard API data, and action requests do not pass through the demo UI or BFF.
- Existing run confirmation, stale-state checks, rerun behavior, workflow controls, and idle runner controls remain unchanged.
- Run details are read-only and show queue wait separately from workflow execution, with job/step statuses and elapsed times.
- Active cards show the current step name and elapsed time next to the overall run timer.
- Preserve demo sign-in, role resolution, routes, use-case authorization declarations, and existing sidebar behavior.
- Project UI emoji, theme, and contrast rules remain in force; do not add CSS for this action.
- After any `demo_api_ui/` edit, run its focused Vitest tests and `npm run build`.
- Use the existing isolated worktree and branch `docs/ci-queue-dashboard-design`; stage only the named paths.

---

## File Structure

- `scripts/ci-queue-dashboard/server.js` — owns the default port constant and standalone server startup.
- `scripts/ci-queue-dashboard/server.test.js` — verifies the default port while retaining ephemeral-port test helpers.
- `scripts/ci-queue-dashboard/README.md` — documents the stable address and startup prerequisite.
- `demo_api_ui/src/components/AdminSideNav.jsx` — defines the legacy Monitoring entries composed into the visible Observability group.
- `demo_api_ui/src/config/navStructureCatalog.js` — exposes the Observability children to Demo Config's navigation picker.
- `demo_api_ui/src/components/__tests__/adminSideNav.test.jsx` — verifies the action opens the fixed URL in a separate tab.
- `demo_api_ui/src/config/__tests__/navStructureCatalog.test.js` — verifies CI Queue Dashboard is in the Observability catalog.
- `scripts/ci-queue-dashboard/github.js` and `github.test.js` — normalize job-step fields from GitHub's existing jobs response.
- `scripts/ci-queue-dashboard/dashboard-model.js` and `.test.js` — derive queue and execution durations, handling missing timestamps.
- `scripts/ci-queue-dashboard/index.html`, `dashboard.js`, and `dashboard.css` — add the accessible run detail panel and run-card action.
- `scripts/ci-queue-dashboard/README.md`, `dashboard.js`, `dashboard.css`, and `dashboard.test.js` — document and show current step timing on active cards.

## Task 1: Set and document the dashboard's stable default port

**Files:**
- Modify: `scripts/ci-queue-dashboard/server.js`
- Test: `scripts/ci-queue-dashboard/server.test.js`
- Modify: `scripts/ci-queue-dashboard/README.md`

**Interface:** Export `DEFAULT_DASHBOARD_PORT = 57500`; `startDashboard({ port })` uses it when `port` is omitted. Explicit ports, including `0` for ephemeral test listeners, remain supported.

- [ ] **Step 1: Add the failing default-port test.** Import `DEFAULT_DASHBOARD_PORT` from `./server` and add:

```js
test('dashboard has a stable default port for the demo navigation link', () => {
  assert.equal(DEFAULT_DASHBOARD_PORT, 57500);
});
```

- [ ] **Step 2: Run the focused server test and confirm it fails.**

Run: `node --test scripts/ci-queue-dashboard/server.test.js`

Expected: FAIL because `DEFAULT_DASHBOARD_PORT` is not exported yet.

- [ ] **Step 3: Implement the constant and use it for startup.** In `server.js`, add `const DEFAULT_DASHBOARD_PORT = 57500;`, change the `startDashboard` parameter default from `port = 0` to `port = DEFAULT_DASHBOARD_PORT`, and export the constant. Leave `createDashboardServer` and explicit port behavior unchanged.

- [ ] **Step 4: Update the README.** Show that `npm run ci:dashboard` opens `http://127.0.0.1:57500/`; explain that the process must be running before using the demo navigation entry and that it remains loopback-only.

- [ ] **Step 5: Run focused dashboard tests.**

Run: `npm run test:ci-dashboard`

Expected: all dashboard tests pass, including the default-port test and existing tests that bind using port `0`.

- [ ] **Step 6: Commit the standalone change.**

```sh
git add scripts/ci-queue-dashboard/server.js scripts/ci-queue-dashboard/server.test.js scripts/ci-queue-dashboard/README.md
git commit -m "feat: use a stable CI dashboard port"
```

## Task 2: Add the dashboard action to the demo's Observability navigation

**Files:**
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx`
- Modify: `demo_api_ui/src/config/navStructureCatalog.js`
- Test: `demo_api_ui/src/components/__tests__/adminSideNav.test.jsx`
- Test: `demo_api_ui/src/config/__tests__/navStructureCatalog.test.js`

**Protected invariant:** `demo_api_ui/` is governed by `REGRESSION_PLAN.md` §0–§1 and `.claude/skills/regression-guard/`. Do not change sign-in, role resolution, route guards, auth requirements, or any existing nav action. Add only one external child action and its catalog entry; add no CSS.

**Interface:** The legacy Monitoring item `{ label: "CI Queue Dashboard", icon: "log", action }` is composed into the visible Observability group. Its action calls `window.open("http://127.0.0.1:57500/", "_blank", "noopener,noreferrer")`.

- [ ] **Step 1: Add a failing sidebar action test.** In `adminSideNav.test.jsx`, spy on `window.open`, search for the new item, click its button, and assert the exact URL, target, and feature string. Restore the spy in a `finally` block:

```js
it("opens the local CI dashboard in a separate tab", () => {
  const opened = vi.spyOn(window, "open").mockImplementation(() => null);
  try {
    renderNav();
    fireEvent.change(screen.getByLabelText(/search navigation/i), {
      target: { value: "CI Queue Dashboard" },
    });
    fireEvent.click(screen.getByRole("button", { name: "CI Queue Dashboard" }));
    expect(opened).toHaveBeenCalledWith(
      "http://127.0.0.1:57500/",
      "_blank",
      "noopener,noreferrer",
    );
  } finally {
    opened.mockRestore();
  }
});
```

- [ ] **Step 2: Run the focused Vitest file and confirm it fails.**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/adminSideNav.test.jsx`

Expected: FAIL because the item is not in the sidebar.

- [ ] **Step 3: Add the item to the legacy Monitoring children.** In `AdminSideNav.jsx`, add the child action near the other monitoring/log tools. Do not change the `childrenFrom` or `productGroup` composition logic.

- [ ] **Step 4: Update the Observability catalog.** Add `"CI Queue Dashboard"` to `NAV_STRUCTURE_CATALOG`'s `Observability` children at the same relative position as the item appears in the composed sidebar.

- [ ] **Step 5: Assert the catalog entry.** In `navStructureCatalog.test.js`, add an expectation that the Observability group contains `"CI Queue Dashboard"`. The existing drift suite also must pass.

- [ ] **Step 6: Run focused sidebar and catalog tests.**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/adminSideNav.test.jsx src/config/__tests__/navStructureCatalog.test.js src/config/__tests__/navStructureCatalog.drift.test.js`

Expected: all selected UI tests pass, including the tab URL and catalog drift assertions.

- [ ] **Step 7: Commit the navigation change.**

```sh
git add demo_api_ui/src/components/AdminSideNav.jsx demo_api_ui/src/config/navStructureCatalog.js demo_api_ui/src/components/__tests__/adminSideNav.test.jsx demo_api_ui/src/config/__tests__/navStructureCatalog.test.js
git commit -m "feat: add CI dashboard to demo navigation"
```

## Task 3: Add the read-only run detail panel

**Files:**
- Modify: `scripts/ci-queue-dashboard/github.js` and `github.test.js`
- Modify: `scripts/ci-queue-dashboard/dashboard-model.js` and `dashboard-model.test.js`
- Modify: `scripts/ci-queue-dashboard/index.html`, `dashboard.js`, and `dashboard.css`
- Add or modify focused dashboard UI test coverage, following existing project test patterns

**Interface:** Each run card has a **Run details** action that opens an accessible in-dashboard panel for that run. Show queue wait (`createdAt` to `startedAt`) and execution duration (`startedAt` to `completedAt`, or now while running) separately. Show each job's status and elapsed time, its steps' status and elapsed time, and clearly identify an in-progress step as current. If dates or job/step data are unavailable, say so without estimating from unrelated timestamps. Closing the panel restores the queue view; details are read-only and do not trigger run/workflow/runner actions.

- [ ] **Step 1: Add focused failing tests for job-step normalization and run timing.** Preserve step name, status, conclusion, and start/completion timestamps from the existing GitHub jobs response. Test queue and execution split calculations for queued, running, completed, and incomplete-timestamp cases.
- [ ] **Step 2: Add the panel interaction and content tests.** Verify selecting a run opens its details, the expected jobs/steps/current step and timing labels are shown, close works, and no mutation endpoint/action is requested.
- [ ] **Step 3: Implement model/data normalization and panel rendering.** Reuse the existing job response; do not introduce another API call or change action/auth handling. Keep UI text content safe and accessible.
- [ ] **Step 4: Run focused standalone dashboard tests.** Run `npm run test:ci-dashboard`; expected all dashboard tests pass.
- [ ] **Step 5: Commit only the task paths.** Use `feat: add CI dashboard run details`.

## Task 4: Show the active step timer on running cards

**Files:**
- Modify: `scripts/ci-queue-dashboard/dashboard.js`
- Test: `scripts/ci-queue-dashboard/dashboard.test.js`
- Modify: `scripts/ci-queue-dashboard/dashboard.css`
- Modify: `scripts/ci-queue-dashboard/README.md`

**Interface:** An active run card retains its workflow elapsed time and also shows each in-progress job's current step name and elapsed time. If no job step is running or its timing cannot be computed, the card does not invent a step or duration. This is read-only.

- [ ] **Step 1: Add a focused test** proving the active card preserves the workflow timer and separately displays job, current step, and step elapsed time.
- [ ] **Step 2: Render running steps on active cards** using the existing normalized jobs/steps and elapsed-time formatter; add concise styling consistent with dashboard tokens.
- [ ] **Step 3: Update the README** to describe current step timing alongside active run runtime.
- [ ] **Step 4: Run `npm run test:ci-dashboard` and `git diff --check`;** expected all dashboard tests pass.
- [ ] **Step 5: Commit only the four named files** with `feat: show current step time on active runs`.

## Task 5: Verify the integrated local flow and update PR #383

**Files:** No additional files unless verification finds a defect.

- [ ] **Step 1: Run focused standalone tests.**

Run: `npm run test:ci-dashboard`

Expected: all dashboard tests pass.

- [ ] **Step 2: Re-run focused navigation tests and the UI build.** The Task 2 report records the full UI suite exiting without a final summary and multiple failures in untouched areas; do not rerun it here. Run `cd demo_api_ui && npx vitest run src/components/__tests__/adminSideNav.test.jsx src/config/__tests__/navStructureCatalog.test.js src/config/__tests__/navStructureCatalog.drift.test.js && npm run build`.

Expected: focused navigation tests and Vite build both exit `0`.

- [ ] **Step 3: Run the navigation contrast check.** Open the demo's normal admin view in the browser, inspect the rendered Observability navigation in light and dark themes, and run `THEMING.md` §1 snippets A and B in both themes. Since this task adds no CSS, fix only a contrast issue caused by the added label/action.

- [ ] **Step 4: Smoke-check the local launch.** Start the server with `npm run ci:dashboard`, confirm it prints `http://127.0.0.1:57500`, then use the CI Queue Dashboard navigation action to open that address in a separate tab. Confirm the page and read endpoints load; do not activate a run, workflow, or runner mutation.

- [ ] **Step 5: Run repository hygiene checks.**

Run: `npm run root:allowlist:check` and `git diff --check`.

Expected: both pass; the root allowlist remains at its existing count.

- [ ] **Step 6: Refresh the project graph after code edits.**

Run: `graphify update .`

Expected: graph refresh exits successfully. Record any pre-existing parser warnings without changing unrelated generated files.

- [ ] **Step 7: Push the implementation commits to PR #383.**

```sh
git push origin docs/ci-queue-dashboard-design
```

Expected: PR #383 includes the stable-port and navigation commits; no deployment or merge is performed by this plan.

## Final Review Checklist

- The visible Observability group contains CI Queue Dashboard and its catalog entry.
- The action opens only `http://127.0.0.1:57500/` in a separate tab with `noopener,noreferrer`.
- The standalone dashboard binds to `127.0.0.1` and retains its existing local GitHub CLI, confirmation, stale-state, and runner-busy safeguards.
- Rerun failed jobs remains available from failed completed runs on the standalone dashboard.
- Dashboard tests, selected navigation tests, the UI build, contrast check, root allowlist, and diff check have fresh passing evidence.
- Run details show the queue/execution split and job-step progress without adding a mutation path.
- Active run cards show current step time alongside workflow elapsed time.
