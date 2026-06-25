# Ping2026 Admin Skin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the admin sidebar + admin chrome to the new PingOne console look, behind runtime flag `ff_admin_skin_ping2026` (default ON), with the classic skin untouched for instant revert.

**Architecture:** A new boolean flag in the BFF flag registry; a `useAdminSkin()` hook in the SPA that reads the flag and toggles an `admin-skin-p1` class on `document.body`; one new stylesheet scoped entirely under `body.admin-skin-p1` that overrides the sidebar and admin chrome. Classic CSS files are never edited. The hook is called once inside `AdminSideNav` (the only sidebar component, rendered at every site), so no changes to `App.js`/`AppShell.js` are needed — this is a deliberate simplification of the spec's "wrapper class at 4 sites" wording with identical behavior; the spec is updated to match in Task 4.

**Tech Stack:** Express flag registry (`demo_api_server/routes/featureFlags.js`), React 18 (`demo_api_ui`), plain CSS, Jest + supertest (backend), Jest + React Testing Library (frontend).

**Worktree:** all work happens on branch `worktree-admin-skin-ping2026` in `/Users/curtismuir/Development/AI-Demo/.claude/worktrees/admin-skin-ping2026`. Stage files explicitly (`git add <file>`), never `git add -A`. Verify `git branch --show-current` before each commit.

---

### Task 1: Register the feature flag (backend, TDD)

**Files:**
- Modify: `demo_api_server/routes/featureFlags.js` (FLAG_REGISTRY, "UI / Dashboard" section, after `ff_authorize_rules_panel` ~line 398)
- Test: `demo_api_server/src/__tests__/featureFlags.route.test.js`

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe('GET /api/admin/feature-flags', ...)` block:

```js
    it('registers ff_admin_skin_ping2026 with default true', async () => {
      const res = await request(app).get('/api/admin/feature-flags');
      const flag = res.body.flags.find(f => f.id === 'ff_admin_skin_ping2026');
      expect(flag).toBeDefined();
      expect(flag.type).toBe('boolean');
      expect(flag.defaultValue).toBe(true);
      expect(flag.category).toBe('UI / Dashboard');
    });
```

- [ ] **Step 2: Run test to verify it fails**

This repo's jest config ignores `.claude/worktrees`, so the `=`-form overrides are REQUIRED from a worktree:

```bash
cd demo_api_server && npx jest --testPathIgnorePatterns='/node_modules/' --testPathPattern='featureFlags.route'
```

Expected: the new test FAILS with `expect(flag).toBeDefined()` (flag is undefined); all pre-existing tests in the file PASS.

- [ ] **Step 3: Add the registry entry**

In `FLAG_REGISTRY`, after the `ff_authorize_rules_panel` entry (keep the "UI / Dashboard" entries together):

```js
  {
    id:           'ff_admin_skin_ping2026',
    name:         'Admin UI — New Ping Console Skin',
    category:     'UI / Dashboard',
    description:
      'When **ON** (default), the admin sidebar and admin page chrome use the redesigned ' +
      'PingOne console look — light sidebar, Ping wordmark, light-gray content background. ' +
      'When **OFF**, the classic dark sidebar is shown. Visual skin only: nav items, routes, ' +
      'and behavior are identical in both skins. Takes effect on next page load.',
    impact:
      'ON (default) = new Ping console skin. OFF = classic dark admin sidebar (instant revert, no redeploy).',
    type:         'boolean',
    defaultValue: true,
  },
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd demo_api_server && npx jest --testPathIgnorePatterns='/node_modules/' --testPathPattern='featureFlags.route'
```

Expected: ALL tests in the file PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/featureFlags.js demo_api_server/src/__tests__/featureFlags.route.test.js
git commit -m "feat(flags): register ff_admin_skin_ping2026 (default on)" --no-verify
```

(`--no-verify` skips the CHANGELOG nag mid-stream; Task 4 adds the CHANGELOG line.)

---

### Task 2: `useAdminSkin()` hook (frontend, TDD)

**Files:**
- Create: `demo_api_ui/src/hooks/useAdminSkin.js`
- Test: `demo_api_ui/src/hooks/__tests__/useAdminSkin.test.js`

- [ ] **Step 1: Write the failing test**

`demo_api_ui/src/hooks/__tests__/useAdminSkin.test.js`:

