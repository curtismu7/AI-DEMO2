# InspectorShell Collapsible Tool List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `InspectorShell`'s left tool-list column collapse to zero width via a topbar toggle, freeing space for the middle/right columns, with state persisted independently of the existing width persistence.

**Architecture:** Add a `leftCollapsed` boolean to `InspectorShell.jsx`, persisted to its own `localStorage` key. A topbar button (rendered only when a `left` prop exists) flips it. When collapsed, `gridTemplateColumns` zeroes the left column and its resize-handle track; the left column div and handle stay mounted (never conditionally removed from JSX) so implicit CSS Grid auto-placement of the middle/right columns never shifts — only `aria-hidden`/`pointer-events`/`border` change via a `--collapsed` modifier class.

**Tech Stack:** React 19.2, plain JSX (no TypeScript), Vitest 3.2 + `@testing-library/react`, CSS (no CSS-in-JS, no preprocessor).

## Global Constraints

- No TypeScript sources in `demo_api_ui` — plain `.jsx`/`.js` only.
- Test runner is Vitest, not Jest (`describe`/`it`/`expect` from Vitest globals, already configured in `src/setupTests.js`).
- Verification gate: `cd demo_api_ui && npm run test:unit && npm run build` — a green test run alone is not sufficient, the build must also pass.
- Emoji allowlist only (`⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`) — not relevant to this change (no new emoji), noted per project rule.
- Zero changes permitted in any `InspectorShell` consumer file (`McpInspectorPage.jsx`, `AgentGatewayTester.jsx`, `PingOneAuthorizePage.jsx`, `UnifiedTokenFlowInspector.jsx`, `MgmtApiRunnerPage.jsx`) — this feature is shell-only.
- The existing `inspector-shell-panel-widths` localStorage persistence and its test (`persists widths to localStorage after a drag ends...`) must keep passing unmodified — new state uses a separate key (`inspector-shell-left-collapsed`).
- Grid children in `InspectorShell.jsx` must never be conditionally unmounted based on collapse state — CSS Grid auto-placement assigns un-declared `grid-column` positions by DOM order, so removing an early child from JSX shifts every later column into the wrong track. Always render all 5 grid children; toggle only classes/attributes.

---

## File Structure

