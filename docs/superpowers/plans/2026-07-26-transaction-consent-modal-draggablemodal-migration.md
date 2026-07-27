# TransactionConsentModal → DraggableModal Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `TransactionConsentModal.tsx` off its hand-rolled `drp-*` shell onto the shared `DraggableModal` component, fix the Cancel/Agree button color collision, and keep every existing test green — this is Phase 1 of the customer-modal-style-unification effort (see `docs/superpowers/specs/2026-07-26-customer-modal-style-unification-design.md`). Phase 2 (bulk rollout to the other 10 customer-facing modals) is a **separate plan**, written after this one lands — it depends on the `className` prop and `.modal-text-link` class this plan introduces.

**Architecture:** `TransactionConsentModal` currently violates this repo's "always DraggableModal" rule: it calls `useDraggablePanel` directly and hand-builds its own panel/header/resize-handles/pop-out-window shell, duplicating ~250 lines of logic that `DraggableModal.jsx` already provides as shared infrastructure. This plan deletes that duplicate shell code and wraps the modal's existing step-content JSX (`stepContent` — MFA/OTP/FIDO enrollment flows, untouched) in `<DraggableModal>`. `DraggableModal` gains one small new prop (`className`) so the migrated panel can still be found by `.transaction-consent-popup`, which two Playwright e2e specs and a shared test helper depend on today.

**Tech Stack:** React 19.2 (`.tsx`), Vitest 3.2 + `@testing-library/react` for unit tests, Playwright for e2e. No new dependencies.

## Global Constraints

