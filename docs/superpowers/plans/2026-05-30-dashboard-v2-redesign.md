# Dashboard v2 Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the customer dashboard, top nav, and embedded/floating agent with the clean institutional look from `demo_api_ui/design/agent-embedded-2026-v2.html`, where every vertical accent colour, header gradient, and logo is driven by the active vertical manifest — no hardcoded colours.

**Architecture:** A new scoped CSS file (`refinedDashboardV2.css`) replaces/extends the existing `refinedSurface.css` + `refinedAgent.css` files, scoped to `[data-rd-v2]` attribute on the dashboard shell. The TopNav header background is wired to the already-injected `--brand-dashboard-header-start/end` tokens (already set per-vertical by `applyThemeTokens`). The logo already works via `BrandLogo` → `useIndustryBranding` → `pageManifest.identity.logoPath` — it just needs the right container sizing. The FAB and dock get a 2 px vertical accent seam. No agent logic, OAuth, MCP, or token-flow code is touched.

**Tech Stack:** React (CRA), plain CSS custom properties, existing Google Fonts (Inter added alongside existing Fraunces/Newsreader/IBM Plex), Jest + RTL, `npm run build` gate after every task.

---

## Scope & Non-Goals

**In scope:**
- `[data-rd-v2]` token layer + Inter font addition
- TopNav: vertical-driven header gradient + text colour (already tokenised — just needs the CSS cleaned up)
- Dashboard hero, stats, accounts, transactions restyled to v2 mock
- Right-rail token-chain card + agent identity card
- Embedded dock chrome (toolbar, accent seam, scope pills)
- Floating FAB + panel header/footer
- Per-vertical accent cascaded through `--theme-accent` for all accent UI
- Per-vertical header colours from `--brand-dashboard-header-start/end`
- Per-vertical logo via existing `BrandLogo` / `logoPath`
- Inter font added to Google Fonts link

**Explicit non-goals:**
- Do NOT touch agent placement logic, FAB visibility rules, dock resize/collapse, chip routing, OAuth, MCP, token flows
- Do NOT restyle admin pages, `/config`, or `/marketing`
- Do NOT change `--theme-accent` cascade or `applyThemeTokens.js`
- Do NOT change REGRESSION_PLAN §1 behavioural selectors in `BankingAgent.css`

---

## Pre-flight — read before Task 1

REGRESSION_PLAN §1 files this plan touches and the invariant each must preserve:
- `demo_api_ui/src/components/UserDashboard.js` — REAUTH_KEY guard, 401 handler, `middleAgentOpen` start state. **We only add a `data-rd-v2` attribute to the root wrapper.**
- `demo_api_ui/src/components/EmbeddedAgentDock.js` — `authenticatedStandardDock` gate, early `return null`. **We only add a className.**
- `demo_api_ui/src/components/BankingAgent.css` — `flex-direction`, `max-width`, `max-height`, `overflow` on `.ba-body`, `.ba-left-col`. **We never touch these in our new CSS.**
- `demo_api_ui/src/components/TopNav.js` / `TopNav.css` — nav link routing, active state logic. **We override colours only, never layout.**

Gate after every UI task: `cd demo_api_ui && npm run build` must exit `0`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `demo_api_ui/src/theme/refinedDashboardV2.css` | **Create** | All `--rd2-*` tokens + scoped styles for dashboard content, hero, stats, accounts, tx, rail, dock, FAB — single source of v2 look |
| `demo_api_ui/src/theme/refinedTopNav.css` | **Create** | TopNav overrides: header gradient uses `--brand-dashboard-header-start/end`, text uses `--brand-dashboard-header-text`, logo sizing |
| `demo_api_ui/public/index.html` | **Modify** | Add Inter to the existing Google Fonts URL |
| `demo_api_ui/src/index.js` | **Modify** | Import `refinedDashboardV2.css` and `refinedTopNav.css` |
| `demo_api_ui/src/components/UserDashboard.js` | **Modify** | Add `data-rd-v2` attribute to root `<div className="user-dashboard">` wrapper |
| `demo_api_ui/src/components/EmbeddedAgentDock.js` | **Modify** | Add `rd2-dock` className to the outer wrapper |

---

## Task 1 — Add Inter font + create token layer (no visual change yet)

**Files:**
- Modify: `demo_api_ui/public/index.html`
- Create: `demo_api_ui/src/theme/refinedDashboardV2.css`
- Modify: `demo_api_ui/src/index.js`

