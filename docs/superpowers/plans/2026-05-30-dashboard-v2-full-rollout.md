# Dashboard v2 Full Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the approved v2 institutional look (`demo_api_ui/design/agent-embedded-2026-v2.html`) to (a) the embedded agent dock — adding the mock's identity rail + clean chip/composer skin, (b) Authorize Rules + MCP activity panels placed below the dock, and (c) every remaining customer-dashboard component (quick actions, trust strip, profile card, account cards, forms, transaction feed, token rail, modals) — all per-vertical-accent-driven, with no §1 regression.

**Architecture:** All new visual rules live in the existing `[data-rd-v2]`-scoped `refinedDashboardV2.css`. We do NOT rewrite `BankingAgent.js`'s shared 2,200-line render path (it serves float/popout/split/bottom modes). Instead we add a bottom-dock-only identity rail via a small scoped JSX addition gated on `isBottomDock`, restyle the existing columns via CSS targeting `.ba-embedded-bottom-dock`, and keep `.ba-body` `column-reverse` + `.ba-left-col` horizontal-strip invariants (§1 #45/#68) — locked by a new guard test written FIRST. Authorize/MCP panels are added as siblings below `EmbeddedAgentDock` in `UserDashboard.js`, wrapped so they only render on the bottom-dock placement.

**Tech Stack:** React (CRA), plain CSS custom properties (`--rd2-*` tokens + per-vertical `--theme-accent`), Jest + RTL, `npm run build` gate after every task.

---

## Scope & Non-Goals

