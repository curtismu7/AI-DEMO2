# Agent Flow Inspector — Hybrid-Tree Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the "Flow & Tokens" tab of `UnifiedTokenFlowInspector.jsx`
onto the shared `InspectorShell` (MCP-Inspector-style tree/detail/tabs)
pattern, without touching the "Token Chain" or "Token Transform" tabs, the
floating/draggable wrapper, or any of `TokenChainTraceRail`'s 25+ other
consumers.

**Architecture:** Add a `kind` prop to `InspectorListItem`, a `"fill"` height
mode to `InspectorShell`, a new `InspectorReplayBar` shared component, and a
pure `buildAgentFlowTree()` helper. Then replace the tab's two-pane
`AgentFlowSection`/`OAuthInspectorSection` layout with a new `FlowTokensPanel`
(tree left, adaptive detail middle, 5 tabs right) built from those pieces,
reusing `OAuthInspectorSection`'s existing data-fetching untouched.

**Tech Stack:** React (function components + hooks), Vitest +
`@testing-library/react` (globals enabled, jsdom environment, matchers via
`src/setupTests.js`), existing `InspectorShell` CSS design tokens.

## Global Constraints

- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` (per
  `REGRESSION_PLAN.md` §0). Don't introduce new emoji in any new UI text.
- "Token Chain" and "Token Transform" tabs must render pixel-identical to
  before — no code in those branches changes.
- `TokenChainTraceRail`, `tokenChainTraceStore`, and their other 25+ consumers
  are out of scope — do not edit `TokenChainTraceRail.jsx` or anything under
  `demo_api_ui/src/services/tokenChainTrace/`.
- Run tests with `npx vitest run <path>` from `demo_api_ui/`. Full suite:
  `npm test` (interactive) or `npx vitest run` (CI-style, one-shot).
- This work happens in the `worktree-agent-flow-inspector-redesign` worktree,
  already checked out. Commit after each task.

---

### Task 1: `InspectorListItem` — add `kind` prop (step vs. token icon)

**Files:**
- Modify: `demo_api_ui/src/components/shared/InspectorListItem.jsx`
- Modify: `demo_api_ui/src/components/shared/InspectorShell.css`
- Create: `demo_api_ui/src/components/shared/__tests__/InspectorListItem.test.jsx`

**Interfaces:**
- Produces: `InspectorListItem({ label, active, dot, kind, badges, onClick })`
  — `kind` is new, `'step' | 'token'`, default `'step'`. When `'token'`,
  renders `.inspector-shell-tree-item__token-icon` (colored via the existing
  `dot` prop's palette) instead of `.inspector-shell-tree-item__dot`. All
  other props and existing callers (`McpInspectorPage.jsx`,
  `AgentGatewayTester.jsx`) are unaffected since they never pass `kind`.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_ui/src/components/shared/__tests__/InspectorListItem.test.jsx`:

```jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import InspectorListItem from '../InspectorListItem';

describe('InspectorListItem', () => {
  it('renders a round dot by default (kind="step")', () => {
    const { container } = render(<InspectorListItem label="get_accounts" onClick={() => {}} />);
    expect(container.querySelector('.inspector-shell-tree-item__dot')).toBeInTheDocument();
    expect(container.querySelector('.inspector-shell-tree-item__token-icon')).toBeNull();
  });

  it('renders a token icon instead of a dot when kind="token"', () => {
    const { container } = render(
      <InspectorListItem label="Exchanged Access Token" kind="token" onClick={() => {}} />
    );
    expect(container.querySelector('.inspector-shell-tree-item__token-icon')).toBeInTheDocument();
    expect(container.querySelector('.inspector-shell-tree-item__dot')).toBeNull();
  });

  it('colors the token icon using the dot prop, same palette as step dots', () => {
    const { container } = render(
      <InspectorListItem label="Denied step token" kind="token" dot="sensitive" onClick={() => {}} />
    );
    expect(
      container.querySelector('.inspector-shell-tree-item__token-icon--sensitive')
    ).toBeInTheDocument();
  });

  it('still fires onClick and applies the active class for both kinds', () => {
    const onClick = vi.fn();
    render(<InspectorListItem label="x" kind="token" active onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button')).toHaveClass('inspector-shell-tree-item--active');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/components/shared/__tests__/InspectorListItem.test.jsx`