- Working directory: `.claude/worktrees/modal-style-unification` (branch `worktree-modal-style-unification`) — already an isolated worktree. Stage files explicitly (`git add <files>`), never `git add -A`.
- REGRESSION_PLAN §0/§1 applies — this touches a live transaction-consent/MFA flow. Emoji allowlist: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` only (this plan introduces no new emoji — `✕`/`🪟` already exist in `DraggableModal.jsx`).
- Verify before calling any task done: `cd demo_api_ui && npm run test:unit && npm run build`.
- Hard test-compatibility requirement: `.transaction-consent-popup`, `.transfer-form`, `.account-card`, button role names `"Agree & continue"` / `"Confirm"`, and OTP placeholder `123123` must keep working — `demo_api_ui/tests/e2e/hitl-transfer.spec.js`, `hitl-transfer.real.spec.js`, and `tests/e2e/helpers/hitlMocks.js` all key off these.
- No TypeScript sources is the stated house rule for `demo_api_ui` (see its `CLAUDE.md`), but `TransactionConsentModal.tsx` is a pre-existing exception — this plan keeps it a `.tsx` file (not in scope to convert).

---

### Task 1: Fix the Cancel/Agree button color collision

`.transaction-consent-btn--ghost` (used by the main "Cancel" button and the denial-dialog's "Keep reviewing" button) currently renders in the **exact same red gradient** as `.transaction-consent-btn--primary` ("Agree & continue"), so the two opposite actions look identical. Fix: give `--ghost` the same white/red-outline treatment the app's global `.btn-secondary` already uses everywhere else (`index.css:597-608`).

**Files:**
- Modify: `demo_api_ui/src/components/TransactionConsentPage.css:366-370` and `:389-391`

**Interfaces:** none — pure CSS value change, no JSX/class-name changes in this task.

- [ ] **Step 1: Change the two CSS rules**

In `demo_api_ui/src/components/TransactionConsentPage.css`, replace lines 366-370:

```css
.transaction-consent-btn--ghost {
  background: linear-gradient(135deg, #dc2626, #991b1b);
  border-color: transparent;
  color: #fff;
}
```

with:

```css
.transaction-consent-btn--ghost {
  background: #fff;
  border-color: var(--app-primary-red-border);
  color: var(--app-primary-red);
}
```

And replace lines 389-391:

```css
.transaction-consent-btn--ghost:hover:not(:disabled) {
  background: linear-gradient(135deg, #ef4444, #b91c1c);
}
```

with:

```css
.transaction-consent-btn--ghost:hover:not(:disabled) {
  background: #fef2f2;
  border-color: var(--app-primary-red);
  color: var(--app-primary-red-hover);
}
```

(`--app-primary-red-border`, `--app-primary-red`, `--app-primary-red-hover` are already defined globally in `demo_api_ui/src/index.css:72-76` — no new variables needed.)

- [ ] **Step 2: Run the unit suite — confirm no regression**

Run: `cd demo_api_ui && npm run test:unit`
Expected: same pass count as before this change (this is a CSS-value-only change; no test asserts on the literal gradient string).

- [ ] **Step 3: Visually verify the color change**

Reuse the mocked-HITL Playwright recipe (drive `/dashboard`, mock `mockHitlDashboard`/`mockHitlConsentApi` from `tests/e2e/helpers/hitlMocks.js`, open the transfer form, submit $300, screenshot the `.transaction-consent-popup`). Confirm "Cancel" now renders white with a red outline, visually distinct from the solid-red-gradient "Agree & continue".

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/TransactionConsentPage.css
git commit -m "fix(ui): stop Cancel from rendering identical to Agree & continue

TransactionConsentModal's --ghost button used the same red gradient as
--primary. Give it the app's existing white/red-outline secondary look."
```

---

### Task 2: Promote the "Learn:" link to a shared `.modal-text-link` class

`demo_api_ui/src/index.css` already centralizes the app's shared button classes (`.btn-primary`, `.btn-secondary`, `.btn-danger`). This task adds a matching shared text-link class there, so Phase 2's `ErrorModal` (which currently has an inconsistent boxed "Learn more" button) can reuse the exact same link style TransactionConsentModal already got right.

**Files:**
- Modify: `demo_api_ui/src/index.css` (insert new rule after line 642)
- Modify: `demo_api_ui/src/components/TransactionConsentModal.tsx:1073`
- Modify: `demo_api_ui/src/components/TransactionConsentPage.css:39-55` (delete, now superseded)

**Interfaces:**
- Produces: `.modal-text-link` / `.modal-text-link:hover` in `index.css`, usable by any modal in this app without an extra import (it's the global stylesheet).

- [ ] **Step 1: Add the shared class to index.css**

In `demo_api_ui/src/index.css`, after line 642 (the closing `}` of `.btn-danger:hover`) and before line 644 (`.btn-success`), insert:

```css

.modal-text-link {
  display: inline-block;
  margin: 0 0 0.65rem;
  padding: 0;
  border: none;
  background: none;
  color: var(--brand-navy);
  font-size: 0.78rem;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.modal-text-link:hover {
  text-decoration: none;
}
```

(`--brand-navy` is already defined at `index.css:106` — no new variable needed. Values copied verbatim from the rule being deleted in Step 3, so this is a pure rename, not a restyle.)

- [ ] **Step 2: Update the JSX class name**

In `demo_api_ui/src/components/TransactionConsentModal.tsx:1073`, change:

```tsx
              className="transaction-consent-learn-link"
```

to:

```tsx
              className="modal-text-link"
```

- [ ] **Step 3: Delete the now-superseded CSS rule**

In `demo_api_ui/src/components/TransactionConsentPage.css`, delete lines 39-55 (`.transaction-consent-learn-link` and `.transaction-consent-learn-link:hover`) in full — replaced by Step 1's `index.css` rule.

- [ ] **Step 4: Run the unit suite**

Run: `cd demo_api_ui && npm run test:unit`
Expected: same pass count as before (the existing `TransactionConsentModal.simulated.test.jsx` never exercises this link, per its own note that `useEducationUI`'s mock shape doesn't match what the component reads — this rename doesn't change that).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/index.css demo_api_ui/src/components/TransactionConsentModal.tsx demo_api_ui/src/components/TransactionConsentPage.css
git commit -m "refactor(ui): promote transaction-consent-learn-link to shared .modal-text-link

Prep for Phase 2 — ErrorModal's inconsistent boxed 'Learn more' button
will reuse this same class instead of inventing its own treatment."
```

---

### Task 3: Add an optional `className` prop to DraggableModal

`DraggableModal` currently has no way for a consumer to add a custom class to its outer panel. Task 4 needs this to keep `.transaction-consent-popup` alive on the migrated panel for e2e-test compatibility. No existing test file covers `DraggableModal` directly (confirmed: `find . -iname "DraggableModal*test*"` returns nothing) — this task adds the first one, TDD-style.

**Files:**
- Create: `demo_api_ui/src/components/__tests__/DraggableModal.test.jsx`
- Modify: `demo_api_ui/src/components/DraggableModal.jsx:51-69` (prop destructuring), `:233-244` (panel div)

**Interfaces:**
- Produces: `DraggableModal` accepts an optional `className?: string` prop (default `""`), appended (space-separated) to the panel's existing `dm-panel` class. Omitting it is a no-op — every other current consumer of `DraggableModal` is unaffected.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/DraggableModal.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DraggableModal from '../DraggableModal';

describe('DraggableModal', () => {
  it('appends a custom className to the panel alongside dm-panel', () => {
    render(
      <DraggableModal isOpen onClose={vi.fn()} title="Test" className="probe-class">
        <p>body</p>
      </DraggableModal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('dm-panel');
    expect(dialog).toHaveClass('probe-class');
  });

  it('renders only dm-panel when no className is passed', () => {
    render(
      <DraggableModal isOpen onClose={vi.fn()} title="Test">
        <p>body</p>
      </DraggableModal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className.trim()).toBe('dm-panel');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/DraggableModal.test.jsx`
Expected: FAIL on the first test (`probe-class` not present — the prop is currently silently dropped since it isn't destructured).

- [ ] **Step 3: Add the prop**

In `demo_api_ui/src/components/DraggableModal.jsx`, in the destructured props (currently lines 51-69), add `className = ""` — e.g. right after `title = "Panel",`:

```jsx
export default function DraggableModal({
  isOpen,
  onClose,
  title = "Panel",
  className = "",
  children,
  footer,
  defaultWidth = 520,
  ...
```

Then in the panel div (currently lines 233-244), change:

```jsx
      <div
        className="dm-panel"
        role="dialog"
```

to:

```jsx
      <div
        className={`dm-panel${className ? ` ${className}` : ""}`}
        role="dialog"
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/DraggableModal.test.jsx`
Expected: PASS (both tests).

- [ ] **Step 5: Run the full unit suite**

Run: `cd demo_api_ui && npm run test:unit`
Expected: same pass count as before, plus the 2 new tests (every other `DraggableModal` consumer passes no `className`, so the default `""` keeps their rendered output byte-identical).

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/DraggableModal.jsx demo_api_ui/src/components/__tests__/DraggableModal.test.jsx
git commit -m "feat(ui): let DraggableModal consumers append a custom className

Needed so TransactionConsentModal's migration onto DraggableModal can
keep .transaction-consent-popup for e2e-test compatibility."
```

---

### Task 4: Migrate TransactionConsentModal's shell onto DraggableModal

This is the core migration. `TransactionConsentModal.tsx`'s own pop-out mechanism (`PopOutPortal`, `handlePopOut`, `popoutWin` state) is functionally a duplicate of `DraggableModal`'s built-in one — both portal `children` into a `window.open()`'d document via the same pattern, and since `DraggableModal` re-renders `title` reactively through the SAME React tree (portal, not a separate root), it already handles a per-step-changing title correctly. Deleting the duplicate and delegating to `DraggableModal` is a pure simplification, not a feature change.

**Behavior changes this task intentionally makes (call these out in review — don't let them slide by silently):**
1. **Dismiss consolidation:** Today, clicking the ✕ (old custom header) calls the parent's raw `onClose` immediately (no confirmation), while clicking the backdrop calls `handleCancelClick` (opens the "Transaction not authorized" confirmation dialog) — an existing inconsistency. After migration, `DraggableModal`'s ✕ **and** Escape key **and** the "Cancel" button all call `handleCancelClick` uniformly. Clicking the backdrop now does nothing (matches every other `DraggableModal`-based modal in this app already — none of the other 10 in-scope modals reproduce a "backdrop-click-asks-for-confirmation" pattern either).
2. **Escape key now closes-with-confirmation** — `DraggableModal` has built-in Escape handling; the old custom shell had none.
3. **Known, explicitly out-of-scope gap:** `DraggableModal`'s title bar has no `id`/`aria-labelledby` wiring (confirmed: no other modal in this app gets that either). The dialog loses its explicit `aria-labelledby` pointing at a heading. This plan does not fix it — it's a `DraggableModal`-wide gap affecting all 11 in-scope modals, not something to patch one-off here. Not requested by the spec; flagged for a future accessibility pass.

**Files:**
- Modify: `demo_api_ui/src/components/TransactionConsentModal.tsx` (imports; delete dead shell/popout code; replace final `return`)
- Modify: `demo_api_ui/src/components/TransactionConsentPage.css` (delete dead shell rules; tighten `.drp-body` padding)

**Interfaces:**
- Consumes: `DraggableModal`'s `className` prop from Task 3.
- Produces: no new exports — `TransactionConsentModal`'s own props/behavior for its consumers (`Dashboard.js`, HITL agent flow, etc.) are unchanged.

- [ ] **Step 1: Update imports**

In `demo_api_ui/src/components/TransactionConsentModal.tsx`, remove line 16:

```tsx
import { useDraggablePanel } from "../hooks/useDraggablePanel";
```

replace it with:

```tsx
import DraggableModal from "./DraggableModal";
```

and remove line 27:

```tsx
import "../styles/draggablePanel.css";
```

(`draggablePanel.css` stays in the repo untouched — it's shared by 7 other components; only this file's now-unused import goes away.)

- [ ] **Step 2: Delete the standalone PopOutPortal helper**

Delete lines 76-91 (the doc comment plus the `function PopOutPortal({...}) {...}` block) — `DraggableModal` has its own equivalent built in.

- [ ] **Step 3: Delete the popoutWin state**

Delete lines 148-150:

```tsx
  // Pop-out: content renders in a separate browser window via createPortal,
  // mirroring DraggableModal.jsx's handlePopOut/PopOutPortal pattern.
  const [popoutWin, setPopoutWin] = useState<Window | null>(null);
```

(Keep the surrounding `assertionPending` state above it and `mfaThreshold` state below it untouched.)

- [ ] **Step 4: Delete handleBackdropPointer and the custom useDraggablePanel call**

Delete lines 308-324:

```tsx
  const handleBackdropPointer = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget && !submitting && !otpVerifying)
        handleCancelClick();
    },
    [submitting, otpVerifying, handleCancelClick],
  );

  const { pos, size, handleDragStart, createResizeHandler } = useDraggablePanel(
    () => ({
      x: Math.max(20, (window.innerWidth - 420) / 2),
      y: Math.max(20, (window.innerHeight - 440) / 2),
    }),
    { w: 420, h: 440 },
    { storageKey: "transaction-consent-modal" },
  ) as any;

```

(Keep `modalTitle` — currently the next block — untouched.)

- [ ] **Step 5: Delete isPoppedOut and handlePopOut and its two cleanup effects**

After `modalTitle`'s closing `` ` : "Approve high-value transaction";`` line, delete the block from `const isPoppedOut = ...` through the second cleanup `useEffect` (currently lines 333-389):

```tsx
  const isPoppedOut = Boolean(popoutWin && !popoutWin.closed);

  const handlePopOut = useCallback(() => {
    if (popoutWin && !popoutWin.closed) {
      popoutWin.focus();
      return;
    }
    const w = size.w + 40;
    const h = size.h + 60;
    const left = window.screenX + pos.x;
    const top = window.screenY + pos.y;
    const win = window.open(
      "",
      `tx-consent-${Date.now()}`,
      `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    );
    if (!win) return;

    const styleLinks = Array.from(
      document.querySelectorAll('link[rel="stylesheet"]'),
    )
      .map((el) => `<link rel="stylesheet" href="${(el as HTMLLinkElement).href}">`)
      .join("\n");
    const inlineStyles = Array.from(document.querySelectorAll("style"))
      .map((el) => `<style>${el.textContent}</style>`)
      .join("\n");

    win.document.write(`<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${modalTitle}</title>
${styleLinks}
${inlineStyles}
<style>
html,body{margin:0;padding:0;height:100%;background:#fff}
#drp-popout-root{display:flex;flex-direction:column;height:100%;overflow:hidden}
</style>
</head><body><div id="drp-popout-root"></div></body></html>`);
    win.document.close();
    win.addEventListener("beforeunload", () => setPopoutWin(null));
    setPopoutWin(win);
  }, [popoutWin, size, pos, modalTitle]);

  // Close the pop-out window if this component unmounts while it's open.
  useEffect(
    () => () => {
      if (popoutWin && !popoutWin.closed) popoutWin.close();
    },
    [popoutWin],
  );

  // Close any pop-out window if the modal itself is dismissed from outside
  // (parent flips `open` to false) — otherwise it's left orphaned since the
  // early `if (!open...) return null` below stops rendering the portal.
  useEffect(() => {
    if (!open && popoutWin && !popoutWin.closed) popoutWin.close();
  }, [open, popoutWin]);