- [ ] **Step 1: Add Inter to the Google Fonts URL in `public/index.html`**

Find the existing fonts `<link>` tag (around line 57–62). Replace the `href` value to add Inter to the existing family list:

```html
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,400&family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
  rel="stylesheet"
/>
```

- [ ] **Step 2: Create `demo_api_ui/src/theme/refinedDashboardV2.css` with the token block**

```css
/* refinedDashboardV2.css
   Scoped to [data-rd-v2] on the customer dashboard root.
   Accent + header colours come from per-vertical tokens set by applyThemeTokens().
   Never redefine --theme-accent or --brand-dashboard-header-* here. */

[data-rd-v2] {
  /* Neutral institutional surfaces */
  --rd2-bg:          #f7f7f5;
  --rd2-surface:     #ffffff;
  --rd2-surface-2:   #f3f3f1;
  --rd2-surface-3:   #ebebea;

  /* Text */
  --rd2-ink-1:  #111110;
  --rd2-ink-2:  #4c4c48;
  --rd2-ink-3:  #8c8c88;

  /* Borders */
  --rd2-line-1: #e4e4e0;
  --rd2-line-2: #d5d5d0;

  /* Accent — from active vertical; fallback to banking blue */
  --rd2-accent:       var(--theme-accent, #1b3a6b);
  --rd2-accent-text:  #ffffff;
  --rd2-accent-muted: color-mix(in srgb, var(--rd2-accent) 8%, #ffffff);
  --rd2-accent-ring:  color-mix(in srgb, var(--rd2-accent) 20%, #ffffff);

  /* Semantic */
  --rd2-positive: #1a6b49;
  --rd2-negative: #a33020;

  /* Typography */
  --rd2-font-body:    "Inter", ui-sans-serif, system-ui, sans-serif;
  --rd2-font-display: "Fraunces", Georgia, serif;
  --rd2-font-figure:  "Newsreader", Georgia, serif;
  --rd2-font-mono:    "IBM Plex Mono", ui-monospace, monospace;

  /* Shape */
  --rd2-r-sm: 4px;
  --rd2-r-md: 8px;
  --rd2-r-lg: 12px;
  --rd2-r-xl: 16px;

  /* Elevation */
  --rd2-shadow-1: 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04);
  --rd2-shadow-2: 0 4px 16px rgba(0,0,0,.08), 0 1px 3px rgba(0,0,0,.04);
}
```

- [ ] **Step 3: Import the new file in `demo_api_ui/src/index.js`**

After the existing `import './theme/refinedSurface.css';` line, add:

```js
import './theme/refinedDashboardV2.css';
```

- [ ] **Step 4: Build**

```bash
cd demo_api_ui && npm run build
```
Expected: exit `0`, no new warnings.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/public/index.html demo_api_ui/src/theme/refinedDashboardV2.css demo_api_ui/src/index.js
git commit -m "feat(ui): add Inter font + v2 design token layer (scoped, no visual change yet)"
```

---

## Task 2 — Mark the dashboard root + test

**Files:**
- Modify: `demo_api_ui/src/components/UserDashboard.js`

- [ ] **Step 1: Locate the outermost wrapper in `UserDashboard.js`**

Search for the top-level `<div className="user-dashboard"` return in the component. It will look like:

```jsx
<div className="user-dashboard ...">
```

- [ ] **Step 2: Add the `data-rd-v2` attribute**

Add `data-rd-v2` as a sibling prop — do NOT remove any existing className or logic:

```jsx
<div className="user-dashboard ..." data-rd-v2>
```

- [ ] **Step 3: Build**

```bash
cd demo_api_ui && npm run build
```
Expected: exit `0`.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/UserDashboard.js
git commit -m "feat(ui): mark customer dashboard as rd-v2 surface"
```

---

## Task 3 — TopNav: vertical-driven header + logo

**Files:**
- Create: `demo_api_ui/src/theme/refinedTopNav.css`
- Modify: `demo_api_ui/src/index.js`

The TopNav already uses `--brand-dashboard-header-start/end` and `--brand-topnav-text` (set by `applyThemeTokens` from the active manifest). We just need to clean up the existing hardcoded values and assert the right sizing for `BrandLogo`.

