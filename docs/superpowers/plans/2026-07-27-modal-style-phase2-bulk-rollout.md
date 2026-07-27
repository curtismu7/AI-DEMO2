# Modal Style Unification — Phase 2 Bulk Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the app's existing global button classes (`.btn-primary`/`.btn-secondary`/`.btn-danger`, `demo_api_ui/src/index.css`) and the 380/460 width-tier convention to the remaining 10 customer-facing modals, per `docs/superpowers/specs/2026-07-26-customer-modal-style-unification-design.md`'s Phase 2 section. Fix the concrete bugs the original audit found along the way (a duplicate heading, a double-padded form, an off-brand blue button, a locally-shadowed global button class). This is Phase 2 — Phase 1 (`TransactionConsentModal` → `DraggableModal` migration) already merged to `main`.

**Architecture:** Every modal in scope already uses `DraggableModal` (none needs a shell migration like Phase 1 did). The work here is CSS/class-level: swap bespoke button styling for the shared `.btn-primary`/`.btn-secondary`/`.btn-danger` classes where they'd produce a real visual change, delete confirmed-dead pre-`DraggableModal` CSS, and snap each modal's `defaultWidth`/`minWidth` to 380 or 460.

**Tech Stack:** React 19.2 (`.js`/`.jsx`), Vitest 3.2 + `@testing-library/react`, plain CSS. No new dependencies.

## Global Constraints

- Working directory: `.claude/worktrees/modal-style-phase2` (branch `worktree-modal-style-phase2`) — isolated worktree. Stage files explicitly (`git add <files>`), never `git add -A`.
- REGRESSION_PLAN §0/§1 applies. Emoji allowlist: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` only — this plan introduces no new emoji (some existing ones, e.g. `✅`/`❌`/`⚠️` in `ComplianceModalContent.js`/`ErrorModal.js`, are untouched).
- Verify per task: `cd demo_api_ui && npm run test:unit` (targeted file first, then full suite before the final commit) `&& npm run build`.
- **Two components share CSS**: `FidoStepUpModal.js` and `OtpStepUpModal.js` both use `.otp-step-up-modal__btn-primary`/`__btn-ghost`, defined once (duplicated twice, pre-existing) in `demo_api_ui/src/App.css`. Task 1 touches both files together for exactly this reason.
- **`ComplianceModal.css` is shared with a second, independent component** — `ComplianceModalPopout.js` (a `window.open`-based pop-out, NOT using `DraggableModal`) still uses `.compliance-modal` and `.compliance-modal__modal-title` from the same stylesheet. Task 6 must not delete those two selectors.
- **Out of scope, confirmed, no task needed:** `CibaStepUpFlowPanel.jsx` is a static informational tab panel (`ArchitectureTabsPanel.jsx`), not a modal — no `DraggableModal`, zero `<button>` elements, no fixed width. Nothing in this plan touches it.
- **No test coverage exists** for `LoginSuccessModal`, `MissingCredentialsModal`, `ComplianceModal`/`ComplianceModalContent`/`ComplianceModalPopout`, `ErrorModal`, or `ConfirmModal` (confirmed by repo-wide grep — noted per-task below). Every button-role/text assertion in the tests that DO exist (`FidoStepUpModal`, `OtpStepUpModal`, `GatewayConsentModal`, `AgentConsentModal`) queries by accessible role/name/`data-testid`, never by class name or color — all four are safe to restyle without touching their test files.

---

### Task 1: Snap FidoStepUpModal + OtpStepUpModal to the width tiers (no button-color change)

**Finding from the audit:** `.otp-step-up-modal__btn-primary` and `.otp-step-up-modal__btn-cancel`/`__btn-ghost` (`demo_api_ui/src/App.css`) already use the exact same CSS variables as `.btn-primary`/`.btn-secondary` in `index.css` (same gradient, same border, same shadow) — there is no visual bug to fix here, only a width-tier snap. Renaming the classes would be pure churn (they also use `flex:1` for equal-width footer buttons, which `.btn` doesn't set, so swapping class names would need extra footer-layout work for zero visual benefit). Leave the classes as-is.

**Files:**
- Modify: `demo_api_ui/src/components/FidoStepUpModal.js:87-88`
- Modify: `demo_api_ui/src/components/OtpStepUpModal.js:1023-1024`, `:1118-1119`

**Interfaces:** none — numeric prop values only, no new/changed exports.

- [ ] **Step 1: Snap FidoStepUpModal to the 380 (single-action) tier**

In `demo_api_ui/src/components/FidoStepUpModal.js`, change:

```jsx
      defaultWidth={420}
      defaultHeight={320}
```

to:

```jsx
      defaultWidth={380}
      defaultHeight={320}
```

- [ ] **Step 2: Snap both OtpStepUpModal invocations to the 460 (multi-field/list) tier**

In `demo_api_ui/src/components/OtpStepUpModal.js`, the p1mfa-mode call currently reads:

```jsx
        defaultWidth={520}
        defaultHeight={440}
