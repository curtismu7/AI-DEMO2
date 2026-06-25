# Cleaner User Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the banking-info column in the middle-agent dashboard layout behind a new setup-page feature flag `ff_show_banking_in_middle_agent` (default OFF), leaving floating and bottom modes unchanged.

**Architecture:** Add one boolean flag to the backend `FLAG_REGISTRY` (renders generically on the setup page). The `UserDashboard` reads the flag with the same cookie-credentialed GET pattern `BankingAgent.js` already uses, then conditionally renders the banking `<main>` and swaps a CSS grid-template modifier class. A tiny pure helper for the grid-class decision is extracted into `dashboardLayout.js` so it is unit-testable without rendering the 3603-line component.

**Tech Stack:** React (CRA, ES modules + JSX in `.js`), Express (CommonJS), Jest + React Testing Library, configStore-backed feature flags.

---

## File Structure

- `banking_api_server/routes/featureFlags.js` — **Modify.** Add one entry to `FLAG_REGISTRY`. No other backend change (GET/PUT routes + setup-page UI are generic over the registry).
- `banking_api_ui/src/utils/dashboardLayout.js` — **Modify.** Add one pure helper `splitGridClass(showBankingInMiddle)` returning the CSS modifier class.
- `banking_api_ui/src/utils/__tests__/dashboardLayout.test.js` — **Create.** Unit tests for `splitGridClass`.
- `banking_api_ui/src/components/UserDashboard.js` — **Modify.** Add one `useState` + one `useEffect` to read the flag; apply `splitGridClass` to the middle-layout container; gate the banking `<main>` render on the flag.
- `banking_api_ui/src/components/UserDashboard.css` — **Modify.** Add one modifier rule `.ud-body--dashboard-split3--no-banking` that collapses the 3-track grid to 2 tracks (plus the existing tablet/mobile breakpoints).

---

### Task 1: Register the feature flag (backend)

**Files:**
- Modify: `banking_api_server/routes/featureFlags.js` (insert into `FLAG_REGISTRY`, before the closing `];` at line ~271, after the `ff_heuristic_enabled` block)

- [ ] **Step 1: Add the flag entry**

In `banking_api_server/routes/featureFlags.js`, locate the end of the `ff_heuristic_enabled` object (the block ending `defaultValue: true,\n  },` around line 269) and the closing `];` of `FLAG_REGISTRY` around line 271. Insert this new object as the last entry, immediately before `];`:

```javascript
  // ── UI / Dashboard ─────────────────────────────────────────────────────────
  {
    id:           'ff_show_banking_in_middle_agent',
    name:         'Dashboard — Show Banking Column With Centered Agent',
    category:     'UI / Dashboard',
    description:
      'Controls the customer dashboard layout **only when the AI agent is placed in the center column**. ' +
      'When **OFF** (default), the banking-info column is hidden so the dashboard stays clean — ' +
      'balances and account details come from the agent response or its pop-out instead. ' +
      'When **ON**, the banking-info column is shown alongside the centered agent (legacy layout). ' +
      'The floating (corner FAB) and bottom-dock agent placements always show the banking column and are not affected by this flag.',
    impact:
      'OFF (default) = cleaner dashboard; with a centered agent only the Token Chain and the agent are shown, banking info via the agent / pop-out. ' +
      'ON = banking column also shown next to the centered agent.',
    type:         'boolean',
    defaultValue: false,
  },
```

- [ ] **Step 2: Verify the registry still parses and the flag is served**

Run: `cd banking_api_server && node -e "const r=require('./routes/featureFlags'); console.log('loaded ok')"`
Expected: prints `loaded ok` with no syntax error.

(If the BFF is running, `curl -s http://localhost:3001/api/admin/feature-flags | grep ff_show_banking_in_middle_agent` should show the flag and a `"UI / Dashboard"` category. This is optional — the require check is the gate.)

- [ ] **Step 3: Commit**

```bash
git add banking_api_server/routes/featureFlags.js
git commit -m "feat(ff): add ff_show_banking_in_middle_agent flag (default off)"
```

---

### Task 2: Pure grid-class helper (TDD)

**Files:**
- Modify: `banking_api_ui/src/utils/dashboardLayout.js`
- Test: `banking_api_ui/src/utils/__tests__/dashboardLayout.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `banking_api_ui/src/utils/__tests__/dashboardLayout.test.js`:

```javascript
import { splitGridClass } from "../dashboardLayout";

