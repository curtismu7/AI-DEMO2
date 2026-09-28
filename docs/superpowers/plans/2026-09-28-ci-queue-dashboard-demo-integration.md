# CI Queue Dashboard Demo Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a demo navigation entry that opens the existing local CI queue dashboard in a separate browser tab at a stable localhost URL.

**Architecture:** The dashboard server defaults to port `57500` and remains bound to `127.0.0.1`. The demo's visible Observability group gains a child action that opens that URL in a new tab; GitHub requests and the machine's `gh` login remain inside the standalone dashboard process.

**Tech Stack:** Node.js >=22, Node's built-in test runner, React 19, Vite 8, Vitest 3, and the existing `gh` CLI dashboard.

**Spec:** `docs/superpowers/specs/2026-09-28-ci-queue-dashboard-demo-integration-design.md` (PR #383)

## Global Constraints

- The dashboard listens on `127.0.0.1:57500` by default and continues to reject foreign Host/Origin headers.
- The demo opens `http://127.0.0.1:57500/` in a new tab using `noopener,noreferrer`.
- GitHub credentials, dashboard API data, and action requests do not pass through the demo UI or BFF.
- Existing run confirmation, stale-state checks, rerun behavior, workflow controls, and idle runner controls remain unchanged.
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

## Task 3: Verify the integrated local flow and update PR #383

**Files:** No additional files unless verification finds a defect.

- [ ] **Step 1: Run focused standalone tests.**

Run: `npm run test:ci-dashboard`

Expected: all dashboard tests pass.

- [ ] **Step 2: Run the required UI test and build gates.**

Run: `cd demo_api_ui && npm run test:unit && npm run build`

Expected: Vitest and Vite build both exit `0`.

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