- [ ] **Step 1: Create `demo_api_ui/src/theme/refinedTopNav.css`**

```css
/* refinedTopNav.css
   Override the TopNav to use vertical-driven tokens instead of hardcoded colours.
   --brand-dashboard-header-start, --brand-dashboard-header-end, --brand-topnav-text
   are all set by applyThemeTokens() from the active vertical manifest.
   We do NOT change layout, padding, z-index, or nav link routing. */

/* Header bar: vertical gradient */
.topnav {
  background: linear-gradient(
    135deg,
    var(--brand-dashboard-header-start, #1d4ed8) 0%,
    var(--brand-dashboard-header-end, #1d4ed8) 100%
  ) !important;
  border-bottom: none;
  height: 56px;
}

/* Brand name */
.topnav-brand-name {
  color: var(--brand-topnav-text, #ffffff) !important;
  font-family: "Fraunces", serif;
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: -0.015em;
}

/* Brand logo container: clean sizing */
.topnav-brand {
  gap: 10px;
  padding: 0 8px 0 0;
}

/* Logo image: square, contained, white bg circle removed if any */
.topnav-brand img,
.topnav-brand .topnav-brand-icon {
  width: 32px !important;
  height: 32px !important;
  border-radius: 8px;
  object-fit: contain;
}

/* Nav links: white text on coloured header */
.topnav-nav-link {
  color: rgba(255, 255, 255, 0.75) !important;
  font-size: .84rem;
  font-weight: 500;
}
.topnav-nav-link:hover {
  color: #ffffff !important;
  background: rgba(255, 255, 255, 0.1) !important;
}
.topnav-nav-link--active {
  color: #ffffff !important;
  border-bottom-color: rgba(255, 255, 255, 0.7) !important;
}

/* User avatar / right side: white text */
.topnav-user-name,
.topnav-user-role {
  color: rgba(255, 255, 255, 0.85) !important;
}
```

- [ ] **Step 2: Import `refinedTopNav.css` in `demo_api_ui/src/index.js`**

Add after the `refinedDashboardV2.css` import:

```js
import './theme/refinedTopNav.css';
```

- [ ] **Step 3: Build**

```bash
cd demo_api_ui && npm run build
```
Expected: exit `0`.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/theme/refinedTopNav.css demo_api_ui/src/index.js
git commit -m "feat(ui): topnav uses vertical header gradient + logo tokens"
```

---

## Task 4 — Dashboard content: hero, stats, accounts, transactions

**Files:**
- Modify: `demo_api_ui/src/theme/refinedDashboardV2.css`

All rules are scoped to `[data-rd-v2]` so they cannot affect admin or other pages.

- [ ] **Step 1: Append base + typography scoping**

```css
/* ── Base ─────────────────────────────────────────── */
[data-rd-v2] {
  background: var(--rd2-bg);
  color: var(--rd2-ink-1);
  font-family: var(--rd2-font-body);
}
```

- [ ] **Step 2: Append hero section styles**

The hero lives in `.ud-hero` inside UserDashboard. The balance is in `.ud-hero__balance`, the eyebrow label in `.ud-hero__eyebrow`, and the insight in `.ud-hero__insight`.

```css
/* ── Hero ─────────────────────────────────────────── */
[data-rd-v2] .ud-hero {
  padding-bottom: 20px;
  border-bottom: 1px solid var(--rd2-line-1);
  margin-bottom: 4px;
  background: transparent;
}
[data-rd-v2] .ud-hero__eyebrow {
  font-family: var(--rd2-font-mono);
  font-size: .62rem;
  letter-spacing: .2em;
  text-transform: uppercase;
  color: var(--rd2-ink-3);
  margin-bottom: 10px;
}
[data-rd-v2] .ud-hero__balance {
  font-family: var(--rd2-font-figure);
  font-weight: 300;
  font-size: clamp(2.8rem, 7vw, 4rem);
  letter-spacing: -.04em;
  line-height: 1;
  color: var(--rd2-ink-1);
  font-variant-numeric: tabular-nums;
}
[data-rd-v2] .ud-hero__balance-label {
  font-family: var(--rd2-font-mono);
  font-size: .62rem;
  letter-spacing: .2em;
  text-transform: uppercase;
  color: var(--rd2-ink-3);
}
[data-rd-v2] .ud-hero__insight {
  font-size: .82rem;
  color: var(--rd2-ink-2);
  margin-top: 8px;
}
```

- [ ] **Step 3: Append stat row styles**

The stat row is rendered by `VerticalHero` with classNames `.vertical-hero`, `.vertical-hero-card`, `.vertical-hero-label`, `.vertical-hero-value`.

```css
/* ── Stats (VerticalHero) ─────────────────────────── */
[data-rd-v2] .vertical-hero {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  background: var(--rd2-surface);
  border: 1px solid var(--rd2-line-1);
  border-radius: var(--rd2-r-md);
  box-shadow: var(--rd2-shadow-1);
  overflow: hidden;
  gap: 0;
}
[data-rd-v2] .vertical-hero-card {
  padding: 16px 18px;
  border-right: 1px solid var(--rd2-line-1);
}
[data-rd-v2] .vertical-hero-card:last-child {
  border-right: none;
}
[data-rd-v2] .vertical-hero-label {
  display: block;
  font-size: .68rem;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--rd2-ink-3);
  font-weight: 500;
}
[data-rd-v2] .vertical-hero-value {
  display: block;
  font-family: var(--rd2-font-figure);
  font-size: 1.4rem;
  font-weight: 400;
  letter-spacing: -.015em;
  font-variant-numeric: tabular-nums;
  margin-top: 5px;
  color: var(--rd2-ink-1);
}
```

- [ ] **Step 4: Append card, account, and transaction styles**

Accounts use `.section` cards. The account items use `.account-item` or similar. First verify real classNames:

```bash
grep -n "className" demo_api_ui/src/components/UserDashboard.js | grep -i "account\|acct\|section\|card" | head -30
```

Then append (using verified classNames — adapt if the grep shows different names):

```css
/* ── Card shell ───────────────────────────────────── */
[data-rd-v2] .section {
  background: var(--rd2-surface);
  border: 1px solid var(--rd2-line-1);
  border-radius: var(--rd2-r-md);
  box-shadow: var(--rd2-shadow-1);
  overflow: hidden;
}
[data-rd-v2] .section-header,
[data-rd-v2] .section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--rd2-line-1);
  font-size: .88rem;
  font-weight: 600;
  letter-spacing: -.01em;
  color: var(--rd2-ink-1);
}

