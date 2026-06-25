# Refined Dashboard + Agent Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the signed-in **customer dashboard** and its **embedded + floating banking agent** with the refined "institutional" look from the approved mockup (`demo_api_ui/design/agent-embedded-2026-redesign.html`), driven by per-vertical accent (`--theme-accent`), without regressing any REGRESSION_PLAN §1 surface.

**Architecture:** The app already themes per-vertical via CSS custom properties written to `:root` by `applyThemeTokens.js` (accent cascades through `--theme-accent` → `--brand-navy`, referenced by 89 files). We do **not** touch that cascade. Instead we add a **new scoped design layer** — a set of `--rd-*` ("refined design") tokens plus a `data-refined-surface` attribute on the customer-dashboard shell — so the new look applies only on the customer dashboard surface, leaves admin/config/marketing untouched, and reads accent from the existing per-vertical vars. The embedded dock chrome (`EmbeddedAgentDock.js`) and floating agent shell (`BankingAgent.css`) are restyled via new CSS only; their JS behavior (resize, collapse, placement gating, portal host) is left byte-for-byte intact to satisfy §1.

**Tech Stack:** React (CRA), plain CSS custom properties, Google Fonts (Fraunces + Newsreader + IBM Plex Sans/Mono), Jest + React Testing Library, Playwright (e2e smoke).

---

## Scope & Non-Goals

**In scope (this plan):**
- New `--rd-*` token layer + Google Fonts, scoped to a `data-refined-surface="customer"` container.
- Customer dashboard content restyle: hero/balance, stat cards, accounts, transactions, token-chain rail.
- Embedded agent **dock chrome** restyle (toolbar/title/resize seam/background).
- Floating agent **shell** restyle (FAB + panel header/footer) to the institutional look.
- Accent remains **per-vertical** (banking blue, healthcare teal, retail yellow) via `--theme-accent`.

**Explicit non-goals (do NOT do in this plan):**
- Do NOT restyle admin pages, `/config`, marketing/`/marketing`, or modals globally.
- Do NOT change `--font-primary`, body background, or any global `:root` default that non-dashboard pages inherit.
- Do NOT change agent placement logic, FAB visibility rules, dock resize/collapse logic, the bottom-dock tile-strip direction, or the middle-layout start state (all §1).
- Do NOT touch accent plumbing (`--theme-accent` / `--brand-navy` cascade) or `applyThemeTokens.js`.
- Do NOT change chip routing ids/messages, OAuth, MCP, or token flows.

---

## Pre-flight (read before Task 1)

REGRESSION_PLAN §1 files this plan **touches** and the invariant each must preserve:
- `demo_api_ui/src/components/UserDashboard.js` — REAUTH_KEY guard, 401 handler, `middleAgentOpen` start state. **We only add a wrapper attribute/className; touch no logic.**
- `demo_api_ui/src/components/EmbeddedAgentDock.js` — bottom-dock-vs-FAB rule, no `isBankingAgentDashboardRoute` guard. **We only add CSS classNames; the `authenticatedStandardDock` gate and early `return null` stay identical.**
- `demo_api_ui/src/components/BankingAgent.css` — float panel resize caps, bottom-dock `.ba-body` `column-reverse`, `.ba-left-col` horizontal strip. **We add new rules; we do NOT alter the listed selectors' flex-direction or max-width/height.**
- `demo_api_ui/src/App.js` — App.js merge-drop rule + App.structure tests. **We touch App.js only if Task 2 needs the surface attribute there; if so, run `npx jest App.structure` after (per CLAUDE.md §8).**

Gate after every UI task: `cd demo_api_ui && npm run build` must exit `0` (CLAUDE.md §3).

---

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `demo_api_ui/src/theme/refinedSurface.css` | **Create** | All `--rd-*` tokens + `[data-refined-surface="customer"]` scoped styles for dashboard content, hero, stats, accounts, tx, rail. Single source of the new look. |
| `demo_api_ui/src/theme/refinedAgent.css` | **Create** | Scoped restyle of embedded dock chrome + floating agent shell, reading `--rd-*` + `--theme-accent`. |
| `demo_api_ui/public/index.html` | **Modify** | Add Google Fonts `<link>` (preconnect + stylesheet) for Fraunces/Newsreader/IBM Plex. |
| `demo_api_ui/src/index.js` (or `App.js` import block) | **Modify** | `import './theme/refinedSurface.css'` and `'./theme/refinedAgent.css'` so they ship in the bundle (after `index.css` so they win specificity ties). |
| `demo_api_ui/src/components/UserDashboard.js` | **Modify** | Add `data-refined-surface="customer"` + a className to the dashboard root wrapper. No logic change. |
| `demo_api_ui/src/components/EmbeddedAgentDock.js` | **Modify** | Add `refined-dock` className(s) to the existing wrapper/toolbar nodes. No logic change. |
| `demo_api_ui/src/theme/__tests__/refinedSurface.test.js` | **Create** | Asserts the surface attribute renders on the dashboard and the CSS files are imported. |

