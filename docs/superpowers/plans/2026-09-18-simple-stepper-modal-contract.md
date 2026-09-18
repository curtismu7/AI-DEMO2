# Simple Stepper Modal Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Simple Stepper onto the shared resizable browser-window modal primitive and establish the light/dark pop-out rule for future modal surfaces.

**Architecture:** `SimpleStepperPanel` will keep its token-chain table and row rendering but delegate surface behavior to `DraggableModal`. `DraggableModal` will add a theme toggle inside its child-window title bar, changing only the child document's `data-theme`. The contract will be recorded in the UI regression/theming guidance.

**Tech Stack:** React 19.2, Vitest 3.2, plain CSS theme tokens, existing `DraggableModal` and `useDraggablePanel` primitives.

**Spec:** `docs/superpowers/specs/2026-09-18-modal-surface-contract-design.md`

## Global Constraints

- Preserve the emoji allowlist; use `🪟`, `☀️`, `🌙`, `✕`, and `✓` only for their existing jobs.
- Keep light/dark state keyed by `:root[data-theme="dark"]`; do not use `prefers-color-scheme`.
- Keep themeable color/background/font-size values out of inline styles; layout geometry may remain inline where the modal primitive requires it.
- Use `DraggableModal` for modal surfaces; do not create a second pop-out root or resize implementation.
- Run `cd demo_api_ui && npm run build` before claiming completion.

### Task 1: Record the modal surface contract

**Files:**
- Modify: `REGRESSION_PLAN.md` §0 UI style rules
- Modify: `THEMING.md` modal guidance section

**Interfaces:**
- Produces the documented rule that future modal changes can be checked against.

- [ ] **Step 1: Add the contract text**

Document that modal/pop-out surfaces must use the shared modal primitive,
provide pop-out and resizing, and use theme tokens in both embedded and child
windows. State that existing specialized surfaces are migrated when touched,
not through unrelated cleanup.

- [ ] **Step 2: Check the documentation diff**

Run:

```bash
git diff --check -- REGRESSION_PLAN.md THEMING.md
```

Expected: no whitespace errors and no unrelated changes.

- [ ] **Step 3: Commit the contract**

```bash
git add REGRESSION_PLAN.md THEMING.md
git commit -m "docs(ui): define modal surface contract"
```

### Task 2: Refactor Simple Stepper onto DraggableModal

**Files:**
- Modify: `demo_api_ui/src/components/SimpleStepperPanel.js`
- Modify: `demo_api_ui/src/components/SimpleStepperPanel.css`
- Test: `demo_api_ui/src/components/__tests__/SimpleStepperPanel.test.jsx`
- Test: `demo_api_ui/src/components/__tests__/SimpleStepperBar.test.jsx`

**Interfaces:**
- Consumes: `DraggableModal` props `isOpen`, `onClose`, `title`, `storageKey`, `noBackdrop`, `footer`, `defaultWidth`, `defaultHeight`, `minWidth`, and `minHeight`.
- Produces: the same `SimpleStepperPanel` component API and table semantics, plus the shared modal controls including pop-out and resize.

- [ ] **Step 1: Add failing tests**

Extend the panel tests to mock `DraggableModal` with a dialog wrapper and
assert that Simple Stepper passes `noBackdrop`, `footer={null}`, a storage key,
and minimum dimensions. Extend the bar test to assert the embedded panel still
opens and closes through the existing Show/Hide control.

- [ ] **Step 2: Run the focused tests and verify the intended failure**

```bash
cd demo_api_ui
npm run test:unit -- src/components/__tests__/SimpleStepperPanel.test.jsx src/components/__tests__/SimpleStepperBar.test.jsx
```

Expected: the new primitive-prop assertions fail before the refactor.

- [ ] **Step 3: Replace the custom panel shell**

Remove the local `useDraggablePanel`, portal, resize-handle, header-control,
minimize, and close-shell code from `SimpleStepperPanel`. Render the existing
stepper table as `DraggableModal` children with `noBackdrop`, `footer={null}`,
`storageKey="sstp-modal"`, `defaultWidth={560}`, `defaultHeight={480}`,
`minWidth={360}`, and `minHeight={240}`. Keep the token-chain context lookup,
halted-row classification, table markup, and close callback unchanged.