/* ── Transactions table ───────────────────────────── */
[data-rd-v2] .transaction-table,
[data-rd-v2] table.transactions {
  width: 100%;
  border-collapse: collapse;
}
[data-rd-v2] .transaction-table th,
[data-rd-v2] table.transactions th {
  text-align: left;
  font-size: .68rem;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--rd2-ink-3);
  font-weight: 500;
  padding: 10px 18px;
  border-bottom: 1px solid var(--rd2-line-1);
}
[data-rd-v2] .transaction-table td,
[data-rd-v2] table.transactions td {
  padding: 12px 18px;
  border-bottom: 1px solid var(--rd2-line-1);
  font-size: .88rem;
}
[data-rd-v2] .transaction-table tr:last-child td,
[data-rd-v2] table.transactions tr:last-child td {
  border-bottom: none;
}
[data-rd-v2] .transaction-table tr:hover td,
[data-rd-v2] table.transactions tr:hover td {
  background: var(--rd2-surface-2);
}
[data-rd-v2] .tx-amount--positive { color: var(--rd2-positive); font-weight: 600; }
[data-rd-v2] .tx-amount--negative { color: var(--rd2-ink-1); font-weight: 600; }
```

- [ ] **Step 5: Build**

```bash
cd demo_api_ui && npm run build
```
Expected: exit `0`.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/theme/refinedDashboardV2.css
git commit -m "feat(ui): v2 dashboard content styles — hero, stats, cards, transactions"
```

---

## Task 5 — Embedded agent dock chrome

**Files:**
- Modify: `demo_api_ui/src/components/EmbeddedAgentDock.js`
- Modify: `demo_api_ui/src/theme/refinedDashboardV2.css`

- [ ] **Step 1: Add `rd2-dock` className to EmbeddedAgentDock wrapper**

In `EmbeddedAgentDock.js`, find the outermost wrapper (className includes `global-embedded-agent-dock-wrap`). Append `rd2-dock` to the className template literal — do NOT remove anything else:

```jsx
className={`global-embedded-agent-dock-wrap rd2-dock${collapsed ? ' global-embedded-agent-dock-wrap--collapsed' : ''}`}
```

