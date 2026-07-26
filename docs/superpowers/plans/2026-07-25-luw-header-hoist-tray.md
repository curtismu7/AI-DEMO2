# Live Workbench Header Hoist + Collapsible Demo Script Tray — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/use-cases/live`, move the agent's control row out of the middle column into a full-width bar above the columns, and let the Demo Script column collapse to a thin rail — both to give the agent more room.

**Architecture:** The agent's `.ba-header-tools` element stays one React element; only its DOM parent changes, via `createPortal` into a host node the page registers on `AgentUiModeContext`. This mirrors the existing `surfaceHostEl` mechanism the agent surface itself already uses, so no state is duplicated and no other agent surface is affected. The tray collapse is local page state persisted to `localStorage`.

**Tech Stack:** React 18, Vite, vitest + @testing-library/react, plain CSS (no CSS modules on these files).

## Global Constraints

- Work only inside the worktree `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray`. Prefix every Write/Edit path with it. Never edit the main checkout.
- Stage explicitly with `git add <files>`. Never `git add -A`.
- All commands run from `<worktree>/demo_api_ui` unless stated otherwise.
- Test runner is **vitest**, not jest: `npx vitest run <path>`.
- Emoji allowlist (`REGRESSION_PLAN.md` §0): `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` only. This plan uses `←` / `→`, which are arrow glyphs already used in `AdminSideNav.jsx`, not emoji. Do not introduce any other symbol.
- Do not change: OAuth/login, RFC 8693 token exchange, BFF session handling, role enforcement, HITL consent, ports/hosts, chip dispatch, agent routing, or the behavior of `ScopePicker` / `DemoStepsDropdown` / `Clear progress` / `Sign out`.
- `AIAgent.js` is shared by every agent surface. Its only change in this plan is a conditional wrapper around markup that is otherwise byte-identical.
- localStorage key: `luw_demo_script_collapsed`, values `"1"` / `"0"`.
- CSS class names: `luw-topbar__agent-tools`, `luw-body--drawer-collapsed`, `luw-drawer__toggle`, `luw-drawer__vlabel`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `demo_api_ui/src/context/AgentUiModeContext.js` | Owns cross-component agent-UI state. Gains `toolbarHostEl` / `setToolbarHostEl`. | Modify |
| `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js` | Route component. Registers the toolbar host node; owns tray-collapse state. | Modify |
| `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.css` | Route layout. Toolbar bar styles + collapsed-drawer styles. | Modify |
| `demo_api_ui/src/components/AIAgent.js` | The agent. Portals `.ba-header-tools` when a host is registered. | Modify |
| `demo_api_ui/src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx` | Covers host registration + tray collapse/persist. | Create |
| `demo_api_ui/src/components/__tests__/AIAgent.chips.test.js` | Existing agent harness. Gains a toolbar-portal describe block. | Modify |

---

### Task 1: Register a toolbar host node on the workbench topbar

Adds the context slot and the page-side host, plus the test file that later tasks extend. Nothing visually moves yet — `AIAgent.js` still renders its tools inline until Task 2.

**Files:**
- Modify: `demo_api_ui/src/context/AgentUiModeContext.js:85-86, 103, 167-183`
- Modify: `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js:91-98, 327-331`
- Modify: `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.css:10-18`
- Create: `demo_api_ui/src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `useAgentUiMode()` returns `toolbarHostEl: HTMLElement | null` and `setToolbarHostEl(elOrUpdater)`. Task 2 reads `toolbarHostEl`. The page renders `<div className="luw-topbar__agent-tools">` as that element.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx`:

```jsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../LiveUseCaseWorkbenchPage.css', () => ({}), { virtual: true });

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { useCases: [] } })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

vi.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({ activeId: 'banking' }),
}));

vi.mock('../../components/VerticalSwitcher', () => ({
  default: () => <div data-testid="vertical-switcher" />,
}));

vi.mock('../../components/TokenChainTraceRail', () => ({
  default: () => <div data-testid="trace-rail" />,
}));

vi.mock('../../services/tokenChainTrace/tokenChainTraceStore', () => ({
  tokenChainTraceStore: {
    beginTrace: vi.fn(),
    ingestTokenEvent: vi.fn(),
    ingestAuthorize: vi.fn(),
    completeTrace: vi.fn(),
  },
}));

vi.mock('../../services/tokenChainTrace/simTraceAdapter', () => ({
  buildSimRailEvents: vi.fn(() => []),
}));

const mockSetSurfaceHostEl = vi.fn();
const mockSetToolbarHostEl = vi.fn();
vi.mock('../../context/AgentUiModeContext', () => ({
  useAgentUiMode: () => ({
    setSurfaceHostEl: mockSetSurfaceHostEl,
    setToolbarHostEl: mockSetToolbarHostEl,
    toolbarHostEl: null,
  }),
}));

import LiveUseCaseWorkbenchPage from '../LiveUseCaseWorkbenchPage';

/** The host-registration effect fires more than once during mount (pre-ref-attach
 *  null, functional cleanup updater, then the attached node). Pull the call that
 *  actually carries an Element rather than assuming an index. */
function registeredElement(mockFn) {
  return mockFn.mock.calls
    .map(([arg]) => arg)
    .find((arg) => arg instanceof Element);
}

beforeEach(() => {
  mockSetSurfaceHostEl.mockClear();
  mockSetToolbarHostEl.mockClear();
  localStorage.clear();
});

describe('LiveUseCaseWorkbenchPage — agent toolbar host', () => {
  it('registers a toolbar host node in the topbar', async () => {
    render(<LiveUseCaseWorkbenchPage />);
    await waitFor(() => {
      expect(registeredElement(mockSetToolbarHostEl)).toBeInstanceOf(Element);
    });
    const el = registeredElement(mockSetToolbarHostEl);
    expect(el).toHaveClass('luw-topbar__agent-tools');
    expect(el.closest('.luw-topbar')).not.toBeNull();
  });

  it('still registers the agent surface host', async () => {
    render(<LiveUseCaseWorkbenchPage />);
    await waitFor(() => {
      expect(registeredElement(mockSetSurfaceHostEl)).toBeInstanceOf(Element);
    });
    expect(registeredElement(mockSetSurfaceHostEl)).toHaveClass('luw-agent-host');
    expect(screen.getByTestId('trace-rail')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx
```

Expected: the toolbar-host test FAILS (`registeredElement` is `undefined` — `setToolbarHostEl` is never called). The surface-host test passes.

- [ ] **Step 3: Add the context slot**

In `demo_api_ui/src/context/AgentUiModeContext.js`, in the `createContext` default object, immediately after `setSurfaceHostEl: () => {},` (line 86) add:

```js
  // Registered by a host page that wants the agent's header control row rendered
  // outside the agent column (see LiveUseCaseWorkbenchPage). Null everywhere else,
  // which keeps every other surface on the inline header.
  toolbarHostEl: null,
  setToolbarHostEl: () => {},
```

In `AgentUiModeProvider`, immediately after line 103 (`const [surfaceHostEl, setSurfaceHostEl] = useState(null);`) add:

```js
  const [toolbarHostEl, setToolbarHostEl] = useState(null);
```

In the `useMemo` value object, immediately after `setSurfaceHostEl,` add:

```js
      toolbarHostEl,
      setToolbarHostEl,
```

And add `toolbarHostEl` to that `useMemo` dependency array, so it reads:

```js
    [state.placement, state.fab, state.mode, setAgentUi, webMcpLastResult, surfaceHostEl, toolbarHostEl, clinicalSplit, setClinicalSplit]
```

- [ ] **Step 4: Register the host on the page**

In `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js`, replace lines 91-98 with:

```jsx
  const { setSurfaceHostEl, setToolbarHostEl } = useAgentUiMode();
  const [agentHostEl, setAgentHostEl] = useState(null);
  const agentHostRef = useCallback((node) => setAgentHostEl(node), []);
  const [toolbarHostEl, setToolbarHostElNode] = useState(null);
  const toolbarHostRef = useCallback((node) => setToolbarHostElNode(node), []);

  useEffect(() => {
    setSurfaceHostEl(agentHostEl);
    return () => setSurfaceHostEl((cur) => (cur === agentHostEl ? null : cur));
  }, [agentHostEl, setSurfaceHostEl]);

  // The agent's header control row portals here so it spans the full page width
  // instead of wrapping into six rows inside the middle column.
  useEffect(() => {
    setToolbarHostEl(toolbarHostEl);
    return () => setToolbarHostEl((cur) => (cur === toolbarHostEl ? null : cur));
  }, [toolbarHostEl, setToolbarHostEl]);
```