**In scope:**
- Guard test locking "prompt input visible in bottom dock" (§1 #45/#68)
- Bottom-dock identity rail (Active badge, agent name, scope pills) — new JSX gated on `isBottomDock`
- Bottom-dock CSS skin: chips, composer, messages, identity rail — to mock
- Authorize Rules panel + MCP activity panel below the dock (bottom placement only)
- v2 restyle of remaining customer-dashboard sections: quick actions, trust strip, super pills, profile card, account cards, transfer/deposit/withdraw forms, transaction feed, token rail
- v2 restyle of customer-dashboard modals (ConfirmModal, TransactionConsentModal, OTP/TOTP/device/push/enrollment inline modals, FloatingPanel)
- Reconcile the older `data-refined-surface` warm-paper layer so it doesn't fight the neutral v2 palette

**Explicit non-goals:**
- Do NOT rewrite `BankingAgent.js` shared render JSX (only add the `isBottomDock` rail block)
- Do NOT change `.ba-body` `column-reverse` or `.ba-left-col` strip direction (§1 #68)
- Do NOT change EmbeddedAgentDock resize/collapse/portal-host logic (§1 #45)
- Do NOT restyle the ADMIN dashboard in this plan (separate surface; tracked as a follow-up)
- Do NOT touch `/marketing`, OAuth, MCP, or token-flow logic
- Do NOT change `--theme-accent` cascade or `applyThemeTokens.js`

---

## Pre-flight — read before Task 1

REGRESSION_PLAN §1 entries this plan touches:
- **#45** — Bottom dock on dashboard routes: `EmbeddedAgentDock.js` must NOT gain an `isBankingAgentDashboardRoute` guard; UserDashboard mounts the dock internally. **We add panels as siblings; we do not move or re-gate the dock.**
- **#68** — Bottom dock tile-strip direction: `.ba-body` must be `column-reverse`; `.ba-left-col` must be `flex-direction: row; overflow-x: auto`. **Our CSS never sets these properties on those selectors. The Task-1 guard test enforces it.**

Gate after every UI task: `cd demo_api_ui && npm run build` must exit `0`.

Reconciliation note: the dashboard root carries BOTH `data-refined-surface="customer"` (older warm-paper `--rd-*` palette in `refinedSurface.css`) AND `data-rd-v2` (neutral `--rd2-*` palette). Where they visually conflict, the v2 rules under `[data-rd-v2]` win by being imported later AND by equal-or-higher specificity. Task 8 explicitly audits leftover warm-paper bleed.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `demo_api_ui/src/components/__tests__/EmbeddedDockPromptVisible.test.js` | **Create** | Guard test: prompt input present in bottom-dock render (§1 #45/#68) |
| `demo_api_ui/src/components/BankingAgent.js` | **Modify** | Add `isBottomDock`-gated identity rail JSX block only |
| `demo_api_ui/src/components/UserDashboard.js` | **Modify** | Render Authorize + MCP panels below `EmbeddedAgentDock` (bottom placement) |
| `demo_api_ui/src/theme/refinedDashboardV2.css` | **Modify** | All new v2 rules: dock rail/chips/composer, panels, dashboard sections, modals |

---

## Task 1 — Lock the prompt-input-visible invariant (TDD, write test FIRST)

**Files:**
- Create: `demo_api_ui/src/components/__tests__/EmbeddedDockPromptVisible.test.js`

This test guards §1 #45/#68 BEFORE we touch the dock. It must pass against the CURRENT code (the invariant already holds today), then keep passing through Tasks 2–3.

- [ ] **Step 1: Find the existing BankingAgent test harness to copy mocks from**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
ls src/__tests__/BankingAgent*.test.js
sed -n '1,60p' src/__tests__/BankingAgent.test.js
```

Use the SAME mock/provider setup that `src/__tests__/BankingAgent.test.js` uses (it renders BankingAgent successfully today). Copy its import + mock block verbatim into the new test.

- [ ] **Step 2: Write the guard test**

Create `demo_api_ui/src/components/__tests__/EmbeddedDockPromptVisible.test.js`. Render `BankingAgent` in inline + bottom-dock mode (the props that set `isInline` and `embeddedDockBottom` true — confirm the prop names from the harness in Step 1; likely `mode="inline"` and an `embeddedDockBottom`/dock prop). Assert the prompt input renders:

```js
// Reuse the exact mock block from src/__tests__/BankingAgent.test.js (providers, fetch, contexts).
import React from 'react';
import { render, screen } from '@testing-library/react';
// ...copied mocks...
import BankingAgent from '../BankingAgent';

test('bottom-dock render keeps the prompt input visible (REGRESSION_PLAN §1 #45/#68)', () => {
  // Props that put BankingAgent into inline bottom-dock mode.
  // Confirm exact prop names from BankingAgent.test.js harness in Step 1.
  render(<BankingAgent mode="inline" embeddedDockBottom={true} /* ...other required props from harness... */ />);

  // The composer text input must be in the DOM. The live input has class "ba-input"
  // inside ".ba-input-row" (confirmed in BankingAgent.js ~line 8841-8844).
  const input = document.querySelector('.ba-input-row .ba-input');
  expect(input).not.toBeNull();
});
```

> IMPLEMENTER: If the harness needs more props for BankingAgent to mount in bottom-dock mode, copy them from how `BankingAgent.test.js` renders it and add `embeddedDockBottom`. Do NOT weaken the `.ba-input` assertion. If `mode`/`embeddedDockBottom` are not the real prop names, read BankingAgent.js lines 1720–1730 to find what sets `isInline` and `embeddedDockBottom` and pass those.

- [ ] **Step 3: Run the test — it must PASS against current code**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npx jest EmbeddedDockPromptVisible --no-coverage 2>&1 | tail -15
```
Expected: PASS (the invariant holds today). If it FAILS to mount, fix the harness/props until it renders and the assertion passes — do not change the assertion.

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo && git add demo_api_ui/src/components/__tests__/EmbeddedDockPromptVisible.test.js && git commit -m "test(ui): lock prompt-input-visible invariant for bottom dock (§1 #45/#68)"
```

---

## Task 2 — Bottom-dock identity rail (mock's left panel)

**Files:**
- Modify: `demo_api_ui/src/components/BankingAgent.js`
- Modify: `demo_api_ui/src/theme/refinedDashboardV2.css`

Add the mock's identity rail (Active badge, agent name, scope pills) as a NEW element rendered only when `isBottomDock`. It sits as a sibling at the start of `.ba-body` so `column-reverse` places it correctly; CSS makes it a left rail on wide dock, top strip on narrow. We do NOT alter existing columns.

- [ ] **Step 1: Locate the `.ba-body` open tag in bottom-dock render**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
grep -n '<div className="ba-body">' src/components/BankingAgent.js
```
It is at ~line 7321. Read lines 7318–7330 to confirm context.

- [ ] **Step 2: Confirm what data is available for the rail**

Read BankingAgent.js around the bottom-dock render for: the agent title variable (e.g. `verticalAgentTitle` / a name prop), and any scopes array. Find with:
```bash
grep -n "verticalAgentTitle\|agentTitle\|scopes\|grantedScopes\|read.*write" src/components/BankingAgent.js | head -20
```
Use the real variable for the agent name. For scope pills, use the granted-scopes source if present; otherwise render the static demo scopes `read`, `write`, `admin` (matches the mock and the project scope-name memory: plain scopes, never `banking:*`).

- [ ] **Step 3: Insert the identity-rail JSX immediately inside `.ba-body`, gated on `isBottomDock`**

Right after the `<div className="ba-body">` line, insert (using the real agent-name variable confirmed in Step 2):

```jsx
{isBottomDock && (
  <div className="ba-dock-identity" aria-label="Agent identity">
    <div className="ba-dock-identity__tag">
      <span className="ba-dock-identity__dot" aria-hidden="true" />
      Active
    </div>
    <div className="ba-dock-identity__name">{verticalAgentTitle}</div>
    <p className="ba-dock-identity__desc">Secured via PingOne · RFC&nbsp;8693</p>
    <div className="ba-dock-identity__scopes" aria-label="Granted scopes">
      <span className="ba-dock-identity__scope">read</span>
      <span className="ba-dock-identity__scope">write</span>
      <span className="ba-dock-identity__scope">admin</span>
    </div>
  </div>
)}
```

Do NOT touch `.ba-left-col`, `.ba-right-col`, the messages container, or the input row. Do NOT change `.ba-body`'s className.

- [ ] **Step 4: Append the identity-rail CSS to `refinedDashboardV2.css`**

```css
/* ── Bottom-dock identity rail (v2 mock) ──────────── */
.ba-embedded-bottom-dock .ba-dock-identity {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0;
  padding: 4px 18px 4px 0;
  border-right: 1px solid var(--rd2-line-1, #e4e4e0);
  flex: 0 0 auto;
  min-width: 180px;
}
.ba-embedded-bottom-dock .ba-dock-identity__tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: "IBM Plex Mono", monospace;
  font-size: .6rem;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--rd2-ink-3, #8c8c88);
  margin-bottom: 8px;
}
.ba-embedded-bottom-dock .ba-dock-identity__dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--rd2-positive, #1a6b49);
}
.ba-embedded-bottom-dock .ba-dock-identity__name {
  font-family: "Fraunces", serif;
  font-size: 1.05rem; font-weight: 600; letter-spacing: -.015em;
  color: var(--rd2-ink-1, #111110); margin-bottom: 3px;
}
.ba-embedded-bottom-dock .ba-dock-identity__desc {
  font-size: .78rem; color: var(--rd2-ink-2, #4c4c48); margin: 0;
}
.ba-embedded-bottom-dock .ba-dock-identity__scopes {
  margin-top: 12px; display: flex; flex-wrap: wrap; gap: 4px;
}
.ba-embedded-bottom-dock .ba-dock-identity__scope {
  font-family: "IBM Plex Mono", monospace;
  font-size: .6rem; letter-spacing: .04em;
  padding: 2px 7px; border-radius: 999px;
  border: 1px solid var(--rd2-line-1, #e4e4e0);
  background: var(--rd2-surface-2, #f3f3f1);
  color: var(--rd2-ink-2, #4c4c48);
}
/* Narrow dock: rail becomes a top strip, not a left column */
@media (max-width: 700px) {
  .ba-embedded-bottom-dock .ba-dock-identity {
    border-right: none;
    border-bottom: 1px solid var(--rd2-line-1, #e4e4e0);
    padding: 8px 0;
    min-width: 0;
  }
}
```

- [ ] **Step 5: Build + run the guard test**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -5
npx jest EmbeddedDockPromptVisible BankingAgent.test --no-coverage 2>&1 | tail -12
```
Expected: build exit 0; guard test + BankingAgent.test PASS (rail added, input still present).

- [ ] **Step 6: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo && git add demo_api_ui/src/components/BankingAgent.js demo_api_ui/src/theme/refinedDashboardV2.css && git commit -m "feat(ui): bottom-dock identity rail (v2 mock) — scopes, agent name, active badge"
```

---

## Task 3 — Bottom-dock chip + composer + messages skin

**Files:**
- Modify: `demo_api_ui/src/theme/refinedDashboardV2.css`

CSS-only. Restyle the existing bottom-dock chips, composer, and messages to the mock — color/typography/border/radius ONLY. Never set `flex-direction`/`overflow`/`max-*`/`display` on `.ba-body`, `.ba-left-col`, `.ba-right-col`.

- [ ] **Step 1: Confirm the live bottom-dock chip/composer classes**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
grep -n "ba-suggestion\|ba-action-item\|ba-input-row\|ba-input\|ba-send\|banking-agent-messages\|ba-bottom" src/components/BankingAgent.js | head -30
```

- [ ] **Step 2: Append the skin rules**

```css
/* ── Bottom-dock skin (v2) — colour/type only ─────── */
.ba-embedded-bottom-dock {
  background: var(--rd2-surface, #ffffff) !important;
  color: var(--rd2-ink-1, #111110) !important;
}
.ba-embedded-bottom-dock .banking-agent-messages {
  background: var(--rd2-surface, #ffffff) !important;
}
/* Chip tiles in the horizontal strip */
.ba-embedded-bottom-dock .ba-suggestion {
  background: var(--rd2-surface, #ffffff) !important;
  border: 1px solid var(--rd2-line-2, #d5d5d0) !important;
  color: var(--rd2-ink-1, #111110) !important;
  border-radius: 999px !important;
  font-family: "Inter", ui-sans-serif, sans-serif !important;
  font-size: .8rem !important;
  font-weight: 500 !important;
}
.ba-embedded-bottom-dock .ba-suggestion:hover {
  border-color: var(--theme-accent, #1b3a6b) !important;
  color: var(--theme-accent, #1b3a6b) !important;
  background: color-mix(in srgb, var(--theme-accent, #1b3a6b) 8%, #ffffff) !important;
}
.ba-embedded-bottom-dock .ba-action-item {
  background: var(--rd2-surface-2, #f3f3f1) !important;
  border: 1px solid var(--rd2-line-1, #e4e4e0) !important;
  color: var(--rd2-ink-1, #111110) !important;
  border-radius: 999px !important;
  font-family: "Inter", ui-sans-serif, sans-serif !important;
  font-size: .8rem !important;
}
/* Composer / input row */
.ba-embedded-bottom-dock .ba-input-row {
  background: var(--rd2-surface-2, #f3f3f1) !important;
  border: 1px solid var(--rd2-line-2, #d5d5d0) !important;
  border-radius: 999px !important;
  padding: 5px 5px 5px 16px !important;
}
.ba-embedded-bottom-dock .ba-input-row:focus-within {
  border-color: var(--theme-accent, #1b3a6b) !important;
  background: var(--rd2-surface, #ffffff) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--theme-accent, #1b3a6b) 20%, #ffffff) !important;
}
.ba-embedded-bottom-dock .ba-input {
  background: transparent !important;
  border: none !important;
  font-family: "Inter", ui-sans-serif, sans-serif !important;
  font-size: .9rem !important;
  color: var(--rd2-ink-1, #111110) !important;
}
.ba-embedded-bottom-dock .ba-send-btn {
  background: var(--theme-accent, #1b3a6b) !important;
  color: #ffffff !important;
  border: none !important;
  border-radius: 999px !important;
}
.ba-embedded-bottom-dock .ba-send-btn:hover { opacity: .88 !important; }
```

- [ ] **Step 3: Build + guard test**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -5
npx jest EmbeddedDockPromptVisible --no-coverage 2>&1 | tail -8
```
Expected: build exit 0; guard test PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo && git add demo_api_ui/src/theme/refinedDashboardV2.css && git commit -m "feat(ui): bottom-dock chip + composer + messages skin (v2)"
```

---

## Task 4 — Authorize Rules + MCP panels below the dock

**Files:**
- Modify: `demo_api_ui/src/components/UserDashboard.js`
- Modify: `demo_api_ui/src/theme/refinedDashboardV2.css`

Render `AuthorizeRulesPanel` and `WebMcpPanel` as siblings below `EmbeddedAgentDock`, only on the bottom placement, wrapped in a v2 two-column grid. These show "what's going on under the hood".

- [ ] **Step 1: Read the dock render site in UserDashboard.js**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
grep -n "EmbeddedAgentDock\|AuthorizeRulesPanel\|WebMcpPanel\|import .*Authorize\|import .*WebMcp" src/components/UserDashboard.js
```
Confirm `EmbeddedAgentDock` is rendered around line 2686 inside `{agentPlacement === "bottom" && (...)}`.

- [ ] **Step 2: Add imports**

At the top of UserDashboard.js with the other component imports, add:
```js
import AuthorizeRulesPanel from "./AuthorizeRulesPanel";
import WebMcpPanel from "./WebMcpPanel";
```

- [ ] **Step 3: Render the panels below the dock**

Find the existing block:
```jsx
{agentPlacement === "bottom" && (
  <EmbeddedAgentDock
    user={user}
    agentPlacement={agentPlacement}
  />
)}
```
Change it to wrap the dock and the two panels together (the panels render below the dock, only when bottom placement and a user exists):
```jsx
{agentPlacement === "bottom" && (
  <>
    <EmbeddedAgentDock
      user={user}
      agentPlacement={agentPlacement}
    />
    {user && (
      <section className="rd2-undertheheood" aria-label="Authorization and MCP activity">
        <div className="rd2-undertheheood__panel">
          <AuthorizeRulesPanel />
        </div>
        <div className="rd2-undertheheood__panel">
          <WebMcpPanel />
        </div>
      </section>
    )}
  </>
)}
```
Do NOT change the dock props or its placement. Do NOT remove `data-rd-v2` from the root.

> IMPLEMENTER: `AuthorizeRulesPanel` and `WebMcpPanel` both take NO props (self-contained, confirmed in survey). If either throws when mounted here (missing context/provider), wrap ONLY that panel in the same provider the dashboard already supplies, or fall back to not rendering it and report DONE_WITH_CONCERNS — do not stub fake data.

- [ ] **Step 4: Append the panel-layout CSS**

```css
/* ── Under-the-hood panels below the dock (v2) ────── */
[data-rd-v2] .rd2-undertheheood {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  max-width: 1200px;
  margin: 16px auto 0;
  padding: 0 clamp(16px, 4vw, 48px) 24px;
}
@media (max-width: 900px) {
  [data-rd-v2] .rd2-undertheheood { grid-template-columns: 1fr; }
}
[data-rd-v2] .rd2-undertheheood__panel {
  background: var(--rd2-surface, #ffffff);
  border: 1px solid var(--rd2-line-1, #e4e4e0);
  border-radius: var(--rd2-r-md, 8px);
  box-shadow: var(--rd2-shadow-1, 0 1px 3px rgba(0,0,0,.06));
  overflow: hidden;
}
```

- [ ] **Step 5: Build + App.structure regression (UserDashboard touched)**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -5
npx jest App.structure --no-coverage 2>&1 | grep -E "Tests:|FAIL" | tail -5
```
Expected: build exit 0. App.structure: same pass/fail count as the pre-existing baseline (2 pre-existing failures unrelated to this change are acceptable; no NEW failures).

- [ ] **Step 6: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo && git add demo_api_ui/src/components/UserDashboard.js demo_api_ui/src/theme/refinedDashboardV2.css && git commit -m "feat(ui): Authorize + MCP activity panels below agent dock (bottom placement)"
```

---

## Task 5 — Restyle dashboard action/profile sections

**Files:**
- Modify: `demo_api_ui/src/theme/refinedDashboardV2.css`

CSS-only, scoped `[data-rd-v2]`. Restyle quick actions, trust strip, super pills, and profile card to the v2 look.

- [ ] **Step 1: Confirm live classes**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
grep -n "ud-quick-actions\|ud-qa-btn\|ud-trust-strip\|ud-super-pills\|ud-profile-card" src/components/UserDashboard.js | head -20
```

- [ ] **Step 2: Append rules**

```css
/* ── Quick actions ────────────────────────────────── */
[data-rd-v2] .ud-quick-actions {
  display: flex; flex-wrap: wrap; gap: 8px;
}
[data-rd-v2] .ud-qa-btn {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--rd2-font-body); font-size: .86rem; font-weight: 500;
  padding: 9px 16px; border-radius: 999px;
  border: 1px solid var(--rd2-line-2); background: var(--rd2-surface);
  color: var(--rd2-ink-1);
}
[data-rd-v2] .ud-qa-btn:hover {
  border-color: var(--rd2-accent); color: var(--rd2-accent);
  background: var(--rd2-accent-muted);
}
/* Primary quick action keeps accent fill if it has a --primary modifier */
[data-rd-v2] .ud-qa-btn--primary {
  background: var(--rd2-accent) !important; color: #fff !important; border-color: transparent !important;
}
[data-rd-v2] .ud-qa-btn--primary:hover { opacity: .9; }

/* ── Trust strip ──────────────────────────────────── */
[data-rd-v2] .ud-trust-strip {
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
  font-size: .76rem; color: var(--rd2-ink-3);
}
[data-rd-v2] .ud-trust-strip b { color: var(--rd2-ink-2); font-weight: 500; }

/* ── Super pills ──────────────────────────────────── */
[data-rd-v2] .ud-super-pills { display: flex; flex-wrap: wrap; gap: 6px; }
[data-rd-v2] .ud-super-pills a,
[data-rd-v2] .ud-super-pills button {
  font-family: "IBM Plex Mono", monospace; font-size: .68rem;
  letter-spacing: .04em; padding: 5px 11px; border-radius: 999px;
  border: 1px solid var(--rd2-line-1); background: var(--rd2-surface-2);
  color: var(--rd2-ink-2); text-decoration: none;
}
[data-rd-v2] .ud-super-pills a:hover,
[data-rd-v2] .ud-super-pills button:hover {
  border-color: var(--rd2-accent); color: var(--rd2-accent);
}

/* ── Profile card ─────────────────────────────────── */
[data-rd-v2] .ud-profile-card {
  background: var(--rd2-surface); border: 1px solid var(--rd2-line-1);
  border-radius: var(--rd2-r-md); box-shadow: var(--rd2-shadow-1);
  padding: 16px 18px;
}
```

- [ ] **Step 3: Build**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo && git add demo_api_ui/src/theme/refinedDashboardV2.css && git commit -m "feat(ui): v2 quick actions, trust strip, super pills, profile card"
```

---

## Task 6 — Restyle account cards, forms, token rail

**Files:**
- Modify: `demo_api_ui/src/theme/refinedDashboardV2.css`

- [ ] **Step 1: Confirm live classes**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
grep -n "account-card\|accounts-grid\|transfer-form\|deposit-form\|withdraw-form\|ud-token-rail\|tx-feed\|tx-row" src/components/UserDashboard.js | head -30
```

- [ ] **Step 2: Append rules**

```css
/* ── Account cards ────────────────────────────────── */
[data-rd-v2] .accounts-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px;
}
[data-rd-v2] .account-card {
  background: var(--rd2-surface); border: 1px solid var(--rd2-line-1);
  border-radius: var(--rd2-r-md); box-shadow: var(--rd2-shadow-1);
  padding: 16px 18px;
}
[data-rd-v2] .account-card__balance,
[data-rd-v2] .account-card .balance {
  font-family: var(--rd2-font-figure); font-weight: 400;
  font-size: 1.5rem; letter-spacing: -.015em; font-variant-numeric: tabular-nums;
  color: var(--rd2-ink-1);
}
[data-rd-v2] .account-card button {
  font-family: var(--rd2-font-body); font-size: .8rem; font-weight: 500;
  border-radius: 999px; border: 1px solid var(--rd2-line-2);
  background: var(--rd2-surface); color: var(--rd2-ink-1); padding: 6px 13px;
}
[data-rd-v2] .account-card button:hover {
  border-color: var(--rd2-accent); color: var(--rd2-accent); background: var(--rd2-accent-muted);
}

/* ── Money-movement forms ─────────────────────────── */
[data-rd-v2] .transfer-form,
[data-rd-v2] .deposit-form,
[data-rd-v2] .withdraw-form {
  background: var(--rd2-surface-2); border: 1px solid var(--rd2-line-1);
  border-radius: var(--rd2-r-md); padding: 16px 18px;
}
[data-rd-v2] .transfer-form input,
[data-rd-v2] .transfer-form select,
[data-rd-v2] .deposit-form input,
[data-rd-v2] .deposit-form select,
[data-rd-v2] .withdraw-form input,
[data-rd-v2] .withdraw-form select {
  border: 1px solid var(--rd2-line-2); border-radius: var(--rd2-r-sm);
  background: var(--rd2-surface); font-family: var(--rd2-font-body);
  font-size: .88rem; color: var(--rd2-ink-1); padding: 8px 10px;
}
[data-rd-v2] .transfer-form input:focus,
[data-rd-v2] .deposit-form input:focus,
[data-rd-v2] .withdraw-form input:focus,
[data-rd-v2] .transfer-form select:focus,
[data-rd-v2] .deposit-form select:focus,
[data-rd-v2] .withdraw-form select:focus {
  outline: none; border-color: var(--rd2-accent);
  box-shadow: 0 0 0 3px var(--rd2-accent-ring);
}

/* ── Transaction feed ─────────────────────────────── */
[data-rd-v2] .tx-feed { display: flex; flex-direction: column; }
[data-rd-v2] .tx-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 0; border-bottom: 1px solid var(--rd2-line-1);
}
[data-rd-v2] .tx-row:last-child { border-bottom: none; }
[data-rd-v2] .tx-row .amount,
[data-rd-v2] .tx-row__amount { font-variant-numeric: tabular-nums; font-weight: 600; }

/* ── Token rail ───────────────────────────────────── */
[data-rd-v2] .ud-token-rail {
  background: var(--rd2-surface); border: 1px solid var(--rd2-line-1);
  border-radius: var(--rd2-r-md); box-shadow: var(--rd2-shadow-1);
}
```

> IMPLEMENTER: amount-colour classes (positive/negative) may differ — grep `tx-row` markup and add `color: var(--rd2-positive)` to the credit/positive class you find. Do not guess; match the real class.

- [ ] **Step 3: Build**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo && git add demo_api_ui/src/theme/refinedDashboardV2.css && git commit -m "feat(ui): v2 account cards, money-movement forms, tx feed, token rail"
```

---

## Task 7 — Restyle dashboard modals

**Files:**
- Modify: `demo_api_ui/src/theme/refinedDashboardV2.css`

Modals render in a portal at `document.body`, OUTSIDE the `[data-rd-v2]` subtree. So these rules must be scoped by a class on the modal itself, not `[data-rd-v2]`. We add a body-level class hook OR target the modals' own root classes directly. Since we must not edit modal JS, target the modals' existing root classNames globally but defensively (only colour/typography/border).

- [ ] **Step 1: Confirm modal root classes**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
grep -rn "className=" src/components/ConfirmModal.js src/components/TransactionConsentModal.tsx | grep -i "modal\|overlay" | head
grep -n "otp-step-up-modal\|otp-step-up-overlay\|device-picker\|push-modal\|enrollment-modal" src/components/UserDashboard.js | head
```

- [ ] **Step 2: Append modal rules (global, conservative — colour/type/border only)**

```css
/* ── Dashboard modals (v2) — global, conservative ─── */
/* These render in a body portal, so they cannot be scoped under [data-rd-v2].
   We only touch surface/typography/border so other pages' modals stay safe-looking. */
.confirm-modal, .transaction-consent-modal,
.otp-step-up-modal, .totp-step-up-modal,
.device-picker-modal, .push-modal, .enrollment-modal {
  font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
  border-radius: 16px;
  border: 1px solid var(--rd2-line-2, #d5d5d0);
  box-shadow: 0 20px 60px rgba(0,0,0,.18);
}
.confirm-modal h2, .transaction-consent-modal h2,
.otp-step-up-modal h2 {
  font-family: "Fraunces", serif; letter-spacing: -.01em;
}
/* Primary modal buttons pick up the active vertical accent */
.confirm-modal .btn-primary, .transaction-consent-modal .btn-primary,
.otp-step-up-modal .btn-primary {
  background: var(--theme-accent, #1b3a6b); border-color: var(--theme-accent, #1b3a6b); color: #fff;
}
```

> IMPLEMENTER: Use the REAL modal root class names found in Step 1. If a modal's primary button uses a different class than `.btn-primary`, adapt. If a modal already has heavy custom styling that this would clash with, scope conservatively or omit that modal and note it — modal consistency is a §1-adjacent concern (see REGRESSION_PLAN modal-consistency entries); when unsure, prefer omission over a half-restyle.

- [ ] **Step 3: Build**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo && git add demo_api_ui/src/theme/refinedDashboardV2.css && git commit -m "feat(ui): v2 dashboard modal surfaces + accent primary buttons"
```

---

## Task 8 — Reconcile warm-paper bleed + full verification

**Files:**
- Modify: `demo_api_ui/src/theme/refinedDashboardV2.css` (only if bleed found)

- [ ] **Step 1: Audit for the older warm-paper layer fighting v2**

The root has both `data-refined-surface="customer"` (warm `--rd-*`) and `data-rd-v2` (neutral `--rd2-*`). Check whether warm-paper surfaces bleed through:

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
grep -n "data-refined-surface\|refinedSurface" src/index.js
sed -n '1,40p' src/theme/refinedSurface.css
```

If `refinedSurface.css` paints `[data-refined-surface="customer"]` backgrounds (e.g. `--rd-paper #f6f4ef`) that show through where v2 has no rule, add a neutralizing base in `refinedDashboardV2.css`:
```css
/* Ensure the v2 neutral page wins over the older warm-paper surface layer */
[data-rd-v2][data-refined-surface="customer"] { background: var(--rd2-bg) !important; }
```
Only add this if Step 1 shows a real conflict. If `data-refined-surface` is absent or harmless, skip.

- [ ] **Step 2: Build gate**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: exit 0.

- [ ] **Step 3: Regression suites**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npx jest EmbeddedDockPromptVisible BankingAgent.test BankingAgent.integration BankingAgent.chipRouting --no-coverage 2>&1 | grep -E "Tests:|FAIL|PASS" | tail -12
npx jest App.structure --no-coverage 2>&1 | grep -E "Tests:" | tail -2
```
Expected: guard test PASS; BankingAgent core suites PASS; App.structure same baseline (2 pre-existing failures only, no new ones).

- [ ] **Step 4: Manual visual verification (services up)**

```bash
cd /Users/curtismuir/Development/AI-Demo && ./run.sh status
open https://api.ping.demo:4000
```
Sign in and confirm:
1. Bottom dock shows the identity rail (Active badge, agent name, scope pills) on the left; chips + composer to the right; **prompt input visible** (never hidden).
2. Authorize Rules + MCP panels render below the dock in a two-column v2 grid.
3. Quick actions, profile card, account cards, forms, tx feed, token rail all use neutral surfaces + accent.
4. Switch banking→healthcare→retail: dock accent, chips, composer focus ring, panel accents, and primary buttons all flip with the vertical. No code change.
5. Modals (trigger demo reset / a transfer >$250) show v2 surface + accent primary button.
6. `/marketing` and admin unchanged.

- [ ] **Step 5: Final commit (only if Step 1 added a rule or Step 4 needed fixups)**

```bash
cd /Users/curtismuir/Development/AI-Demo && git add -A && git commit -m "chore(ui): reconcile warm-paper bleed + v2 rollout verification fixups"
```

---

## Self-Review

**Spec coverage:**
- Dock identity rail (mock left panel) ✓ Task 2
- Dock chips/composer/messages skin ✓ Task 3
- Authorize + MCP panels below dock ✓ Task 4
- Quick actions/trust/pills/profile ✓ Task 5
- Account cards/forms/tx/token rail ✓ Task 6
- Modals ✓ Task 7
- Per-vertical accent throughout (`--theme-accent`) ✓ all tasks
- §1 #45/#68 protection ✓ Task 1 guard test, no layout-property changes on locked selectors
- Warm-paper reconciliation ✓ Task 8

**Placeholder scan:** No TBDs; every step has exact code or exact commands. Implementer dependencies (real class-name confirmation) are called out with exact grep commands in Tasks 2,3,5,6,7.

**Type/name consistency:** `--rd2-*` tokens used identically (defined Task 1 of the prior plan, already in `refinedDashboardV2.css`). `.ba-dock-identity*` classes defined in Task 2 JSX and Task 2 CSS match. `.rd2-undertheheood*` classes defined in Task 4 JSX and CSS match. Guard test class `.ba-input`/`.ba-input-row` matches the live DOM (confirmed in survey).

**Risk note:** Task 4 mounts AuthorizeRulesPanel + WebMcpPanel in a new location; if they require providers not present on the dashboard, the implementer wraps only that panel or reports DONE_WITH_CONCERNS rather than stubbing data.
