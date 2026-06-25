# Theme Distinction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each theme unmistakably distinct on switch — Great Buy gets a black/yellow identity, all yellow buttons use black text, and the TopNav picks up the theme color for retail.

**Architecture:** All changes are CSS variable values — either in vertical JSON config files (server) or CSS fallback defaults (client). No logic changes. New vars `--brand-topnav-bg-start`, `--brand-topnav-bg-end`, and `--brand-topnav-text` drive TopNav theming; existing vars already wire up buttons and headers correctly.

**Tech Stack:** CSS custom properties, vertical JSON config files, React (TopNav.css, DashboardHeader.css, index.css)

---

### Task 1: Add TopNav theme vars to CSS

**Files:**
- Modify: `demo_api_ui/src/components/TopNav.css:1-10` (`.topnav` rule)
- Modify: `demo_api_ui/src/components/TopNav.css:70-76` (`.topnav-brand-name` rule)
- Modify: `demo_api_ui/src/index.css:31-38` (`:root` block — add new var defaults)

- [ ] **Step 1: Add fallback defaults for new TopNav vars to `:root` in `index.css`**

Open `demo_api_ui/src/index.css`. After line 38 (`--app-primary-btn-text: #ffffff;`), add:

```css
  --brand-topnav-bg-start: #1e293b;
  --brand-topnav-bg-end: #334155;
  --brand-topnav-text: #ffffff;
```

- [ ] **Step 2: Wire TopNav background to the new vars in `TopNav.css`**

In `demo_api_ui/src/components/TopNav.css`, replace the `.topnav` background line:

Old:
```css
.topnav {
  background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
```

New:
```css
.topnav {
  background: linear-gradient(135deg, var(--brand-topnav-bg-start, #1e293b) 0%, var(--brand-topnav-bg-end, #334155) 100%);
```

- [ ] **Step 3: Wire TopNav brand name color to the new var in `TopNav.css`**

In `demo_api_ui/src/components/TopNav.css`, replace the `.topnav-brand-name` color line:

Old:
```css
.topnav-brand-name {
  font-size: 20px;
  font-weight: 600;
  color: #ffffff;
```

New:
```css
.topnav-brand-name {
  font-size: 20px;
  font-weight: 600;
  color: var(--brand-topnav-text, #ffffff);
```

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/TopNav.css demo_api_ui/src/index.css
git commit -m "feat(theme): add --brand-topnav-bg and --brand-topnav-text CSS vars"
```

---

### Task 2: Update Great Buy vertical JSON — black/yellow identity

**Files:**
- Modify: `demo_api_server/config/verticals/retail.json`

- [ ] **Step 1: Replace the `theme.cssVars` block in `retail.json`**

Open `demo_api_server/config/verticals/retail.json`. Replace the entire `"theme"` block:

Old:
```json
"theme": {
  "cssVars": {
    "--app-primary-red": "#FFE000",
    "--app-primary-red-hover": "#FFCC00",
    "--app-primary-red-mid": "#FFE933",
    "--app-primary-red-border": "#E6CC00",
    "--app-primary-btn-text": "#1D1D1B",
    "--brand-dashboard-header-start": "#0046BE",
    "--brand-dashboard-header-end": "#003a9e",
    "--brand-app-shell-hero-start": "#0046BE",
    "--brand-app-shell-hero-end": "#003a9e",
    "--theme-accent": "#FFE000",
    "--brand-dashboard-header-text": "#ffffff"
  }
},
```

New:
```json
"theme": {
  "cssVars": {
    "--app-primary-red": "#FFE000",
    "--app-primary-red-hover": "#FFCC00",
    "--app-primary-red-mid": "#FFE933",
    "--app-primary-red-border": "#E6CC00",
    "--app-primary-btn-text": "#1D1D1B",
    "--brand-dashboard-header-start": "#1D1D1B",
    "--brand-dashboard-header-end": "#2d2d2b",
    "--brand-app-shell-hero-start": "#1D1D1B",
    "--brand-app-shell-hero-end": "#2d2d2b",
    "--theme-accent": "#FFE000",
    "--brand-dashboard-header-text": "#FFE000",
    "--brand-topnav-bg-start": "#1D1D1B",
    "--brand-topnav-bg-end": "#2d2d2b",
    "--brand-topnav-text": "#FFE000"
  }
},
```

- [ ] **Step 2: Commit**

```bash
git add demo_api_server/config/verticals/retail.json
git commit -m "feat(theme): Great Buy — black/yellow header and TopNav identity"
```

---

### Task 3: Fix DashboardHeader badge colors for themed headers

**Files:**
- Modify: `demo_api_ui/src/components/DashboardHeader.css:61-69`

The customer and admin badge classes use hardcoded light blue/green backgrounds that look wrong on a dark header. Replace with semi-transparent white that works on any colored header.

- [ ] **Step 1: Replace badge variant classes in `DashboardHeader.css`**

Open `demo_api_ui/src/components/DashboardHeader.css`. Replace:

Old:
```css
.sb-dashboard-header__badge--customer {
  background: #eff6ff;
  color: #0369a1;
}

.sb-dashboard-header__badge--admin {
  background: #f0fdf4;
  color: #166534;
}
```

New:
```css
.sb-dashboard-header__badge--customer {
  background: rgba(255, 255, 255, 0.18);
  color: var(--brand-dashboard-header-text, #ffffff);
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.sb-dashboard-header__badge--admin {
  background: rgba(255, 255, 255, 0.18);
  color: var(--brand-dashboard-header-text, #ffffff);
  border: 1px solid rgba(255, 255, 255, 0.25);
}
```

- [ ] **Step 2: Commit**

```bash
git add demo_api_ui/src/components/DashboardHeader.css
git commit -m "fix(theme): dashboard badge adapts to themed header text color"
```

---

### Task 4: Build and verify

- [ ] **Step 1: Run the UI build**

```bash
cd demo_api_ui && npm run build
```

Expected: exit code 0, no errors.

- [ ] **Step 2: Restart the API server to pick up JSON changes**

```bash
./run.sh stop && ./run.sh
```

Or if already running, the server hot-reloads JSON on next request — just refresh the browser after switching themes.

- [ ] **Step 3: Manual verification checklist**

Open `https://api.ping.demo:4000/dashboard` (or `http://localhost:4000/dashboard`).

1. Switch to **Great Buy**: TopNav turns black with yellow "Great Buy" brand name. Dashboard header is dark with yellow title text. Body background is white. Buttons are yellow with black text.
2. Switch back to **Super Banking**: TopNav returns to dark slate. Dashboard header is navy. Clearly different from Great Buy.
3. Switch to **CareConnect**: TopNav stays dark slate. Header is teal. No regression.
4. Switch to **Super Sports**: TopNav stays dark slate. Header is red. No regression.
5. Switch to **WX Workforce**: TopNav stays dark slate. Header is purple. No regression.

- [ ] **Step 4: Final commit if any fixes were needed, otherwise done**

All 5 themes switch with immediately obvious visual distinction. ✅