describe("splitGridClass", () => {
  test("returns base split3 class when banking column is shown", () => {
    expect(splitGridClass(true)).toBe("ud-body--dashboard-split3");
  });

  test("appends the no-banking modifier when banking column is hidden", () => {
    expect(splitGridClass(false)).toBe(
      "ud-body--dashboard-split3 ud-body--dashboard-split3--no-banking",
    );
  });

  test("treats falsy non-boolean input as hidden", () => {
    expect(splitGridClass(undefined)).toBe(
      "ud-body--dashboard-split3 ud-body--dashboard-split3--no-banking",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd banking_api_ui && CI=true npx react-scripts test --watchAll=false src/utils/__tests__/dashboardLayout.test.js`
Expected: FAIL — `splitGridClass is not a function` / not exported.

- [ ] **Step 3: Implement the helper**

Append to `banking_api_ui/src/utils/dashboardLayout.js` (after the existing `setDashboardLayout` function, at end of file):

```javascript

/**
 * CSS class(es) for the middle-agent split3 grid container.
 * When the banking column is hidden, append the modifier that collapses
 * the grid from 3 tracks (token | agent | banking) to 2 (token | agent).
 *
 * @param {boolean} showBankingInMiddle
 * @returns {string}
 */
export function splitGridClass(showBankingInMiddle) {
  return showBankingInMiddle
    ? 'ud-body--dashboard-split3'
    : 'ud-body--dashboard-split3 ud-body--dashboard-split3--no-banking';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd banking_api_ui && CI=true npx react-scripts test --watchAll=false src/utils/__tests__/dashboardLayout.test.js`
Expected: PASS — 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add banking_api_ui/src/utils/dashboardLayout.js banking_api_ui/src/utils/__tests__/dashboardLayout.test.js
git commit -m "feat(dashboard): splitGridClass helper for no-banking middle layout"
```

---

### Task 3: CSS modifier — collapse split3 grid to two tracks

**Files:**
- Modify: `banking_api_ui/src/components/UserDashboard.css`

Context: the base rule at line 119 is
`.ud-body.ud-body--dashboard-split3 { ... grid-template-columns: minmax(240px, 260px) 1fr minmax(360px, 420px); }`
(token rail | agent column | banking column). The tablet breakpoint at line ~254 sets `1fr 1fr 1fr` and the mobile one at ~260 sets `1fr`.

- [ ] **Step 1: Add the desktop modifier rule**

In `banking_api_ui/src/components/UserDashboard.css`, immediately after the closing `}` of the `.ud-body.ud-body--dashboard-split3 { ... }` rule that ends at line 132, insert:

```css

/* No-banking variant: hide the third (banking) track — token rail | agent only */
.ud-body.ud-body--dashboard-split3.ud-body--dashboard-split3--no-banking {
  grid-template-columns: minmax(240px, 260px) 1fr;
}
```

- [ ] **Step 2: Add the tablet-breakpoint override**

Find the tablet media block containing `.ud-body.ud-body--dashboard-split3 { grid-template-columns: 1fr 1fr 1fr; }` (around line 254). Immediately after that rule's closing `}` (still inside the same `@media` block), insert:

```css
  .ud-body.ud-body--dashboard-split3.ud-body--dashboard-split3--no-banking {
    grid-template-columns: 1fr 1fr;
  }
```

- [ ] **Step 3: Verify the mobile breakpoint needs no change**

Find the mobile media block containing `.ud-body.ud-body--dashboard-split3 { grid-template-columns: 1fr; }` (around line 260). A single `1fr` column already stacks correctly whether or not the banking `<main>` is present, so **no rule is added here**. Confirm by reading the block; do not edit it.

- [ ] **Step 4: Commit**

```bash
git add banking_api_ui/src/components/UserDashboard.css
git commit -m "feat(dashboard): split3 no-banking grid modifier (desktop + tablet)"
```

---

### Task 4: Read the flag and gate the banking column (UserDashboard)

**Files:**
- Modify: `banking_api_ui/src/components/UserDashboard.js`
  - Add `splitGridClass` to the existing `../utils/dashboardLayout` import (line ~26-28)
  - Add state + effect near the other dashboard state (after line 148, `middleAgentOpen`)
  - Apply class + gate render in the middle branch (lines ~2615-2666)

- [ ] **Step 1: Extend the dashboardLayout import**

In `banking_api_ui/src/components/UserDashboard.js`, the import around lines 26-28 is:

```javascript
} from "../utils/dashboardLayout";
```

Read the full import statement (it starts a few lines above line 28 with `import {`). Add `splitGridClass` to the named imports list inside that `import { ... } from "../utils/dashboardLayout";` block. For example if it currently imports `getDashboardLayout, setDashboardLayout`, it becomes `getDashboardLayout, setDashboardLayout, splitGridClass`.

- [ ] **Step 2: Add flag state + fetch effect**

In `UserDashboard.js`, immediately after the `middleAgentOpen` state declaration block (the `useState` at line ~148; insert after its closing `);`), add:

```javascript
  // ff_show_banking_in_middle_agent — when false (default) the banking column
  // is hidden in the middle-agent layout (banking info comes from the agent /
  // pop-out). Floating + bottom modes are unaffected. Mirrors the cookie-
  // credentialed read BankingAgent.js uses for ff_heuristic_enabled.
  const [showBankingInMiddle, setShowBankingInMiddle] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/feature-flags", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const flag = data?.flags?.find(
          (f) => f.id === "ff_show_banking_in_middle_agent",
        );
        if (flag != null) setShowBankingInMiddle(Boolean(flag.value));
      })
      .catch(() => {
        /* fail to the clean default (column hidden) */
      });
    return () => {
      cancelled = true;
    };
  }, []);
```

Note: `useState` and `useEffect` are already imported in this file (React hooks are used throughout). Do not add a new React import.

- [ ] **Step 3: Apply the grid class to the middle container**

In the middle-agent branch, the container is at line ~2616:

```javascript
        <div className="dashboard-content ud-body ud-body--2026 ud-body--dashboard-split3">
```

Replace that line with:

```javascript
        <div
          className={`dashboard-content ud-body ud-body--2026 ${splitGridClass(
            showBankingInMiddle,
          )}`}
        >
```

- [ ] **Step 4: Gate the banking `<main>` render**

In the same branch, the banking column is rendered at lines ~2659-2665:

```javascript
          <main
            className="ud-center ud-banking-column"
            id="main-dashboard-content"
            tabIndex={-1}
          >
            {renderBankingMain()}
          </main>
```

Wrap it so it only renders when the flag is on:

```javascript
          {showBankingInMiddle && (
            <main
              className="ud-center ud-banking-column"
              id="main-dashboard-content"
              tabIndex={-1}
            >
              {renderBankingMain()}
            </main>
          )}
```

Leave the `else` branch (starting at line ~2667, the `// Bottom-dock or float mode` comment) completely unmodified — bottom and floating modes keep the banking column.

- [ ] **Step 5: Build the UI (mandatory gate)**

Run: `cd banking_api_ui && npm run build`
Expected: exit code **0**. (CLAUDE.md / REGRESSION_PLAN UI build gate.)

- [ ] **Step 6: Run the helper test suite (regression check on touched util)**

Run: `cd banking_api_ui && CI=true npx react-scripts test --watchAll=false src/utils/__tests__/dashboardLayout.test.js`
Expected: PASS — 3 passing tests.

- [ ] **Step 7: Commit**

```bash
git add banking_api_ui/src/components/UserDashboard.js
git commit -m "feat(dashboard): hide banking column in middle-agent layout behind ff_show_banking_in_middle_agent"
```

---

### Task 5: Manual verification + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (one line under `[Unreleased]`, category `Added`)

- [ ] **Step 1: Manual smoke (services running via `./run-demo.sh`)**

Log in as a customer → `/dashboard`. With the agent placement set to **middle** and the agent opened:
- FF off (default): only the Token Chain rail + agent column are visible; **no** banking column; the agent answers a balance question and the pop-out works.
- Toggle `ff_show_banking_in_middle_agent` ON from the setup page (`/config` → Feature Flags → "UI / Dashboard"); reload `/dashboard`: the banking column reappears next to the centered agent. Toggle back OFF.

Switch agent placement to **bottom**: banking column is visible (FF state irrelevant).
Switch agent placement to **floating** (corner FAB): banking column is visible (FF state irrelevant).

If any check fails, stop and re-plan — do not mark complete.

- [ ] **Step 2: Add CHANGELOG entry**

In `CHANGELOG.md`, under the `[Unreleased]` section's `Added` category (create the `### Added` subhead if absent), add:

```markdown
- Feature flag `ff_show_banking_in_middle_agent` (default off): hides the banking-info column in the middle-agent dashboard layout so banking details come from the agent response / pop-out. Floating and bottom agent placements are unaffected.
```

- [ ] **Step 3: Final build gate**

Run: `cd banking_api_ui && npm run build`
Expected: exit code **0**.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): ff_show_banking_in_middle_agent"
```

---

## Self-Review

**Spec coverage:**
- Backend flag registered, `UI / Dashboard` category, default false → Task 1 (matches spec §"Backend: register the flag").
- Frontend reads flag via cookie-credentialed GET, fails to clean default → Task 4 Step 2 (matches spec §"Frontend: read the flag").
- Banking `<main>` gated on flag in middle branch only; else branch untouched → Task 4 Steps 3-4 (matches spec §"conditional render" + scope boundary).
- CSS grid collapses to two tracks → Tasks 2 + 3 (matches spec §"CSS: two-track grid modifier").
- Floating & bottom unchanged → Task 4 Step 4 explicit "leave else branch unmodified" + Task 5 Step 1 manual checks (matches spec behavior matrix).
- Build exits 0 → Task 4 Step 5, Task 5 Step 3 (matches spec success criteria + CLAUDE.md gate).
- Flag on setup page, persists via configStore → Task 1 (generic registry render) + Task 5 Step 1 toggle check (matches spec success criteria).
- No bug-fix log entry needed (feature, not bug) → consistent with spec §Regression note; CHANGELOG entry added instead (repo commit hook expects it).

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". All code blocks are complete; all commands have expected output.

**Type consistency:** `splitGridClass` signature/return identical in Task 2 (definition + tests) and Task 4 (call site). Flag id string `ff_show_banking_in_middle_agent` identical across Tasks 1, 4, 5. CSS class `ud-body--dashboard-split3--no-banking` identical across Tasks 2, 3, and the helper return value.

No gaps found.