In the topbar JSX (currently lines 327-331), add the host node as the last child:

```jsx
      <div className="luw-topbar">
        <p className="luw-topbar__title">Use Cases</p>
        <span className="luw-topbar__crumb">/ Live Workbench</span>
        <div className="luw-topbar__vertical"><VerticalSwitcher /></div>
        <div className="luw-topbar__agent-tools" ref={toolbarHostRef} />
      </div>
```

- [ ] **Step 5: Style the bar**

In `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.css`, replace the `.luw-topbar` rule (lines 10-14) with:

```css
.luw-topbar {
  display: flex; align-items: center; gap: 0.9rem;
  flex-wrap: wrap;
  padding: 0.65rem 1.1rem; border-bottom: 1px solid var(--brand-medium-gray, #e2e8f0);
  background: #fff;
}

/* Host for the agent's hoisted header control row. Takes the full remaining
   width so the controls lay out on one line and wrap only when they must. */
.luw-topbar__agent-tools {
  flex: 1 1 100%;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 0;
}
.luw-topbar__agent-tools:empty { display: none; }
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx
```

Expected: both tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray
git add demo_api_ui/src/context/AgentUiModeContext.js \
        demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js \
        demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.css \
        demo_api_ui/src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx
git commit -m "feat(luw): register an agent toolbar host node on the workbench topbar

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Portal `.ba-header-tools` into the registered host

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js:281, 7807, 8009` (plus one small module-scope component)
- Modify: `demo_api_ui/src/components/__tests__/AIAgent.chips.test.js:49-55` (+ new describe block at end of file)

**Interfaces:**
- Consumes: `toolbarHostEl` from `useAgentUiMode()` (Task 1).
- Produces: nothing later tasks depend on. `.ba-header-tools` keeps its class name and all children unchanged, so `data-testid="header-clear-progress"` and every existing selector still resolve — only `.parentElement` changes.

- [ ] **Step 1: Make the existing agent-UI mock mutable**

In `demo_api_ui/src/components/__tests__/AIAgent.chips.test.js`, replace lines 49-55 with:

```js
const mockAgentUiMode = {
  placement: "none",
  fab: true,
  setAgentUi: jest.fn(),
  toolbarHostEl: null,
};
vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => mockAgentUiMode,
}));
```

- [ ] **Step 2: Write the failing test**

Append to the end of `demo_api_ui/src/components/__tests__/AIAgent.chips.test.js`:

```js
// ─── Header toolbar portal (live workbench hoist) ────────────────────────────