The new look lives in **two new CSS files**, isolated behind a data-attribute. This keeps the diff reviewable, the blast radius contained, and rollback trivial (remove two imports + one attribute).

---

### Task 1: Add the refined token layer + Google Fonts (no visual change yet)

**Files:**
- Create: `demo_api_ui/src/theme/refinedSurface.css`
- Modify: `demo_api_ui/public/index.html`
- Modify: `demo_api_ui/src/index.js`

- [ ] **Step 1: Add Google Fonts to `public/index.html`**

Find the `<head>` and add, immediately before `</head>`:

```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
```

- [ ] **Step 2: Create `refinedSurface.css` with the token block + scoped base**

Create `demo_api_ui/src/theme/refinedSurface.css`:

```css
/* refinedSurface.css — refined "institutional" look, scoped to the signed-in
   customer dashboard via [data-refined-surface="customer"]. Accent is NOT
   redefined here: it cascades from the per-vertical --theme-accent so banking
   stays blue, healthcare teal, retail yellow. */

[data-refined-surface="customer"] {
  /* Neutral institutional palette (vertical-independent) */
  --rd-paper:        #f6f4ef;
  --rd-surface:      #fffefb;
  --rd-surface-sunk: #f1eee7;
  --rd-ink:          #1a1a17;
  --rd-ink-soft:     #57534c;
  --rd-ink-faint:    #8a857c;
  --rd-line:         #e3ddd2;
  --rd-line-strong:  #d4cdbf;
  --rd-positive:     #1f6b4a;
  --rd-negative:     #9a3526;
  --rd-gold:         #9a7b3f;

  /* Accent comes from the active vertical. --theme-accent is written to :root
     by applyThemeTokens(); fall back to the banking blue if absent. */
  --rd-accent:       var(--theme-accent, #1b3a6b);
  --rd-accent-soft:  color-mix(in srgb, var(--rd-accent) 9%, var(--rd-surface));

  /* Type */
  --rd-font-display: "Fraunces", Georgia, serif;
  --rd-font-figure:  "Newsreader", Georgia, serif;
  --rd-font-body:    "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  --rd-font-mono:    "IBM Plex Mono", ui-monospace, monospace;

  --rd-radius:    4px;
  --rd-radius-lg: 8px;
  --rd-shadow-card: 0 1px 0 rgba(26,26,23,.03), 0 1px 2px rgba(26,26,23,.04);
}
```

- [ ] **Step 3: Import the CSS file so it ships in the bundle**

In `demo_api_ui/src/index.js`, find the existing `import './index.css';` line and add **after** it (so refined rules win specificity ties):

```js
import './theme/refinedSurface.css';
```

- [ ] **Step 4: Build to verify no breakage**

Run: `cd demo_api_ui && npm run build`
Expected: exit code `0`, no new warnings about the CSS import.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/public/index.html demo_api_ui/src/theme/refinedSurface.css demo_api_ui/src/index.js
git commit -m "feat(ui): add refined design token layer + fonts (scoped, no visual change yet)"
```

---

### Task 2: Mark the customer dashboard as a refined surface (test-first)

**Files:**
- Modify: `demo_api_ui/src/components/UserDashboard.js`
- Test: `demo_api_ui/src/theme/__tests__/refinedSurface.test.js`

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/theme/__tests__/refinedSurface.test.js`. This asserts the dashboard root carries the surface attribute. Match the existing UserDashboard test setup (mock `useVertical`, `fetch`, router) — copy the mock block from `demo_api_ui/src/components/__tests__/` nearest UserDashboard test if one exists; otherwise use this minimal harness:

```js
import React from 'react';
import { render } from '@testing-library/react';

// Minimal mocks so UserDashboard mounts without network/router/vertical deps.
jest.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({
    pageManifest: { dashboard: { kind: 'banking' }, terminology: { agent: 'Banking Agent' }, identity: { displayName: 'Super Banking' } },
    pageMockData: { heroStats: {} },
    agentManifest: { agent: {} },
    isAdminScope: false,
  }),
}));

// If UserDashboard requires more providers to mount, prefer rendering the
// smallest wrapper that includes the [data-refined-surface] node. The assertion
// only needs that attribute to exist in the rendered tree.
import UserDashboard from '../../components/UserDashboard';

test('customer dashboard renders a refined surface container', () => {
  const { container } = render(<UserDashboard user={{ name: 'Demo' }} agentPlacement="bottom" />);
  expect(container.querySelector('[data-refined-surface="customer"]')).not.toBeNull();
});
```

> NOTE for implementer: UserDashboard has heavy dependencies. If this render throws on missing providers, do NOT weaken the assertion — instead wrap the render in the same provider stack the existing UserDashboard tests use (search `demo_api_ui/src` for an existing test that renders `UserDashboard` and reuse its harness verbatim). The assertion line stays the same.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx jest refinedSurface --no-coverage`
Expected: FAIL — `expect(...).not.toBeNull()` receives `null` (attribute not yet added).

- [ ] **Step 3: Add the surface attribute to the dashboard root**

In `demo_api_ui/src/components/UserDashboard.js`, locate the **outermost JSX wrapper** returned by the component (the top-level `<div>` of the dashboard layout). Add the attribute and a class WITHOUT removing any existing className or prop:

```jsx
// before:
// <div className="user-dashboard ...existing...">
// after:
<div className="user-dashboard ...existing... refined-customer-surface" data-refined-surface="customer">
```

If the outermost element already spreads props or has a dynamic className, append `' refined-customer-surface'` to the className string and add `data-refined-surface="customer"` as a sibling attribute. **Do not** touch `fetchUserData`, the REAUTH_KEY logic, the 401 handler, or `middleAgentOpen` (§1).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx jest refinedSurface --no-coverage`
Expected: PASS.

- [ ] **Step 5: Run App.structure regression (CLAUDE.md §8) — only if App.js was touched**

If Step 3 required editing `App.js` (it should not — UserDashboard owns its wrapper), run:
Run: `cd demo_api_ui && npx jest App.structure --no-coverage`
Expected: PASS (13 tests).

- [ ] **Step 6: Build + commit**

```bash
cd demo_api_ui && npm run build   # expect exit 0
git add demo_api_ui/src/components/UserDashboard.js demo_api_ui/src/theme/__tests__/refinedSurface.test.js
git commit -m "feat(ui): mark customer dashboard as refined surface"
```

---

### Task 3: Restyle dashboard content (hero, stats, accounts, transactions, rail)

**Files:**
- Modify: `demo_api_ui/src/theme/refinedSurface.css`

This task is CSS-only and behind `[data-refined-surface="customer"]`, so it cannot affect other pages.

- [ ] **Step 1: Add scoped base + typography rules**

Append to `refinedSurface.css`:

```css
[data-refined-surface="customer"] {
  background: var(--rd-paper);
  color: var(--rd-ink);
  font-family: var(--rd-font-body);
}
[data-refined-surface="customer"] h1,
[data-refined-surface="customer"] h2,
[data-refined-surface="customer"] .rd-display {
  font-family: var(--rd-font-display);
  letter-spacing: -0.01em;
}
```

- [ ] **Step 2: Port the mockup's content styles, namespaced under the surface**

Append the hero/stat/account/tx/rail rules from the approved mockup
(`demo_api_ui/design/agent-embedded-2026-redesign.html`), prefixing EVERY
selector with `[data-refined-surface="customer"] ` and swapping the mockup's
hardcoded `--accent`/`--paper`/`--ink` for the `--rd-*` equivalents. Concretely,
translate these mockup classes (they map to the live DOM produced by
`VerticalHero.jsx`, the accounts list, and the transactions table — verify the
live class names first with `grep` and adapt selectors to match the real
markup): `.hero/.balance-band/.spark`, `.stats/.stat`, `.card/.card-head/.card-title`,
`.acct/.acct-emblem/.acct-bal`, `.tx` table, and the token-chain `.chain/.chain-step`.

> IMPLEMENTER: Do NOT invent class names. First run
> `grep -rn "className" demo_api_ui/src/components/VerticalHero.jsx demo_api_ui/src/components/UserDashboard.js`
> and target the REAL classes the dashboard renders. The mockup is the visual
> spec; the live class names are the binding targets.