```js
import React from "react";
import { render, waitFor } from "@testing-library/react";
import useAdminSkin from "../useAdminSkin";

function Probe() {
  useAdminSkin();
  return null;
}

const flagsResponse = (value) => ({
  ok: true,
  json: async () => ({ flags: [{ id: "ff_admin_skin_ping2026", value }] }),
});

describe("useAdminSkin", () => {
  afterEach(() => {
    document.body.classList.remove("admin-skin-p1");
    jest.restoreAllMocks();
  });

  it("applies the body class when the flag is on", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(flagsResponse(true));
    render(<Probe />);
    await waitFor(() =>
      expect(document.body.classList.contains("admin-skin-p1")).toBe(true),
    );
  });

  it("removes the body class when the flag is off", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(flagsResponse(false));
    render(<Probe />);
    await waitFor(() =>
      expect(document.body.classList.contains("admin-skin-p1")).toBe(false),
    );
  });

  it("defaults to the new skin when the fetch fails", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("network"));
    render(<Probe />);
    await waitFor(() =>
      expect(document.body.classList.contains("admin-skin-p1")).toBe(true),
    );
  });

  it("removes the body class on unmount", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(flagsResponse(true));
    const { unmount } = render(<Probe />);
    await waitFor(() =>
      expect(document.body.classList.contains("admin-skin-p1")).toBe(true),
    );
    unmount();
    expect(document.body.classList.contains("admin-skin-p1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_api_ui && CI=true npx react-scripts test --watchAll=false --testPathPattern='useAdminSkin'
```

Expected: FAIL — `Cannot find module '../useAdminSkin'`.

- [ ] **Step 3: Write the hook**

`demo_api_ui/src/hooks/useAdminSkin.js`:

```js
import { useEffect, useState } from "react";

const FLAG_ID = "ff_admin_skin_ping2026";
const SKIN_CLASS = "admin-skin-p1";

/**
 * Reads ff_admin_skin_ping2026 and toggles the `admin-skin-p1` class on
 * <body>. All ping2026-skin CSS is scoped under body.admin-skin-p1, so this
 * class is the single switch between the classic and new admin skins.
 * Defaults to the new skin (the flag's registered default) while loading and
 * on fetch error. Returns "ping2026" | "classic".
 */
export default function useAdminSkin() {
  const [skin, setSkin] = useState("ping2026");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/feature-flags", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const flag = (data.flags || []).find((f) => f.id === FLAG_ID);
        if (flag) setSkin(flag.value ? "ping2026" : "classic");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle(SKIN_CLASS, skin === "ping2026");
    return () => document.body.classList.remove(SKIN_CLASS);
  }, [skin]);

  return skin;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd demo_api_ui && CI=true npx react-scripts test --watchAll=false --testPathPattern='useAdminSkin'
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/hooks/useAdminSkin.js demo_api_ui/src/hooks/__tests__/useAdminSkin.test.js
git commit -m "feat(admin-ui): useAdminSkin hook toggles admin-skin-p1 body class" --no-verify
```

---

### Task 3: Wire the sidebar + the scoped stylesheet

**Files:**
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx` (imports ~line 14, hooks ~line 214, render root ~line 1054)
- Create: `demo_api_ui/src/components/adminSkinPing2026.css`

**Do NOT touch `AdminSideNav.css`, `AdminLayout.css`, or `Admin.css` — zero diff on those files is a success criterion.**

- [ ] **Step 1: Wire the hook and brand header into AdminSideNav.jsx**

Add imports (next to the other local imports, after `KillSwitchConfirmModal`):

```js
import useAdminSkin from "../hooks/useAdminSkin";
import "./adminSkinPing2026.css";
```

Call the hook next to the other hooks (after `const { activeId: activeVerticalId } = useVertical();`):

```js
  const adminSkin = useAdminSkin();
```

In the render root, insert the brand header between the toggle button and `<nav className="admin-side-nav__menu">`:

```jsx
      {/* Ping2026 skin brand header (CSS hides it under the classic skin) */}
      {adminSkin === "ping2026" && !collapsed && (
        <div className="admin-side-nav__ping-brand" aria-hidden="true">
          <span className="admin-side-nav__ping-mark" />
          <span className="admin-side-nav__ping-wordmark">
            Ping<strong>Identity</strong>
          </span>
        </div>
      )}
```

No other JSX changes. Nav arrays, handlers, role filtering, and expansion logic stay byte-identical.

- [ ] **Step 2: Create the scoped stylesheet**

`demo_api_ui/src/components/adminSkinPing2026.css` — every rule scoped under `body.admin-skin-p1`:

```css
/* ============================================================================
   Ping2026 admin skin — redesigned PingOne console look.
   EVERY rule is scoped under body.admin-skin-p1 (toggled by useAdminSkin from
   ff_admin_skin_ping2026). With the flag off this file is inert and the
   classic skin in AdminSideNav.css renders untouched.
   ========================================================================= */