- Modify: `demo_api_ui/src/components/shared/InspectorShell.jsx` — add `leftCollapsed` state, persistence, toggle button, conditional classes/attributes.
- Modify: `demo_api_ui/src/components/shared/InspectorShell.css` — add `min-width: 0` to `.inspector-shell-col-left` (required for the track to truly reach 0px — grid items default to `min-width: auto`, which can refuse to shrink below the content's intrinsic minimum), and a `--collapsed` modifier to drop the stray 1px border that would otherwise still render at 0 width.
- Modify: `demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx` — add coverage for the toggle button, collapsed grid columns, DOM persistence of hidden content, and independent localStorage persistence.

## Task 1: Toggle state, persistence, and topbar button

**Files:**
- Modify: `demo_api_ui/src/components/shared/InspectorShell.jsx:1-20` (constants + loader), `:29-77` (component state/handlers), `:87-100` (topbar JSX)
- Test: `demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx`

**Interfaces:**
- Consumes: nothing new — reads the existing `left` prop already accepted by `InspectorShell`.
- Produces: `leftCollapsed` boolean state and `toggleLeftCollapsed()` handler, consumed by Task 2 for grid/column rendering. Button renders with `className="inspector-shell-topbar__btn"`, text/`aria-label` "Hide tools" (expanded) / "Show tools" (collapsed), `aria-expanded={!leftCollapsed}`.

- [ ] **Step 1: Write the failing tests**

Add to `demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx`, inside the existing `describe('InspectorShell', ...)` block:

```jsx
it('renders a left-collapse toggle button only when a left prop is provided', () => {
  const { rerender } = render(<InspectorShell title="X" left={<div>tools</div>} />);
  expect(screen.getByRole('button', { name: 'Hide tools' })).toBeInTheDocument();

  rerender(<InspectorShell title="X" />);
  expect(screen.queryByRole('button', { name: /tools/i })).toBeNull();
});

it('toggles the button label and aria-expanded when clicked', () => {
  render(<InspectorShell title="X" left={<div>tools</div>} />);
  const button = screen.getByRole('button', { name: 'Hide tools' });
  expect(button).toHaveAttribute('aria-expanded', 'true');

  fireEvent.click(button);
  expect(screen.getByRole('button', { name: 'Show tools' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );

  fireEvent.click(screen.getByRole('button', { name: 'Show tools' }));
  expect(screen.getByRole('button', { name: 'Hide tools' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});

it('persists the collapsed state to its own localStorage key, independent of widths', () => {
  const { unmount } = render(<InspectorShell title="X" left={<div>tools</div>} />);
  fireEvent.click(screen.getByRole('button', { name: 'Hide tools' }));

  expect(window.localStorage.getItem('inspector-shell-left-collapsed')).toBe('true');
  expect(window.localStorage.getItem('inspector-shell-panel-widths')).toBeNull();

  unmount();
  render(<InspectorShell title="X" left={<div>tools</div>} />);
  expect(screen.getByRole('button', { name: 'Show tools' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/components/shared/__tests__/InspectorShell.test.jsx`
Expected: the three new tests FAIL (no "Hide tools" button exists yet); all pre-existing tests in the file still PASS.

- [ ] **Step 3: Implement the toggle state, persistence, and button**

In `demo_api_ui/src/components/shared/InspectorShell.jsx`, add the key and loader next to the existing `WIDTHS_KEY`/`loadWidths` (after line 20):

```jsx
const LEFT_COLLAPSED_KEY = 'inspector-shell-left-collapsed';

function loadLeftCollapsed() {
  try {
    return window.localStorage.getItem(LEFT_COLLAPSED_KEY) === 'true';
  } catch {
    // Malformed or unavailable storage (private browsing, quota) — default open.
    return false;
  }
}
```

In the component body, alongside the existing `const [widths, setWidths] = useState(loadWidths);` (line 40), add:

```jsx
const [leftCollapsed, setLeftCollapsed] = useState(loadLeftCollapsed);

const toggleLeftCollapsed = useCallback(() => {
  setLeftCollapsed((prev) => {
    const next = !prev;
    try {
      window.localStorage.setItem(LEFT_COLLAPSED_KEY, String(next));
    } catch {
      // Ignore write failures (private browsing, quota).
    }
    return next;
  });
}, []);
```

In the topbar JSX (currently lines 89-100), insert the button immediately after `<h1>{title}</h1>` and before `{statusText && ...}`:

```jsx
{left != null && (
  <button
    type="button"
    className="inspector-shell-topbar__btn"
    onClick={toggleLeftCollapsed}
    aria-expanded={!leftCollapsed}
    aria-label={leftCollapsed ? 'Show tools' : 'Hide tools'}
  >
    {leftCollapsed ? 'Show tools' : 'Hide tools'}
  </button>
)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/shared/__tests__/InspectorShell.test.jsx`
Expected: all tests PASS, including the three new ones and every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/shared/InspectorShell.jsx demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx
git commit -m "feat(inspector): add left-collapse toggle state and topbar button"
```

## Task 2: Collapse the grid layout and hide the column

**Files:**
- Modify: `demo_api_ui/src/components/shared/InspectorShell.jsx:102-131` (grid + left column + left handle JSX)
- Modify: `demo_api_ui/src/components/shared/InspectorShell.css` (`.inspector-shell-col-left` rule, new modifier class)
- Test: `demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx`

**Interfaces:**
- Consumes: `leftCollapsed` boolean and `widths` state from Task 1 (already in scope in the same component/render function — no prop threading needed).
- Produces: `gridTemplateColumns` becomes `0px 0px {widths.middle}px 6px 1fr` when collapsed; left column gets class `inspector-shell-col-left--collapsed` and `aria-hidden={leftCollapsed}`; left resize handle gets `aria-hidden={leftCollapsed}` and inline `style={{ pointerEvents: leftCollapsed ? 'none' : undefined }}`. Nothing here is consumed by a later task — this is the terminal behavior for the feature.

- [ ] **Step 1: Write the failing tests**

Add to `demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx`:

```jsx
it('zeroes the left column and its handle track when collapsed, and restores a dragged width on expand', () => {
  const { container } = render(<InspectorShell title="X" left={<div>tools</div>} />);
  const [leftHandle] = container.querySelectorAll('.inspector-shell-resize-handle');
  const grid = container.querySelector('.inspector-shell-grid');

  // Drag the left column wider first, so we can prove expand restores it (not the default).
  fireEvent.mouseDown(leftHandle, { clientX: 240 });
  fireEvent.mouseMove(document, { clientX: 300 });
  fireEvent.mouseUp(document);
  expect(grid.style.gridTemplateColumns).toBe('300px 6px 380px 6px 1fr');

  fireEvent.click(screen.getByRole('button', { name: 'Hide tools' }));
  expect(grid.style.gridTemplateColumns).toBe('0px 0px 380px 6px 1fr');

  fireEvent.click(screen.getByRole('button', { name: 'Show tools' }));
  expect(grid.style.gridTemplateColumns).toBe('300px 6px 380px 6px 1fr');
});

it('hides the left column from assistive tech and applies the collapsed modifier class, without unmounting its content', () => {
  const { container } = render(
    <InspectorShell title="X" left={<div data-testid="left-content">tools</div>} />,
  );
  const leftCol = container.querySelector('.inspector-shell-col-left');
  expect(leftCol).not.toHaveClass('inspector-shell-col-left--collapsed');
  expect(leftCol).not.toHaveAttribute('aria-hidden');

  fireEvent.click(screen.getByRole('button', { name: 'Hide tools' }));

  expect(leftCol).toHaveClass('inspector-shell-col-left--collapsed');
  expect(leftCol).toHaveAttribute('aria-hidden', 'true');
  // Content stays mounted — hidden via the track/CSS, not removed from the DOM.
  expect(screen.getByTestId('left-content')).toBeInTheDocument();
});

it('marks the left resize handle inert while collapsed without removing it from the DOM', () => {
  const { container } = render(<InspectorShell title="X" left={<div>tools</div>} />);
  const [leftHandle] = container.querySelectorAll('.inspector-shell-resize-handle');
  expect(leftHandle).not.toHaveAttribute('aria-hidden');

  fireEvent.click(screen.getByRole('button', { name: 'Hide tools' }));

  expect(container.querySelectorAll('.inspector-shell-resize-handle')).toHaveLength(2);
  expect(leftHandle).toHaveAttribute('aria-hidden', 'true');
  expect(leftHandle).toHaveStyle({ pointerEvents: 'none' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/components/shared/__tests__/InspectorShell.test.jsx`
Expected: the three new tests FAIL (grid columns don't zero out yet, no `--collapsed` class/`aria-hidden` applied yet); all Task 1 tests and pre-existing tests still PASS.

- [ ] **Step 3: Implement the grid/column changes**

In `demo_api_ui/src/components/shared/InspectorShell.jsx`, replace the inline `gridTemplateColumns` computation. Currently the grid `<div>` (around line 102-111) sets:

```jsx
style={{ gridTemplateColumns: `${widths.left}px 6px ${widths.middle}px 6px 1fr` }}
```

Replace with:

```jsx
style={{
  gridTemplateColumns: leftCollapsed
    ? `0px 0px ${widths.middle}px 6px 1fr`
    : `${widths.left}px 6px ${widths.middle}px 6px 1fr`,
}}
```

Replace the left column div (currently `<div className="inspector-shell-col-left">{left}</div>`, line 112) with:

```jsx
<div
  className={
    leftCollapsed
      ? 'inspector-shell-col-left inspector-shell-col-left--collapsed'
      : 'inspector-shell-col-left'
  }
  aria-hidden={leftCollapsed || undefined}
>
  {left}
</div>
```

Replace the left resize handle (currently lines 113-119) with:

```jsx
<div
  className="inspector-shell-resize-handle"
  onMouseDown={onDragStart('left')}
  role="separator"
  aria-orientation="vertical"
  aria-label="Resize tool list column"
  aria-hidden={leftCollapsed || undefined}
  style={leftCollapsed ? { pointerEvents: 'none' } : undefined}
/>
```

In `demo_api_ui/src/components/shared/InspectorShell.css`, update the `.inspector-shell-col-left` rule (currently lines 72-78) to add `min-width: 0;`:

```css
.inspector-shell-col-left {
  background: #f1f5f9;
  border-right: 1px solid #cbd5e1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
```

Add a new rule immediately after it:

```css
/* Collapsed: track width is already 0 via gridTemplateColumns; this only
   removes the stray 1px border that would otherwise still render at the
   track's edge (a 0-width box still paints its border). */
.inspector-shell-col-left--collapsed {
  border-right: none;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/shared/__tests__/InspectorShell.test.jsx`
Expected: all tests PASS — every test in the file, including all of Task 1's and Task 2's new tests.

- [ ] **Step 5: Run the full verification gate**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: both commands exit 0. `test:unit` runs the entire suite (not just this one file) — confirm nothing else regressed. `npm run build` confirms the JSX/CSS changes compile cleanly.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/shared/InspectorShell.jsx demo_api_ui/src/components/shared/InspectorShell.css demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx
git commit -m "feat(inspector): collapse left column grid track and hide it from assistive tech"
```

---

## Self-Review Notes

- **Spec coverage:** state/persistence (Task 1) · trigger button placement/labels/aria (Task 1) · grid track zeroing (Task 2) · content survives collapse (Task 2, DOM-presence assertion) · handle inert while collapsed (Task 2) · independent localStorage key, existing widths test untouched (Task 1 test asserts `inspector-shell-panel-widths` stays `null`) · zero consumer-file changes (no consumer file appears in either task's Files list). All spec sections are covered.
- **Deviation from spec wording, and why:** the spec says the left handle "is not rendered while collapsed." This plan keeps it mounted but inert (`aria-hidden`, `pointer-events: none`) instead of conditionally removing it from JSX. Reason: `InspectorShell`'s grid children have no explicit `grid-column` assigned, so CSS Grid auto-placement assigns tracks by DOM order — conditionally unmounting an early child (the handle is the 2nd of 5) would shift every later column (middle, its handle, right) one track to the left, corrupting the layout. Staying mounted-but-inert produces the identical user-facing outcome (invisible, undraggable) without that risk. Flagged here rather than silently diverging.
- **Type/name consistency:** `leftCollapsed`, `toggleLeftCollapsed`, `LEFT_COLLAPSED_KEY`, `loadLeftCollapsed` are the only new identifiers, each used exactly once by name across both tasks — checked for drift, none found.