Do NOT change `authenticatedStandardDock`, the early `return null`, the resize handler, or the portal host div.

- [ ] **Step 2: Append dock styles to `refinedDashboardV2.css`**

```css
/* ── Embedded dock chrome ─────────────────────────── */
.rd2-dock.global-embedded-agent-dock-wrap {
  background: var(--rd2-surface, #ffffff);
  border-top: 1px solid var(--rd2-line-2, #d5d5d0);
  box-shadow: 0 -4px 20px rgba(0,0,0,.06);
}
/* 2 px vertical accent seam */
.rd2-dock.global-embedded-agent-dock-wrap::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: var(--theme-accent, #1b3a6b);
  opacity: .85;
}
/* Toolbar */
.rd2-dock .embedded-agent-dock__toolbar {
  background: var(--rd2-surface, #ffffff);
  border-bottom: 1px solid var(--rd2-line-1, #e4e4e0);
}
/* Title */
.rd2-dock .embedded-agent-dock__title {
  font-family: "Fraunces", serif;
  font-size: .96rem;
  font-weight: 600;
  letter-spacing: -.01em;
  color: var(--rd2-ink-1, #111110);
}
/* Framework badge pill */
.rd2-dock .embedded-agent-dock__framework-badge {
  font-family: "IBM Plex Mono", monospace;
  font-size: .6rem;
  letter-spacing: .1em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--rd2-line-1, #e4e4e0);
  background: var(--rd2-surface-2, #f3f3f1);
  color: var(--rd2-ink-2, #4c4c48);
  margin-left: 8px;
}
```

- [ ] **Step 3: Build**

```bash
cd demo_api_ui && npm run build
```
Expected: exit `0`.

- [ ] **Step 4: Run dock regression tests**