Expected: FAIL — `token-icon` classes never render (prop doesn't exist yet).

- [ ] **Step 3: Implement the `kind` prop**

Replace `demo_api_ui/src/components/shared/InspectorListItem.jsx` entirely:

```jsx
// demo_api_ui/src/components/shared/InspectorListItem.jsx
import React from 'react';
import './InspectorShell.css';

const BADGE_TEXT = { write: 'W', sensitive: 'S' };

/**
 * One left-column row: status dot (or token icon) + label + zero or more
 * badges. A tool can be both write and sensitive at once (both badges
 * render). `kind="token"` swaps the round status dot for a small square
 * token icon, colored with the same `dot` palette (default/write/sensitive).
 */
export default function InspectorListItem({
  label,
  active = false,
  dot = 'default',
  kind = 'step',
  badges = [],
  onClick,
}) {
  const dotClass =
    dot === 'default'
      ? 'inspector-shell-tree-item__dot'
      : `inspector-shell-tree-item__dot inspector-shell-tree-item__dot--${dot}`;
  const tokenIconClass =
    dot === 'default'
      ? 'inspector-shell-tree-item__token-icon'
      : `inspector-shell-tree-item__token-icon inspector-shell-tree-item__token-icon--${dot}`;
  const itemClass = active
    ? 'inspector-shell-tree-item inspector-shell-tree-item--active'
    : 'inspector-shell-tree-item';

  return (
    <button type="button" className={itemClass} onClick={onClick}>
      {kind === 'token' ? (
        <span className={tokenIconClass}>▮</span>
      ) : (
        <span className={dotClass} />
      )}
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

Append to `demo_api_ui/src/components/shared/InspectorShell.css` (after the
existing `.inspector-shell-tree-item__badge--sensitive` rule):

```css
.inspector-shell-tree-item__token-icon { font-size: 10px; line-height: 1; color: #2563eb; flex-shrink: 0; }
.inspector-shell-tree-item__token-icon--write { color: #d97706; }
.inspector-shell-tree-item__token-icon--sensitive { color: #dc2626; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/shared/__tests__/InspectorListItem.test.jsx`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/shared/InspectorListItem.jsx demo_api_ui/src/components/shared/InspectorShell.css demo_api_ui/src/components/shared/__tests__/InspectorListItem.test.jsx
git commit -m "feat(inspector-shell): add kind prop to InspectorListItem for token nodes"
```

---

### Task 2: `InspectorShell` — add `fullHeight="fill"` mode

**Files:**
- Modify: `demo_api_ui/src/components/shared/InspectorShell.jsx`
- Modify: `demo_api_ui/src/components/shared/InspectorShell.css`
- Modify: `demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx`

**Interfaces:**
- Produces: `InspectorShell`'s `fullHeight` prop now accepts
  `true | false | 'fill'`. `true` (default) → existing 100vh-based grid.
  `false` → existing fixed-640px `--embedded` grid. `'fill'` (new) → new
  `--fill` grid, `height: 100%`, for a shell embedded in a tab panel that
  already constrains its own height.

- [ ] **Step 1: Write the failing test**

Add to `demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx`,
inside the existing `describe('InspectorShell', ...)` block, after the
`'applies the embedded grid modifier only when fullHeight is false'` test:

```jsx
  it('applies the fill grid modifier when fullHeight="fill"', () => {
    const { container } = render(<InspectorShell title="X" fullHeight="fill" />);
    const grid = container.querySelector('.inspector-shell-grid');
    expect(grid).toHaveClass('inspector-shell-grid--fill');
    expect(grid).not.toHaveClass('inspector-shell-grid--embedded');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/shared/__tests__/InspectorShell.test.jsx`
Expected: FAIL — `--fill` class never applied (fullHeight="fill" falls
through the current boolean check as truthy, so it gets the plain grid, not
`--fill`).

- [ ] **Step 3: Implement the `"fill"` mode**

In `demo_api_ui/src/components/shared/InspectorShell.jsx`, replace the grid
`className` expression:

```jsx
      <div
        className={
          fullHeight === 'fill'
            ? 'inspector-shell-grid inspector-shell-grid--fill'
            : fullHeight
              ? 'inspector-shell-grid'
              : 'inspector-shell-grid inspector-shell-grid--embedded'
        }
      >
```

Append to `demo_api_ui/src/components/shared/InspectorShell.css` (after the
`.inspector-shell-grid--embedded` rule):

```css
.inspector-shell-grid--fill {
  height: 100%;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/shared/__tests__/InspectorShell.test.jsx`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/shared/InspectorShell.jsx demo_api_ui/src/components/shared/InspectorShell.css demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx
git commit -m "feat(inspector-shell): add fullHeight=\"fill\" mode for tab-embedded shells"
```

---

### Task 3: `InspectorReplayBar` — new shared status/nav strip

**Files:**
- Create: `demo_api_ui/src/components/shared/InspectorReplayBar.jsx`
- Modify: `demo_api_ui/src/components/shared/InspectorShell.css`
- Create: `demo_api_ui/src/components/shared/__tests__/InspectorReplayBar.test.jsx`

**Interfaces:**
- Produces: `InspectorReplayBar({ stepCount, deniedCount, tokenCount, onPrev,
  onNext, onClear, clearDisabled })` — a presentational strip. All props
  optional (numeric props default `0`, handlers default no-op via React's
  normal undefined-handler behavior — a click with no handler passed is a
  no-op, not an error).

- [ ] **Step 1: Write the failing tests**

Create `demo_api_ui/src/components/shared/__tests__/InspectorReplayBar.test.jsx`:

```jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import InspectorReplayBar from '../InspectorReplayBar';

describe('InspectorReplayBar', () => {
  it('renders step, denied, and token counts', () => {
    render(<InspectorReplayBar stepCount={6} deniedCount={1} tokenCount={3} />);
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('applies the warn style only when deniedCount > 0', () => {
    const { container, rerender } = render(<InspectorReplayBar deniedCount={0} />);
    expect(container.querySelector('.inspector-shell-replay-bar__item--warn')).toBeNull();

    rerender(<InspectorReplayBar deniedCount={2} />);
    expect(container.querySelector('.inspector-shell-replay-bar__item--warn')).toBeInTheDocument();
  });

  it('fires onPrev, onNext, and onClear from their respective buttons', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onClear = vi.fn();
    render(<InspectorReplayBar onPrev={onPrev} onNext={onNext} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: /Prev/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('disables Clear when clearDisabled is true', () => {
    render(<InspectorReplayBar clearDisabled />);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/components/shared/__tests__/InspectorReplayBar.test.jsx`
Expected: FAIL — module `../InspectorReplayBar` does not exist.

- [ ] **Step 3: Implement `InspectorReplayBar`**

Create `demo_api_ui/src/components/shared/InspectorReplayBar.jsx`:

```jsx
// demo_api_ui/src/components/shared/InspectorReplayBar.jsx
import React from 'react';
import './InspectorShell.css';

/**
 * Persistent status/nav strip between an InspectorShell's topbar and its
 * grid — step/denied/token counters plus Prev/Next/Clear. Presentational
 * only; the caller owns all counts and handlers.
 */
export default function InspectorReplayBar({
  stepCount = 0,
  deniedCount = 0,
  tokenCount = 0,
  onPrev,
  onNext,
  onClear,
  clearDisabled = false,
}) {
  return (
    <div className="inspector-shell-replay-bar">
      <span className="inspector-shell-replay-bar__item">
        Steps <strong>{stepCount}</strong>
      </span>
      <span
        className={
          deniedCount > 0
            ? 'inspector-shell-replay-bar__item inspector-shell-replay-bar__item--warn'
            : 'inspector-shell-replay-bar__item'
        }
      >
        Denied <strong>{deniedCount}</strong>
      </span>
      <span className="inspector-shell-replay-bar__item">
        Tokens minted <strong>{tokenCount}</strong>
      </span>
      <div className="inspector-shell-replay-bar__controls">
        <button type="button" className="inspector-shell-replay-bar__btn" onClick={onPrev}>
          ◀ Prev
        </button>
        <button type="button" className="inspector-shell-replay-bar__btn" onClick={onNext}>
          Next ▶
        </button>
        <button
          type="button"
          className="inspector-shell-replay-bar__btn"
          onClick={onClear}
          disabled={clearDisabled}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
```

Append to `demo_api_ui/src/components/shared/InspectorShell.css`:

```css
/* Replay bar — persistent status/nav strip between topbar and grid */
.inspector-shell-replay-bar {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 9px 20px;
  background: #f8fafc;
  border-bottom: 1px solid #cbd5e1;
  font-size: 12px;
  color: #475569;
}
.inspector-shell-replay-bar__item strong { color: #1e293b; }
.inspector-shell-replay-bar__item--warn strong { color: #991b1b; }
.inspector-shell-replay-bar__controls { margin-left: auto; display: flex; gap: 6px; }
.inspector-shell-replay-bar__btn {
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 5px;
  border: 1px solid #94a3b8;
  background: #ffffff;
  color: #334155;
  cursor: pointer;
}
.inspector-shell-replay-bar__btn:hover { background: #e2e8f0; }
.inspector-shell-replay-bar__btn:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/shared/__tests__/InspectorReplayBar.test.jsx`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/shared/InspectorReplayBar.jsx demo_api_ui/src/components/shared/InspectorShell.css demo_api_ui/src/components/shared/__tests__/InspectorReplayBar.test.jsx
git commit -m "feat(inspector-shell): add InspectorReplayBar status/nav strip"
```

---

### Task 4: `buildAgentFlowTree` — pure step/token tree builder

**Files:**
- Create: `demo_api_ui/src/utils/agentFlowTree.js`
- Create: `demo_api_ui/src/utils/__tests__/agentFlowTree.test.js`

**Interfaces:**
- Consumes: `steps: Array<{id, title, detail?, status}>` (shape produced by
  `agentFlowDiagramService.js`'s `buildCompletedSteps()`); `tokenChain:
  Array<{id, tokenType?, timestamp?, tokenSub?, tokenAct?}>` (shape returned
  by `GET /api/token-chain/current`'s `currentTokens`).
- Produces: `buildAgentFlowTree(steps, tokenChain) => Array<{key, label,
  nodes: Array<{id, kind: 'step'|'token', label, status, data}>}>` — consumed
  by Task 5's `FlowTokensPanel` for the tree's left column and for flattening
  into a Prev/Next-navigable node list.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_ui/src/utils/__tests__/agentFlowTree.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildAgentFlowTree } from '../agentFlowTree';

describe('buildAgentFlowTree', () => {
  it('groups known step ids into their phase, in phase order', () => {
    const steps = [
      { id: 'as', title: 'PingOne — Demo User App', status: 'done' },
      { id: 'bff', title: 'BFF — POST /api/mcp/tool', status: 'done' },
      { id: 'tool', title: 'MCP tool — get_accounts', status: 'done' },
    ];
    const tree = buildAgentFlowTree(steps, []);
    expect(tree.map((g) => g.key)).toEqual(['auth', 'agent_gateway', 'tool_execution']);
    expect(tree[0].nodes[0]).toMatchObject({ id: 'step-as', kind: 'step', status: 'done' });
  });

  it('falls back unknown step ids to the OTHER group instead of dropping them', () => {
    const steps = [{ id: 'future-step', title: 'New step', status: 'done' }];
    const tree = buildAgentFlowTree(steps, []);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ key: 'other', label: 'OTHER' });
  });

  it('appends a trailing TOKENS MINTED group, sorted by timestamp, when tokens exist', () => {
    const tokenChain = [
      { id: 'tok-2', tokenType: 'mcp_token', timestamp: 200 },
      { id: 'tok-1', tokenType: 'user_token', timestamp: 100 },
    ];
    const tree = buildAgentFlowTree([], tokenChain);
    expect(tree).toHaveLength(1);
    expect(tree[0].key).toBe('tokens');
    expect(tree[0].nodes.map((n) => n.id)).toEqual(['token-tok-1', 'token-tok-2']);
  });

  it('omits the TOKENS MINTED group entirely when tokenChain is empty', () => {
    const tree = buildAgentFlowTree([{ id: 'as', title: 'x', status: 'done' }], []);
    expect(tree.some((g) => g.key === 'tokens')).toBe(false);
  });

  it('returns an empty array when there are no steps and no tokens', () => {
    expect(buildAgentFlowTree([], [])).toEqual([]);
    expect(buildAgentFlowTree(undefined, undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/utils/__tests__/agentFlowTree.test.js`
Expected: FAIL — module `../agentFlowTree` does not exist.

- [ ] **Step 3: Implement `buildAgentFlowTree`**

Create `demo_api_ui/src/utils/agentFlowTree.js`:

```js
// demo_api_ui/src/utils/agentFlowTree.js
/**
 * Groups a session's live flow steps (agentFlowDiagram.getState().steps) and
 * minted tokens (GET /api/token-chain/current) into the tree the Agent Flow
 * Inspector's Flow & Tokens tab renders. Pure — no side effects, no
 * fetching; steps/tokenChain are passed in already-loaded.
 *
 * Steps carry no timestamp (only a fixed pipeline order), so true
 * chronological interleaving of steps and tokens isn't possible — tokens
 * render in their own trailing group instead, sorted by their real
 * timestamp.
 */

const STEP_PHASE = {
  as: 'auth',
  agent: 'agent_gateway',
  bff: 'agent_gateway',
  'mcp-gateway': 'agent_gateway',
  pingauthorize: 'authorization',
  mcp: 'tool_execution',
  tool: 'tool_execution',
};

const PHASE_LABELS = {
  auth: 'AUTHENTICATION',
  agent_gateway: 'AGENT & GATEWAY',
  authorization: 'AUTHORIZATION',
  tool_execution: 'TOOL EXECUTION',
  other: 'OTHER',
};

const PHASE_ORDER = ['auth', 'agent_gateway', 'authorization', 'tool_execution', 'other'];

export function buildAgentFlowTree(steps, tokenChain) {
  const groups = new Map(
    PHASE_ORDER.map((key) => [key, { key, label: PHASE_LABELS[key], nodes: [] }])
  );

  (steps || []).forEach((step) => {
    const phaseKey = STEP_PHASE[step.id] || 'other';
    groups.get(phaseKey).nodes.push({
      id: `step-${step.id}`,
      kind: 'step',
      label: step.title,
      status: step.status,
      data: step,
    });
  });

  const sortedTokens = [...(tokenChain || [])].sort(
    (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
  );
  if (sortedTokens.length) {
    groups.set('tokens', { key: 'tokens', label: 'TOKENS MINTED', nodes: [] });
    sortedTokens.forEach((token) => {
      groups.get('tokens').nodes.push({
        id: `token-${token.id}`,
        kind: 'token',
        label: token.tokenType ? token.tokenType.replace(/_/g, ' ') : 'Token',
        status: 'ok',
        data: token,
      });
    });
  }

  return [...PHASE_ORDER, 'tokens']
    .map((key) => groups.get(key))
    .filter((group) => group && group.nodes.length > 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/utils/__tests__/agentFlowTree.test.js`
Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/utils/agentFlowTree.js demo_api_ui/src/utils/__tests__/agentFlowTree.test.js
git commit -m "feat(agent-flow-inspector): add buildAgentFlowTree pure helper"
```

---

### Task 5: `FlowTokensPanel` — replace the Flow & Tokens tab's layout

**Files:**
- Modify: `demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx`
- Modify: `demo_api_ui/src/components/UnifiedTokenFlowInspector.test.jsx`

**Interfaces:**
- Consumes: `InspectorShell({ title, statusText, fullHeight, left, middle,
  right })` (Task 2), `InspectorReplayBar({ stepCount, deniedCount,
  tokenCount, onPrev, onNext, onClear, clearDisabled })` (Task 3),
  `InspectorListItem({ label, kind, dot, active, onClick })` (Task 1),
  `InspectorTabs({ tabs, activeKey, onChange })` (existing, already imported
  by `McpInspectorPage.jsx` from `./shared/InspectorTabs`),
  `buildAgentFlowTree(steps, tokenChain)` (Task 4).
- Produces: `FlowTokensPanel({ onOpenClaimsModal })` — a new, non-exported
  function inside this file, replacing `AgentFlowSection`. Renders into the
  `activeTab === 'flow'` branch of the file's default export.

This task has two parts: (5a) add the new imports and build
`FlowTokensPanel`; (5b) wire it in and delete the old two-pane layout. Do
them in one pass since a half-wired `FlowTokensPanel` isn't independently
useful — the existing test file only exercises this component through its
top-level export (see `UnifiedTokenFlowInspector.test.jsx`'s 26-line file
today), so that's also how the new coverage is written.

- [ ] **Step 1: Write the failing test**

Replace `demo_api_ui/src/components/UnifiedTokenFlowInspector.test.jsx`
entirely (keeps the existing Token Transform test untouched — that tab isn't
changing — and adds coverage for the redesigned Flow & Tokens tab):

```jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import UnifiedTokenFlowInspector from './UnifiedTokenFlowInspector';
import { ExchangeModeProvider } from '../context/ExchangeModeContext';
import { agentFlowDiagram } from '../services/agentFlowDiagramService';

// AgentFlowSection (rendered on the default 'flow' tab, mounted before the
// Token Transform tab is clicked) calls useExchangeMode(), which throws
// outside its provider — wrap so the crash tested isn't a missing-provider
// error but the actual behavior under test.
function renderInspector() {
  return render(
    <ExchangeModeProvider>
      <UnifiedTokenFlowInspector />
    </ExchangeModeProvider>
  );
}

describe('UnifiedTokenFlowInspector — Token Transform tab', () => {
  it('shows a Token Transform tab that renders the gateway-in vs backend-out audience', () => {
    renderInspector();
    fireEvent.click(screen.getByRole('tab', { name: /Token Transform/i }));
    expect(screen.getByText(/gateway-audience-in/i)).toBeInTheDocument();
    expect(screen.getByText(/backend-audience-out/i)).toBeInTheDocument();
  });
});

describe('UnifiedTokenFlowInspector — Flow & Tokens tab (hybrid tree)', () => {
  beforeEach(() => {
    agentFlowDiagram.reset();
    agentFlowDiagram.close();
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ currentTokens: [] }) })
    );
  });

  it('shows an empty-state hint when no steps have run yet', () => {
    renderInspector();
    expect(screen.getByText(/Run a banking action in the agent/i)).toBeInTheDocument();
  });

  it('renders live steps as a tree grouped by phase, and shows step detail on select', async () => {
    renderInspector();
    agentFlowDiagram.open();
    // completeMcpToolCall() is the real method that populates state.steps
    // via buildCompletedSteps() — the same call site bankingAgentService
    // uses after a tool finishes.
    agentFlowDiagram.completeMcpToolCall({ toolName: 'get_accounts', tokenEvents: [], ok: true });

    await waitFor(() => {
      expect(screen.getByText(/AUTHENTICATION/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/PingOne — Demo User App/));
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('marks denied steps with the sensitive (red) tree icon and counts them in the replay bar', async () => {
    const { container } = renderInspector();
    agentFlowDiagram.open();
    // ok: false with no matching tokenEvents makes buildCompletedSteps()
    // mark the pingauthorize/mcp/tool steps 'error' — a real step-up-denial
    // shape, not a synthetic one.
    agentFlowDiagram.completeMcpToolCall({
      toolName: 'create_withdrawal',
      tokenEvents: [],
      ok: false,
      errorMessage: 'Step-up required',
    });

    await waitFor(() => {
      expect(screen.getByText(/AUTHORIZATION/)).toBeInTheDocument();
    });
    expect(container.querySelector('.inspector-shell-tree-item__dot--sensitive')).toBeInTheDocument();
    expect(screen.getByText('Denied').parentElement.querySelector('strong').textContent).not.toBe('0');
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd demo_api_ui && npx vitest run src/components/UnifiedTokenFlowInspector.test.jsx`
Expected: FAIL — no "Agent Request Flow" heading exists yet (old layout has
no `InspectorShell` title), no phase-group text renders.

- [ ] **Step 3: Add new imports**

In `demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx`, add to the
top-of-file import block (after the existing `import JsonHighlight from
'./shared/JsonHighlight';` line):

```jsx
import InspectorShell from './shared/InspectorShell';
import InspectorTabs from './shared/InspectorTabs';
import InspectorListItem from './shared/InspectorListItem';
import InspectorReplayBar from './shared/InspectorReplayBar';
import { buildAgentFlowTree } from '../utils/agentFlowTree';
```

- [ ] **Step 4: Replace `AgentFlowSection` with `FlowTokensPanel`**

In `demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx`, delete the
entire `AgentFlowSection` function (from `// ====... LEFT: AGENT REQUEST FLOW
SECTION ====...` through its closing `}` — the function whose signature is
`function AgentFlowSection({ compact = false, onSelectToken, selectedTokenId:
selectedTokenIdFromParent })`). Replace it with:

```jsx
// ============================================================================
// LEFT/MIDDLE/RIGHT: FLOW & TOKENS TAB — hybrid tree via InspectorShell
// ============================================================================

function nodeFieldRows(node) {
  if (node.kind === 'token') {
    const t = node.data;
    return [
      ['Type', t.tokenType ? t.tokenType.replace(/_/g, ' ') : 'token'],
      ['Minted', t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : '—'],
      ...(t.tokenSub ? [['Subject', `${String(t.tokenSub).slice(0, 16)}…`]] : []),
      ...(t.tokenAct ? [['Actor (act)', `${String(t.tokenAct).slice(0, 16)}…`]] : []),
    ];
  }
  const s = node.data;
  return [['Status', s.status], ...(s.detail ? [['Detail', s.detail]] : [])];
}

const UTFI_PATH_LABELS = {
  oauth_bearer: 'OAUTH BEARER PATH',
  api_key: 'API-KEY PATH',
  dual_token: 'ACCESS + ID-TOKEN PATH',
};
const UTFI_PATH_COLORS = {
  oauth_bearer: { bg: '#dbeafe', border: '#004687', text: '#004687' },
  api_key: { bg: '#fef9c3', border: '#ca8a04', text: '#713f12' },
  dual_token: { bg: '#ccfbf1', border: '#0d9488', text: '#0d9488' },
};

const RIGHT_TABS = [
  { key: 'claims', label: 'Claims' },
  { key: 'exchange', label: 'Token Exchange' },
  { key: 'diagram', label: 'Diagram' },
  { key: 'raw', label: 'Raw' },
  { key: 'glossary', label: 'Glossary' },
];

function FlowTokensPanel({ onOpenClaimsModal }) {
  const [snap, setSnap] = useState(() => agentFlowDiagram.getState());
  const [tokenChain, setTokenChain] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedToken, setSelectedToken] = useState(null);
  const [activeRightTab, setActiveRightTab] = useState('claims');
  const [showFlowDiagram, setShowFlowDiagram] = useState(false);
  const { mode } = useExchangeMode();
  const tokenChainCtx = useTokenChainOptional();

  const loadTokenChain = useCallback(async () => {
    try {
      const res = await fetch('/api/token-chain/current', { credentials: 'include', _silent: true });
      if (res.ok) {
        const data = await res.json();
        setTokenChain(data.currentTokens || []);
      }
    } catch (err) {
      console.error('Failed to load token chain:', err);
    }
  }, []);

  useEffect(() => {
    const unsub = agentFlowDiagram.subscribe(setSnap);
    return unsub;
  }, []);

  useEffect(() => {
    if (snap.visible) loadTokenChain();
  }, [snap.visible, loadTokenChain]);

  useEffect(() => {
    const onAgentResult = () => {
      if (agentFlowDiagram.getState().visible) loadTokenChain();
    };
    window.addEventListener('banking-agent-result', onAgentResult);
    return () => window.removeEventListener('banking-agent-result', onAgentResult);
  }, [loadTokenChain]);

  useEffect(() => {
    if (!snap.visible) return undefined;
    const id = setInterval(loadTokenChain, 10000);
    return () => clearInterval(id);
  }, [snap.visible, loadTokenChain]);

  const { steps, hint, toolName } = snap;
  const tree = buildAgentFlowTree(steps, tokenChain);
  const flatNodes = tree.flatMap((g) => g.nodes);
  const selectedNode =
    flatNodes.find((n) => n.id === selectedNodeId) || flatNodes[flatNodes.length - 1] || null;

  const selectNode = useCallback((node) => {
    setSelectedNodeId(node.id);
    setSelectedToken(node.kind === 'token' ? node.data : null);
  }, []);

  const selectedIndex = flatNodes.findIndex((n) => n.id === selectedNode?.id);
  const goPrev = () => { if (selectedIndex > 0) selectNode(flatNodes[selectedIndex - 1]); };
  const goNext = () => {
    if (selectedIndex >= 0 && selectedIndex < flatNodes.length - 1) selectNode(flatNodes[selectedIndex + 1]);
  };
  const handleClear = () => {
    agentFlowDiagram.reset();
    setSelectedNodeId(null);
    setSelectedToken(null);
  };

  const deniedCount = steps.filter((s) => s.status === 'error').length;
  const utfiCredentialPath = tokenChainCtx?.events?.[0]?.credentialPath || 'oauth_bearer';
  const utfiPathLabel = UTFI_PATH_LABELS[utfiCredentialPath] || UTFI_PATH_LABELS.oauth_bearer;
  const utfiPathColor = UTFI_PATH_COLORS[utfiCredentialPath] || UTFI_PATH_COLORS.oauth_bearer;

  const left = (
    <div className="inspector-shell-tree-body">
      {tree.length === 0 && (
        <div className="utfi-empty-state">
          <p className="utfi-empty-msg">{hint || 'Ready for agent requests…'}</p>
        </div>
      )}
      {tree.map((group) => (
        <div key={group.key}>
          <div className="inspector-shell-tree-group__label">{group.label} ({group.nodes.length})</div>
          {group.nodes.map((node) => (
            <InspectorListItem
              key={node.id}
              label={node.label}
              kind={node.kind}
              dot={node.status === 'error' ? 'sensitive' : 'default'}
              active={selectedNode?.id === node.id}
              onClick={() => selectNode(node)}
            />
          ))}
        </div>
      ))}
    </div>
  );

  const middle = selectedNode ? (
    <>
      <div className="inspector-shell-form-header">
        <div className="inspector-shell-form-header__name">{selectedNode.label}</div>
      </div>
      <div className="inspector-shell-form-body">
        {nodeFieldRows(selectedNode).map(([k, v]) => (
          <div className="inspector-shell-field" key={k}>
            <label>{k}</label>
            <div>{v}</div>
          </div>
        ))}
      </div>
    </>
  ) : (
    <div className="inspector-shell-form-empty">Select a step or token on the left to inspect it.</div>
  );

  const right = (
    <>
      <InspectorTabs tabs={RIGHT_TABS} activeKey={activeRightTab} onChange={setActiveRightTab} />
      <div className="inspector-shell-output-body">
        <div style={{ display: activeRightTab === 'claims' || activeRightTab === 'exchange' ? 'block' : 'none' }}>
          <OAuthInspectorSection
            activeTab={activeRightTab}
            selectedToken={selectedToken}
            onOpenClaimsModal={onOpenClaimsModal}
          />
        </div>
        {activeRightTab === 'diagram' && (
          <>
            <TokenFlowDiagram />
            {steps.length > 0 && (
              <div className="utfi-flow-section">
                <div className="utfi-flow-section-header">
                  <span>{mode === 'double' ? '2-Exchange Flow (RFC 8693 §4)' : '1-Exchange Flow (RFC 8693 §2.1)'}</span>
                  <button
                    type="button"
                    className="utfi-btn utfi-btn-sm"
                    onClick={() => setShowFlowDiagram(!showFlowDiagram)}
                    aria-pressed={showFlowDiagram}
                  >
                    {showFlowDiagram ? '▼' : '▶'}
                  </button>
                </div>
                {showFlowDiagram && (
                  <div className="utfi-flow-diagram">
                    <TokenExchangeFlowDiagram phase={snap.phase} steps={steps} />
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {activeRightTab === 'raw' && (
          <pre className="inspector-shell-output-code">
            {selectedNode ? JSON.stringify(selectedNode.data, null, 2) : 'Nothing selected yet.'}
          </pre>
        )}
        {activeRightTab === 'glossary' && (
          <div className="utfi-detailed-steps-list">
            {STEP_DETAILS.map((step) => (
              <StepDetailsSection key={step.id} step={step} />
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="utfi-agent-flow-section">
      <SecurityGuaranteeBanner />
      {tokenChainCtx?.events?.length > 0 && (
        <div
          style={{
            margin: '4px 0 6px',
            padding: '4px 10px',
            borderRadius: 5,
            background: utfiPathColor.bg,
            borderLeft: `3px solid ${utfiPathColor.border}`,
            fontSize: '0.71rem',
            fontWeight: 700,
            color: utfiPathColor.text,
            letterSpacing: 0.3,
          }}
        >
          {utfiPathLabel}
        </div>
      )}
      <InspectorReplayBar
        stepCount={steps.length}
        deniedCount={deniedCount}
        tokenCount={tokenChain.length}
        onPrev={goPrev}
        onNext={goNext}
        onClear={handleClear}
        clearDisabled={steps.length === 0 && tokenChain.length === 0}
      />
      <InspectorShell
        title="Agent Request Flow"
        statusText={toolName || 'No tool call yet this session'}
        fullHeight="fill"
        left={left}
        middle={middle}
        right={right}
      />
    </div>
  );
}

// ============================================================================
// RIGHT: OAUTH TOKEN INSPECTOR SECTION
// ============================================================================
```

(The `// RIGHT: OAUTH TOKEN INSPECTOR SECTION` comment and the
`OAuthInspectorSection` function that already follows it stay in place —
this replacement only removes `AgentFlowSection` and inserts
`FlowTokensPanel` in its place, immediately before `OAuthInspectorSection`.)

- [ ] **Step 5: Add the `activeTab` prop to `OAuthInspectorSection`**

In `OAuthInspectorSection`'s signature, add `activeTab`:

```jsx
function OAuthInspectorSection({ selectedToken, onOpenClaimsModal, activeTab }) {
```

Find its final `return` statement (the one starting `return (
<div className="utfi-inspector-section">` with the `.utfi-sections` div
containing `tokenGrid`, `TokenCard`, `identity`, `authorization`,
`tokenExchange`, and `account` sections). Replace the `<div
className="utfi-sections">...</div>` block with:

```jsx
      <div className="utfi-sections">
        <div style={{ display: activeTab === 'exchange' ? 'none' : undefined }}>
          {renderSection('tokenGrid', 'Token Overview', '📊', (
            <TokenCardGrid
              userToken={tokenExchangeEvents.find((e) => e.id === 'user-token' || e.label?.toLowerCase().includes('user'))?.decoded || null}
              agentToken={tokenExchangeEvents.find((e) => e.label?.toLowerCase().includes('agent') || e.id?.toLowerCase().includes('agent'))?.decoded || null}
              mcpToken={tokenExchangeEvents.find((e) => e.label?.toLowerCase().includes('mcp') || e.id?.toLowerCase().includes('mcp') || e.label?.toLowerCase().includes('resource'))?.decoded || null}
              onInspectToken={handleGridInspect}
            />
          ))}

          <TokenCard decoded={tokenClaims} title="OAuth Token" defaultExpanded showHeader showIdentity showScopes showRaw />

          {renderSection('identity', 'Identity & Profile', '👤', (
            <>
              <ClaimRow label="Username" value={user?.username} />
              <ClaimRow label="Email" value={user?.email} />
              <ClaimRow label="Name" value={user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : null} />
              <ClaimRow label="Subject (sub)" value={payload.sub} glossary={CLAIM_GLOSSARY.sub} />
            </>
          ))}

          {renderSection('authorization', 'Authorization', '🔑', (
            <>
              <div className="utfi-claim-row">
                <span className="utfi-claim-key" title={CLAIM_GLOSSARY.scope} style={{ cursor: 'help', borderBottom: '1px dotted #94a3b8' }}>
                  Scopes
                </span>
                <ScopesBadges scope={payload.scope} tokenLabel={displayedTokenId || 'customer access token (BFF session)'} />
              </div>
              {!payload.scope && (
                <div className="utfi-rfc-inline-hint">RFC 6749 §3.3 — the <strong>customer access token</strong> (stored server-side in the BFF session after PingOne login) has no scope claim in its JWT payload. MCP tool calls require scoped tokens. Sign out and sign in with the PingOne <em>customer</em> app configured to request <code>read</code> / <code>write</code> scopes.</div>
              )}
              <ClaimRow label="Audience (aud)" value={Array.isArray(payload.aud) ? payload.aud.join(', ') : payload.aud} glossary={CLAIM_GLOSSARY.aud} />
              <ClaimRow label="Client ID" value={payload.client_id} glossary={CLAIM_GLOSSARY.client_id} />
              {payload.may_act && (
                <>
                  <ClaimRow label="may_act" value={payload.may_act} glossary={CLAIM_GLOSSARY.may_act} />
                  <div className="utfi-rfc-inline-hint utfi-rfc-inline-hint--good">✅ RFC 8693 §4.2 — may_act present. The BFF (client_id above) is pre-authorized to call Token Exchange on this user&apos;s behalf and obtain a delegated MCP token.</div>
                </>
              )}
              {!payload.may_act && payload.sub && (
                <div className="utfi-rfc-inline-hint">⚠️ RFC 8693 §4.2 — may_act absent. Token Exchange will fall back to subject-only mode (no act claim in MCP token, weaker delegation proof). Enable may_act in PingOne for full delegation.</div>
              )}
              {payload.act && (
                <div className="utfi-act-chain">
                  <span className="utfi-act-chain-label" title={CLAIM_GLOSSARY.act}>Actor chain (act) — RFC 8693 §4.1</span>
                  <code className="utfi-act-chain-value">{typeof payload.act === 'object' ? <JsonHighlight value={payload.act} /> : payload.act}</code>
                  <div className="utfi-rfc-inline-hint utfi-rfc-inline-hint--good">✅ act claim present — BFF identity is cryptographically bound in this token. MCP server can verify the delegation chain without trusting the caller.</div>
                </div>
              )}
              {payload.scope && (
                <div className="utfi-rfc-inline-hint utfi-rfc-inline-hint--info">RFC 6749 §3.3 · RFC 8693 §2.1 — Token Exchange can only narrow these scopes. The MCP token will carry a subset of what you see here.</div>
              )}
            </>
          ))}

          {(enrichedLoading || enrichedInfo?.error || hasAnyField(enrichedInfo?.data)) && renderSection('account', 'Account Information', '📋', (
            <>
              {enrichedLoading && <div className="utfi-muted">Loading PingOne profile…</div>}
              {enrichedInfo?.error && <div className="utfi-muted">⚠ {enrichedInfo.error}</div>}
              {enrichedInfo?.data && hasAnyField(enrichedInfo.data) && (
                <>
                  <ClaimRow label="Email" value={enrichedInfo.data.email} />
                  <ClaimRow label="Email Verified" value={enrichedInfo.data.email_verified != null ? String(enrichedInfo.data.email_verified) : null} />
                  <ClaimRow label="Phone" value={enrichedInfo.data.phone_number || enrichedInfo.data.phone} />
                </>
              )}
            </>
          ))}
        </div>

        <div style={{ display: activeTab === 'exchange' ? undefined : 'none' }}>
          {renderSection('tokenExchange', 'Token Exchange & Scopes', '🔄', (
            <>
              <TokenExchangeModeSummary
                tokens={[
                  { type: 'User', name: 'customer access token', issuedBy: 'PingOne AS', rfc8693Role: 'subject token' },
                  { type: 'Agent', name: 'BFF-delegated MCP token', issuedBy: 'PingOne AS (via RFC 8693)', rfc8693Role: 'delegated token' },
                  { type: 'MCP', name: 'resource-scoped access token', issuedBy: 'PingOne AS (RFC 8693 + 8707)', rfc8693Role: 'narrowed resource token' },
                ]}
              />
              <ScopeChangesCallout />
              <div className="utfi-token-exchange-events">
                {tokenExchangeEvents.length === 0 ? (
                  <div className="utfi-exchange-empty">
                    <p className="utfi-exchange-desc">Perform a banking action (transfer, deposit, etc.) to see token exchanges and scopes in real-time</p>
                    <div className="utfi-exchange-rfc-primer">
                      <div className="utfi-exchange-primer-row"><span className="utfi-primer-rfc">RFC 8693 §3.1</span> Subject token in → MCP access token out, scope narrowed, <code>act</code> claim added</div>
                      <div className="utfi-exchange-primer-row"><span className="utfi-primer-rfc">RFC 8707</span> <code>resource</code> parameter binds the new token to a single audience</div>
                      <div className="utfi-exchange-primer-row"><span className="utfi-primer-rfc">RFC 6749 §3.3</span> Exchange cannot grant scopes the user token doesn&apos;t already have</div>
                      <div className="utfi-exchange-primer-row"><span className="utfi-primer-rfc">RFC 9470</span> Step-up: if ACR is insufficient, the server challenges before exchange</div>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="utfi-exchange-desc">Real-time token lifecycle — scopes and claims as tokens are exchanged</p>
                    <div className="utfi-exchange-timeline">
                      {tokenExchangeEvents.map((evt, idx) => (
                        <div key={idx} className="utfi-exchange-event">
                          <div className="utfi-event-header">
                            <span className="utfi-event-time">{evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : 'N/A'}</span>
                            <span className={`utfi-event-status utfi-event-status--${evt.status || 'info'}`}>{evt.label || evt.id || 'Event'}</span>
                          </div>
                          <div className="utfi-event-details">
                            {evt.decoded?.payload && (
                              <div className="utfi-event-claims">
                                {evt.decoded.payload.scope && (
                                  <div className="utfi-event-row">
                                    <span className="utfi-event-label">Scopes:</span>
                                    <div className="utfi-scopes-inline">
                                      {typeof evt.decoded.payload.scope === 'string'
                                        ? evt.decoded.payload.scope.split(' ').map((s, i) => <span key={i} className="utfi-scope-badge">{s}</span>)
                                        : <span className="utfi-scope-badge">{evt.decoded.payload.scope}</span>}
                                    </div>
                                  </div>
                                )}
                                {evt.decoded.payload.aud && (
                                  <div className="utfi-event-row"><span className="utfi-event-label">Audience (aud):</span><code className="utfi-event-value">{evt.decoded.payload.aud}</code></div>
                                )}
                                {evt.decoded.payload.act && (
                                  <div className="utfi-event-row"><span className="utfi-event-label">Actor (act):</span><code className="utfi-event-value"><JsonHighlight value={evt.decoded.payload.act} /></code></div>
                                )}
                                {evt.decoded.payload.may_act && (
                                  <div className="utfi-event-row"><span className="utfi-event-label">May Act:</span><code className="utfi-event-value">✓ Delegation authorized</code></div>
                                )}
                                {evt.decoded.payload.sub && (
                                  <div className="utfi-event-row"><span className="utfi-event-label">Subject:</span><code className="utfi-event-value">{evt.decoded.payload.sub.slice(0, 16)}…</code></div>
                                )}
                                {evt.decoded.payload.acr && (
                                  <div className="utfi-event-row"><span className="utfi-event-label">Auth Level (acr):</span><span className="utfi-event-value">{evt.decoded.payload.acr}</span></div>
                                )}
                              </div>
                            )}
                            {evt.message && <div className="utfi-event-message">{evt.message}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          ))}
        </div>
      </div>
```

- [ ] **Step 6: Wire `FlowTokensPanel` into the tab body and remove now-dead state**

In the file's default-exported `UnifiedTokenFlowInspector` function, remove
the now-unused line:

```jsx
  const [selectedToken, setSelectedToken] = useState(null);
```

(It was only ever passed down to `AgentFlowSection`/`OAuthInspectorSection`,
both of which `FlowTokensPanel` now owns internally.)

Replace the `activeTab === 'flow'` branch:

```jsx
      {activeTab === 'flow' ? (
        <div className="utfi-content">
          <div className="utfi-left">
            <AgentFlowSection onSelectToken={setSelectedToken} selectedTokenId={selectedToken?.id} />
          </div>
          <div className="utfi-divider"></div>
          <div className="utfi-right">
            <OAuthInspectorSection selectedToken={selectedToken} onOpenClaimsModal={openClaimsModal} />
          </div>
        </div>
      ) : activeTab === 'chain' ? (
```

with:

```jsx
      {activeTab === 'flow' ? (
        <FlowTokensPanel onOpenClaimsModal={openClaimsModal} />
      ) : activeTab === 'chain' ? (
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/UnifiedTokenFlowInspector.test.jsx`
Expected: PASS (all tests, including the pre-existing Token Transform test)

- [ ] **Step 8: Run the full UI test suite to check for regressions**

Run: `cd demo_api_ui && npx vitest run`
Expected: PASS. If any unrelated test fails, check whether it renders
`UnifiedTokenFlowInspector` or `DevToolsDashboard` (both now render
`FlowTokensPanel`) — if so, it may need the same `activeTab`/tree-aware
assertions this task's Step 1 used; if it fails for an unrelated reason, stop
and investigate before continuing (don't paper over an unrelated break).

- [ ] **Step 9: Commit**

```bash
git add demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx demo_api_ui/src/components/UnifiedTokenFlowInspector.test.jsx
git commit -m "feat(agent-flow-inspector): redesign Flow & Tokens tab onto InspectorShell hybrid tree"
```

---

### Task 6: Manual verification + regression gate

**Files:** None (verification only).

- [ ] **Step 1: Start the dev stack**

Follow this repo's existing run instructions (`./run-docker.sh` or
`./run.sh` per `CLAUDE.md`) — do not invent a new startup method.

- [ ] **Step 2: Verify `/agent-flow-inspector` (docked)**

Sign in at `https://local.ping-devops.com:4000`, navigate to
`/agent-flow-inspector`. Confirm:
- "Flow & Tokens" tab shows the new tree (empty-state hint when no action has
  run yet).
- Trigger a banking agent action (e.g. "show my accounts"). Confirm phase
  groups appear in the tree, selecting a step shows its detail in the middle
  pane, and the right column's Claims/Token Exchange/Diagram/Raw/Glossary
  tabs all render real content.
- Trigger an action that gets denied (e.g. a transfer requiring step-up MFA
  without it). Confirm the resulting step renders with the red
  (`kind="step" dot="sensitive"`) tree icon, and the replay bar's "Denied"
  counter increments.
- Click "Token Chain" and "Token Transform" tabs — confirm both look and
  behave exactly as they did before this change (no code in those branches
  was touched, but confirm nothing broke via the shared modal state).
- Click the float/dock toggle (📌/⛓ button) — confirm the new layout renders
  correctly floating, draggable, and resizable, same as before.

- [ ] **Step 3: Verify the `DevToolsDashboard` embed**

Navigate to wherever `DevToolsDashboard.jsx` is mounted, open its
"Inspector" tab. Confirm the new layout fills the tab panel's height
(`fullHeight="fill"`) rather than overflowing or collapsing to zero height.

- [ ] **Step 4: Run the UI build gate**

Run: `cd demo_api_ui && npm run build`
Expected: builds with no errors (per `REGRESSION_PLAN.md` §0/§1 process for
changes touching a `§1`-adjacent UI surface).

- [ ] **Step 5: Run the full UI test suite one more time**

Run: `cd demo_api_ui && npx vitest run`
Expected: PASS, same result as Task 5 Step 8 (confirms nothing drifted while
doing manual verification).