- [ ] **Step 4: Move only table-specific styling to theme tokens**

Keep layout rules in `SimpleStepperPanel.css`, replace hard-coded surface/ink/
border/status colors with the existing `--th-*` families, and remove styling
for the deleted custom title bar, controls, and resize handles. Do not add
inline themeable styles.

- [ ] **Step 5: Run the focused tests and verify they pass**

```bash
cd demo_api_ui
npm run test:unit -- src/components/__tests__/SimpleStepperPanel.test.jsx src/components/__tests__/SimpleStepperBar.test.jsx
```

Expected: all focused Simple Stepper tests pass.

- [ ] **Step 6: Commit the refactor**

```bash
git add demo_api_ui/src/components/SimpleStepperPanel.js demo_api_ui/src/components/SimpleStepperPanel.css demo_api_ui/src/components/__tests__/SimpleStepperPanel.test.jsx demo_api_ui/src/components/__tests__/SimpleStepperBar.test.jsx
git commit -m "feat(ui): use resizable modal for simple stepper"
```

### Task 3: Add theme control to shared modal pop-outs

**Files:**
- Modify: `demo_api_ui/src/components/DraggableModal.jsx`
- Modify: `demo_api_ui/src/components/DraggableModal.css`
- Test: `demo_api_ui/src/components/__tests__/DraggableModal.test.jsx` (or the nearest existing modal test file)

**Interfaces:**
- Consumes: the parent document's `data-theme` attribute and existing child-window `PopOutPortal`.
- Produces: a child-window theme toggle labeled `Switch to dark mode` or `Switch to light mode`, scoped to the pop-out document.

- [ ] **Step 1: Add failing pop-out theme tests**

Test that the pop-out shell copies the parent theme, renders a theme toggle,
and toggles only the child document's `data-theme` while preserving the parent
document theme. Test that existing resize handles remain present in embedded
mode.

- [ ] **Step 2: Run the focused modal tests and verify failure**

```bash
cd demo_api_ui
npm run test:unit -- src/components/__tests__/DraggableModal.test.jsx
```

Expected: the new theme-toggle assertions fail before implementation.

- [ ] **Step 3: Implement child-window theme state**

Add local child-window theme state initialized from the parent theme. Render a
theme button in the pop-out title bar with the allowlisted `☀️`/`🌙` marker and
accessible label. Toggle `win.document.documentElement.dataset.theme` and keep
the button label synchronized. Use class-based CSS and `--th-*` tokens for the
pop-out shell; do not add color/background/font-size inline styles.

- [ ] **Step 4: Verify modal behavior**

```bash
cd demo_api_ui
npm run test:unit -- src/components/__tests__/DraggableModal.test.jsx src/components/__tests__/SimpleStepperPanel.test.jsx src/components/__tests__/SimpleStepperBar.test.jsx
```

Expected: all focused modal and stepper tests pass.

- [ ] **Step 5: Commit the shared primitive change**

```bash
git add demo_api_ui/src/components/DraggableModal.jsx demo_api_ui/src/components/DraggableModal.css demo_api_ui/src/components/__tests__/DraggableModal.test.jsx
git commit -m "feat(ui): theme modal pop-out windows"
```

### Task 4: Verify the complete UI surface

**Files:**
- No source changes expected.

- [ ] **Step 1: Run the focused and full UI checks**

```bash
cd demo_api_ui
npm run test:unit -- src/components/__tests__/DraggableModal.test.jsx src/components/__tests__/SimpleStepperPanel.test.jsx src/components/__tests__/SimpleStepperBar.test.jsx
npm run test:unit
npm run build
```

Record unrelated baseline failures without attributing them to this change.

- [ ] **Step 2: Run the contrast audit**

Open the Simple Stepper in embedded and pop-out modes, switch both windows
between light and dark themes, and run the `THEMING.md` §1.4 contrast auditor.
The result must contain no failures for the modal chrome, table, or status rows.

- [ ] **Step 3: Review the final diff**

```bash
git diff --check HEAD~3..HEAD
git status --short
```

Expected: only the documented contract, shared modal primitive, Simple Stepper,
and their tests are changed; no generated artifacts are staged.
