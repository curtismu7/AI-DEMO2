# InspectorShell Shared Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the topbar + 3-column grid layout that `McpInspector.js`, `PingOneMcpInspector.js`, `ApiExplorerPanel.js`, and `AgentGatewayTester.jsx` currently hand-copy into one real, presentational-only `InspectorShell` React component plus two small siblings (`InspectorListItem`, `InspectorTabs`).

**Architecture:** Three new files in `demo_api_ui/src/components/shared/` — `InspectorShell.jsx` (topbar + 3-column grid, renders opaque `left`/`middle`/`right` slot props), `InspectorListItem.jsx` (the repeated dot+label+badge left-column row), `InspectorTabs.jsx` (the repeated output tab bar). One shared stylesheet, `InspectorShell.css`, holds every `inspector-shell-*` classname — a straight rename of the existing `p1mcp-*` rules in `PingOneMcpInspector.css` (verified verbatim in this plan's research), with grid `-col-tree/form/output` renamed to the content-agnostic `-col-left/middle/right`. None of the three components hold state or know about tools, calls, or policies — they only render what they're given. This plan does not touch any existing page; it ships the shell in isolation, verified by its own tests, so later plans (PingOneAuthorizePage conversion, AgentGatewayTester conversion, the McpInspector/PingOneMcpInspector/ApiExplorerPanel merge) can consume it without this plan blocking on any of them.

**Tech Stack:** React 18 (function components + hooks), Vitest + `@testing-library/react` + `@testing-library/jest-dom` (globals enabled, jsdom environment — see `vite.config.js:211-216`), plain CSS (no CSS-in-JS, no modules — matches every existing file in `demo_api_ui/src/components/shared/`).

## Global Constraints

- **Worktree required.** All work happens in this session's worktree (`/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/inspector-shell-spec`, branch `worktree-inspector-shell-spec`) — a hard-block hook denies `Write`/`Edit` in the main checkout. Run `git branch --show-current` before each commit to confirm.
- **Protected UI area.** `demo_api_ui` is covered by `REGRESSION_PLAN.md` §1. Invoke the `regression-guard` skill before Task 1's first edit. State what will not break: these are three brand-new files with no imports from any existing page, so no existing behavior is touched by this plan.
- **Emoji allowlist** (`REGRESSION_PLAN.md` §0): only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` are permitted anywhere in UI code/copy. None of the code in this plan uses any emoji — verify this stays true if you deviate from the plan.
- **Stage explicitly.** `git add <exact files>`, never `git add -A` (concurrent worktree sessions share the index).
- **CSS is a straight rename, not a redesign.** Every color/size/spacing value in `InspectorShell.css` must match the source `PingOneMcpInspector.css` rule it replaces exactly — this plan is extracting duplication, not restyling. Values are quoted verbatim in Task 1.
- **UI build gate.** `npm run build` inside `demo_api_ui/` must succeed before this plan is done (final step of Task 3).

---

## File Structure

| File | Responsibility |
|---|---|
| `demo_api_ui/src/components/shared/InspectorShell.jsx` | Topbar (dot, title, status text, right-aligned actions) + 3-column grid. Renders `left`/`middle`/`right` props as-is. No state. |
| `demo_api_ui/src/components/shared/InspectorShell.css` | Every `inspector-shell-*` rule — topbar, grid, tree item, form field, output tab/body/footer. Single source of truth; all three components import this same file. |
| `demo_api_ui/src/components/shared/InspectorListItem.jsx` | One left-column row: status dot (default/write/sensitive) + label + zero or more badges (write/sensitive can co-occur — confirmed in `AgentGatewayTester.jsx`, both badges render simultaneously when a tool is both). |
| `demo_api_ui/src/components/shared/InspectorTabs.jsx` | Output tab bar: renders `tabs`, highlights `activeKey`, calls `onChange(key)` on click. Tab *content* stays caller-supplied — this renders only the bar. |
| `demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx` | Verifies topbar rendering (title, status dot on/off, status text, actions) and that `left`/`middle`/`right` land in the correct grid columns. |
| `demo_api_ui/src/components/shared/__tests__/InspectorListItem.test.jsx` | Verifies label, active state, dot variant, single and multiple badges, click handling. |
| `demo_api_ui/src/components/shared/__tests__/InspectorTabs.test.jsx` | Verifies all tabs render, the active tab is marked, and clicking a tab calls `onChange` with that tab's key. |

No existing file is modified by this plan.

---

### Task 1: `InspectorShell`

**Files:**
- Create: `demo_api_ui/src/components/shared/InspectorShell.css`
- Create: `demo_api_ui/src/components/shared/InspectorShell.jsx`
- Test: `demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the first task).
- Produces:
  - `InspectorShell({ title, statusOn = true, statusText, actions, left, middle, right })` — default export from `demo_api_ui/src/components/shared/InspectorShell.jsx`. `title: string`, `statusOn: boolean`, `statusText?: string`, `actions?: ReactNode`, `left?: ReactNode`, `middle?: ReactNode`, `right?: ReactNode`.
  - CSS classnames later tasks depend on: `inspector-shell-tree-item`, `inspector-shell-tree-item--active`, `inspector-shell-tree-item__dot`, `inspector-shell-tree-item__dot--write`, `inspector-shell-tree-item__dot--sensitive`, `inspector-shell-tree-item__badge`, `inspector-shell-tree-item__badge--write`, `inspector-shell-tree-item__badge--sensitive` (used by Task 2's `InspectorListItem`); `inspector-shell-output-tabs`, `inspector-shell-output-tab`, `inspector-shell-output-tab--active` (used by Task 3's `InspectorTabs`).