```

change to:

```jsx
        defaultWidth={460}
        defaultHeight={440}
```

And the stub-mode call currently reads:

```jsx
      defaultWidth={520}
      defaultHeight={stubStep === 'choose' ? 400 : 480}
```

change to:

```jsx
      defaultWidth={460}
      defaultHeight={stubStep === 'choose' ? 400 : 480}
```

(460 rather than 380 for both: the method-choice table is the widest content in any of the 11 modals in scope across both phases.)

- [ ] **Step 3: Run both components' unit tests**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/FidoStepUpModal.test.jsx src/components/__tests__/OtpStepUpModal.methodChoice.test.jsx`
Expected: all tests pass unchanged (neither test file mocks or asserts `defaultWidth`/`defaultHeight` — `FidoStepUpModal`'s test mocks `DraggableModal` entirely; `OtpStepUpModal`'s test renders the real one but only queries by role/testid).

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/FidoStepUpModal.js demo_api_ui/src/components/OtpStepUpModal.js
git commit -m "style(ui): snap FidoStepUpModal/OtpStepUpModal to the 380/460 width tiers"
```

---

### Task 2: Fix GatewayConsentModal's off-brand blue button + purge dead CSS

**Finding:** `.gcm-btn-approve` is blue (`#3b82f6`), the one real off-brand color in this whole rollout — every other primary button in the app is the red gradient. `.gcm-btn-cancel` is a plain transparent/gray-border button, not `.btn-secondary`'s white/red-outline look. `.gcm-card`, `.gcm-drag-handle`, `.gcm-title`, `.gcm-body` (+ `.gcm-body p`), and `.gcm-footer` are confirmed dead — none of their class names appear in `GatewayConsentModal.js` (only `.gcm-hitl-badge`, `.gcm-challenge-id`, `.gcm-expires`, and the two footer button classes are actually used).

**Files:**
- Modify: `demo_api_ui/src/components/GatewayConsentModal.js:46`, `:54`
- Modify: `demo_api_ui/src/components/GatewayConsentModal.css` (full rewrite — see Step 2)

**Interfaces:** none — no prop/export changes.

- [ ] **Step 1: Swap the footer button classes**

In `demo_api_ui/src/components/GatewayConsentModal.js`, change line 46:

```jsx
      className="gcm-btn-approve"
```

to:

```jsx
      className="btn btn-primary"
```

and change line 54:

```jsx
      className="gcm-btn-cancel"
```

to:

```jsx
      className="btn btn-secondary"
```

- [ ] **Step 2: Rewrite GatewayConsentModal.css, dropping all dead rules**

Replace the entire file with:

```css
/* GatewayConsentModal — gcm- prefix */

.gcm-hitl-badge {
  display: inline-block;
  background: #fff3cd;
  border: 1px solid #ffc107;
  color: #664d03;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 6px;
  padding: 2px 8px;
  width: fit-content;
}

.gcm-challenge-id {
  font-size: 0.78rem;
  color: #1e293b;
  font-family: inherit;
}

.gcm-expires {
  font-size: 0.78rem;
  color: #1e293b;
}
```

- [ ] **Step 3: Snap the width to the 380 tier**

In `demo_api_ui/src/components/GatewayConsentModal.js`, change:

```jsx
      defaultWidth={420}
      defaultHeight={380}
```

to:

```jsx
      defaultWidth={380}
      defaultHeight={380}
```

- [ ] **Step 4: Run the test and a visual check**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/GatewayConsentModal.test.jsx`
Expected: all pass unchanged (role/name-based assertions only; `DraggableModal` is mocked in this test so the width props aren't observed).

Then reuse the mocked-Playwright screenshot recipe (mock `mockCustomerDashboard`/relevant routes, dispatch whatever event opens `GatewayConsentModal`, or render it directly in a throwaway harness) to confirm "Agree & Continue" now renders in the app's red gradient, not blue, and "Cancel" renders white/red-outline.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/GatewayConsentModal.js demo_api_ui/src/components/GatewayConsentModal.css
git commit -m "fix(ui): stop GatewayConsentModal's Approve button rendering off-brand blue

.gcm-btn-approve was #3b82f6 -- the one button in the whole app not using
the red-accent system. Also purges .gcm-card/.gcm-drag-handle/.gcm-title/
.gcm-body/.gcm-footer, none of which GatewayConsentModal.js references."
```

---

### Task 3: AgentConsentModal — make Cancel red like every other Cancel button