- [ ] **Step 3: Build + visually verify**

Run: `cd demo_api_ui && npm run build` (expect exit 0).
Then with services up (`./run.sh status`), load `https://api.ping.demo:4000/dashboard` as a signed-in user and confirm: warm paper bg, serif balance figure, hairline cards, accent matches the active vertical.

- [ ] **Step 4: Verify accent is per-vertical**

Switch verticals (admin `/admin/verticals` or the vertical switcher) banking→healthcare and confirm the accent flips blue→teal on the dashboard WITHOUT a code change (proves `--rd-accent` reads `--theme-accent`).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/theme/refinedSurface.css
git commit -m "feat(ui): refined customer dashboard content (hero, stats, accounts, tx, rail)"
```

---

### Task 4: Restyle the embedded agent dock chrome

**Files:**
- Create: `demo_api_ui/src/theme/refinedAgent.css`
- Modify: `demo_api_ui/src/index.js` (add import)
- Modify: `demo_api_ui/src/components/EmbeddedAgentDock.js` (add classNames only)

- [ ] **Step 1: Create `refinedAgent.css` scoped to the dock wrapper**

Create `demo_api_ui/src/theme/refinedAgent.css`:

```css
/* refinedAgent.css — institutional restyle of the embedded dock chrome and the
   floating agent shell. Scoped via the wrapper classes added in EmbeddedAgentDock
   and BankingAgent; reads --rd-* (from refinedSurface.css, present because the
   dock renders within the dashboard surface) and per-vertical --theme-accent.
   Behavioral CSS (resize caps, tile-strip direction) lives in BankingAgent.css
   and is NOT overridden here. */