- [ ] **Step 1: Invoke regression-guard**

Before any edit, invoke the `regression-guard` skill. State: this task creates three new files under `demo_api_ui/src/components/shared/` with zero imports from any existing page or route — nothing currently rendered can regress.

- [ ] **Step 2: Write the failing test**

Create `demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx`:

```jsx
// demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import InspectorShell from '../InspectorShell';

describe('InspectorShell', () => {
  it('renders the title and status text', () => {
    render(
      <InspectorShell title="MCP Inspector" statusText="Connected · banking-mcp" />
    );
    expect(screen.getByRole('heading', { name: 'MCP Inspector' })).toBeInTheDocument();
    expect(screen.getByText('Connected · banking-mcp')).toBeInTheDocument();
  });

  it('renders the status dot as "on" by default and toggles "off"', () => {
    const { container, rerender } = render(<InspectorShell title="X" />);
    const dot = container.querySelector('.inspector-shell-topbar__dot');
    expect(dot).not.toHaveClass('inspector-shell-topbar__dot--off');

    rerender(<InspectorShell title="X" statusOn={false} />);
    expect(container.querySelector('.inspector-shell-topbar__dot')).toHaveClass(
      'inspector-shell-topbar__dot--off',
    );
  });

  it('renders actions in the topbar when provided', () => {
    render(<InspectorShell title="X" actions={<button type="button">Refresh</button>} />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('omits the actions wrapper when no actions are provided', () => {
    const { container } = render(<InspectorShell title="X" />);
    expect(container.querySelector('.inspector-shell-topbar__right')).toBeNull();
  });

  it('renders left/middle/right slot content in the correct grid columns', () => {
    const { container } = render(
      <InspectorShell
        title="X"
        left={<div data-testid="left-content">left</div>}
        middle={<div data-testid="middle-content">middle</div>}
        right={<div data-testid="right-content">right</div>}
      />,
    );
    expect(
      container.querySelector('.inspector-shell-col-left')?.contains(screen.getByTestId('left-content')),
    ).toBe(true);
    expect(
      container.querySelector('.inspector-shell-col-middle')?.contains(screen.getByTestId('middle-content')),
    ).toBe(true);
    expect(
      container.querySelector('.inspector-shell-col-right')?.contains(screen.getByTestId('right-content')),
    ).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

From `demo_api_ui/`:

```bash
npx vitest run src/components/shared/__tests__/InspectorShell.test.jsx
```

Expected: FAIL — `Failed to resolve import "../InspectorShell"` (the file doesn't exist yet).

- [ ] **Step 4: Write `InspectorShell.css`**

Create `demo_api_ui/src/components/shared/InspectorShell.css`. Every value below is copied verbatim from the existing `demo_api_ui/src/components/PingOneMcpInspector.css` (read in full during this plan's research) — only classnames change (`p1mcp-*` → `inspector-shell-*`; `p1mcp-col-tree/form/output` → `inspector-shell-col-left/middle/right`; `p1mcp-tree-*` → `inspector-shell-tree-*`; `p1mcp-form-*` → `inspector-shell-form-*`; `p1mcp-output-*` → `inspector-shell-output-*`; `p1mcp-btn-*` → `inspector-shell-btn-*`):

```css
/* InspectorShell.css — shared topbar + 3-column layout for tool/list-detail
   inspector pages. Renamed from the page-owned p1mcp-* classnames this
   replaces (previously duplicated in PingOneMcpInspector.css and hand-copied
   by McpInspector.js, ApiExplorerPanel.js, AgentGatewayTester.jsx). */

