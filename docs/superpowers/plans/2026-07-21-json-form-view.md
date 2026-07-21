# JSON Form View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Form" output tab to three JSON-heavy inspector surfaces (PingGateway Inspector's JSON Config tab, PingOne MCP Inspector, Gateway Tester), each rendering the currently-shown JSON as labeled fields via one new shared component instead of raw text.

**Architecture:** One new component, `JsonFormView` (`demo_api_ui/src/components/shared/`), recursively flattens any JSON value into label/value rows (nested objects → indented sub-groups, arrays → indexed sub-groups), with a heuristic "Key Values" summary section for name-matched fields (id, status, amount, url, ...) on top of a full "All Fields" tree below. It is wired into three existing components as an additional read-only view — no new data fetching, no new backend routes, no changes to existing save/validate/execute logic.

**Tech Stack:** React (function components + hooks), Vitest + `@testing-library/react` for tests, existing `InspectorTabs`/`InspectorShell` shared components, existing `JsonHighlight` shared component (reused for its `deepParse` MCP-payload-unwrapping helper).

**Design spec:** `docs/superpowers/specs/2026-07-21-json-form-view-design.md` — read it if anything below is ambiguous; it wins over paraphrase.

## Global Constraints

- Read-only. No task in this plan adds editable form fields or a new save/write path — `AgentGatewayConfigEditor`'s existing Monaco + validate/save/restart flow is untouched; Form is an alternate display of the same in-memory value.
- Heuristic is name-pattern based and generic (substring match against a fixed word list) — never add a per-tool, per-file-type, or per-scenario field schema.
- Emoji allowlist only in any UI copy touched: `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`.
- Edit/test/commit only inside the isolated worktree already created for this work (`worktree-json-form-view`) — never the shared main checkout.
- `regression-guard`: every file this plan touches is inside `demo_api_ui/`, a protected area per `REGRESSION_PLAN.md` §1. Stated invariant for this whole plan: won't change what any existing tab/button does today (Response/Request/History/Result/Audit Trail/etc. keep their exact current behavior) — only adding one new "Form" tab alongside them, and one new Editor/Form toggle in `AgentGatewayConfigEditor` that doesn't touch Save/Revert/Restart/validate wiring.
- `cd demo_api_ui && npm run build` must exit `0` before any task is considered done.
- Test runner is **Vitest**, not Jest — use `vi.fn()`/`vi.mock()`, and run tests with `npx vitest run <path>` (not `npx jest ...`).
- Follow the existing shared-component import convention: `import X from './shared/X';` relative to `demo_api_ui/src/components/`.

---

### Task 1: `JsonFormView` shared component

**Files:**
- Modify: `demo_api_ui/src/components/shared/JsonHighlight.jsx` (export `deepParse`)
- Create: `demo_api_ui/src/components/shared/JsonFormView.jsx`
- Create: `demo_api_ui/src/components/shared/JsonFormView.css`
- Test: `demo_api_ui/src/components/shared/__tests__/JsonFormView.test.jsx`

**Interfaces:**
- Produces: `export default function JsonFormView({ value, emptyMessage = 'No data.' })` — a React component. `value` is any JSON-serializable value (object, array, primitive, `null`/`undefined`). Renders a "Key Values" summary section (only when at least one name-matched field exists) followed by an "All Fields" section with the full tree. No other props, no return value beyond JSX — later tasks only ever call `<JsonFormView value={...} />`, optionally with `emptyMessage`.
- Consumes: `deepParse` from `./JsonHighlight` (newly exported in this task) — normalizes MCP's common `{ text: "<escaped JSON string>" }` shape before rendering, matching what the existing `<JsonHighlight deep />` views already show.

- [ ] **Step 1: Export `deepParse` from `JsonHighlight.jsx`**

In `demo_api_ui/src/components/shared/JsonHighlight.jsx`, the function is currently private:

```js
function deepParse(value, depth = 0) {
```

Change to:

```js
export function deepParse(value, depth = 0) {
```

No other change to this file.

- [ ] **Step 2: Write the failing test**

Create `demo_api_ui/src/components/shared/__tests__/JsonFormView.test.jsx`:

```jsx
// demo_api_ui/src/components/shared/__tests__/JsonFormView.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import JsonFormView from '../JsonFormView';

describe('JsonFormView', () => {
  it('renders a nested object as grouped label/value rows', () => {
    render(<JsonFormView value={{ account: { openedOn: '2024-01-01', notes: 'first account' } }} />);
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Opened On')).toBeInTheDocument();
    expect(screen.getByText('2024-01-01')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('first account')).toBeInTheDocument();
    expect(screen.queryByText('Key Values')).toBeNull();
  });

  it('renders an array of primitives as Item rows', () => {
    render(<JsonFormView value={{ scopes: ['read', 'write'] }} />);
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('read')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    expect(screen.getByText('write')).toBeInTheDocument();
  });

  it('renders an array of objects as indexed sub-groups', () => {
    render(<JsonFormView value={{ accounts: [{ openedOn: '2024' }, { openedOn: '2025' }] }} />);
    expect(screen.getAllByText(/Item \d/)).toHaveLength(2);
    expect(screen.getByText('2024')).toBeInTheDocument();
    expect(screen.getByText('2025')).toBeInTheDocument();
  });

  it('renders a null leaf as a muted dash, not omitted', () => {
    render(<JsonFormView value={{ favoriteColor: null }} />);
    expect(screen.getByText('Favorite Color')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('truncates long string values with a Show more toggle', () => {
    const long = 'x'.repeat(200);
    render(<JsonFormView value={{ token: long }} />);
    expect(screen.getByText(`${'x'.repeat(120)}…`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getByText(long)).toBeInTheDocument();
  });

  it('collects name-matched keys into a Key Values summary, without removing them from All Fields', () => {
    render(<JsonFormView value={{ account: { accountId: 'acc_1', favoriteColor: 'blue' } }} />);
    expect(screen.getByText('Key Values')).toBeInTheDocument();
    expect(screen.getByText('All Fields')).toBeInTheDocument();
    expect(screen.getByText('Account › Account Id')).toBeInTheDocument();
    expect(screen.getAllByText('acc_1')).toHaveLength(2);
    expect(screen.getByText('blue')).toBeInTheDocument();
  });

  it('shows the empty message when value is null, undefined, or an empty object', () => {
    const { rerender } = render(<JsonFormView value={null} />);
    expect(screen.getByText('No data.')).toBeInTheDocument();
    rerender(<JsonFormView value={{}} emptyMessage="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/shared/__tests__/JsonFormView.test.jsx`