describe("Header controls portal", () => {
  afterEach(() => {
    mockAgentUiMode.toolbarHostEl = null;
  });

  it("renders the header controls inside the agent header when no host is registered", () => {
    renderAgent({ user: customerUser, mode: "inline" });
    const clear = screen.getByTestId("header-clear-progress");
    expect(clear.closest(".ba-header")).not.toBeNull();
  });

  it("portals the header controls into a registered toolbar host", () => {
    const host = document.createElement("div");
    host.setAttribute("data-testid", "toolbar-host");
    document.body.appendChild(host);
    mockAgentUiMode.toolbarHostEl = host;

    renderAgent({ user: customerUser, mode: "inline" });

    const clear = screen.getByTestId("header-clear-progress");
    expect(host.contains(clear)).toBe(true);
    expect(clear.closest(".ba-header")).toBeNull();
    // The controls keep their wrapper class, so existing selectors still resolve.
    expect(clear.closest(".ba-header-tools")).not.toBeNull();

    document.body.removeChild(host);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/components/__tests__/AIAgent.chips.test.js -t "Header controls portal"
```

Expected: the first test PASSES (current inline behavior), the second FAILS — `host.contains(clear)` is `false` because the controls are still inside `.ba-header`.

- [ ] **Step 4: Add the portal wrapper component**

In `demo_api_ui/src/components/AIAgent.js`, `createPortal` is already imported at line 8. Add this small component at module scope, immediately before the main `AIAgent` component's definition (search for the line that begins `const splitChrome` at line 273 and scroll up to the enclosing `function`/`export` declaration; place the helper directly above that declaration):

```jsx
/**
 * Renders children into `target` when one is registered, otherwise in place.
 * Used so a host page (LiveUseCaseWorkbenchPage) can hoist the agent's header
 * control row above its columns without duplicating any of the controls' state.
 * @param {{ target: HTMLElement|null, children: React.ReactNode }} props
 */
function MaybePortal({ target, children }) {
  return target ? createPortal(children, target) : children;
}
```

- [ ] **Step 5: Read the host from context**

In `demo_api_ui/src/components/AIAgent.js`, change line 281 from:

```js
  const { mode: agentUiMode } = useAgentUiMode();
```

to:

```js
  const { mode: agentUiMode, toolbarHostEl } = useAgentUiMode();
```

- [ ] **Step 6: Wrap the controls**

In `demo_api_ui/src/components/AIAgent.js`, wrap the existing `ba-header-tools` block. At line 7807, change:

```jsx
              <div className="ba-header-tools">
```

to:

```jsx
              <MaybePortal target={toolbarHostEl}>
              <div className="ba-header-tools">
```

and at line 8009 — the `</div>` that closes `ba-header-tools`, immediately before the `</div>` closing `ba-header-top` — change:

```jsx
              </div>
            </div>
```

to:

```jsx
              </div>
              </MaybePortal>
            </div>
```

Do **not** re-indent the block's contents. Every line between the new wrapper tags must stay byte-identical, so the diff shows exactly two added lines.

- [ ] **Step 7: Run test to verify it passes**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/components/__tests__/AIAgent.chips.test.js
```

Expected: the whole file PASSES, including both new tests and every pre-existing test (the mutable mock returns the same shape as before plus `toolbarHostEl: null`).

- [ ] **Step 8: Verify no other agent surface regressed**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/components/__tests__/AIAgent.a2aExplain.test.js \
  src/components/__tests__/AIAgent.aguiError.test.js \
  src/components/__tests__/AIAgent.confusedDeputy.test.js \
  src/components/__tests__/AIAgent.greeting.test.js \
  src/components/__tests__/AIAgent.greetingUpdate.test.js \
  src/components/__tests__/AIAgent.groundingCorrection.test.js \
  src/components/__tests__/AIAgent.terminology.test.js \
  src/components/__tests__/AIAgent.wrongAudience.test.js \
  src/components/__tests__/AIAgent.wrongScope.test.js
```

Expected: PASS. These files mock `useAgentUiMode` without `toolbarHostEl`, so it is `undefined` → falsy → inline branch, exactly as before.

If any of these files does **not** mock `AgentUiModeContext` at all and fails on the new destructure, that is a real signal — the fix is to keep the destructure safe rather than to edit those tests. Only if a failure appears, change line 281 to:

```js
  const { mode: agentUiMode, toolbarHostEl } = useAgentUiMode() || {};
```

- [ ] **Step 9: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray
git add demo_api_ui/src/components/AIAgent.js \
        demo_api_ui/src/components/__tests__/AIAgent.chips.test.js
git commit -m "feat(agent): portal header controls into a registered toolbar host

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Collapsible Demo Script tray

**Files:**
- Modify: `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js:78-98, 333-345`
- Modify: `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.css:20-26, 30-40, 258-283`
- Modify: `demo_api_ui/src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx`

**Interfaces:**
- Consumes: the test file and mocks created in Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

Append to `demo_api_ui/src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx` (the `fireEvent` import must be added to the existing `@testing-library/react` import line at the top of the file):

```jsx
describe('LiveUseCaseWorkbenchPage — demo script tray', () => {
  it('starts expanded and collapses on toggle', () => {
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    expect(container.querySelector('.luw-body')).not.toHaveClass(
      'luw-body--drawer-collapsed',
    );
    expect(screen.getByPlaceholderText('Filter use cases…')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Collapse demo script'));

    expect(container.querySelector('.luw-body')).toHaveClass(
      'luw-body--drawer-collapsed',
    );
    expect(screen.queryByPlaceholderText('Filter use cases…')).toBeNull();
    expect(screen.getByLabelText('Expand demo script')).toBeInTheDocument();
  });

  it('persists the collapsed state to localStorage', () => {
    render(<LiveUseCaseWorkbenchPage />);
    fireEvent.click(screen.getByLabelText('Collapse demo script'));
    expect(localStorage.getItem('luw_demo_script_collapsed')).toBe('1');
  });

  it('restores the collapsed state on mount', () => {
    localStorage.setItem('luw_demo_script_collapsed', '1');
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    expect(container.querySelector('.luw-body')).toHaveClass(
      'luw-body--drawer-collapsed',
    );
    expect(screen.getByLabelText('Expand demo script')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx -t "demo script tray"
```

Expected: all three FAIL with `Unable to find a label with the text of: Collapse demo script`.

- [ ] **Step 3: Add the collapse state**

In `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js`, add this module-scope constant next to the other top-level constants (after `TRACK_LABELS`, around line 34):

```js
const DRAWER_COLLAPSED_KEY = 'luw_demo_script_collapsed';
```

Inside the component, after the `glanceRecent` state declaration (line 89), add:

```js
  const [drawerCollapsed, setDrawerCollapsed] = useState(() => {
    try {
      return localStorage.getItem(DRAWER_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(DRAWER_COLLAPSED_KEY, drawerCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [drawerCollapsed]);
```

- [ ] **Step 4: Wire the markup**

In the same file, change the body wrapper (line 333) from:

```jsx
      <div className="luw-body">
```

to:

```jsx
      <div className={`luw-body${drawerCollapsed ? ' luw-body--drawer-collapsed' : ''}`}>
```

Replace the drawer head block (lines 334-346, from `<nav className="luw-drawer"` through the closing `</div>` of `.luw-drawer__search`) with:

```jsx
        <nav className="luw-drawer" aria-label="Use case launcher">
          <div className="luw-drawer__head">
            <button
              type="button"
              className="luw-drawer__toggle"
              onClick={() => setDrawerCollapsed((c) => !c)}
              aria-expanded={!drawerCollapsed}
              aria-label={drawerCollapsed ? 'Expand demo script' : 'Collapse demo script'}
              title={drawerCollapsed ? 'Expand' : 'Collapse'}
            >
              {drawerCollapsed ? '→' : '←'}
            </button>
            {drawerCollapsed ? (
              <span className="luw-drawer__vlabel">Demo script</span>
            ) : (
              <>
                <h1 className="luw-drawer__title">Demo script</h1>
                <p className="luw-drawer__sub">Pick a step — agent runs on the right</p>
              </>
            )}
          </div>
          {!drawerCollapsed && (
            <div className="luw-drawer__search">
              <input
                type="text"
                placeholder="Filter use cases…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}
```

Then guard the two remaining drawer children. Change:

```jsx
          {runState?.state === 'error' && (
            <p className="luw-drawer__empty">{runState.msg}</p>
          )}
          <div className="luw-drawer__scroll">
```

to:

```jsx
          {!drawerCollapsed && runState?.state === 'error' && (
            <p className="luw-drawer__empty">{runState.msg}</p>
          )}
          {!drawerCollapsed && (
          <div className="luw-drawer__scroll">
```

and add a closing `)}` immediately after the `</div>` that closes `.luw-drawer__scroll` (the line directly before `</nav>`), so it reads:

```jsx
          </div>
          )}
        </nav>
```

- [ ] **Step 5: Add the CSS**

In `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.css`, immediately after the `.luw-body` rule (which ends at line 26) insert:

```css
/* Collapsed Demo Script tray — thin rail, toggle + vertical label only. Declared
   before the 860px stack breakpoint so that breakpoint still wins on narrow. */
.luw-body--drawer-collapsed {
  grid-template-columns: 44px 1fr;
}
```

Then replace the `.luw-drawer__head` rule (lines 30-32) with:

```css
.luw-drawer__head {
  padding: 1rem 0.9rem 0.55rem;
  position: relative;
}

.luw-drawer__toggle {
  position: absolute;
  top: 0.55rem;
  right: 0.5rem;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #475569;
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
}
.luw-drawer__toggle:hover { border-color: #94a3b8; color: #0f172a; }

.luw-body--drawer-collapsed .luw-drawer__head {
  padding: 0.5rem 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}
.luw-body--drawer-collapsed .luw-drawer__toggle {
  position: static;
}

.luw-drawer__vlabel {
  writing-mode: vertical-rl;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #64748b;
  white-space: nowrap;
}
```

Finally, inside the existing `@media (max-width: 860px)` block (line 258), add a reset so a collapsed tray still stacks readably on narrow viewports — put it right after the existing `.luw-body` rule in that block:

```css
  .luw-body--drawer-collapsed {
    grid-template-columns: 1fr;
  }
  .luw-drawer__vlabel {
    writing-mode: horizontal-tb;
  }
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx
```

Expected: all five tests in the file PASS (two from Task 1, three from this task).

- [ ] **Step 7: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray
git add demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js \
        demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.css \
        demo_api_ui/src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx
git commit -m "feat(luw): collapsible demo script tray with persisted state

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Build gate and live verification

No code changes unless a gate fails. This task is the evidence that the work is done.

**Files:**
- Modify: none expected.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: verification evidence.

- [ ] **Step 1: Run the full UI test suite**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run 2>&1 | tail -40
```

Expected: no new failures versus the baseline. If any suite fails, first confirm whether it also fails on `origin/main` before treating it as caused by this work.

- [ ] **Step 2: Run the build gate**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npm run build 2>&1 | tail -20
```

Expected: build succeeds, no errors.

- [ ] **Step 3: Confirm the diff is scoped**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray
git diff origin/main --stat -- demo_api_ui/src
git diff origin/main -- demo_api_ui/src/components/AIAgent.js
```

Expected: exactly five source files touched plus two test files. The `AIAgent.js` diff shows only the destructure change, the `MaybePortal` helper, and the two wrapper lines — no changed lines inside `ba-header-tools`.

- [ ] **Step 4: Verify live**

Serve the worktree UI and open `https://local.ping-devops.com:4000/use-cases/live` (the login host — see CLAUDE.md; `api.ping.demo` will show "Please sign in"). Sign in, then confirm:

1. The control row (Routing, Wiring, RFC info, Compliance, Token Chain, Guide, Demo steps, Agent scope, Clear progress, Sign out) renders as one full-width bar above all three columns.
2. The agent column header shows only the status dot, "Super Banking Assistant" and "Customer · Demo".
3. Each control still works: change Routing, flip the Token Chain switch, open Demo steps, toggle Agent scope Read/Write, click Clear progress.
4. Click the Demo Script collapse toggle — the tray shrinks to a thin rail with a vertical "Demo script" label, the agent column widens, and the toggle flips to `→`.
5. Reload the page — the tray is still collapsed. Expand it, reload again — it is expanded.
6. Run a chip (e.g. "show my balance") end-to-end; the Token Chain rail populates.
7. Open `/dashboard` and the floating agent — their header controls still render inline inside the agent, unchanged.

- [ ] **Step 5: Record the result**

Report which of the seven live checks passed, quoting any failure exactly. Do not claim completion without this evidence.

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| A1 context `toolbarHostEl` | Task 1, Step 3 |
| A2 page host registration | Task 1, Step 4 |
| A3 `AIAgent.js` portal | Task 2, Steps 4-6 |
| A4 topbar CSS | Task 1, Step 5 |
| B1 collapse state + toggle + persistence | Task 3, Steps 3-4 |
| B2 collapsed CSS + 860px interaction | Task 3, Step 5 |
| Success criteria 1-4 | Task 4 |
| Risk / protected areas | Global Constraints + Task 2 Step 8 + Task 4 Step 3 |

**Deviation from spec, noted deliberately:** the spec described assigning the controls to a local const. That is not possible inside a JSX return without hoisting ~200 lines, which would produce a large, review-hostile diff in a shared file. Task 2 uses a `MaybePortal` wrapper component instead — same effect, two-line diff. Everything else follows the spec.

**Placeholder scan:** no TBD/TODO; every code step carries the literal code; no "similar to Task N" references.

**Type consistency:** `toolbarHostEl` / `setToolbarHostEl` are the names used in the context (Task 1 Step 3), the page (Task 1 Step 4), the page test mock (Task 1 Step 1), the agent (Task 2 Step 5) and the agent test mock (Task 2 Step 1). The page's local node state is deliberately named `setToolbarHostElNode` so it does not shadow the context setter. `DRAWER_COLLAPSED_KEY` resolves to `luw_demo_script_collapsed` in both the implementation and the test assertion. Class names `luw-topbar__agent-tools`, `luw-body--drawer-collapsed`, `luw-drawer__toggle`, `luw-drawer__vlabel` are identical across JS, CSS and tests.