/* Page wrapper */
.inspector-shell-page {
  width: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
}

/* Top bar */
.inspector-shell-topbar {
  background: #f1f5f9;
  border-bottom: 1px solid #cbd5e1;
  padding: 10px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
}
.inspector-shell-topbar h1 { font-size: 16px; font-weight: 600; color: #1e293b; margin: 0; }
.inspector-shell-topbar__dot { width: 8px; height: 8px; border-radius: 50%; background: #16a34a; flex-shrink: 0; }
.inspector-shell-topbar__dot--off { background: #dc2626; }
.inspector-shell-topbar__status { font-size: 12px; color: #64748b; }
.inspector-shell-topbar__right { margin-left: auto; display: flex; gap: 8px; }
.inspector-shell-topbar__btn {
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 4px;
  border: 1px solid #94a3b8;
  background: #f8fafc;
  color: #334155;
  cursor: pointer;
  transition: background 0.1s;
}
.inspector-shell-topbar__btn:hover { background: #e2e8f0; }
.inspector-shell-topbar__btn--active { background: #2563eb; border-color: #2563eb; color: #fff; }
.inspector-shell-topbar__btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Three-column grid */
.inspector-shell-grid {
  display: grid;
  grid-template-columns: 240px 380px 1fr;
  height: calc(100vh - 45px);
  overflow: hidden;
}

/* Column 1: left (tool tree / call list / preset list) */
.inspector-shell-col-left {
  background: #f1f5f9;
  border-right: 1px solid #cbd5e1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.inspector-shell-tree-header {
  padding: 12px 16px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #64748b;
  border-bottom: 1px solid #cbd5e1;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.inspector-shell-tree-search {
  padding: 8px 12px;
  border-bottom: 1px solid #cbd5e1;
}
.inspector-shell-tree-search input {
  width: 100%;
  padding: 6px 10px;
  font-size: 12px;
  background: #ffffff;
  border: 1px solid #94a3b8;
  border-radius: 4px;
  color: #1e293b;
}
.inspector-shell-tree-search input:focus { outline: none; border-color: #3b82f6; }
.inspector-shell-tree-search input::placeholder { color: #94a3b8; }
.inspector-shell-tree-body { flex: 1; overflow-y: auto; padding: 4px 0; }

/* Tree groups */
.inspector-shell-tree-group__label {
  padding: 8px 16px 4px;
  font-size: 10px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.inspector-shell-tree-item {
  padding: 5px 16px 5px 24px;
  font-size: 13px;
  font-family: 'SF Mono', SFMono-Regular, monospace;
  color: #334155;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 0.08s;
  border: 1px solid transparent;
  border-radius: 0;
  background: none;
  width: 100%;
  text-align: left;
}
.inspector-shell-tree-item:hover { background: #e2e8f0; }
.inspector-shell-tree-item--active {
  background: #2563eb;
  color: #fff;
  border-radius: 4px;
  margin: 1px 8px;
  padding-left: 16px;
}
.inspector-shell-tree-item__dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: #16a34a; }
.inspector-shell-tree-item__dot--write { background: #d97706; }
.inspector-shell-tree-item__dot--sensitive { background: #dc2626; }
.inspector-shell-tree-item__badge {
  margin-left: auto;
  font-size: 9px;
  font-weight: 700;
  font-family: -apple-system, sans-serif;
  padding: 1px 5px;
  border-radius: 3px;
  letter-spacing: 0.03em;
}
.inspector-shell-tree-item__badge--write { background: #fef3c7; color: #92400e; }
.inspector-shell-tree-item__badge--sensitive { background: #fee2e2; color: #991b1b; }

/* Column 2: middle (param form / detail fields) */
.inspector-shell-col-middle {
  background: #f8fafc;
  border-right: 1px solid #cbd5e1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.inspector-shell-form-header {
  padding: 16px 20px;
  border-bottom: 1px solid #cbd5e1;
}
.inspector-shell-form-header__name {
  font-family: 'SF Mono', monospace;
  font-size: 15px;
  font-weight: 700;
  color: #1e293b;
}
.inspector-shell-form-header__desc {
  font-size: 13px;
  color: #475569;
  margin-top: 6px;
  line-height: 1.5;
}
.inspector-shell-form-body { padding: 16px 20px; flex: 1; overflow-y: auto; }
.inspector-shell-form-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: #64748b;
  font-size: 14px;
  text-align: center;
  padding: 40px 20px;
}

/* Form fields */
.inspector-shell-field { margin-bottom: 14px; }
.inspector-shell-field label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  margin-bottom: 4px;
  font-family: 'SF Mono', monospace;
}
.inspector-shell-field label .req { color: #dc2626; }
.inspector-shell-field label .type { font-weight: 400; color: #64748b; margin-left: 6px; }
.inspector-shell-field input, .inspector-shell-field textarea {
  width: 100%;
  padding: 8px 10px;
  font-size: 13px;
  font-family: 'SF Mono', monospace;
  background: #ffffff;
  border: 1px solid #94a3b8;
  border-radius: 4px;
  color: #1e293b;
  resize: vertical;
}
.inspector-shell-field input:focus, .inspector-shell-field textarea:focus { outline: none; border-color: #3b82f6; }
.inspector-shell-field input::placeholder, .inspector-shell-field textarea::placeholder { color: #94a3b8; }

/* Form actions */
.inspector-shell-form-actions {
  padding: 12px 20px;
  border-top: 1px solid #cbd5e1;
  display: flex;
  gap: 10px;
  align-items: center;
}
.inspector-shell-form-actions--top {
  border-top: none;
  border-bottom: 1px solid #cbd5e1;
}
.inspector-shell-btn-call {
  padding: 9px 20px;
  font-size: 13px;
  font-weight: 600;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;
}
.inspector-shell-btn-call:hover { background: #1d4ed8; }
.inspector-shell-btn-call:disabled { opacity: 0.5; cursor: not-allowed; }
.inspector-shell-btn-clear {
  padding: 9px 14px;
  font-size: 13px;
  background: transparent;
  color: #475569;
  border: 1px solid #94a3b8;
  border-radius: 6px;
  cursor: pointer;
}
.inspector-shell-btn-clear:hover { background: #e2e8f0; }
.inspector-shell-form-error { font-size: 12px; color: #dc2626; margin-left: 8px; }

/* Column 3: right (tabbed output) */
.inspector-shell-col-right {
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.inspector-shell-output-tabs {
  display: flex;
  border-bottom: 1px solid #cbd5e1;
  padding: 0;
}
.inspector-shell-output-tab {
  font-size: 12px;
  font-weight: 500;
  color: #64748b;
  padding: 10px 16px;
  border: none;
  background: none;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.1s;
}
.inspector-shell-output-tab:hover { color: #334155; }
.inspector-shell-output-tab--active { color: #1e293b; border-bottom-color: #2563eb; }

.inspector-shell-output-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}
.inspector-shell-output-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: #64748b;
  font-size: 14px;
  text-align: center;
  padding: 40px 20px;
}
.inspector-shell-output-code {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  line-height: 1.7;
  color: #1e293b;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  background: #f1f5f9;
  padding: 12px 16px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

.inspector-shell-output-footer {
  padding: 8px 20px;
  border-top: 1px solid #cbd5e1;
  font-size: 11px;
  color: #64748b;
  display: flex;
  gap: 20px;
  flex-shrink: 0;
}
.inspector-shell-output-footer strong { color: #334155; }
```

- [ ] **Step 5: Write `InspectorShell.jsx`**

Create `demo_api_ui/src/components/shared/InspectorShell.jsx`:

```jsx
// demo_api_ui/src/components/shared/InspectorShell.jsx
import React from 'react';
import './InspectorShell.css';

/**
 * Shared topbar + 3-column grid for tool/list-detail inspector pages.
 * Presentational only — owns no state, no data shape. Callers supply
 * left/middle/right column content and manage their own selection,
 * form, and tab state.
 */
export default function InspectorShell({
  title,
  statusOn = true,
  statusText,
  actions,
  left,
  middle,
  right,
}) {
  return (
    <div className="inspector-shell-page">
      <div className="inspector-shell-topbar">
        <span
          className={
            statusOn
              ? 'inspector-shell-topbar__dot'
              : 'inspector-shell-topbar__dot inspector-shell-topbar__dot--off'
          }
        />
        <h1>{title}</h1>
        {statusText && <span className="inspector-shell-topbar__status">{statusText}</span>}
        {actions && <div className="inspector-shell-topbar__right">{actions}</div>}
      </div>
      <div className="inspector-shell-grid">
        <div className="inspector-shell-col-left">{left}</div>
        <div className="inspector-shell-col-middle">{middle}</div>
        <div className="inspector-shell-col-right">{right}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx vitest run src/components/shared/__tests__/InspectorShell.test.jsx
```

Expected: PASS — 5 tests.

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # confirm worktree-inspector-shell-spec
git add demo_api_ui/src/components/shared/InspectorShell.jsx \
        demo_api_ui/src/components/shared/InspectorShell.css \
        demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx
git commit -m "feat(inspector-shell): add InspectorShell presentational component"
```

---

### Task 2: `InspectorListItem`

**Files:**
- Create: `demo_api_ui/src/components/shared/InspectorListItem.jsx`
- Test: `demo_api_ui/src/components/shared/__tests__/InspectorListItem.test.jsx`

**Interfaces:**
- Consumes: `inspector-shell-tree-item*` classnames from Task 1's `InspectorShell.css` (imports the same file).
- Produces: `InspectorListItem({ label, active = false, dot = 'default', badges = [], onClick })` — default export from `demo_api_ui/src/components/shared/InspectorListItem.jsx`. `label: string`, `active: boolean`, `dot: 'default' | 'write' | 'sensitive'`, `badges: Array<'write' | 'sensitive'>` (both may be present at once — confirmed in `AgentGatewayTester.jsx`, where a tool can render both the write and sensitive badge simultaneously), `onClick: () => void`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/shared/__tests__/InspectorListItem.test.jsx`:

```jsx
// demo_api_ui/src/components/shared/__tests__/InspectorListItem.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import InspectorListItem from '../InspectorListItem';

describe('InspectorListItem', () => {
  it('renders the label', () => {
    render(<InspectorListItem label="get_account_balance" />);
    expect(screen.getByText('get_account_balance')).toBeInTheDocument();
  });

  it('applies the active modifier class when active', () => {
    const { rerender } = render(<InspectorListItem label="x" active={false} />);
    expect(screen.getByRole('button')).not.toHaveClass('inspector-shell-tree-item--active');

    rerender(<InspectorListItem label="x" active />);
    expect(screen.getByRole('button')).toHaveClass('inspector-shell-tree-item--active');
  });

  it('applies the correct dot modifier class', () => {
    const { container, rerender } = render(<InspectorListItem label="x" dot="write" />);
    expect(container.querySelector('.inspector-shell-tree-item__dot')).toHaveClass(
      'inspector-shell-tree-item__dot--write',
    );

    rerender(<InspectorListItem label="x" dot="sensitive" />);
    expect(container.querySelector('.inspector-shell-tree-item__dot')).toHaveClass(
      'inspector-shell-tree-item__dot--sensitive',
    );

    rerender(<InspectorListItem label="x" dot="default" />);
    const dot = container.querySelector('.inspector-shell-tree-item__dot');
    expect(dot).not.toHaveClass('inspector-shell-tree-item__dot--write');
    expect(dot).not.toHaveClass('inspector-shell-tree-item__dot--sensitive');
  });

  it('renders both badges when a tool is both write and sensitive', () => {
    render(<InspectorListItem label="delete_user" badges={['write', 'sensitive']} />);
    expect(screen.getByText('W')).toBeInTheDocument();
    expect(screen.getByText('S')).toBeInTheDocument();
  });

  it('renders no badges by default', () => {
    render(<InspectorListItem label="get_account_balance" />);
    expect(screen.queryByText('W')).toBeNull();
    expect(screen.queryByText('S')).toBeNull();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<InspectorListItem label="x" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/components/shared/__tests__/InspectorListItem.test.jsx
```

Expected: FAIL — `Failed to resolve import "../InspectorListItem"`.

- [ ] **Step 3: Write `InspectorListItem.jsx`**

Create `demo_api_ui/src/components/shared/InspectorListItem.jsx`:

```jsx
// demo_api_ui/src/components/shared/InspectorListItem.jsx
import React from 'react';
import './InspectorShell.css';

const BADGE_TEXT = { write: 'W', sensitive: 'S' };

/**
 * One left-column row: status dot + label + zero or more badges.
 * A tool can be both write and sensitive at once (both badges render).
 */
export default function InspectorListItem({
  label,
  active = false,
  dot = 'default',
  badges = [],
  onClick,
}) {
  const dotClass =
    dot === 'default'
      ? 'inspector-shell-tree-item__dot'
      : `inspector-shell-tree-item__dot inspector-shell-tree-item__dot--${dot}`;
  const itemClass = active
    ? 'inspector-shell-tree-item inspector-shell-tree-item--active'
    : 'inspector-shell-tree-item';

  return (
    <button type="button" className={itemClass} onClick={onClick}>
      <span className={dotClass} />
      <span>{label}</span>
      {badges.map((badge) => (
        <span
          key={badge}
          className={`inspector-shell-tree-item__badge inspector-shell-tree-item__badge--${badge}`}
        >
          {BADGE_TEXT[badge]}
        </span>
      ))}
    </button>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/components/shared/__tests__/InspectorListItem.test.jsx
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # confirm worktree-inspector-shell-spec
git add demo_api_ui/src/components/shared/InspectorListItem.jsx \
        demo_api_ui/src/components/shared/__tests__/InspectorListItem.test.jsx
git commit -m "feat(inspector-shell): add InspectorListItem component"
```

---

### Task 3: `InspectorTabs`

**Files:**
- Create: `demo_api_ui/src/components/shared/InspectorTabs.jsx`
- Test: `demo_api_ui/src/components/shared/__tests__/InspectorTabs.test.jsx`

**Interfaces:**
- Consumes: `inspector-shell-output-tab*` classnames from Task 1's `InspectorShell.css` (imports the same file).
- Produces: `InspectorTabs({ tabs, activeKey, onChange })` — default export from `demo_api_ui/src/components/shared/InspectorTabs.jsx`. `tabs: Array<{ key: string, label: string }>`, `activeKey: string`, `onChange: (key: string) => void`. Renders the tab bar only — tab *content* is rendered by the caller (e.g. inside `InspectorShell`'s `right` slot, below this bar), matching every existing page's pattern of a tab bar followed by a separately-rendered output body.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/shared/__tests__/InspectorTabs.test.jsx`:

```jsx
// demo_api_ui/src/components/shared/__tests__/InspectorTabs.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import InspectorTabs from '../InspectorTabs';

const TABS = [
  { key: 'response', label: 'Response' },
  { key: 'request', label: 'Request' },
  { key: 'history', label: 'History' },
];

describe('InspectorTabs', () => {
  it('renders every tab label', () => {
    render(<InspectorTabs tabs={TABS} activeKey="response" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Response' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
  });

  it('marks only the active tab with the active class', () => {
    render(<InspectorTabs tabs={TABS} activeKey="request" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Response' })).not.toHaveClass(
      'inspector-shell-output-tab--active',
    );
    expect(screen.getByRole('button', { name: 'Request' })).toHaveClass(
      'inspector-shell-output-tab--active',
    );
  });

  it('calls onChange with the clicked tab key', () => {
    const onChange = vi.fn();
    render(<InspectorTabs tabs={TABS} activeKey="response" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(onChange).toHaveBeenCalledWith('history');
  });

  it('renders nothing when tabs is empty', () => {
    const { container } = render(<InspectorTabs tabs={[]} activeKey="" onChange={() => {}} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/components/shared/__tests__/InspectorTabs.test.jsx
```

Expected: FAIL — `Failed to resolve import "../InspectorTabs"`.

- [ ] **Step 3: Write `InspectorTabs.jsx`**

Create `demo_api_ui/src/components/shared/InspectorTabs.jsx`:

```jsx
// demo_api_ui/src/components/shared/InspectorTabs.jsx
import React from 'react';
import './InspectorShell.css';

/**
 * Output tab bar. Renders tabs and highlights activeKey; tab content is
 * rendered separately by the caller.
 */
export default function InspectorTabs({ tabs, activeKey, onChange }) {
  return (
    <div className="inspector-shell-output-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={
            tab.key === activeKey
              ? 'inspector-shell-output-tab inspector-shell-output-tab--active'
              : 'inspector-shell-output-tab'
          }
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/components/shared/__tests__/InspectorTabs.test.jsx
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Run the full shared/ test suite together**

```bash
npx vitest run src/components/shared/__tests__/
```

Expected: PASS — all tests in `InspectorShell.test.jsx`, `InspectorListItem.test.jsx`, `InspectorTabs.test.jsx`, plus the pre-existing `EducationDrawer.test.js`, all green (16 tests total across the four files: 5 + 6 + 4 + 1 — do not worry if `EducationDrawer.test.js`'s count differs, just confirm zero failures).

- [ ] **Step 6: Run the UI build gate**

```bash
npm run build
```

Expected: build succeeds with no errors. This is the `Global Constraints` build-gate requirement — it confirms the three new files are valid, importable modules even though nothing consumes them yet.

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # confirm worktree-inspector-shell-spec
git add demo_api_ui/src/components/shared/InspectorTabs.jsx \
        demo_api_ui/src/components/shared/__tests__/InspectorTabs.test.jsx
git commit -m "feat(inspector-shell): add InspectorTabs component"
```

---

## What this plan does not do

- Does not modify `McpInspector.js`, `PingOneMcpInspector.js`, `ApiExplorerPanel.js`, `AgentGatewayTester.jsx`, or `PingOneAuthorizePage.jsx` — those conversions are separate plans (per `docs/superpowers/specs/2026-07-19-inspector-shell-template-design.md`, migration order: `PingOneAuthorizePage` next, then `AgentGatewayTester`, then the `McpInspectorPage` merge).
- Does not touch routing, `AdminSideNav.jsx`, or the `p1mcp-*` classnames in `PingOneMcpInspector.css` — those still back the four live pages unchanged until each is migrated in its own plan.
- Does not add the `inspector-template` skill — that ships once at least one real page conversion has validated the component's API.