```

(Keep `modalTitle` above this block, and `handleConfirm` — the next function — untouched.)

- [ ] **Step 6: Delete the isPoppedOut early-return branch**

Delete the block starting `if (isPoppedOut && popoutWin) {` through its closing `}` (currently lines 1229-1287), i.e. everything between `denialOverlay`'s closing `) : null;` and the final `return (`.

- [ ] **Step 7: Replace the final return statement**

Replace everything from `return (` through the component's closing `};` (currently lines 1288-1459) with:

```tsx
  return (
    <>
      <DraggableModal
        isOpen={open}
        onClose={handleCancelClick}
        title={modalTitle}
        footer={null}
        className="transaction-consent-popup"
        defaultWidth={380}
        defaultHeight={440}
        storageKey="transaction-consent-modal"
      >
        <div className="drp-body">{stepContent}</div>
      </DraggableModal>
      {denialOverlay ? createPortal(denialOverlay, document.body) : null}
    </>
  );
};

export default TransactionConsentModal;
```

(`denialOverlay` — computed just above this, unchanged — now needs its own portal since it's no longer nested inside a DOM subtree that happened to share a stacking context with the old hand-rolled overlay. `document.body` is the same portal target `DraggableModal` itself uses, so both stack against the same root context; `.transaction-consent-modal-overlay`'s existing `z-index: 100070` comfortably beats `DraggableModal`'s default `zIndex={9999}`.)

- [ ] **Step 8: Delete the now-dead shell CSS**

In `demo_api_ui/src/components/TransactionConsentPage.css`, delete these now-unreferenced rules in full:
- Lines 3-12 (`.transaction-consent-popup-overlay`) — `DraggableModal` provides its own backdrop.
- Lines 14-23 (`.transaction-consent-popup`) — kept only as a class *name* (for the e2e locator) via the new `className` prop; `DraggableModal`'s `.dm-panel` already supplies background/border-radius/box-shadow, so this rule's declarations would just conflict.
- Lines 25-30 (`.transaction-consent-popup__title`) — replaced by `DraggableModal`'s own `.dm-title`.
- Lines 57-95 (the `/* ── Draggable-panel header controls ── */` comment through `.drp-header__btn:hover`) — replaced by `.dm-titlebar`/`.dm-controls`/`.dm-btn`.
- Lines 97-105 (the `/* ── Pop-out window layout ── */` comment plus `.drp-popout-layout`) — `DraggableModal.css` already defines an equivalent `.dm-popout-layout`.
- Lines 113-141 (`.drp-popout-placeholder` and `.drp-popout-placeholder__btn` + `:hover`) — `DraggableModal.css` already defines equivalent `.dm-popout-placeholder`/`.dm-placeholder-btn`.

(Line numbers are pre-Task-2 numbering; since Task 2 already deleted lines 39-55, re-derive exact current line numbers with `grep -n` before deleting — don't delete by number blindly, confirm by matching the selector text shown above.)

- [ ] **Step 9: Tighten `.drp-body` padding to the Compact spacing convention**

`.drp-body` stays (it's still the body's own padding wrapper, unaffected by the shell change). Change its padding from the current `0.85rem 1rem 1rem` to the spec's Compact convention:

```css
.drp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 14px 14px;
}
```

- [ ] **Step 10: Run the unit suite**

Run: `cd demo_api_ui && npm run test:unit`
Expected: `TransactionConsentModal.simulated.test.jsx`'s two tests still pass unchanged (they query by role/text — `checkbox`, `/agree & continue/i` — none of which this migration touches), plus everything from Tasks 1-3.

- [ ] **Step 11: Run the build gate**

Run: `cd demo_api_ui && npm run build`
Expected: clean build — confirms no dangling references to deleted identifiers (`useDraggablePanel`, `pos`, `size`, `handleDragStart`, `createResizeHandler`, `handlePopOut`, `popoutWin`, `isPoppedOut`, `PopOutPortal`, `handleBackdropPointer`).

- [ ] **Step 12: Commit**

```bash
git add demo_api_ui/src/components/TransactionConsentModal.tsx demo_api_ui/src/components/TransactionConsentPage.css
git commit -m "refactor(ui): migrate TransactionConsentModal onto DraggableModal

