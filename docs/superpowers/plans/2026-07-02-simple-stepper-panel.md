# Simple Stepper Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-to-read wrapping token-chain pill flow with a compact "Simple Stepper" bar whose toggle pops out a floating, draggable (off-screen capable), resizable table panel — one table row per token-chain step.

**Architecture:** Two new components. `SimpleStepperPanel` is a `createPortal(document.body)` floating panel positioned by the existing `useDraggablePanel` hook, rendering a `# / Step / Product / Status` table from `TokenChainContext` events. `SimpleStepperBar` replaces `InlineTokenChainView` — it keeps only the compact header (title, count badge, Show/Hide toggle) and owns the panel's open state. The single `AIAgent.js` mount covers agent float/embedded/bottom-dock modes, every backend agent framework, and the clinical TalkPane (which hosts the portalled AIAgent); OAuth Academy has its own mount that gets the same swap.

**Tech Stack:** React (JS, no TypeScript), plain CSS files, Vitest + @testing-library/react, existing in-house `useDraggablePanel` hook (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-07-02-simple-stepper-panel-design.md`

## Global Constraints

- Naming is **"Simple Stepper"** everywhere user-visible — never "Token Chain" (avoids confusion with the untouched full Token Chain panel).
- CSS prefixes: `ssp-` (panel), `ssb-` (bar). No emoji in UI (project rule — SVG/text glyphs only; ✓ ✕ — are text glyphs, allowed).
- localStorage keys: `ssp-pos` (panel position/size, written by the hook), `ba_simple_stepper_open` (open state). The old `ba_inline_tc_show` key is retired, no migration; panel defaults **closed** on first visit.
- No new npm dependencies.
- Do not modify `FloatingTokenChainPanel.*`, `TokenChainDisplay.*`, `useDraggablePanel.js`, or any education Token Chain component.
- All commands run from `demo_api_ui/` inside the worktree (`/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/simple-stepper-panel/demo_api_ui`).
- Stage files explicitly (`git add <files>`), never `git add -A`. Verify `git branch --show-current` prints `worktree-simple-stepper-panel` before each commit.

---

### Task 1: SimpleStepperPanel component

**Files:**
- Create: `demo_api_ui/src/components/SimpleStepperPanel.js`
- Create: `demo_api_ui/src/components/SimpleStepperPanel.css`
- Test: `demo_api_ui/src/components/__tests__/SimpleStepperPanel.test.jsx`

**Interfaces:**
- Consumes: `useDraggablePanel(initialPos, initialSize, {storageKey, minW, minH})` → `{ pos, size, handleDragStart, createResizeHandler }` (existing hook at `src/hooks/useDraggablePanel.js`); `useTokenChainOptional()` → `{ events } | null` (existing, `src/context/TokenChainContext`); `isHaltedAt(events, index)` and `resolveStatusVisual(status)` → `{ bucket, label }` (existing named exports of `src/components/TokenChainDisplay.js`); `PingProductChip({ product, size })` (existing, `src/components/PingProductChip`); `productForEvent(event)` (existing, `src/utils/pingProducts`).
- Produces: `export default function SimpleStepperPanel({ isOpen, onClose })` — renders `null` when `!isOpen` or outside the TokenChainContext provider. Task 2's bar renders `<SimpleStepperPanel isOpen={open} onClose={close} />`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/SimpleStepperPanel.test.jsx`:

```jsx
// demo_api_ui/src/components/__tests__/SimpleStepperPanel.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SimpleStepperPanel from '../SimpleStepperPanel';

// -- Mock TokenChainContext (real one SSE-connects) ----------------------------
let _mockCtx = null;
vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: () => _mockCtx,
}));

// -- Mock named exports from TokenChainDisplay ---------------------------------
vi.mock('../TokenChainDisplay', () => ({
  isHaltedAt: (events, i) => events[i]?.isHaltedStep === true,
  resolveStatusVisual: (status) => {
    const map = {
      success: { bucket: 'success', label: 'Success' },
      failed: { bucket: 'failed', label: 'Failed' },
      acquiring: { bucket: 'acquiring', label: 'Acquiring' },
      waiting: { bucket: 'waiting', label: 'Waiting' },
    };
    return map[status] || { bucket: 'failed', label: status || 'Unknown' };
  },
  default: () => null,
}));

// -- Mock product attribution so chip rendering is deterministic ---------------
vi.mock('../../utils/pingProducts', () => ({
  productForEvent: (ev) => ev.product || null,
}));
vi.mock('../PingProductChip', () => ({
  PingProductChip: ({ product }) => <span data-testid="product-chip">{String(product)}</span>,
}));

beforeEach(() => {
  localStorage.clear();
  _mockCtx = null;
});

function makeEvent(overrides) {
  return {
    id: 'step-1',
    label: 'User Token',
    status: 'success',
    timestamp: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('SimpleStepperPanel', () => {
  it('renders null when isOpen is false', () => {
    _mockCtx = { events: [makeEvent()] };
    render(<SimpleStepperPanel isOpen={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders null outside the TokenChainContext provider', () => {
    _mockCtx = null;
    render(<SimpleStepperPanel isOpen onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a dialog titled Simple Stepper with one numbered row per event', () => {
    _mockCtx = {
      events: [
        makeEvent({ id: 'a', label: 'User Token' }),
        makeEvent({ id: 'b', label: 'Agent Token' }),
      ],
    };
    render(<SimpleStepperPanel isOpen onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: /simple stepper/i })).toBeTruthy();
    const rows = screen.getAllByRole('row'); // 1 header + 2 body
    expect(rows.length).toBe(3);
    expect(screen.getByText('User Token')).toBeTruthy();
    expect(screen.getByText('Agent Token')).toBeTruthy();
    // numbered in order
    expect(rows[1].textContent).toMatch(/^1/);
    expect(rows[2].textContent).toMatch(/^2/);
  });

  it('marks the halted row and greys rows after it', () => {
    _mockCtx = {
      events: [
        makeEvent({ id: 'a', label: 'Good Step', status: 'success' }),
        makeEvent({ id: 'b', label: 'Bad Step', status: 'failed', isHaltedStep: true, errorCode: 'intent_mismatch' }),
        makeEvent({ id: 'c', label: 'Ghost Step', status: 'waiting' }),
      ],
    };
    const { baseElement } = render(<SimpleStepperPanel isOpen onClose={() => {}} />);
    const halted = baseElement.querySelectorAll('.ssp-row--halted');
    expect(halted.length).toBe(1);
    expect(halted[0].textContent).toContain('Bad Step');
    expect(halted[0].textContent).toContain('intent_mismatch');
    const ghosts = baseElement.querySelectorAll('.ssp-row--ghost');
    expect(ghosts.length).toBe(1);
    expect(ghosts[0].textContent).toContain('Ghost Step');
    expect(ghosts[0].textContent).toContain('did not run');
  });

  it('renders a product chip when productForEvent matches', () => {
    _mockCtx = { events: [makeEvent({ product: 'pingone' })] };
    render(<SimpleStepperPanel isOpen onClose={() => {}} />);
    expect(screen.getByTestId('product-chip').textContent).toBe('pingone');
  });

  it('shows the empty state when there are no events', () => {
    _mockCtx = { events: [] };
    render(<SimpleStepperPanel isOpen onClose={() => {}} />);
    expect(screen.getByText(/no token events yet/i)).toBeTruthy();
  });

  it('calls onClose when the close button is clicked', () => {
    _mockCtx = { events: [makeEvent()] };
    const onClose = vi.fn();
    render(<SimpleStepperPanel isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close simple stepper/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('minimize button hides the table body, expand restores it', () => {
    _mockCtx = { events: [makeEvent()] };
    render(<SimpleStepperPanel isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /minimize panel/i }));
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /expand panel/i }));
    expect(screen.getByRole('table')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/SimpleStepperPanel.test.jsx`
Expected: FAIL — `Cannot find module '../SimpleStepperPanel'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `demo_api_ui/src/components/SimpleStepperPanel.js`:

```jsx
// demo_api_ui/src/components/SimpleStepperPanel.js
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import { useTokenChainOptional } from '../context/TokenChainContext';
import { isHaltedAt, resolveStatusVisual } from './TokenChainDisplay';
import { PingProductChip } from './PingProductChip';
import { productForEvent } from '../utils/pingProducts';
import '../styles/draggablePanel.css';
import './SimpleStepperPanel.css';

const RESIZE_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/**
 * Floating, draggable, resizable Simple Stepper panel — one table row per
 * token-chain step. Distinct from the full Token Chain panel
 * (FloatingTokenChainPanel): this is the compact per-step audit table popped
 * out from SimpleStepperBar.
 *
 * Dragging uses pointer capture (useDraggablePanel) so the panel can be
 * dragged fully off-screen, e.g. onto a second monitor.
 */
export default function SimpleStepperPanel({ isOpen, onClose }) {
  const ctx = useTokenChainOptional();
  const [minimized, setMinimized] = useState(false);

  const { pos, size, handleDragStart, createResizeHandler } = useDraggablePanel(
    () => ({
      x: Math.max(20, window.innerWidth - 620),
      y: Math.max(60, 90),
    }),
    { w: 560, h: 480 },
    { storageKey: 'ssp-pos', minW: 360, minH: 240 }
  );

  if (!ctx || !isOpen) return null;

  const events = ctx.events ?? [];
  const haltedIdx = events.findIndex((ev, i) => isHaltedAt(events, i));

  return createPortal(
    <div
      className="ssp-card"
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: minimized ? 'auto' : size.h,
        zIndex: 9980,
      }}
      role="dialog"
      aria-label="Simple Stepper"
    >
      <div className="ssp-header" onPointerDown={handleDragStart} title="Drag to move">
        <span className="ssp-title">Simple Stepper</span>
        {events.length > 0 && <span className="ssp-count">{events.length}</span>}
        <div className="ssp-controls">
          <button
            type="button"
            className="ssp-btn"
            onClick={() => setMinimized((m) => !m)}
            title={minimized ? 'Expand' : 'Minimize'}
            aria-label={minimized ? 'Expand panel' : 'Minimize panel'}
          >
            {minimized ? '▸' : '▾'}
          </button>
          <button
            type="button"
            className="ssp-btn ssp-btn--close"
            onClick={onClose}
            title="Close"
            aria-label="Close Simple Stepper"
          >
            ✕
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="ssp-body">
          {events.length === 0 ? (
            <div className="ssp-empty">No token events yet.</div>
          ) : (
            <table className="ssp-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Step</th>
                  <th scope="col">Product</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev, i) => (
                  <StepRow
                    key={ev.id ? `${ev.id}-${i}` : `no-id-${i}`}
                    event={ev}
                    index={i}
                    halted={haltedIdx === i}
                    didNotRun={haltedIdx !== -1 && i > haltedIdx}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!minimized && (
        <div className="drp-resize-handles">
          {RESIZE_DIRS.map((dir) => (
            <div
              key={dir}
              className={`drp-resize-handle drp-resize-handle--${dir}`}
              onMouseDown={createResizeHandler(dir)}
            />
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}

/** One table row: # / Step / Product / Status. */
function StepRow({ event, index, halted, didNotRun }) {
  const { bucket, label: statusLabel } = resolveStatusVisual(event.status);
  const label = event.label || event.id || 'Step';
  const product = productForEvent(event);

  let rowClass = '';
  if (halted) rowClass = 'ssp-row--halted';
  else if (didNotRun) rowClass = 'ssp-row--ghost';

  let statusCell;
  if (didNotRun) {
    statusCell = <span className="ssp-st ssp-st--skip">— did not run</span>;
  } else if (halted) {
    statusCell = <span className="ssp-st ssp-st--halt">✕ {event.errorCode || 'halted'}</span>;
  } else if (bucket === 'success') {
    statusCell = <span className="ssp-st ssp-st--ok" aria-label="Success">✓</span>;
  } else {
    statusCell = <span className={`ssp-st ssp-st--${bucket}`}>{statusLabel}</span>;
  }

  return (
    <tr className={rowClass}>
      <td className="ssp-num">{index + 1}</td>
      <td className="ssp-step">{label}</td>
      <td className="ssp-product">{product ? <PingProductChip product={product} size="xs" /> : null}</td>
      <td className="ssp-status">{statusCell}</td>
    </tr>
  );
}
```

Create `demo_api_ui/src/components/SimpleStepperPanel.css`:

```css
/* -- SimpleStepperPanel --------------------------------------------------------
   Namespace: ssp-  (no overlap with ftcp- / tcd- / itcv- / ba-)
   Floating draggable/resizable table panel popped out from SimpleStepperBar.
   ----------------------------------------------------------------------------- */

.ssp-card {
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.22);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* -- Header (drag handle) ------------------------------------------------------ */

.ssp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f1f5f9;
  border-bottom: 1px solid #e5e7eb;
  cursor: grab;
  user-select: none;
  flex-shrink: 0;
}

.ssp-header:active {
  cursor: grabbing;
}

.ssp-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #334155;
}

.ssp-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  background: #eff6ff;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 700;
  color: #2563eb;
}

.ssp-controls {
  margin-left: auto;
  display: flex;
  gap: 4px;
}

.ssp-btn {
  border: 1px solid #e5e7eb;
  background: #fff;
  border-radius: 6px;
  width: 24px;
  height: 24px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  color: #475569;
}

.ssp-btn:hover {
  background: #f8fafc;
}

.ssp-btn--close:hover {
  background: #fef2f2;
  color: #dc2626;
  border-color: #fecaca;
}

/* -- Body / table ---------------------------------------------------------------- */

.ssp-body {
  flex: 1;
  overflow: auto;
}

.ssp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  color: #1e293b;
}

.ssp-table thead th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  text-align: left;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #64748b;
  padding: 8px 12px;
  border-bottom: 1px solid #e5e7eb;
  z-index: 1;
}

.ssp-table td {
  padding: 8px 12px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}

.ssp-num {
  color: #64748b;
  font-size: 12px;
  width: 34px;
}

.ssp-step {
  line-height: 1.35;
}

.ssp-status {
  width: 110px;
  white-space: nowrap;
  font-weight: 600;
}

.ssp-st--ok {
  color: #16a34a;
}

.ssp-st--halt {
  color: #dc2626;
  font-size: 12px;
}

.ssp-st--skip {
  color: #94a3b8;
}

.ssp-st--acquiring {
  color: #1d4ed8;
  font-size: 12px;
}

.ssp-st--waiting {
  color: #64748b;
  font-size: 12px;
}

.ssp-st--failed {
  color: #dc2626;
  font-size: 12px;
}

/* Halted row — red wash, matches itcv halted semantics */
.ssp-row--halted td {
  background: #fef2f2;
}

.ssp-row--halted .ssp-step {
  color: #991b1b;
  font-weight: 600;
}

/* Ghost row — step after the halt; never ran */
.ssp-row--ghost td {
  opacity: 0.45;
}

.ssp-row--ghost .ssp-step {
  font-style: italic;
}

/* -- Empty state ----------------------------------------------------------------- */

.ssp-empty {
  font-size: 12px;
  color: #94a3b8;
  font-style: italic;
  padding: 16px;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/SimpleStepperPanel.test.jsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print worktree-simple-stepper-panel
git add demo_api_ui/src/components/SimpleStepperPanel.js \
        demo_api_ui/src/components/SimpleStepperPanel.css \
        demo_api_ui/src/components/__tests__/SimpleStepperPanel.test.jsx
git commit -m "feat: add SimpleStepperPanel floating token-step table"
```

---

### Task 2: SimpleStepperBar (compact trigger bar)

**Files:**
- Create: `demo_api_ui/src/components/SimpleStepperBar.js`
- Create: `demo_api_ui/src/components/SimpleStepperBar.css`
- Test: `demo_api_ui/src/components/__tests__/SimpleStepperBar.test.jsx`

**Interfaces:**
- Consumes: `SimpleStepperPanel({ isOpen, onClose })` from Task 1; `useTokenChainOptional()` → `{ events } | null`.
- Produces: `export default function SimpleStepperBar()` — no props. Task 3 swaps it in for `InlineTokenChainView` at both mounts.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/SimpleStepperBar.test.jsx`:

```jsx
// demo_api_ui/src/components/__tests__/SimpleStepperBar.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SimpleStepperBar from '../SimpleStepperBar';

// -- Mock TokenChainContext ----------------------------------------------------
let _mockCtx = null;
vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: () => _mockCtx,
}));

// -- Mock the panel so bar tests don't exercise portal/drag internals ----------
vi.mock('../SimpleStepperPanel', () => ({
  default: ({ isOpen, onClose }) =>
    isOpen ? (
      <div data-testid="ssp-panel">
        <button type="button" onClick={onClose}>mock-close</button>
      </div>
    ) : null,
}));

beforeEach(() => {
  localStorage.clear();
  _mockCtx = null;
});

function makeEvent(overrides) {
  return {
    id: 'step-1',
    label: 'User Token',
    status: 'success',
    timestamp: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('SimpleStepperBar', () => {
  it('renders null outside the TokenChainContext provider', () => {
    _mockCtx = null;
    const { container } = render(<SimpleStepperBar />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the Simple Stepper title and step count', () => {
    _mockCtx = { events: [makeEvent({ id: 'a' }), makeEvent({ id: 'b' }), makeEvent({ id: 'c' })] };
    render(<SimpleStepperBar />);
    expect(screen.getByText('Simple Stepper')).toBeTruthy();
    expect(screen.getByLabelText('3 steps')).toBeTruthy();
  });

  it('panel is closed by default on first visit', () => {
    _mockCtx = { events: [makeEvent()] };
    render(<SimpleStepperBar />);
    expect(screen.queryByTestId('ssp-panel')).toBeNull();
    expect(screen.getByRole('button', { name: /show/i })).toBeTruthy();
  });

  it('Show opens the panel; Hide closes it', () => {
    _mockCtx = { events: [makeEvent()] };
    render(<SimpleStepperBar />);
    fireEvent.click(screen.getByRole('button', { name: /show/i }));
    expect(screen.getByTestId('ssp-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(screen.queryByTestId('ssp-panel')).toBeNull();
  });

  it("the panel's onClose closes the panel and resets the toggle to Show", () => {
    _mockCtx = { events: [makeEvent()] };
    render(<SimpleStepperBar />);
    fireEvent.click(screen.getByRole('button', { name: /show/i }));
    fireEvent.click(screen.getByRole('button', { name: 'mock-close' }));
    expect(screen.queryByTestId('ssp-panel')).toBeNull();
    expect(screen.getByRole('button', { name: /show/i })).toBeTruthy();
  });

  it('persists open state under ba_simple_stepper_open', () => {
    _mockCtx = { events: [makeEvent()] };
    render(<SimpleStepperBar />);
    fireEvent.click(screen.getByRole('button', { name: /show/i }));
    expect(localStorage.getItem('ba_simple_stepper_open')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(localStorage.getItem('ba_simple_stepper_open')).toBe('false');
  });

  it('restores open state from localStorage on mount', () => {
    localStorage.setItem('ba_simple_stepper_open', 'true');
    _mockCtx = { events: [makeEvent()] };
    render(<SimpleStepperBar />);
    expect(screen.getByTestId('ssp-panel')).toBeTruthy();
    expect(screen.getByRole('button', { name: /hide/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/SimpleStepperBar.test.jsx`
Expected: FAIL — `Cannot find module '../SimpleStepperBar'`.

- [ ] **Step 3: Write the implementation**

Create `demo_api_ui/src/components/SimpleStepperBar.js`:

```jsx
// demo_api_ui/src/components/SimpleStepperBar.js
import React, { useCallback, useState } from 'react';
import { useTokenChainOptional } from '../context/TokenChainContext';
import SimpleStepperPanel from './SimpleStepperPanel';
import './SimpleStepperBar.css';

const LS_KEY = 'ba_simple_stepper_open';

function loadOpen() {
  try {
    return localStorage.getItem(LS_KEY) === 'true';
  } catch (_) {
    return false;
  }
}

/**
 * Compact Simple Stepper bar — replaces the old wrapping InlineTokenChainView
 * pill flow. Shows title + live step count; the toggle pops out
 * SimpleStepperPanel (floating, draggable, resizable table). Renders null
 * outside the TokenChainContext provider (SSR / tests without provider).
 */
export default function SimpleStepperBar() {
  const ctx = useTokenChainOptional();
  const [open, setOpen] = useState(loadOpen);

  const setOpenPersist = useCallback((next) => {
    setOpen(next);
    try {
      localStorage.setItem(LS_KEY, String(next));
    } catch (_) {}
  }, []);

  if (!ctx) return null;

  const events = ctx.events ?? [];

  return (
    <div className="ssb-bar" aria-label="Simple Stepper">
      <span className="ssb-title">Simple Stepper</span>
      {events.length > 0 && (
        <span
          className="ssb-count"
          aria-label={`${events.length} step${events.length === 1 ? '' : 's'}`}
        >
          {events.length}
        </span>
      )}
      <button
        type="button"
        className="ssb-toggle"
        onClick={() => setOpenPersist(!open)}
        aria-expanded={open}
      >
        {open ? 'Hide' : 'Show'}
      </button>
      <SimpleStepperPanel isOpen={open} onClose={() => setOpenPersist(false)} />
    </div>
  );
}
```

Create `demo_api_ui/src/components/SimpleStepperBar.css`:

```css
/* -- SimpleStepperBar ------------------------------------------------------------
   Namespace: ssb-  (no overlap with ssp- / itcv- / tcd- / ba-)
   Compact header bar; the toggle pops out SimpleStepperPanel.
   ------------------------------------------------------------------------------- */

.ssb-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.ssb-title {
  font-size: 11px;
  font-weight: 700;
  color: #475569;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.ssb-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: #e2e8f0;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 700;
  color: #475569;
}

.ssb-toggle {
  margin-left: auto;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 600;
  color: #2563eb;
  background: none;
  border: 1px solid #bfdbfe;
  border-radius: 4px;
  cursor: pointer;
  line-height: 1.6;
}

.ssb-toggle:hover {
  background: #eff6ff;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/SimpleStepperBar.test.jsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print worktree-simple-stepper-panel
git add demo_api_ui/src/components/SimpleStepperBar.js \
        demo_api_ui/src/components/SimpleStepperBar.css \
        demo_api_ui/src/components/__tests__/SimpleStepperBar.test.jsx
git commit -m "feat: add SimpleStepperBar compact trigger for the stepper panel"
```

---

### Task 3: Swap the mounts and delete InlineTokenChainView

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js:17` (import) and `demo_api_ui/src/components/AIAgent.js:8279` (JSX)
- Modify: `demo_api_ui/src/components/OAuthAcademyPage.jsx:9` (import) and `demo_api_ui/src/components/OAuthAcademyPage.jsx:369` (JSX)
- Delete: `demo_api_ui/src/components/InlineTokenChainView.js`, `demo_api_ui/src/components/InlineTokenChainView.css`, `demo_api_ui/src/components/__tests__/InlineTokenChainView.test.jsx`

**Interfaces:**
- Consumes: `SimpleStepperBar` (default export, no props) from Task 2.
- Produces: nothing new — final wiring. After this task no file references `InlineTokenChainView` or the `itcv-` namespace.

- [ ] **Step 1: Swap the AIAgent mount**

In `demo_api_ui/src/components/AIAgent.js` line 17, replace:

```jsx
import InlineTokenChainView from './InlineTokenChainView';
```

with:

```jsx
import SimpleStepperBar from './SimpleStepperBar';
```

At line ~8279 (inside `<div className="ba-right-col">`), replace:

```jsx
              {/* Inline horizontal token chain — A4.2 */}
              <InlineTokenChainView />
```

with:

```jsx
              {/* Simple Stepper — compact bar + pop-out step table */}
              <SimpleStepperBar />
```

- [ ] **Step 2: Swap the OAuth Academy mount**

In `demo_api_ui/src/components/OAuthAcademyPage.jsx` line 9, replace:

```jsx
import InlineTokenChainView from "./InlineTokenChainView";
```

with:

```jsx
import SimpleStepperBar from "./SimpleStepperBar";
```

At line ~369, replace:

```jsx
        <InlineTokenChainView />
```

with:

```jsx
        <SimpleStepperBar />
```

- [ ] **Step 3: Delete the old component, its CSS, and its test**

```bash
git rm demo_api_ui/src/components/InlineTokenChainView.js \
       demo_api_ui/src/components/InlineTokenChainView.css \
       demo_api_ui/src/components/__tests__/InlineTokenChainView.test.jsx
```

- [ ] **Step 4: Verify no dangling references**

Run: `grep -rn "InlineTokenChainView\|itcv-" demo_api_ui/src --include="*.js" --include="*.jsx" --include="*.css"`
Expected: no output. (If anything appears — e.g. an e2e selector — update it to the `ssb-`/`ssp-` equivalent before proceeding.)

- [ ] **Step 5: Run the full unit test suite**

Run: `cd demo_api_ui && npx vitest run`
Expected: PASS — all suites green, including the untouched `FloatingTokenChainPanel`/education token chain tests; no suite references the deleted files.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print worktree-simple-stepper-panel
git add demo_api_ui/src/components/AIAgent.js demo_api_ui/src/components/OAuthAcademyPage.jsx
git commit -m "feat: replace inline token chain pills with Simple Stepper bar + panel"
```

(The `git rm` in Step 3 already staged the deletions; this commit includes them.)

---

### Task 4: Visual verification in the running app

**Files:** none (verification only)

**Interfaces:**
- Consumes: the running dev stack (Docker serves the MAIN checkout — see memory note `project-docker-serves-main-checkout`; for verification either run Vite against the worktree or land the branch first. Preferred here: run the worktree's dev server directly).

- [ ] **Step 1: Start the worktree UI dev server**

Run: `cd demo_api_ui && npm run dev` (Vite; note the printed local URL)
Expected: dev server starts. If the BFF isn't reachable from this instance, token events won't stream — the bar should still render with "Show" and the panel with the empty state, which is sufficient to verify wiring; full-chain visuals were already validated against the approved HTML mock.

- [ ] **Step 2: Verify with browser automation (webapp-testing skill or Playwright MCP)**

Check, on the agent page (`/agent`):
1. Compact bar shows "SIMPLE STEPPER", count badge (when events exist), and Show/Hide toggle — no wrapping pill flow anywhere.
2. Show opens the floating panel; table has # / Step / Product / Status columns.
3. Panel drags by header, resizes from edges/corners, minimizes to header only, and ✕ closes it (toggle resets to "Show").
4. Reload: panel position/size and open state persist.
Expected: all four pass. Capture a screenshot for the user.

- [ ] **Step 3: Report**

No commit — report verification results (with screenshot) before any merge/PR step.
