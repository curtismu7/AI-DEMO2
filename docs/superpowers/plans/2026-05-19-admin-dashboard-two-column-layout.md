# Admin Dashboard Two-Column Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the admin dashboard is in "Middle" layout mode, split the `<main>` into two columns — Token Chain pinned left, all other admin sections scrollable on the right.

**Architecture:** Add a conditional CSS modifier class `admin-dash-main--split` to `<main>` in `Dashboard.js` when `agentPlacement === "middle"`. New CSS rules in `Dashboard.css` use a two-column grid that slots `dash-shell-card--token` into column 1 and all other `dash-shell-card` sections into column 2. No new state, no structural JSX changes.

**Tech Stack:** React (CRA), CSS Grid, existing `useAgentUiMode()` context

---

### Task 1: Add the modifier class to `<main>` in Dashboard.js

**Files:**
- Modify: `banking_api_ui/src/components/Dashboard.js:557`

Context: `agentPlacement` is already destructured from `useAgentUiMode()` at line 35. The `<main>` element at line 557 currently has no `className`.

- [ ] **Step 1: Open `banking_api_ui/src/components/Dashboard.js` and locate line 557**

The current code looks like:
```jsx
<main id="admin-dashboard-main" tabIndex={-1}>
```

- [ ] **Step 2: Add the conditional className**

Replace that line with:
```jsx
<main
  id="admin-dashboard-main"
  tabIndex={-1}
  className={agentPlacement === "middle" ? "admin-dash-main--split" : undefined}
>
```

- [ ] **Step 3: Verify the build passes**

```bash
cd banking_api_ui && npm run build 2>&1 | tail -5
```
Expected: `Successfully compiled.` (exit 0). If TypeScript/lint errors appear, fix them before proceeding.

- [ ] **Step 4: Commit**

```bash
git add banking_api_ui/src/components/Dashboard.js
git commit -m "feat(admin-dashboard): add admin-dash-main--split class in Middle mode"
```

---

### Task 2: Add two-column CSS to Dashboard.css

**Files:**
- Modify: `banking_api_ui/src/components/Dashboard.css` (append to end of file)

Context: `Dashboard.css` currently only contains `.dash-scope-injection-banner*` rules. The file is imported by `Dashboard.js`. The `<main>` element carries `admin-dash-main--split` when Middle is active. The Token Chain section has class `dash-shell-card dash-shell-card--token`. All other admin sections have class `dash-shell-card` only.

- [ ] **Step 1: Append the following CSS to the end of `banking_api_ui/src/components/Dashboard.css`**

```css
/* ── Admin dashboard: two-column layout in Middle mode ───────────────────── */
main.admin-dash-main--split {
  display: grid;
  grid-template-columns: minmax(320px, 380px) 1fr;
  gap: 1rem;
  align-items: start;
  height: calc(100vh - var(--toolbar-height, 56px));
  overflow: hidden;
}

/* Token Chain: column 1, sticky so it stays in view while right side scrolls */
main.admin-dash-main--split .dash-shell-card--token {
  grid-column: 1;
  position: sticky;
  top: 0;
  max-height: calc(100vh - var(--toolbar-height, 56px) - 2rem);
  overflow-y: auto;
}

/* All other admin sections: column 2 */
main.admin-dash-main--split .dash-shell-card:not(.dash-shell-card--token) {
  grid-column: 2;
}

/* Responsive: single column below 1024px regardless of mode */
@media (max-width: 1024px) {
  main.admin-dash-main--split {
    display: block;
    height: auto;
    overflow: visible;
  }

  main.admin-dash-main--split .dash-shell-card--token,
  main.admin-dash-main--split .dash-shell-card:not(.dash-shell-card--token) {
    grid-column: unset;
    position: static;
    max-height: none;
    overflow-y: visible;
  }
}
```

- [ ] **Step 2: Verify the build passes**

```bash
cd banking_api_ui && npm run build 2>&1 | tail -5
```
Expected: `Successfully compiled.` (exit 0).

- [ ] **Step 3: Commit**

```bash
git add banking_api_ui/src/components/Dashboard.css
git commit -m "feat(admin-dashboard): two-column grid layout for Middle mode"
```

---

### Task 3: Manual verification

This is a visual change — confirm it works in the running app.

- [ ] **Step 1: Start the app (if not already running)**

```bash
./run-demo.sh
```

Wait for `API ready` and `UI ready` in the output.

- [ ] **Step 2: Log in as admin and navigate to the admin dashboard**

Open `https://api.ping.demo:4000`, log in as an admin user, go to the Admin Dashboard.

- [ ] **Step 3: Test Middle mode**

In the toolbar, click **Middle** in the layout toggle. Verify:
- Token Chain panel is pinned to the left column
- Customer lookup and KPI sections appear in the right column
- Both columns are visible without horizontal scroll
- Token Chain stays in view as you scroll the right column

- [ ] **Step 4: Test Float mode**

Click **Float** in the layout toggle. Verify:
- Layout returns to a single scrolling column (Token Chain on top, then admin sections below)
- No visual regressions vs. the state before this change

- [ ] **Step 5: Test responsive (optional, if you have browser dev tools)**

Set viewport to 900px wide. Verify both Middle and Float modes show a single column.

- [ ] **Step 6: Final build gate**

```bash
cd banking_api_ui && npm run build 2>&1 | tail -5
```
Expected: exit 0.