.refined-dock.global-embedded-agent-dock-wrap {
  background: var(--rd-surface, #fffefb);
  border-top: 1px solid var(--rd-line-strong, #d4cdbf);
}
.refined-dock .embedded-agent-dock__title {
  font-family: var(--rd-font-display, "Fraunces", serif);
  letter-spacing: -0.01em;
  color: var(--rd-ink, #1a1a17);
}
.refined-dock .embedded-agent-dock__toolbar {
  background: linear-gradient(180deg, var(--rd-surface, #fffefb), var(--rd-surface-sunk, #f1eee7));
}
/* thin accent seam at the very top of the dock */
.refined-dock.global-embedded-agent-dock-wrap::before {
  content: "";
  position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, var(--theme-accent, #1b3a6b), var(--rd-gold, #9a7b3f) 70%, transparent);
}
```

- [ ] **Step 2: Import it in `index.js` after `refinedSurface.css`**

```js
import './theme/refinedAgent.css';
```

- [ ] **Step 3: Add the `refined-dock` className in `EmbeddedAgentDock.js`**

In the `dockNode` JSX, change ONLY the wrapper className string (line ~148). The existing template literal must be preserved; append `refined-dock`:

```jsx
className={`global-embedded-agent-dock-wrap refined-dock${collapsed ? ' global-embedded-agent-dock-wrap--collapsed' : ''}`}
```

Do NOT change `authenticatedStandardDock`, the `return null` early exit, the resize handler, the collapse logic, or the portal host div (all §1).

- [ ] **Step 4: Build + verify dock chrome**

Run: `cd demo_api_ui && npm run build` (expect exit 0).
Visually: dashboard in Embedded mode shows the dock with the new toolbar/title/accent seam; resize + collapse still work; chips/composer inside (owned by BankingAgent) still render.

- [ ] **Step 5: Run agent/dock regression tests**

Run: `cd demo_api_ui && npx jest EmbeddedAgentDock AgentUiMode --no-coverage`
Expected: PASS (existing suites unaffected by className addition).

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/theme/refinedAgent.css demo_api_ui/src/index.js demo_api_ui/src/components/EmbeddedAgentDock.js
git commit -m "feat(ui): refined embedded agent dock chrome (vertical-accent aware)"
```

---

### Task 5: Restyle the floating agent shell (FAB + panel header/footer)

**Files:**
- Modify: `demo_api_ui/src/theme/refinedAgent.css`

The floating agent is rendered by `BankingAgent.js`/`BankingAgent.css`. Per §1 we do NOT edit `BankingAgent.css`'s resize-cap or layout selectors. We add **new** scoped rules in `refinedAgent.css` targeting the float container's existing classes, restyling only color/typography/borders (never `max-width`/`max-height`/`flex-direction`).

- [ ] **Step 1: Identify the live float classes**

Run: `grep -rn "ba-fab\|ba-float\|ba-panel\|ba-header" demo_api_ui/src/components/BankingAgent.js demo_api_ui/src/components/BankingAgent.css | head -40`
Record the real FAB + panel header/footer class names. (Do not guess.)

- [ ] **Step 2: Append scoped float restyle to `refinedAgent.css`**

Using the REAL class names from Step 1, add color/typography-only rules, e.g. (adapt selectors to the actual names found):

```css
/* Floating agent shell — institutional palette. Visual only; no layout/size. */
.ba-fab {                                   /* replace with real FAB class */
  font-family: var(--rd-font-display, "Fraunces", serif);
  background: var(--theme-accent, #1b3a6b);
  color: #f6f4ef;
}
.ba-panel-header {                          /* replace with real header class */
  font-family: var(--rd-font-display, "Fraunces", serif);
  background: linear-gradient(180deg, var(--rd-surface, #fffefb), var(--rd-surface-sunk, #f1eee7));
  color: var(--rd-ink, #1a1a17);
  border-bottom: 1px solid var(--rd-line, #e3ddd2);
}
```

> Constraint: include ONLY `color`, `background`, `border`, `font-family`,
> `letter-spacing`, `box-shadow` declarations. Do NOT include `max-width`,
> `max-height`, `width`, `height`, `flex-direction`, `overflow` — those are §1
> behavioral properties owned by BankingAgent.css.

- [ ] **Step 3: Build + verify floating mode**

Run: `cd demo_api_ui && npm run build` (expect exit 0).
Visually: switch to Floating mode; FAB shows institutional accent; open panel — header/footer restyled; panel still resizes to its existing caps (proves §1 untouched).

- [ ] **Step 4: Run float-panel regression**

Run: `cd demo_api_ui && npx jest BankingAgent --no-coverage`
Expected: PASS (existing suites unaffected — no JS changed).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/theme/refinedAgent.css
git commit -m "feat(ui): refined floating agent shell (visual only, §1 layout preserved)"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: UI build gate**

Run: `cd demo_api_ui && npm run build`
Expected: exit `0`.

- [ ] **Step 2: App.structure regression (CLAUDE.md §8)**

Run: `cd demo_api_ui && npx jest App.structure --no-coverage`
Expected: 13 tests PASS.

- [ ] **Step 3: Agent + dashboard suites**

Run: `cd demo_api_ui && npx jest EmbeddedAgentDock AgentUiMode BankingAgent refinedSurface --no-coverage`
Expected: PASS.

- [ ] **Step 4: E2E smoke**

Run: `cd demo_api_ui && npm run test:e2e:ui:smoke`
Expected: customer dashboard + landing smoke PASS.

- [ ] **Step 5: Manual §1 spot-checks**

Confirm, signed in on `/dashboard`:
- Embedded mode shows bottom dock (not FAB); tiles/prompt input visible (tile-strip direction unchanged).
- Floating mode shows FAB; panel opens and resizes to existing caps.
- Switch banking→healthcare→retail: accent flips on dashboard AND agent without code change.
- Admin `/admin`, `/config`, and `/marketing` are visually UNCHANGED (refined look did not leak).

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(ui): verification fixups for refined dashboard+agent redesign"
```

---

## Self-Review

**Spec coverage:** Customer dashboard content (Task 3) ✓, embedded dock (Task 4) ✓, floating agent (Task 5) ✓, per-vertical accent (Tasks 1/3/4/5 via `--theme-accent`) ✓, Google Fonts (Task 1) ✓, scoped/no-global-leak (Task 1 data-attribute, verified Task 6 Step 5) ✓.

**§1 protection:** UserDashboard (attribute only), EmbeddedAgentDock (className only), BankingAgent.css (untouched; restyle via separate file, visual props only), App.js (untouched unless forced → App.structure gate). All gated by build + regression suites.

**Type/name consistency:** `--rd-*` token names used identically across `refinedSurface.css` and `refinedAgent.css`; `data-refined-surface="customer"` used in UserDashboard (Task 2) and as selector in CSS (Tasks 1/3); `refined-dock` className added in EmbeddedAgentDock (Task 4) matches `.refined-dock` selector (Task 4 CSS).

**Open implementer dependency:** Tasks 3 and 5 require grepping the REAL live class names before writing selectors (called out inline). The mockup is the visual spec; live DOM classes are the binding targets — never invent class names.