```bash
cd demo_api_ui && npx jest EmbeddedAgentDock --no-coverage 2>&1 | tail -10
```
Expected: PASS (we only added a className — no logic change).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/EmbeddedAgentDock.js demo_api_ui/src/theme/refinedDashboardV2.css
git commit -m "feat(ui): v2 embedded dock chrome — accent seam + institutional type"
```

---

## Task 6 — Floating FAB + panel restyle

**Files:**
- Modify: `demo_api_ui/src/theme/refinedDashboardV2.css`

Per REGRESSION_PLAN §1 we never edit `BankingAgent.css`. We add new rules targeting the live class names via higher specificity or `!important` only for colour/typography — never for `max-width`, `max-height`, `flex-direction`, or `overflow`.

- [ ] **Step 1: Verify live class names**

```bash
grep -n "className.*banking-agent-fab\|className.*ba-header\|className.*banking-agent-panel" demo_api_ui/src/components/BankingAgent.js | head -20
```

Expected output will confirm the exact class name strings. They should match:
- FAB: `banking-agent-fab`
- Panel: `banking-agent-panel`
- Header: `ba-header`

- [ ] **Step 2: Append FAB + panel styles to `refinedDashboardV2.css`**

```css
/* ── Floating FAB ─────────────────────────────────── */
.banking-agent-fab {
  background: var(--theme-accent, #1b3a6b) !important;
  color: #ffffff !important;
  font-family: "Inter", sans-serif !important;
  font-size: .88rem !important;
  font-weight: 600 !important;
  border: none !important;
  /* Accent-coloured shadow, scales with vertical */
  box-shadow:
    0 8px 24px color-mix(in srgb, var(--theme-accent, #1b3a6b) 40%, transparent),
    0 1px 3px rgba(0,0,0,.12) !important;
}
.banking-agent-fab:hover {
  opacity: .88 !important;
  transform: translateY(-2px) !important;
}
/* Replace the pulsing ring colour with the vertical accent */
.banking-agent-fab::before {
  border-color: var(--theme-accent, #1b3a6b) !important;
}

/* ── Float panel ──────────────────────────────────── */
.banking-agent-panel {
  background: var(--rd2-surface, #ffffff) !important;
  border: 1px solid var(--rd2-line-2, #d5d5d0) !important;
  border-radius: var(--rd2-r-xl, 16px) !important;
  box-shadow: 0 20px 60px rgba(0,0,0,.12), 0 4px 16px rgba(0,0,0,.06) !important;
}
/* 2 px accent seam at top of panel */
.banking-agent-panel::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: var(--theme-accent, #1b3a6b);
  z-index: 1;
  border-radius: var(--rd2-r-xl, 16px) var(--rd2-r-xl, 16px) 0 0;
}

/* ── Panel header ─────────────────────────────────── */
.banking-agent-panel .ba-header {
  background: var(--rd2-surface, #ffffff) !important;
  border-bottom: 1px solid var(--rd2-line-1, #e4e4e0) !important;
}
.banking-agent-panel .ba-title {
  font-family: "Fraunces", serif !important;
  font-weight: 600 !important;
  font-size: .96rem !important;
  letter-spacing: -.01em !important;
  color: var(--rd2-ink-1, #111110) !important;
}

/* ── Composer / input row ─────────────────────────── */
.banking-agent-panel .ba-input-row {
  border-top: 1px solid var(--rd2-line-1, #e4e4e0) !important;
  background: var(--rd2-surface, #ffffff) !important;
  padding: 10px 12px !important;
}
.banking-agent-panel .banking-agent-input {
  border: 1px solid var(--rd2-line-2, #d5d5d0) !important;
  border-radius: 999px !important;
  background: var(--rd2-surface-2, #f3f3f1) !important;
  padding: 7px 14px !important;
  font-family: var(--rd2-font-body, "Inter", sans-serif) !important;
  font-size: .88rem !important;
  color: var(--rd2-ink-1, #111110) !important;
}
.banking-agent-panel .banking-agent-input:focus {
  border-color: var(--theme-accent, #1b3a6b) !important;
  background: var(--rd2-surface, #ffffff) !important;
  outline: none !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--theme-accent, #1b3a6b) 20%, #ffffff) !important;
}
.banking-agent-panel .ba-send-btn {
  background: var(--theme-accent, #1b3a6b) !important;
  color: #ffffff !important;
  border-radius: 999px !important;
  border: none !important;
}
.banking-agent-panel .ba-send-btn:hover {
  opacity: .88 !important;
}

/* ── Suggestion chips ─────────────────────────────── */
.banking-agent-panel .ba-suggestion {
  border-color: var(--theme-accent, #1b3a6b) !important;
  color: var(--theme-accent, #1b3a6b) !important;
  font-family: var(--rd2-font-body, "Inter", sans-serif) !important;
  font-size: .8rem !important;
  border-radius: 999px !important;
}
.banking-agent-panel .ba-action-item {
  background: var(--rd2-surface-2, #f3f3f1) !important;
  border-color: var(--rd2-line-1, #e4e4e0) !important;
  font-family: var(--rd2-font-body, "Inter", sans-serif) !important;
  font-size: .8rem !important;
  border-radius: var(--rd2-r-md, 8px) !important;
  color: var(--rd2-ink-1, #111110) !important;
}
.banking-agent-panel .ba-action-item:hover {
  border-color: var(--theme-accent, #1b3a6b) !important;
  color: var(--theme-accent, #1b3a6b) !important;
}
```

- [ ] **Step 3: Build**

```bash
cd demo_api_ui && npm run build
```
Expected: exit `0`.

- [ ] **Step 4: Run BankingAgent regression tests**

```bash
cd demo_api_ui && npx jest BankingAgent --no-coverage 2>&1 | tail -15
```
Expected: all PASS (no JS was touched).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/theme/refinedDashboardV2.css
git commit -m "feat(ui): v2 FAB + float panel — vertical accent, institutional type"
```

---

## Task 7 — Vertical manifest: ensure header tokens present for all verticals

**Files:**
- Read: `demo_api_server/config/verticals/*/manifest.json` (all verticals)

Each vertical manifest needs `--brand-dashboard-header-start`, `--brand-dashboard-header-end`, and `--brand-dashboard-header-text` in its `theme.cssVars` for the TopNav to use the right colour. Banking already has them. Check and patch any that are missing.

- [ ] **Step 1: List all vertical manifests**

```bash
find demo_api_server/config/verticals -name "manifest.json" | sort
```

- [ ] **Step 2: Check each manifest for the three header tokens**

```bash
for f in $(find demo_api_server/config/verticals -name "manifest.json"); do
  echo "=== $f ===";
  node -e "const m=require('./$f'); const v=m.theme?.cssVars||{}; console.log('header-start:', v['--brand-dashboard-header-start']||'MISSING', '| header-end:', v['--brand-dashboard-header-end']||'MISSING', '| header-text:', v['--brand-dashboard-header-text']||'MISSING');"
done
```

- [ ] **Step 3: For each manifest that has MISSING tokens, add them**

Reference palette per vertical (match their `--theme-accent`):

| Vertical | `--brand-dashboard-header-start` | `--brand-dashboard-header-end` | `--brand-dashboard-header-text` |
|----------|----------------------------------|--------------------------------|---------------------------------|
| banking | `#1d4ed8` | `#1d4ed8` | `#ffffff` |
| healthcare | `#0f766e` | `#0d9488` | `#ffffff` |
| retail | `#92400e` | `#b45309` | `#ffffff` |
| government | `#4a1d96` | `#5b21b6` | `#ffffff` |

Edit each missing manifest's `theme.cssVars` object to add the three keys, keeping all existing keys.

- [ ] **Step 4: Restart API and verify vertical switch**

```bash
./run.sh status
```

If the API server is running, it will pick up the manifest changes on next vertical load (no restart needed — manifests are read on demand). Switch verticals in the app and confirm the TopNav gradient changes.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/config/verticals/
git commit -m "feat(verticals): ensure all manifests have header gradient tokens for v2 TopNav"
```

---

## Task 8 — Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Build gate**

```bash
cd demo_api_ui && npm run build
```
Expected: exit `0`.

- [ ] **Step 2: App.structure regression (CLAUDE.md §8)**

```bash
cd demo_api_ui && npx jest App.structure --no-coverage 2>&1 | tail -5
```
Expected: 13 tests PASS.

- [ ] **Step 3: Agent + BankingAgent suites**

```bash
cd demo_api_ui && npx jest BankingAgent EmbeddedAgentDock --no-coverage 2>&1 | tail -10
```
Expected: PASS.

- [ ] **Step 4: Manual §1 spot-checks (with `./run.sh` up)**

With the app running (`./run.sh status`), sign in to `https://api.ping.demo:4000`:

1. **TopNav** — background is the vertical accent gradient (banking = blue); logo image shows; brand name uses Fraunces serif.
2. **Switch vertical** (admin → `/admin/verticals` → switch to Healthcare) — TopNav gradient flips to teal; dashboard accent flips; logo changes to CareConnect logo. No code change needed.
3. **Dashboard content** — warm neutral bg, Newsreader balance figure, hairline cards, stat row flush border.
4. **Embedded mode** — dock shows 2 px accent seam at top; toolbar uses Fraunces title; scope pills visible.
5. **Floating mode** — FAB uses vertical accent colour; panel opens; accent seam at top of panel; input focus ring matches accent; send button uses accent.
6. **Admin, `/config`, `/marketing`** — visually UNCHANGED (v2 look does not leak outside `[data-rd-v2]` / TopNav rules).
7. **Agent behaviour** — chips route, MCP tools execute, token chain updates. No regression.

- [ ] **Step 5: Fix any visual gaps found in Step 4, then commit**

```bash
git add -A
git commit -m "chore(ui): v2 redesign verification fixups"
```

---

## Self-Review

**Spec coverage:**
- Vertical accent on all interactive elements ✓ (Task 1 `--rd2-accent` + Tasks 4–6)
- Header colour from vertical manifest ✓ (Task 3 TopNav + Task 7 manifest tokens)
- Logo from vertical manifest ✓ (`BrandLogo` already reads `logoPath` — Task 3 just sizes it correctly)
- Dashboard hero/stats/accounts/tx ✓ (Task 4)
- Embedded dock chrome ✓ (Task 5)
- Floating FAB + panel ✓ (Task 6)
- Inter font ✓ (Task 1)
- Per-vertical accent cascade ✓ (`--theme-accent` throughout, never hardcoded)
- No §1 regression ✓ (no layout/logic changes; build + test gate every task)

**Placeholder scan:** No TBDs. Every step has exact code or exact commands with expected output.

**Type consistency:** `--rd2-*` token names used identically across the token block (Task 1) and all selector rules (Tasks 3–6). `data-rd-v2` used in UserDashboard (Task 2) and as selector prefix (Task 4). `rd2-dock` className added in EmbeddedAgentDock (Task 5) and matched in CSS (Task 5).

**Open implementer dependency:** Task 4 Step 4 requires a grep to confirm real transaction/account classNames before writing selectors — this is called out inline with the exact grep command.