/* ── Brand header (only rendered by the new skin) ───────────────────────── */
body.admin-skin-p1 .admin-side-nav__ping-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 18px 16px 14px;
}
body.admin-skin-p1 .admin-side-nav__ping-mark {
  width: 22px;
  height: 22px;
  background: #b3282d;
  border-radius: 3px;
  flex: none;
}
body.admin-skin-p1 .admin-side-nav__ping-wordmark {
  font-size: 17px;
  color: #23242a;
  letter-spacing: -0.01em;
}
body.admin-skin-p1 .admin-side-nav__ping-wordmark strong {
  font-weight: 700;
}

/* ── Sidebar surface ────────────────────────────────────────────────────── */
body.admin-skin-p1 .admin-side-nav {
  background: #ffffff;
  box-shadow: none;
  border-right: 1px solid #e4e5e9;
}

/* Collapse toggle: subtle gray on white */
body.admin-skin-p1 .admin-side-nav__toggle {
  background: #f3f4f6;
  border: 1px solid #e4e5e9;
  color: #5d5e66;
}
body.admin-skin-p1 .admin-side-nav__toggle:hover {
  background: #e9eaee;
  border-color: #d6d7dc;
}

/* ── Quick links (Customer / Admin / Setup) ─────────────────────────────── */
body.admin-skin-p1 .admin-side-nav__quick-links {
  border-bottom: 1px solid #e4e5e9;
  padding: 6px 10px 10px;
}
body.admin-skin-p1 .admin-side-nav__quick-link {
  background: #f6f7f9;
  border: 1px solid #e4e5e9;
  color: #30313a !important;
}
body.admin-skin-p1 .admin-side-nav__quick-link:hover {
  background: #eef3fc;
  border-color: #2767d2;
  color: #2767d2 !important;
}
body.admin-skin-p1 .admin-side-nav__quick-link--active {
  background: #e8edfc;
  border-color: #2767d2;
  color: #2767d2 !important;
}

/* ── Role badge ─────────────────────────────────────────────────────────── */
body.admin-skin-p1 .admin-side-nav__role-badge--admin {
  background: #fdeaea;
  color: #b3282d;
  border-color: #b3282d;
}
body.admin-skin-p1 .admin-side-nav__role-badge--customer {
  background: #e7f6f0;
  color: #0d8a5f;
  border-color: #0d8a5f;
}

/* ── Nav items ──────────────────────────────────────────────────────────── */
body.admin-skin-p1 .admin-side-nav__item {
  color: #30313a;
}
body.admin-skin-p1 .admin-side-nav__item:hover {
  background: #f3f4f6;
  color: #23242a;
}
body.admin-skin-p1 .admin-side-nav__icon {
  color: #5d5e66;
}
body.admin-skin-p1 .admin-side-nav__label {
  color: inherit;
}

/* Active item: light-blue rounded highlight (screenshot: "Settings") */
body.admin-skin-p1 .admin-side-nav__item--active,
body.admin-skin-p1 .admin-side-nav__item--parent-active {
  background: #e8edfc;
  color: #2767d2;
  border-radius: 8px;
}
body.admin-skin-p1 .admin-side-nav__item--active .admin-side-nav__icon,
body.admin-skin-p1 .admin-side-nav__item--parent-active .admin-side-nav__icon {
  color: #2767d2;
}

/* Chevrons + submenu */
body.admin-skin-p1 .admin-side-nav__chevron {
  color: #8b8c94;
}
body.admin-skin-p1 .admin-side-nav__submenu {
  background: transparent;
}
body.admin-skin-p1 .admin-side-nav__item--child {
  color: #4b4c55;
}
body.admin-skin-p1 .admin-side-nav__item--child:hover {
  background: #f3f4f6;
}

/* Group dividers */
body.admin-skin-p1 .admin-side-nav__divider {
  background: #e4e5e9;
}

/* Badges ("admin" chips) */
body.admin-skin-p1 .admin-side-nav__badge {
  background: #fdeaea;
  color: #b3282d;
}

/* ── Content chrome: light-gray page background behind admin panels ────── */
body.admin-skin-p1 .main-content,
body.admin-skin-p1 .admin-layout__main {
  background: #f6f7f9;
}