**Decision (confirmed with the user):** `.acm-btn--secondary` currently renders neutral slate/gray text and border, unlike every other Cancel/secondary button in the app (`.btn-secondary`'s red outline/text). Make it consistent. Its `:disabled` state uses a deliberate neutral gray per an explicit code comment ("Disabled = 'not ready yet': neutral, not a faded brand color") — that stays; only the enabled-state color changes.

**Files:**
- Modify: `demo_api_ui/src/components/AgentConsentModal.css:256-265`
- Modify: `demo_api_ui/src/components/AgentConsentModal.js:130-131`

**Interfaces:** none.

- [ ] **Step 1: Update the enabled-state secondary color**

In `demo_api_ui/src/components/AgentConsentModal.css`, change:

```css
.acm-btn--secondary {
  background: #ffffff;
  color: #334155;
  border-color: #cbd5e1;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.acm-btn--secondary:hover:not(:disabled) {
  background: #f8fafc;
  border-color: #94a3b8;
}
.acm-btn--secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

to:

```css
.acm-btn--secondary {
  background: #ffffff;
  color: var(--app-primary-red, #b91c1c);
  border-color: var(--app-primary-red-border, #7f1d1d);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.acm-btn--secondary:hover:not(:disabled) {
  background: #fef2f2;
  border-color: var(--app-primary-red, #b91c1c);
  color: var(--app-primary-red-hover, #991b1b);
}
.acm-btn--secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

(`.acm-btn--primary` is untouched — it's already the same red gradient as `.btn-primary`. `:disabled` is untouched — the neutral-gray "not ready yet" signal stays intentional.)

- [ ] **Step 2: Snap the width to the 460 tier**

In `demo_api_ui/src/components/AgentConsentModal.js`, change:

```jsx
      defaultWidth={500}
```

to:

```jsx
      defaultWidth={460}
```

(`defaultHeight={defaultModalHeight}` — computed as 520/470 depending on `requiresCheckbox` — is unchanged; it already fits its own content.)

- [ ] **Step 3: Run the test**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AgentConsentModal.test.jsx`
Expected: all tests pass unchanged (role/name-based; `DraggableModal` is mocked). Before starting this task, independently confirm the pre-existing `'shows high-value warning when amount >= hitlThreshold'` test's actual pass/fail status — the audit noted `AgentConsentModal.js`'s current JSX has no `.acm-high-value-warning` element or "exceeds" text for that test to find, which would make it a pre-existing failure unrelated to this task. If it's already failing on `main`, leave it (out of scope); if this task somehow makes a passing test start failing, that's a real regression to fix before committing.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/AgentConsentModal.css demo_api_ui/src/components/AgentConsentModal.js
git commit -m "fix(ui): make AgentConsentModal's Cancel button red like every other one

.acm-btn--secondary rendered neutral slate/gray instead of the app's
red-outline secondary look. Disabled-state gray stays -- that's a
separate, intentional 'not ready yet' signal, not a branding choice."
```

---

### Task 4: LoginSuccessModal — Continue button teal → red primary

**Files:**
- Modify: `demo_api_ui/src/components/LoginSuccessModal.jsx:43`
- Modify: `demo_api_ui/src/components/LoginSuccessModal.css:120-138`

**Interfaces:** none. No test file exists for this component (confirmed by repo-wide grep) — no test-side verification beyond a visual check.

- [ ] **Step 1: Swap the button class**

In `demo_api_ui/src/components/LoginSuccessModal.jsx`, change:

```jsx
      <button type="button" className="lsm-continue" onClick={handleContinue}>
```

to:

```jsx
      <button type="button" className="btn btn-primary" onClick={handleContinue}>
```

- [ ] **Step 2: Delete the now-superseded CSS**

In `demo_api_ui/src/components/LoginSuccessModal.css`, delete:

```css
.lsm-continue {
  padding: 8px 18px;
  background: var(--theme-accent, #0e7c86);
  border: 1px solid var(--theme-accent, #0e7c86);
  border-radius: 8px;
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: filter 0.15s;
}

.lsm-continue:hover {
  filter: brightness(1.07);
}

.lsm-continue:focus-visible {
  outline: 2px solid var(--theme-accent, #0e7c86);
  outline-offset: 2px;
}
```

(No width change — `defaultWidth={460}`/`minWidth={380}` already sit exactly on the tier.)

- [ ] **Step 3: Build + visual check**

Run: `cd demo_api_ui && npm run build`
Expected: clean (no test file references `.lsm-continue`, so no test run is needed for this one — but the build gate confirms nothing else in the codebase imports/expects that class). Then a quick visual check: this modal shows once after a fresh PingOne login — reuse a mocked Playwright script if you want a screenshot, or accept the build-clean signal given zero test coverage exists either way.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/LoginSuccessModal.jsx demo_api_ui/src/components/LoginSuccessModal.css
git commit -m "style(ui): LoginSuccessModal's Continue button red like every other primary CTA"
```

---

### Task 5: MissingCredentialsModal — fix the double-padded form + navy buttons + purge dead CSS

**Two findings here:** (1) `dm-scroll` already pads the body, and the inner `<form className="mcm-body">` adds its OWN padding on top — the form fields sit ~44px in while the intro/guidance text above sits only at `dm-scroll`'s padding. (2) `.mcm-btn-submit` is navy (`#0a2540`), one of five different "primary" colors found across these 11 modals.

**Files:**
- Modify: `demo_api_ui/src/components/MissingCredentialsModal.jsx:172`, `:180`, `:163-167`
- Modify: `demo_api_ui/src/components/MissingCredentialsModal.css` (delete dead block + button rules + rewrite dark-mode block)

**Interfaces:** none. No test file exists (confirmed by repo-wide grep).

- [ ] **Step 1: Swap the footer button classes**

In `demo_api_ui/src/components/MissingCredentialsModal.jsx`, change line 172:

```jsx
            className="mcm-btn mcm-btn-cancel"
```

to:

```jsx
            className="btn btn-secondary"
```

and change line 180:

```jsx
            className="mcm-btn mcm-btn-submit"
```

to:

```jsx
            className="btn btn-primary"
```

- [ ] **Step 2: Fix the double-padding — remove `.mcm-body`'s own padding**

In `demo_api_ui/src/components/MissingCredentialsModal.css`, change:

```css
.mcm-body {
  padding: 16px 24px 20px;
}
```

to:

```css
.mcm-body {
  padding: 0;
}
```

(`dm-scroll`'s own padding, applied by the wrapping `<div className="dm-scroll">` in the JSX, is now the only padding layer — the intro text, guidance box, and form fields all sit at the same left/right edge.)

- [ ] **Step 3: Delete the dead pre-DraggableModal shell CSS**

In the same file, delete lines 3-63 in full (`.mcm-overlay`, `@keyframes mcm-fadeIn`, `.mcm-modal`, `@keyframes mcm-slideUp`, `.mcm-header`, `.mcm-header h3`, `.mcm-header p`) — confirmed via repo-wide grep that none of `mcm-overlay`/`mcm-modal`/`mcm-header`/`mcm-footer` appear in any `.js`/`.jsx` file; `DraggableModal` supplies its own panel/titlebar/footer instead.

Also delete the `.mcm-footer` rule (currently right before the button rules):

```css
/* Footer / buttons */
.mcm-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 24px 20px;
  border-top: 1px solid #e2e8f0;
}
```

And delete `.mcm-btn`, `.mcm-btn-cancel`, `.mcm-btn-cancel:hover`, `.mcm-btn-submit`, `.mcm-btn-submit:hover`, `.mcm-btn-submit:disabled` (now dead after Step 1's class swap):

```css
.mcm-btn {
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  border: none;
}

.mcm-btn-cancel {
  background: #f1f5f9;
  color: #475569;
}

.mcm-btn-cancel:hover {
  background: #e2e8f0;
}

.mcm-btn-submit {
  background: #0a2540;
  color: #fff;
}

.mcm-btn-submit:hover {
  background: #0d3a66;
}

.mcm-btn-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 4: Rewrite the dark-mode media query, dropping its now-dead sub-rules**

Replace the whole `@media (prefers-color-scheme: dark) { ... }` block at the end of the file with:

```css
/* Dark mode */
@media (prefers-color-scheme: dark) {
  .mcm-field label {
    color: #e2e8f0;
  }
  .mcm-field input {
    background: #0f172a;
    border-color: #475569;
    color: #f1f5f9;
  }
  .mcm-guidance {
    background: #0c2d48;
    border-color: #1e5b8a;
  }
  .mcm-guidance-title {
    color: #7dd3fc;
  }
  .mcm-guidance ol {
    color: #cbd5e1;
  }
  .mcm-error-banner {
    background: #450a0a;
    border-color: #991b1b;
    color: #fecaca;
  }
}
```

(Drops the dark-mode overrides for `.mcm-modal`, `.mcm-header`(+`h3`/`p`), `.mcm-footer`, `.mcm-btn-cancel`(+`:hover`) — all targeting selectors deleted in Steps 1/3.)

- [ ] **Step 5: Snap width/minWidth to the 460 tier**

In `demo_api_ui/src/components/MissingCredentialsModal.jsx`, change:

```jsx
      defaultWidth={520}
      defaultHeight={560}
      storageKey="missing-credentials-modal"
      minWidth={340}
      minHeight={300}
```

to:

```jsx
      defaultWidth={460}
      defaultHeight={560}
      storageKey="missing-credentials-modal"
      minWidth={380}
      minHeight={300}
```

- [ ] **Step 6: Build + visual check**

Run: `cd demo_api_ui && npm run build`
Expected: clean. Visually confirm (mocked Playwright or manual): the intro text, PingOne setup guidance box, and the input fields all now align at the same left edge — no more double-indent on the form.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/MissingCredentialsModal.jsx demo_api_ui/src/components/MissingCredentialsModal.css
git commit -m "fix(ui): un-double-pad MissingCredentialsModal's form, red buttons not navy

dm-scroll already pads the body; the inner <form className=\"mcm-body\">
added a second padding layer, so the input fields sat ~44px in while the
guidance text above sat at dm-scroll's padding only. Also purges ~90
lines of dead pre-DraggableModal overlay/modal/header/footer CSS."
```

---

### Task 6: ComplianceModal — remove the duplicate title, restyle Clear, purge dead CSS (carefully — Popout shares this stylesheet)

**Finding:** `ComplianceModalContent.js` renders its own `<h3>MCP Compliance Checklist</h3>` directly under `DraggableModal`'s real titlebar, which already shows that exact same text (passed as `ComplianceModal.js`'s `title` prop) — the checklist name appears twice. The header block also carries a `complianceActionLabel` badge that has nowhere else to render if the block is deleted outright — relocate it into the body instead of dropping it.

**Files:**
- Modify: `demo_api_ui/src/components/ComplianceModalContent.js:17-27`, `:30`
- Modify: `demo_api_ui/src/components/ComplianceModal.css` (delete confirmed-dead rules only; `ComplianceModalPopout.js` shares this file)
- Modify: `demo_api_ui/src/components/ComplianceModal.js:23-24`, `:29-30`

**Interfaces:** none. No dedicated test exists for any of the three Compliance* files (confirmed — the only repo-wide hits are an unrelated `App.structure.test.js` blanket-stubbing `ComplianceModalPopout` to `null`, and a comment mention in `BankingAgent.test.js`).

- [ ] **Step 1: Delete the duplicate-heading block, relocate the action-label badge into the body**

In `demo_api_ui/src/components/ComplianceModalContent.js`, delete lines 17-27:

```jsx
      {/* Header */}
      <div className="compliance-modal__header" style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: 8, marginBottom: 8 }}>
        <div className="compliance-modal__title-block">
          <h3 className="compliance-modal__title" style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0, marginBottom: complianceStripState?.complianceActionLabel ? 4 : 0 }}>MCP Compliance Checklist</h3>
          {complianceStripState?.complianceActionLabel && (
            <span className="compliance-modal__action-label" style={{ fontSize: '0.75rem', color: '#1d4ed8' }}>
              {complianceStripState.complianceActionLabel}
            </span>
          )}
        </div>
      </div>

```

Then change line 30 (the body div's opening tag — now the first thing rendered) from:

```jsx
      <div className="compliance-modal__body" aria-live="polite" style={{ flex: 1, overflowY: 'auto', paddingRight: 8 }}>
```

to:

```jsx
      <div className="compliance-modal__body" aria-live="polite" style={{ flex: 1, overflowY: 'auto', paddingRight: 8 }}>
        {complianceStripState?.complianceActionLabel && (
          <span className="compliance-modal__action-label" style={{ display: 'block', marginBottom: 8 }}>
            {complianceStripState.complianceActionLabel}
          </span>
        )}
```

(The badge keeps its existing `.compliance-modal__action-label` class/color — only its position moves, from a now-deleted header block into the top of the scrollable body.)

- [ ] **Step 2: Restyle the Clear button**

In the same file, find (further down, the footer):

```jsx
          className="compliance-modal__clear-btn"
```

change to:

```jsx
          className="btn btn-secondary btn-sm"
```

- [ ] **Step 3: Delete confirmed-dead CSS — do NOT touch `.compliance-modal` or `.compliance-modal__modal-title`**

In `demo_api_ui/src/components/ComplianceModal.css`, delete lines 3-25 (`.compliance-modal-overlay` + `@keyframes fadeIn`):

```css
.compliance-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 16px;
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

```

Keep `.compliance-modal` and `@keyframes slideUp` immediately after it untouched — `ComplianceModalPopout.js` applies the `.compliance-modal` class to its content wrapper, and its `animation: slideUp ...` property means the keyframe is still referenced by a live rule.

Delete `.compliance-modal__drag-header` through `.compliance-modal__popout-icon:hover` (confirmed dead — no `.js`/`.jsx` file anywhere references them):

```css
/* Draggable header */
.compliance-modal__drag-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
  color: #1f2937;
  border-bottom: 1px solid #93c5fd;
  border-radius: 8px 8px 0 0;
  gap: 12px;
  user-select: none;
}

.compliance-modal__close-icon {
  background: transparent;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #1f2937;
  padding: 4px 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.compliance-modal__close-icon:hover {
  background: #e5e7eb;
  color: #111827;
}

.compliance-modal__header-buttons {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-shrink: 0;
}

.compliance-modal__popout-icon {
  background: transparent;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: #1f2937;
  padding: 4px 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.compliance-modal__popout-icon:hover {
  background: #e5e7eb;
  color: #111827;
}

```

Keep `.compliance-modal__modal-title` (used by `ComplianceModalPopout.js`'s own `<h2>`) — it sits between `.compliance-modal` and the block above it; do not delete it.

Delete `.compliance-modal__header`, `.compliance-modal__title-block`, `.compliance-modal__title` (dead now that Step 1 removed the only JSX using them):

```css
.compliance-modal__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 16px 20px;
  border-bottom: 1px solid #e5e7eb;
  gap: 12px;
}

.compliance-modal__title-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.compliance-modal__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #111827;
  line-height: 1.2;
}

```

Keep `.compliance-modal__action-label` immediately after — Step 1 relocated it, it's still live.

Delete `.compliance-modal__close`/`:hover` (a separate dead close button, not the one `DraggableModal` provides):

```css
.compliance-modal__close {
  background: transparent;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #1f2937;
  padding: 4px 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.compliance-modal__close:hover {
  background: #f3f4f6;
  color: #111827;
}

```

Keep `.compliance-modal__body` and everything from `.compliance-modal__last-response` through `.compliance-modal__skip-note` — all live, referenced by `ComplianceModalContent.js`.

Delete the combined clear/close-btn block in full (both selectors are dead now — `clear-btn` was just reclassed in Step 2, `close-btn` was already unreferenced):

```css
.compliance-modal__clear-btn,
.compliance-modal__close-btn {
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  color: #111827;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.compliance-modal__clear-btn:hover,
.compliance-modal__close-btn:hover {
  background: #f3f4f6;
  border-color: #4b5563;
}

.compliance-modal__close-btn {
  margin-left: auto;
}

```

Delete `.compliance-modal__resize-handle` and all 8 of its direction modifiers through the end of that block (dead — `DraggableModal` provides its own `.dm-handle-*` resize handles):

```css
/* Resize handles — all sides and corners */
.compliance-modal__resize-handle {
  position: absolute;
  background: transparent;
  border: none;
  padding: 0;
  z-index: 30;
}

/* Side handles */
.compliance-modal__resize-handle--top {
  top: 0;
  left: 0;
  right: 0;
  height: 6px;
  cursor: ns-resize;
}

.compliance-modal__resize-handle--bottom {
  bottom: 0;
  left: 0;
  right: 0;
  height: 6px;
  cursor: ns-resize;
}

.compliance-modal__resize-handle--left {
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
}

.compliance-modal__resize-handle--right {
  right: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
}

/* Corner handles */
.compliance-modal__resize-handle--top-left {
  top: 0;
  left: 0;
  width: 20px;
  height: 20px;
  cursor: nwse-resize;
}

.compliance-modal__resize-handle--top-right {
  top: 0;
  right: 0;
  width: 20px;
  height: 20px;
  cursor: nesw-resize;
}

.compliance-modal__resize-handle--bottom-left {
  bottom: 0;
  left: 0;
  width: 20px;
  height: 20px;
  cursor: nesw-resize;
}

.compliance-modal__resize-handle--bottom-right {
  bottom: 0;
  right: 0;
  width: 20px;
  height: 20px;
  cursor: nwse-resize;
}

.compliance-modal__resize-handle--bottom-right::after {
  content: "";
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 12px;
  height: 12px;
  background: linear-gradient(135deg, transparent 50%, #4b5563 50%);
  border-radius: 0 0 8px 0;
  pointer-events: none;
}

.compliance-modal__resize-handle--bottom-right:hover::after {
  background: linear-gradient(135deg, transparent 50%, #1f2937 50%);
}

```

Finally, in the trailing `@media (max-width: 640px) { ... }` block, delete just the `.compliance-modal-overlay` sub-rule (dead — the class itself was deleted in this same task) and keep the `.compliance-modal` sub-rule (still applies to `ComplianceModalPopout.js`'s narrow-viewport layout):

```css
@media (max-width: 640px) {
  .compliance-modal {
    max-width: 100%;
    border-radius: 12px 12px 0 0;
  }
}
```

- [ ] **Step 4: Snap width/minWidth to the 460 tier**

In `demo_api_ui/src/components/ComplianceModal.js`, change:

```jsx
      defaultWidth={420}
      defaultHeight={600}
      defaultX={20}
      defaultY={80}
      storageKey="compliance-modal"
      noBackdrop
      minWidth={300}
      minHeight={250}
```

to:

```jsx
      defaultWidth={460}
      defaultHeight={600}
      defaultX={20}
      defaultY={80}
      storageKey="compliance-modal"
      noBackdrop
      minWidth={380}
      minHeight={250}
```

- [ ] **Step 5: Build + visual check both surfaces**

Run: `cd demo_api_ui && npm run build`
Expected: clean. Visually confirm two things: (a) the embedded `ComplianceModal` (via `DraggableModal`) shows the title once, not twice, and the action-label badge (when present) now appears at the top of the scrollable checklist body; (b) `ComplianceModalPopout.js`'s separate pop-out window still renders correctly (its own `.compliance-modal`/`.compliance-modal__modal-title` styling is unaffected) — trigger it via its pop-out button and confirm.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/ComplianceModalContent.js demo_api_ui/src/components/ComplianceModal.css demo_api_ui/src/components/ComplianceModal.js
git commit -m "fix(ui): stop ComplianceModal showing its title twice

ComplianceModalContent rendered its own <h3>MCP Compliance Checklist</h3>
directly under DraggableModal's real titlebar showing the same text.
Relocates the action-label badge into the body instead of dropping it.
Purges ~150 lines of dead pre-DraggableModal CSS -- kept .compliance-modal
and .compliance-modal__modal-title, which ComplianceModalPopout.js
(a separate, non-DraggableModal pop-out) still uses."
```

---

### Task 7: ErrorModal — fix the shadowed global button class, purge dead CSS

**Finding:** `ErrorModal.js`'s "Learn more"/"Contact support" links already use `className="btn btn-secondary"` — correct. But `ErrorModal.css` locally redeclares `.btn`/`.btn-secondary`/`:hover`/`:active` with a completely different, neutral-gray look (`color:#374151`, hover `background:#f3f4f6`) instead of the app's real red-accent global one — this local override is why those two links currently render in the wrong (gray) color today. Deleting the local rule is the actual fix; no JSX change needed.

**Files:**
- Modify: `demo_api_ui/src/components/ErrorModal.css` (delete two ranges)
- Modify: `demo_api_ui/src/components/ErrorModal.js:30-31`

**Interfaces:** none. No test file exists for `ErrorModal.js` (`src/__tests__/txErrorModal.test.js` is a same-name false match — a self-contained, unrelated inline component, confirmed by reading it).

- [ ] **Step 1: Delete the dead pre-DraggableModal shell CSS (lines 6-88)**

In `demo_api_ui/src/components/ErrorModal.css`, delete lines 6-88 in full — `.modal-overlay`, `.error-modal`, `@keyframes slideIn`, `.error-modal__header`, `.error-modal__icon`, `.error-modal__title`, `.error-modal__close`, `.error-modal__close:hover`, `.error-modal__body`:

```css
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 16px;
}

.error-modal {
  background: white;
  border-radius: 8px;
  max-width: 600px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  animation: slideIn 0.2s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.error-modal__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px;
  background: #fef3c7;
  border-bottom: 2px solid #fbbf24;
  border-radius: 8px 8px 0 0;
}

.error-modal__icon {
  font-size: 24px;
  flex-shrink: 0;
}

.error-modal__title {
  flex: 1;
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #92400e;
  word-break: break-word;
}

.error-modal__close {
  background: transparent;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #92400e;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.error-modal__close:hover {
  background-color: rgba(0, 0, 0, 0.1);
}

.error-modal__body {
  padding: 24px;
}

```

Keep `.error-section`, `.error-section h3`, `.error-section p`, `.error-modal__toggle`, `.error-modal__toggle:hover`, `.error-modal__code` — all live.

- [ ] **Step 2: Delete `.error-modal__footer` and the shadowing local `.btn`/`.btn-secondary` block, plus the now-fully-dead responsive media query**

Delete:

```css
.error-modal__footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 16px 24px;
  border-top: 1px solid #e5e7eb;
  background: #f9fafb;
}

.btn {
  padding: 8px 16px;
  border-radius: 4px;
  border: 1px solid #d1d5db;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.btn-secondary {
  background: white;
  color: #374151;
}

.btn-secondary:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.btn-secondary:active {
  background: #e5e7eb;
}

/* Mobile responsive */
@media (max-width: 768px) {
  .modal-overlay {
    padding: 16px;
  }

  .error-modal {
    max-height: 90vh;
  }

  .error-modal__header {
    padding: 16px;
  }

  .error-modal__body {
    padding: 16px;
  }

  .error-modal__footer {
    flex-direction: column;
    padding: 12px 16px;
  }

  .btn {
    width: 100%;
  }
}
```

(The whole responsive block is dead once its targets — `.modal-overlay`, `.error-modal`, `.error-modal__header`, `.error-modal__body`, `.error-modal__footer`, `.btn` — are gone. Deleting the local `.btn`/`.btn-secondary` rules is the actual bug fix: "Learn more"/"Contact support" will now pick up the real global `.btn-secondary` red-outline look from `index.css` automatically, since nothing shadows it anymore.)

- [ ] **Step 3: Snap the width to the 460 tier**

In `demo_api_ui/src/components/ErrorModal.js`, change:

```jsx
      defaultWidth={560}
      defaultHeight={480}
```

to:

```jsx
      defaultWidth={460}
      defaultHeight={480}
      minWidth={380}
```

(Adds an explicit `minWidth` — previously unset, falling back to `DraggableModal`'s default `320`.)

- [ ] **Step 4: Build + visual check**

Run: `cd demo_api_ui && npm run build`
Expected: clean. Visually confirm "Learn more" and "Contact support" now render red-outline (matching `.btn-secondary` everywhere else), not gray.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/ErrorModal.css demo_api_ui/src/components/ErrorModal.js
git commit -m "fix(ui): stop ErrorModal's local .btn-secondary from shadowing the real one

Learn more / Contact support already used className=\"btn btn-secondary\"
but a local re-declaration of .btn-secondary in this file's own CSS
(neutral gray) was winning over the app's real red-accent global one.
Deleting the local override is the fix. Also purges ~90 lines of dead
pre-DraggableModal overlay/header/footer CSS."
```

---

### Task 8: ConfirmModal — replace the inline-styled Confirm button with real button classes

**Finding:** Both buttons use `DraggableModal`'s bare `.dm-close-btn` as a base class. Cancel gets no override (plain gray look). Confirm layers inline styles on top: `danger` true → `background:'#dc2626'` (close to, but not identical to, `.btn-danger`'s gradient); `danger` false → `background:'#2563eb'` (a plain blue matching none of the app's red-accent tokens). Neither variant has a `:hover` rule (inline styles can't express `:hover`), so the confirm/danger action currently has zero hover feedback.

**Files:**
- Modify: `demo_api_ui/src/components/ConfirmModal.js` (full footer + `DraggableModal` call)

**Interfaces:** none. The one real (non-mocked) test that touches this component (`UserDashboardPing2026.test.js` test #9) only asserts `.dm-panel` presence/absence — it does not assert `ConfirmModal`'s own button class, color, or width/height.

- [ ] **Step 1: Replace the footer buttons**

In `demo_api_ui/src/components/ConfirmModal.js`, change:

```jsx
  const footer = (
    <>
      <button type="button" className="dm-close-btn" onClick={onCancel}>
        {cancelLabel}
      </button>
      <button
        type="button"
        className="dm-close-btn"
        style={{
          background: danger ? '#dc2626' : '#2563eb',
          borderColor: danger ? '#b91c1c' : '#1d4ed8',
          color: '#fff',
        }}
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
    </>
  );
```

to:

```jsx
  const footer = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onCancel}>
        {cancelLabel}
      </button>
      <button
        type="button"
        className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
    </>
  );
```

(This also fixes the missing-hover-feedback bug — `.btn-danger`/`.btn-primary` both define real `:hover` rules, which the old inline-`style` approach couldn't.)

- [ ] **Step 2: Snap the width to the 380 tier**

Change:

```jsx
      defaultWidth={440}
      defaultHeight={210}
      backdropClose
      storageKey={null}
```

to:

```jsx
      defaultWidth={380}
      defaultHeight={210}
      minWidth={380}
      backdropClose
      storageKey={null}
```

- [ ] **Step 3: Run the one real test that touches this component**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/UserDashboardPing2026.test.js -t "ConfirmModal"`
Expected: test #9 (`ConfirmModal (Reset Demo) mounts in clinical-split branch...`) still passes — it only checks `.dm-panel` presence, unaffected by this change.

- [ ] **Step 4: Build + visual check**

Run: `cd demo_api_ui && npm run build`
Expected: clean. Visually confirm: Cancel is now white/red-outline (was plain gray `.dm-close-btn`), Confirm is the app's real red gradient (`danger=false`) or `.btn-danger`'s gradient (`danger=true`) — not the old plain blue/red inline colors — and Confirm now visibly changes on hover.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/ConfirmModal.js
git commit -m "fix(ui): replace ConfirmModal's inline-styled Confirm button with real classes

Confirm was background:'#2563eb' (plain blue, matching none of the app's
red-accent tokens) with no :hover rule at all (inline styles can't
express one). Now .btn-primary/.btn-danger by the danger prop, both with
real hover feedback. Cancel becomes real .btn-secondary instead of bare
dm-close-btn."
```

---

### Task 9: Full regression verification

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite + build**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: same pass/fail composition as the pre-existing baseline (confirmed during Phase 1 to be ~49 unrelated failures when run from a worktree with a symlinked `node_modules`, or ~1 unrelated failure — `AdminSideNav` nav-label sync — when run against a fully-provisioned checkout; re-establish whichever baseline applies to how this task is actually run, and confirm no *new* failures appear beyond it). Every test file this plan touches (`FidoStepUpModal`, `OtpStepUpModal.methodChoice`, `GatewayConsentModal`, `AgentConsentModal`, `UserDashboardPing2026`) should show 0 new failures caused by this plan's changes specifically.

- [ ] **Step 2: Dead-code / dead-CSS sanity grep**

Run:
```bash
cd demo_api_ui && grep -rn "gcm-card\|gcm-drag-handle\|gcm-title\b\|gcm-footer\|gcm-body\b\|mcm-overlay\|mcm-modal\|mcm-header\|mcm-footer\|mcm-btn\b\|compliance-modal__drag-header\|compliance-modal__close-icon\|compliance-modal__header-buttons\|compliance-modal__popout-icon\|compliance-modal__header\b\|compliance-modal__title-block\|compliance-modal__title\b\|compliance-modal__close\b\|compliance-modal__close-btn\|compliance-modal__resize-handle\|error-modal__header\|error-modal__body\|error-modal__footer\|lsm-continue\b" src/components/*.js src/components/*.jsx src/components/*.css
```
Expected: no matches (everything this plan deleted is fully gone; class names that were intentionally kept — e.g. `.compliance-modal`, `.compliance-modal__modal-title`, `.error-section`, `.gcm-hitl-badge` — are not in this grep's pattern list, so their continued presence is expected and correct).

- [ ] **Step 3: Visual sweep**

Reuse the mocked-Playwright screenshot recipe (or a quick manual pass through the running dev stack) to confirm, across all 8 restyled modals: primary actions render the app's red gradient, secondary/Cancel actions render white/red-outline, and none of the width changes clipped content or introduced unwanted scrolling. Pay particular attention to `ComplianceModal` (title-not-doubled, action-label badge visible) and `MissingCredentialsModal` (form no longer double-indented).