Expected: FAIL — `Failed to resolve import "../JsonFormView"` (file doesn't exist yet).

- [ ] **Step 4: Write `JsonFormView.jsx`**

Create `demo_api_ui/src/components/shared/JsonFormView.jsx`:

```jsx
// demo_api_ui/src/components/shared/JsonFormView.jsx
import React, { useCallback, useState } from 'react';
import { deepParse } from './JsonHighlight';
import './JsonFormView.css';

// Keys whose value renders in the "Key Values" summary section in addition
// to its place in the full "All Fields" tree. Generic, name-pattern based —
// deliberately not shape-aware (see design spec's Non-goals).
const IMPORTANT_KEY_WORDS = [
  'id', 'name', 'status', 'amount', 'balance', 'url', 'scope', 'audience',
  'type', 'label', 'email', 'role', 'code', 'message', 'state',
];

const LONG_STRING_LIMIT = 120;

function isImportantKey(key) {
  const lower = key.toLowerCase();
  return IMPORTANT_KEY_WORDS.some((w) => lower.includes(w));
}

function humanizeKey(key) {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ');
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(String(text)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [text]);
  return (
    <button type="button" className="jfv-copy" onClick={copy}>
      {copied ? '✅' : 'Copy'}
    </button>
  );
}

function LeafValue({ value }) {
  const [expanded, setExpanded] = useState(false);
  if (value === null || value === undefined) {
    return <span className="jfv-empty">—</span>;
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const isLong = text.length > LONG_STRING_LIMIT;
  const shown = isLong && !expanded ? `${text.slice(0, LONG_STRING_LIMIT)}…` : text;
  return (
    <span className="jfv-value">
      <span className="jfv-value-text">{shown}</span>
      {isLong && (
        <button type="button" className="jfv-expand" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
      <CopyButton text={text} />
    </span>
  );
}

// Plain recursive function (NOT a React component) so pushes into
// `keyValues` happen synchronously while building the tree, before
// JsonFormView decides whether to render the "Key Values" section.
function buildRows(value, path, keyValues) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <div className="jfv-row jfv-empty">Empty list</div>;
    }
    return (
      <>
        {value.map((item, i) => {
          const itemPath = `${path}[${i}]`;
          if (isPlainObject(item) || Array.isArray(item)) {
            return (
              <div className="jfv-subgroup" key={i}>
                <div className="jfv-subgroup-label">Item {i + 1}</div>
                {buildRows(item, itemPath, keyValues)}
              </div>
            );
          }
          return (
            <div className="jfv-row" key={i}>
              <span className="jfv-label">Item {i + 1}</span>
              <LeafValue value={item} />
            </div>
          );
        })}
      </>
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <div className="jfv-row jfv-empty">No fields</div>;
    }
    return (
      <>
        {entries.map(([key, val]) => {
          const fieldPath = path ? `${path}.${key}` : key;
          if (isPlainObject(val) || Array.isArray(val)) {
            return (
              <div className="jfv-subgroup" key={key}>
                <div className="jfv-subgroup-label">{humanizeKey(key)}</div>
                {buildRows(val, fieldPath, keyValues)}
              </div>
            );
          }
          if (isImportantKey(key)) {
            keyValues.push({
              path: fieldPath,
              label: humanizeKey(fieldPath.replace(/\./g, ' › ')),
              value: val,
            });
          }
          return (
            <div className="jfv-row" key={key}>
              <span className="jfv-label">{humanizeKey(key)}</span>
              <LeafValue value={val} />
            </div>
          );
        })}
      </>
    );
  }

  return (
    <div className="jfv-row">
      <LeafValue value={value} />
    </div>
  );
}

export default function JsonFormView({ value, emptyMessage = 'No data.' }) {
  const normalized = deepParse(value);
  const isEmpty =
    normalized === null ||
    normalized === undefined ||
    (isPlainObject(normalized) && Object.keys(normalized).length === 0);

  if (isEmpty) {
    return <div className="jfv-empty-state">{emptyMessage}</div>;
  }

  const keyValues = [];
  const tree = buildRows(normalized, '', keyValues);

  return (
    <div className="jfv-root">
      {keyValues.length > 0 && (
        <div className="jfv-section">
          <div className="jfv-section-title">Key Values</div>
          <div className="jfv-group">
            {keyValues.map((kv) => (
              <div className="jfv-row" key={kv.path}>
                <span className="jfv-label">{kv.label}</span>
                <LeafValue value={kv.value} />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="jfv-section">
        <div className="jfv-section-title">All Fields</div>
        <div className="jfv-group">{tree}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write `JsonFormView.css`**

Create `demo_api_ui/src/components/shared/JsonFormView.css`:

```css
/* demo_api_ui/src/components/shared/JsonFormView.css */
.jfv-root {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  font-size: 0.85rem;
}
.jfv-section-title {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 0.5rem;
}
.jfv-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.jfv-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid #f1f5f9;
}
.jfv-label {
  flex: 0 0 220px;
  color: #475569;
  font-weight: 600;
}
.jfv-value {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  min-width: 0;
  word-break: break-word;
  color: #0f172a;
}
.jfv-value-text {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 0.82rem;
}
.jfv-empty {
  color: #94a3b8;
  font-style: italic;
}
.jfv-empty-state {
  color: #94a3b8;
  font-style: italic;
  padding: 1rem 0;
}
.jfv-subgroup {
  margin-left: 1rem;
  padding-left: 0.75rem;
  border-left: 2px solid #e2e8f0;
  margin-top: 0.35rem;
}
.jfv-subgroup-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: #334155;
  margin-bottom: 0.25rem;
}
.jfv-expand,
.jfv-copy {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #334155;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.1rem 0.4rem;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.jfv-expand:hover,
.jfv-copy:hover {
  background: #f1f5f9;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/shared/__tests__/JsonFormView.test.jsx`
Expected: PASS — 7 tests.

If the "Key Values" test fails on the exact label text, print the rendered DOM (`screen.debug()`) and adjust the test's expected string to match — the `humanizeKey`/path-join logic above is the source of truth, not the test's guess at its output.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/shared/JsonHighlight.jsx \
        demo_api_ui/src/components/shared/JsonFormView.jsx \
        demo_api_ui/src/components/shared/JsonFormView.css \
        demo_api_ui/src/components/shared/__tests__/JsonFormView.test.jsx
git commit -m "feat(json-form-view): add shared JsonFormView component"
```

---

### Task 2: Wire Form view into `AgentGatewayConfigEditor` (PingGateway Inspector → JSON Config tab)

**Files:**
- Modify: `demo_api_ui/src/components/AgentGatewayConfigEditor.jsx`
- Modify: `demo_api_ui/src/components/AgentGatewayConfigEditor.css`
- Create: `demo_api_ui/src/components/__tests__/AgentGatewayConfigEditor.test.jsx`

**Interfaces:**
- Consumes: `JsonFormView` from Task 1 (`import JsonFormView from './shared/JsonFormView';`), prop `value` (parsed JS object) and `emptyMessage` (string).
- Produces: no new exports — this task only adds internal `viewMode` state and JSX branching to an existing default-exported component.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/AgentGatewayConfigEditor.test.jsx`:

```jsx
// demo_api_ui/src/components/__tests__/AgentGatewayConfigEditor.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import apiClient from '../../services/apiClient';
import AgentGatewayConfigEditor from '../AgentGatewayConfigEditor';

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// Stub Monaco — we only test the Editor/Form toggle wiring, not Monaco internals.
vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({ value, onChange }) => (
    <textarea
      data-testid="monaco"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const FILE_LIST = {
  files: [{ id: 'ig-config', label: 'IG Config', group: 'Gateway', reloadMode: 'auto' }],
  restart: { enabled: true, socket: true },
};

const FILE_DETAIL = {
  type: 'ig-config',
  reloadMode: 'auto',
  label: 'IG Config',
  raw: JSON.stringify({ description: 'Gateway route file', streamingEnabled: true }, null, 2),
};

function mockEndpoints() {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/admin/agent-gateway/files') return Promise.resolve({ data: FILE_LIST });
    if (url === '/api/admin/agent-gateway/files/ig-config') return Promise.resolve({ data: FILE_DETAIL });
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEndpoints();
});

test('defaults to Editor view showing the raw JSON in Monaco', async () => {
  render(<AgentGatewayConfigEditor />);
  const monaco = await screen.findByTestId('monaco');
  expect(monaco).toHaveValue(FILE_DETAIL.raw);
  expect(screen.queryByText('Description')).toBeNull();
});

test('switching to Form view renders the parsed JSON as labeled fields', async () => {
  render(<AgentGatewayConfigEditor />);
  await screen.findByTestId('monaco');
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  expect(screen.queryByTestId('monaco')).toBeNull();
  expect(screen.getByText('Description')).toBeInTheDocument();
  expect(screen.getByText('Gateway route file')).toBeInTheDocument();
  expect(screen.getByText('Streaming Enabled')).toBeInTheDocument();
});

test('switching back to Editor view restores Monaco with the current value', async () => {
  render(<AgentGatewayConfigEditor />);
  await screen.findByTestId('monaco');
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  fireEvent.click(screen.getByRole('button', { name: 'Editor' }));
  expect(await screen.findByTestId('monaco')).toHaveValue(FILE_DETAIL.raw);
});

test('shows a parse-error notice in Form view instead of crashing when JSON is invalid', async () => {
  render(<AgentGatewayConfigEditor />);
  const monaco = await screen.findByTestId('monaco');
  fireEvent.change(monaco, { target: { value: '{ invalid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  expect(screen.getByText(/Fix JSON in Editor view first/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AgentGatewayConfigEditor.test.jsx`
Expected: FAIL — "Form"/"Editor" buttons don't exist yet (the toggle isn't wired in).

- [ ] **Step 3: Add the `JsonFormView` import and `viewMode` state**

In `demo_api_ui/src/components/AgentGatewayConfigEditor.jsx`, change:

```jsx
import apiClient from '../services/apiClient';
import { notifyError, notifySuccess, notifyWarning } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import './AgentGatewayConfigEditor.css';
```

to:

```jsx
import apiClient from '../services/apiClient';
import { notifyError, notifySuccess, notifyWarning } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import JsonFormView from './shared/JsonFormView';
import './AgentGatewayConfigEditor.css';
```

Then change:

```jsx
  const [loadingFile, setLoadingFile] = useState(false);

  const editorRef = useRef(null);
```

to:

```jsx
  const [loadingFile, setLoadingFile] = useState(false);
  const [viewMode, setViewMode] = useState('editor'); // 'editor' | 'form'

  const editorRef = useRef(null);
```

Then change:

```jsx
  const dirty = editorValue !== baseline;
  const hasErrors = errors.some((e) => e.level === 'error');
```

to:

```jsx
  const dirty = editorValue !== baseline;
  const hasErrors = errors.some((e) => e.level === 'error');

  let formValue = null;
  let formParseError = null;
  try {
    formValue = editorValue ? JSON.parse(editorValue) : null;
  } catch (e) {
    formParseError = e.message;
  }
```

- [ ] **Step 4: Add the Editor/Form toggle buttons to the toolbar**

Change:

```jsx
          <div className="agc-toolbar">
            <span className="agc-current">{meta?.label || '—'}</span>
            <span className="agc-spacer" />
            {validating && <span className="agc-muted">validating…</span>}
```

to:

```jsx
          <div className="agc-toolbar">
            <span className="agc-current">{meta?.label || '—'}</span>
            <span className="agc-spacer" />
            <button
              type="button"
              className={`agc-btn${viewMode === 'editor' ? ' agc-btn--active' : ''}`}
              onClick={() => setViewMode('editor')}
            >
              Editor
            </button>
            <button
              type="button"
              className={`agc-btn${viewMode === 'form' ? ' agc-btn--active' : ''}`}
              onClick={() => setViewMode('form')}
            >
              Form
            </button>
            {validating && <span className="agc-muted">validating…</span>}
```

- [ ] **Step 5: Branch the main pane on `viewMode`**

Change:

```jsx
          <div className="agc-editor">
            <Monaco
              language="json"
              value={editorValue}
              onChange={onEditorChange}
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: false },
                formatOnPaste: true,
                fontSize: 13,
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>
```

to:

```jsx
          {viewMode === 'editor' ? (
            <div className="agc-editor">
              <Monaco
                language="json"
                value={editorValue}
                onChange={onEditorChange}
                onMount={handleEditorMount}
                options={{
                  minimap: { enabled: false },
                  formatOnPaste: true,
                  fontSize: 13,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            </div>
          ) : (
            <div className="agc-editor agc-editor--form">
              {formParseError ? (
                <div className="agc-form-parse-error">
                  Fix JSON in Editor view first: {formParseError}
                </div>
              ) : (
                <JsonFormView value={formValue} emptyMessage="No file loaded." />
              )}
            </div>
          )}
```

- [ ] **Step 6: Add the new CSS rules**

In `demo_api_ui/src/components/AgentGatewayConfigEditor.css`, change:

```css
.agc-btn--warn { background: #d97706; border-color: #d97706; color: #fff; }
.agc-btn--warn:hover:not(:disabled) { background: #b45309; }
```

to:

```css
.agc-btn--warn { background: #d97706; border-color: #d97706; color: #fff; }
.agc-btn--warn:hover:not(:disabled) { background: #b45309; }
.agc-btn--active { background: #1e293b; border-color: #1e293b; color: #fff; }
.agc-btn--active:hover:not(:disabled) { background: #0f172a; }
```

And change:

```css
.agc-editor { height: 460px; }
```

to:

```css
.agc-editor { height: 460px; }
.agc-editor--form {
  overflow-y: auto;
  padding: 1rem 1.25rem;
}
.agc-form-parse-error {
  padding: 1rem 1.25rem;
  color: #991b1b;
  font-size: 0.85rem;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AgentGatewayConfigEditor.test.jsx`
Expected: PASS — 4 tests.

- [ ] **Step 8: Run the full UI build gate**

Run: `cd demo_api_ui && npm run build`
Expected: exit `0`.

- [ ] **Step 9: Commit**

```bash
git add demo_api_ui/src/components/AgentGatewayConfigEditor.jsx \
        demo_api_ui/src/components/AgentGatewayConfigEditor.css \
        demo_api_ui/src/components/__tests__/AgentGatewayConfigEditor.test.jsx
git commit -m "feat(json-form-view): add Editor/Form toggle to AgentGatewayConfigEditor"
```

---

### Task 3: Wire Form tab into `McpInspectorPage` (PingOne MCP Inspector — all 4 sources)

**Files:**
- Modify: `demo_api_ui/src/components/McpInspectorPage.jsx`
- Modify: `demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx`

**Interfaces:**
- Consumes: `JsonFormView` from Task 1 (`import JsonFormView from './shared/JsonFormView';`).

This page has 4 near-duplicate "source" hooks, each with its own `InspectorTabs` array and output-rendering logic. All 4 get the same shape of change: add a `{ key: 'form', label: 'Form' }` tab entry, and render `<JsonFormView value={...} />` (using the same value the `'response'` tab already shows) when `outputTab === 'form'`.

- [ ] **Step 1: Write the failing tests**

In `demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx`, add these 4 tests (append to the end of the file, before the final closing — each reuses an existing helper/fixture already defined earlier in the file):

```jsx
test('the Form tab renders the Banking MCP response as labeled fields', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { currency: 'USD', available: 4820.15 } });
  renderPage('/pingone-mcp-inspector?source=banking');
  fireEvent.click(await screen.findByText('get_account_balance'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'acc_1' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText(/4820.15/);
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  expect(screen.getByText('Currency')).toBeInTheDocument();
  expect(screen.getByText('USD')).toBeInTheDocument();
  expect(screen.getByText('Available')).toBeInTheDocument();
});

test('the Form tab renders the PingOne MCP response as labeled fields', async () => {
  mockPingOneEndpoints();
  apiClient.post.mockResolvedValueOnce({
    data: { response: { handle: 'jdoe', enabled: true }, request: {}, timingsMs: { roundTrip: 12 } },
  });
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: 'PingOne MCP' }));
  fireEvent.click(await screen.findByText('users.read'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user-1' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  expect(screen.getByText('Handle')).toBeInTheDocument();
  expect(screen.getByText('jdoe')).toBeInTheDocument();
  expect(screen.getByText('Enabled')).toBeInTheDocument();
});

test('the Form tab renders a captured API call response body as labeled fields', async () => {
  const formCall = {
    id: 'c2', method: 'GET', url: '/api/accounts/acc_2', success: true,
    response: { status: 200, body: { notes: 'checking account', pending: false } },
    request: { headers: {} }, durationMs: 21,
  };
  global.fetch = vi.fn((url, opts) => {
    if (opts?.method === 'DELETE') return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ calls: [formCall], stats: { total: 1, success: 1, errors: 0 } }) });
  });
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: 'API Calls' }));
  fireEvent.click(await screen.findByText('/api/accounts/acc_2'));
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  expect(screen.getByText('Notes')).toBeInTheDocument();
  expect(screen.getByText('checking account')).toBeInTheDocument();
  expect(screen.getByText('Pending')).toBeInTheDocument();
});

test('the Form tab renders the Custom Server response as labeled fields', async () => {
  mockCustomServerEndpoints();
  apiClient.post.mockResolvedValueOnce({ data: { query: 'weather today', results: 3 } });
  renderPage('/pingone-mcp-inspector?source=custom');
  fireEvent.click(await screen.findByText('brave_web_search'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'weather today' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  expect(screen.getByText('Query')).toBeInTheDocument();
  expect(screen.getByText('weather today')).toBeInTheDocument();
  expect(screen.getByText('Results')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/McpInspectorPage.test.jsx`
Expected: the 4 new tests FAIL (no "Form" button exists yet); all pre-existing tests in this file still PASS.

- [ ] **Step 3: Add the `JsonFormView` import**

Change:

```jsx
import JsonHighlight from './shared/JsonHighlight';
import InspectorShell from './shared/InspectorShell';
import InspectorTabs from './shared/InspectorTabs';
```

to:

```jsx
import JsonHighlight from './shared/JsonHighlight';
import JsonFormView from './shared/JsonFormView';
import InspectorShell from './shared/InspectorShell';
import InspectorTabs from './shared/InspectorTabs';
```

- [ ] **Step 4: Wire `useBankingSource` (tabs array + `outputContent` resolver + render)**

Change:

```jsx
  const outputContent = useMemo(() => {
    if (!lastInvoke && !lastTiming) return null;
    if (outputTab === 'response') return lastInvoke ?? null;
    if (outputTab === 'request') {
      return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: selectedTool?.name, arguments: paramValues } };
    }
    if (outputTab === 'history') return mcpHistory;
    return null;
  }, [outputTab, lastInvoke, lastTiming, selectedTool, paramValues, mcpHistory]);
```

to:

```jsx
  const outputContent = useMemo(() => {
    if (!lastInvoke && !lastTiming) return null;
    if (outputTab === 'response' || outputTab === 'form') return lastInvoke ?? null;
    if (outputTab === 'request') {
      return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: selectedTool?.name, arguments: paramValues } };
    }
    if (outputTab === 'history') return mcpHistory;
    return null;
  }, [outputTab, lastInvoke, lastTiming, selectedTool, paramValues, mcpHistory]);
```

Change:

```jsx
        <InspectorTabs
          tabs={[
            { key: 'response', label: 'Response' },
            { key: 'request', label: 'Request' },
            { key: 'history', label: `History (${mcpHistory.length})` },
          ]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
        {outputContent ? (
          <>
            <div className="inspector-shell-output-body">
              <pre className="inspector-shell-output-code"><JsonHighlight value={outputContent} deep /></pre>
            </div>
```

to:

```jsx
        <InspectorTabs
          tabs={[
            { key: 'response', label: 'Response' },
            { key: 'request', label: 'Request' },
            { key: 'history', label: `History (${mcpHistory.length})` },
            { key: 'form', label: 'Form' },
          ]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
        {outputContent ? (
          <>
            <div className="inspector-shell-output-body">
              <pre className="inspector-shell-output-code">
                {outputTab === 'form' ? <JsonFormView value={outputContent} /> : <JsonHighlight value={outputContent} deep />}
              </pre>
            </div>
```

(This block appears once for `useBankingSource` — verify with `grep -n "History (\${mcpHistory.length})" demo_api_ui/src/components/McpInspectorPage.jsx` that you're editing the first of its two occurrences here, and the second one in Step 6 below.)

- [ ] **Step 5: Wire `usePingOneSource` (inline tabs array + inline ternary)**

Change:

```jsx
        <InspectorTabs
          tabs={[{ key: 'response', label: 'Response' }, { key: 'request', label: 'Request' }]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
```

to:

```jsx
        <InspectorTabs
          tabs={[{ key: 'response', label: 'Response' }, { key: 'request', label: 'Request' }, { key: 'form', label: 'Form' }]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
```

Change:

```jsx
              <pre className="inspector-shell-output-code">
                <JsonHighlight value={outputTab === 'response' ? lastCall.response : lastCall.request} deep />
              </pre>
```

to:

```jsx
              <pre className="inspector-shell-output-code">
                {outputTab === 'form' ? (
                  <JsonFormView value={lastCall.response} />
                ) : (
                  <JsonHighlight value={outputTab === 'response' ? lastCall.response : lastCall.request} deep />
                )}
              </pre>
```

- [ ] **Step 6: Wire `useApiCallsSource` (inline tabs array + 3 inline conditionals)**

Change:

```jsx
        <InspectorTabs
          tabs={[{ key: 'response', label: 'Response Body' }, { key: 'request', label: 'Request Body' }, { key: 'headers', label: 'Headers' }]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
```

to:

```jsx
        <InspectorTabs
          tabs={[
            { key: 'response', label: 'Response Body' },
            { key: 'request', label: 'Request Body' },
            { key: 'headers', label: 'Headers' },
            { key: 'form', label: 'Form' },
          ]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
```

Change:

```jsx
                {outputTab === 'response' && (selectedCall.response?.body ? <JsonHighlight value={selectedCall.response.body} /> : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No response body captured</span>)}
                {outputTab === 'request' && (selectedCall.request?.body ? <JsonHighlight value={selectedCall.request.body} /> : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No request body</span>)}
                {outputTab === 'headers' && (selectedCall.request?.headers && Object.keys(selectedCall.request.headers).length > 0 ? <JsonHighlight value={selectedCall.request.headers} /> : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No headers captured</span>)}
```

to:

```jsx
                {outputTab === 'response' && (selectedCall.response?.body ? <JsonHighlight value={selectedCall.response.body} /> : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No response body captured</span>)}
                {outputTab === 'request' && (selectedCall.request?.body ? <JsonHighlight value={selectedCall.request.body} /> : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No request body</span>)}
                {outputTab === 'headers' && (selectedCall.request?.headers && Object.keys(selectedCall.request.headers).length > 0 ? <JsonHighlight value={selectedCall.request.headers} /> : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No headers captured</span>)}
                {outputTab === 'form' && (selectedCall.response?.body ? <JsonFormView value={selectedCall.response.body} /> : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No response body captured</span>)}
```

- [ ] **Step 7: Wire `useCustomServerSource` (multi-line tabs array + `outputContent` resolver + render)**

Change:

```jsx
  const outputContent = useMemo(() => {
    if (!lastInvoke && !lastTiming) return null;
    if (outputTab === 'response') {
      if (lastInvoke?.frames?.response) return lastInvoke.frames.response;
      if (lastInvoke) return lastInvoke;
      return null;
    }
    if (outputTab === 'request') {
      if (lastInvoke?.frames?.request) return lastInvoke.frames.request;
      return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: selectedTool?.name, arguments: paramValues } };
    }
    if (outputTab === 'history') return mcpHistory;
    return null;
  }, [outputTab, lastInvoke, lastTiming, selectedTool, paramValues, mcpHistory]);
```

to:

```jsx
  const outputContent = useMemo(() => {
    if (!lastInvoke && !lastTiming) return null;
    if (outputTab === 'response' || outputTab === 'form') {
      if (lastInvoke?.frames?.response) return lastInvoke.frames.response;
      if (lastInvoke) return lastInvoke;
      return null;
    }
    if (outputTab === 'request') {
      if (lastInvoke?.frames?.request) return lastInvoke.frames.request;
      return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: selectedTool?.name, arguments: paramValues } };
    }
    if (outputTab === 'history') return mcpHistory;
    return null;
  }, [outputTab, lastInvoke, lastTiming, selectedTool, paramValues, mcpHistory]);
```

Change:

```jsx
        <InspectorTabs
          tabs={[
            { key: 'response', label: 'Response' },
            { key: 'request', label: 'Request JSON-RPC' },
            { key: 'history', label: `History (${mcpHistory.length})` },
          ]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
        {outputContent ? (
          <>
            <div className="inspector-shell-output-body">
              <pre className="inspector-shell-output-code"><JsonHighlight value={outputContent} deep /></pre>
            </div>
```

to:

```jsx
        <InspectorTabs
          tabs={[
            { key: 'response', label: 'Response' },
            { key: 'request', label: 'Request JSON-RPC' },
            { key: 'history', label: `History (${mcpHistory.length})` },
            { key: 'form', label: 'Form' },
          ]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
        {outputContent ? (
          <>
            <div className="inspector-shell-output-body">
              <pre className="inspector-shell-output-code">
                {outputTab === 'form' ? <JsonFormView value={outputContent} /> : <JsonHighlight value={outputContent} deep />}
              </pre>
            </div>
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/McpInspectorPage.test.jsx`
Expected: PASS — all pre-existing tests plus the 4 new ones.

If a test fails because a hook's actual response-fetch endpoint, payload shape, or field name differs slightly from what's assumed above, fix the test to match the component's real behavior — don't change the component to match a wrong guess in the test.

- [ ] **Step 9: Run the full UI build gate**

Run: `cd demo_api_ui && npm run build`
Expected: exit `0`.

- [ ] **Step 10: Commit**

```bash
git add demo_api_ui/src/components/McpInspectorPage.jsx \
        demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx
git commit -m "feat(json-form-view): add Form tab to all 4 McpInspectorPage sources"
```

---

### Task 4: Wire Form tab into `AgentGatewayTester` (Gateway Tester)

**Files:**
- Modify: `demo_api_ui/src/components/AgentGatewayTester.jsx`
- Modify: `demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx`

**Interfaces:**
- Consumes: `JsonFormView` from Task 1 (`import JsonFormView from './shared/JsonFormView';`).

- [ ] **Step 1: Write the failing test**

Append to `demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx`:

```jsx
test('the Form tab renders the gateway test result as labeled fields', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: { tools: [{ name: 'get_my_accounts', description: 'List accounts.', inputSchema: { type: 'object', properties: {}, required: [] } }], _source: 'live' },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post.mockResolvedValueOnce({ data: { ok: true, result: { currency: 'USD', count: 2 }, durationMs: 42 } });
  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('get_my_accounts'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  expect(screen.getByText('Currency')).toBeInTheDocument();
  expect(screen.getByText('USD')).toBeInTheDocument();
  expect(screen.getByText('Count')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AgentGatewayTester.test.jsx`
Expected: the new test FAILS (no "Form" button exists yet); pre-existing tests still PASS.

- [ ] **Step 3: Add the `JsonFormView` import**

Change:

```jsx
import JsonHighlight from './shared/JsonHighlight';
import InspectorShell from './shared/InspectorShell';
import InspectorTabs from './shared/InspectorTabs';
```

to:

```jsx
import JsonHighlight from './shared/JsonHighlight';
import JsonFormView from './shared/JsonFormView';
import InspectorShell from './shared/InspectorShell';
import InspectorTabs from './shared/InspectorTabs';
```

- [ ] **Step 4: Add the tab entry**

Change:

```jsx
          <InspectorTabs
            tabs={[
              { key: 'result', label: 'Result' },
              { key: 'audit', label: 'Audit Trail' },
              { key: 'authorize', label: 'Authorize Decision' },
              { key: 'mcpAudit', label: 'McpAudit (5W1H)' },
            ]}
            activeKey={outputTab}
            onChange={setOutputTab}
          />
```

to:

```jsx
          <InspectorTabs
            tabs={[
              { key: 'result', label: 'Result' },
              { key: 'audit', label: 'Audit Trail' },
              { key: 'authorize', label: 'Authorize Decision' },
              { key: 'mcpAudit', label: 'McpAudit (5W1H)' },
              { key: 'form', label: 'Form' },
            ]}
            activeKey={outputTab}
            onChange={setOutputTab}
          />
```

- [ ] **Step 5: Add the render branch**

Change:

```jsx
                  {outputTab === 'result' && <JsonHighlight value={resultValue} />}
```

to:

```jsx
                  {outputTab === 'result' && <JsonHighlight value={resultValue} />}
                  {outputTab === 'form' && <JsonFormView value={resultValue} />}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AgentGatewayTester.test.jsx`
Expected: PASS — all pre-existing tests plus the new one.

- [ ] **Step 7: Run the full UI build gate**

Run: `cd demo_api_ui && npm run build`
Expected: exit `0`.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/components/AgentGatewayTester.jsx \
        demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx
git commit -m "feat(json-form-view): add Form tab to AgentGatewayTester"
```

---

### Task 5: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full UI unit test suite**

Run: `cd demo_api_ui && npx vitest run`
Expected: PASS, no regressions in any other file.

- [ ] **Step 2: Run the full UI build gate**

Run: `cd demo_api_ui && npm run build`
Expected: exit `0`.

- [ ] **Step 3: Manual click-through (per `inspector-template` skill's shared verification)**

With the dev server running against this worktree's UI (or after `npm run build`, serving `build/`), for each of the three surfaces:

1. `/pinggateway-inspector` → JSON Config tab → select a file → click **Form** → confirm labeled fields render, Key Values section appears when the file has an `id`/`type`/`status`-ish field, click **Editor** → confirm Monaco still shows the same raw JSON and Save/Revert still work unchanged.
2. `/pingone-mcp-inspector` → for each of the 4 source pills (PingOne MCP / Banking MCP / API Calls / Custom Server): select a tool/call, execute it, click **Form** → confirm labeled fields render; click back to **Response**/**Response Body** → confirm raw JSON view is unchanged.
3. `/pinggateway-inspector` → Gateway Tester tab → select a tool, execute, click **Form** → confirm labeled fields render; click back to **Result** → confirm raw JSON view is unchanged.

- [ ] **Step 4: Confirm no emoji outside the allowlist were introduced**

Run: `grep -rn '[^\x00-\x7F]' demo_api_ui/src/components/shared/JsonFormView.jsx demo_api_ui/src/components/shared/JsonFormView.css demo_api_ui/src/components/AgentGatewayConfigEditor.jsx demo_api_ui/src/components/AgentGatewayConfigEditor.css demo_api_ui/src/components/McpInspectorPage.jsx demo_api_ui/src/components/AgentGatewayTester.jsx`
Expected: only the pre-existing `✅` in `JsonFormView.jsx`'s `CopyButton` (allowlisted) and the `—`/`›` typographic characters used as visual separators (not emoji) — no new disallowed emoji.

- [ ] **Step 5: Update the design spec's status if anything changed during implementation**

If any assumption in `docs/superpowers/specs/2026-07-21-json-form-view-design.md` turned out wrong during Steps 1–4 above (e.g. an endpoint shape, a field name), amend the spec to match reality and commit that alongside a note of what changed and why.