Deletes ~250 lines of duplicated drag/resize/pop-out shell logic that
DraggableModal already provides. Dismiss affordances (X, Escape, Cancel)
now uniformly open the decline-confirmation dialog instead of X closing
immediately while only the backdrop asked for confirmation."
```

---

### Task 5: Full regression verification

**Files:** none (verification only).

- [ ] **Step 1: Unit + build gate**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: both green.

- [ ] **Step 2: Mocked e2e spec**

Run: `cd demo_api_ui && npx playwright test tests/e2e/hitl-transfer.spec.js`
Expected: both tests pass (`agent HITL event opens consent modal and completes with OTP 123123`, `dashboard transfer form triggers HITL consent and completes with OTP 123123`). This is the load-bearing regression check — it exercises `.transaction-consent-popup`, the checkbox, `"Agree & continue"`, the `123123` OTP field, and `"Confirm"`, i.e. every selector this migration risked breaking.

- [ ] **Step 3: Real-login e2e spec (best-effort)**

If `E2E_CUSTOMER_USERNAME`/`E2E_CUSTOMER_PASSWORD` are resolvable (via the main checkout's `demo_api_server/.env` — see `tests/e2e/helpers/repoRoots.js`) and the stack is running on `local.ping-devops.com:4000`:

Run: `cd demo_api_ui && E2E_BASE_URL=https://local.ping-devops.com:4000 PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test tests/e2e/hitl-transfer.real.spec.js`

If the env vars aren't set, this spec self-skips (`test.skip(!requireRealLoginEnv(), ...)`) — that's an acceptable outcome, not a failure to chase.

- [ ] **Step 4: Visual confirmation of the migrated shell**

Reuse the mocked-Playwright screenshot recipe from Task 1 Step 3 (drive `/dashboard`, mock HITL routes, submit a $300 transfer, screenshot `.transaction-consent-popup`). Confirm: navy titlebar (matches every other `DraggableModal` modal now, not the old gray `#f3f4f6` custom header), flush header, `🪟`/`✕` controls present and working, Cancel visually distinct from Agree & continue (Task 1's fix), panel roughly 380px wide.

- [ ] **Step 5: Confirm no dangling dead code**

Run: `cd demo_api_ui && grep -rn "useDraggablePanel\|popoutWin\|isPoppedOut\|handleBackdropPointer\|PopOutPortal" src/components/TransactionConsentModal.tsx`
Expected: no matches (everything from Task 4 fully removed).