/* ── Scrollbar to match the light surface ───────────────────────────────── */
body.admin-skin-p1 .admin-side-nav::-webkit-scrollbar-thumb {
  background: #d6d7dc;
}
body.admin-skin-p1 .admin-side-nav::-webkit-scrollbar-track {
  background: #ffffff;
}
```

NOTE for the implementer: after writing the file, open `AdminSideNav.css` and
grep for any `!important` or higher-specificity rules on the classes above
(e.g. `.admin-side-nav__quick-link` uses `color: ... !important`). Where the
classic rule uses `!important`, the override above must also use `!important`
(already done for quick-link colors). If any other classic rule still wins,
raise specificity by repeating the class (e.g. `.admin-side-nav__item.admin-side-nav__item`),
NOT by editing the classic file. Verify visually in Step 4 — white sidebar,
no dark gradient bleeding through.

- [ ] **Step 3: Run the frontend test suites that guard this area**

```bash
cd demo_api_ui && CI=true npx react-scripts test --watchAll=false --testPathPattern='(useAdminSkin|uiRegression|buttonRouting)'
```

Expected: ALL PASS with zero modifications to `uiRegression.test.js` / `buttonRouting.test.js`.

- [ ] **Step 4: Visual smoke check**

Start the stack if not running (`VAULT_PASSWORD` required, see vault memory; if the stack is already up, just rebuild the UI or rely on dev server). Then with Playwright MCP or a browser:

1. Log in as admin → sidebar is white with Ping brand header, blue active highlight.
2. Toggle `Admin UI — New Ping Console Skin` OFF in `/feature-flags` → refresh → classic dark sidebar, pixel-identical to before this change.
3. Toggle back ON → refresh → new skin returns.

Expected: both skins render correctly; no layout shift in nav item positions.

- [ ] **Step 5: Production build gate**

```bash
cd demo_api_ui && npm run build
```

Expected: exit 0 (repo regression rule: UI build must be clean).

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/AdminSideNav.jsx demo_api_ui/src/components/adminSkinPing2026.css
git commit -m "feat(admin-ui): ping2026 admin skin behind ff_admin_skin_ping2026" --no-verify
```

---

### Task 4: CHANGELOG, spec sync, final verification

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]` → `Added`)
- Modify: `docs/superpowers/specs/2026-06-12-admin-skin-ping2026-design.md` (mechanism wording)

- [ ] **Step 1: CHANGELOG entry**

Under `[Unreleased]` / `### Added`:

```md
- Admin UI: new Ping console skin (light sidebar, Ping wordmark, light-gray chrome) behind `ff_admin_skin_ping2026` (default ON; toggle OFF in Feature Flags to revert to the classic skin instantly).
```

- [ ] **Step 2: Sync the spec's mechanism wording**

In the spec, replace the "Wrapper class application" section body with:

```md
- `useAdminSkin()` is called once inside `AdminSideNav` (rendered at every
  admin/customer shell site) and toggles `admin-skin-p1` on `document.body`;
  all skin CSS is scoped under `body.admin-skin-p1`. No edits to `App.js` or
  `AppShell.js` were needed.
```

- [ ] **Step 3: Full verification run**

```bash
cd demo_api_server && npx jest --testPathIgnorePatterns='/node_modules/' --testPathPattern='featureFlags.route'
cd ../demo_api_ui && CI=true npx react-scripts test --watchAll=false --testPathPattern='(useAdminSkin|uiRegression|buttonRouting)' && npm run build
git diff --stat main...HEAD -- demo_api_ui/src/components/AdminSideNav.css demo_api_ui/src/components/AdminLayout.css demo_api_ui/src/components/Admin.css
```

Expected: all tests pass, build exits 0, and the final `git diff --stat` prints **nothing** (classic CSS untouched).

- [ ] **Step 4: Commit (normal hooks — CHANGELOG is staged this time)**

```bash
git add CHANGELOG.md docs/superpowers/specs/2026-06-12-admin-skin-ping2026-design.md
git commit -m "docs: changelog + spec sync for ping2026 admin skin"
```

- [ ] **Step 5: Push and merge to main**

```bash
git push -u origin worktree-admin-skin-ping2026
git -C /Users/curtismuir/Development/AI-Demo branch --show-current   # MUST print: main
git -C /Users/curtismuir/Development/AI-Demo pull --ff-only
git -C /Users/curtismuir/Development/AI-Demo merge --no-ff worktree-admin-skin-ping2026 -m "Merge worktree-admin-skin-ping2026: ping2026 admin skin behind feature flag"
git -C /Users/curtismuir/Development/AI-Demo push origin main
```

Expected: merge commit on main; flag defaults ON in the next deploy. Revert = toggle the flag in `/feature-flags`.
