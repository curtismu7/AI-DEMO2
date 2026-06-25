# MCP Smart Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-fill, copyable values, and smart param controls to `WebMcpPanel` and `McpGatewayConfig` so UUIDs/URLs carry forward between steps and tool params use the right control type.

**Architecture:** A shared `McpFieldContext` (React context + `useReducer`) stores field values keyed by `MCP_FIELD_KEYS` constants. `useMcpFieldState(key)` reads/writes from any component. `CopyableValue` is the display primitive (filled value + fused copy button). Three smart param controls (`McpParamSelect`, `McpParamToggle`, `McpParamSuggest`) replace plain inputs in `WebMcpPanel`. After a tool call succeeds, result extraction writes account/user lists into context for downstream dropdowns. The wizard seeds auto-filled fields from `data.config.*` on mount.

**Tech Stack:** React 18, CommonJS (`.js`) and JSX (`.jsx`), CSS modules via plain `.css` files, existing `navigator.clipboard` API, existing BFF endpoints `/api/accounts/my` and `/api/admin/agent/lookup`.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `demo_api_ui/src/constants/mcpFieldKeys.js` | String key registry — single source of truth for all field keys |
| Create | `demo_api_ui/src/context/McpFieldContext.js` | Context + `McpFieldProvider` + `useMcpField` low-level hook |
| Create | `demo_api_ui/src/hooks/useMcpFieldState.js` | Public hook: `{ value, setValue, source, clear }` |
| Create | `demo_api_ui/src/components/CopyableValue.jsx` | Display: label + chip + value row + copy button |
| Create | `demo_api_ui/src/components/CopyableValue.css` | All visual states: required/filled/autofill + chips |
| Create | `demo_api_ui/src/components/McpParamSelect.jsx` | Dropdown param control with options from context or hardcoded |
| Create | `demo_api_ui/src/components/McpParamToggle.jsx` | Boolean toggle: radio pair (freeze) or checkbox (confirm/boolean) |
| Create | `demo_api_ui/src/components/McpParamSuggest.jsx` | Free-text input + suggestion chip row below |
| Create | `demo_api_ui/src/__tests__/McpFieldContext.test.js` | Unit tests for context reducer + hook |
| Create | `demo_api_ui/src/__tests__/CopyableValue.test.js` | Component tests for visual states + copy behaviour |
| Modify | `demo_api_ui/src/App.js` | Wrap with `<McpFieldProvider>` inside `<SpinnerProvider>` |
| Modify | `demo_api_ui/src/components/WebMcpPanel.js` | Smart param dispatch + result extraction |
| Modify | `demo_api_ui/src/components/WebMcpPanel.css` | Typography: line-height, letter-spacing, mono variant |
| Modify | `demo_api_ui/src/components/McpGatewayConfig.jsx` | Wizard fields use `CopyableValue` + `useMcpFieldState` |
| Modify | `demo_api_ui/src/components/McpGatewayConfig.css` | Typography: line-height, letter-spacing, hint, code |

---

## Task 1: Field key constants

**Files:**
- Create: `demo_api_ui/src/constants/mcpFieldKeys.js`

- [ ] **Step 1: Create the constants file**

```js
// demo_api_ui/src/constants/mcpFieldKeys.js

/**
 * Canonical keys for the McpFieldContext store.
 * Use these instead of raw strings to prevent typos.
 */
export const MCP_FIELD_KEYS = {
  // PingGateway wizard fields
  PINGONE_ENV_URL:      'pingOneEnvUrl',
  PINGONE_RESOURCE_ID:  'pingOneResourceId',
  GATEWAY_URL:          'gatewayUrl',
  UPSTREAM_MCP_URL:     'upstreamMcpUrl',
  INTROSPECT_ENDPOINT:  'introspectEndpoint',
  MCP_SCOPE:            'mcpScope',

  // WebMcpPanel tool param fields
  ACCOUNT_ID:           'account_id',
  FROM_ACCOUNT_ID:      'from_account_id',
  TO_ACCOUNT_ID:        'to_account_id',
  USER_ID:              'userId',
  ACCOUNT_ID_ADMIN:     'accountId',
  LIMIT:                'limit',
};

/**
 * Keys whose values come from /api/accounts/my result.
 * These get a dropdown populated from the cached account list.
 */
export const ACCOUNT_ID_KEYS = new Set([
  MCP_FIELD_KEYS.ACCOUNT_ID,
  MCP_FIELD_KEYS.FROM_ACCOUNT_ID,
  MCP_FIELD_KEYS.TO_ACCOUNT_ID,
]);

/**
 * Keys whose values come from lookup_customer result.
 */
export const USER_ID_KEYS = new Set([MCP_FIELD_KEYS.USER_ID]);

/**
 * Keys whose values come from get_customer_accounts result.
 */
export const ADMIN_ACCOUNT_ID_KEYS = new Set([MCP_FIELD_KEYS.ACCOUNT_ID_ADMIN]);

/**
 * Per-tool description suggestions shown as clickable chips.
 */
export const DESCRIPTION_SUGGESTIONS = {
  create_deposit:    ['Cash Deposit', 'Mobile Check Deposit', 'Transfer from External'],
  create_withdrawal: ['ATM Withdrawal', 'Cash Withdrawal', 'Check Withdrawal'],
  create_transfer:   ['Transfer to Savings', 'Transfer to Checking'],
  adjust_balance:    ['Admin adjustment', 'Correction', 'Fee reversal'],
};

export const QUERY_SUGGESTIONS = [
  "Should I transfer $500 to savings?",
  "What's my spending this month?",
];
```

- [ ] **Step 2: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/constants/mcpFieldKeys.js
git commit -m "feat: add MCP field key constants registry"
```

---

## Task 2: McpFieldContext + useMcpFieldState

**Files:**
- Create: `demo_api_ui/src/context/McpFieldContext.js`
- Create: `demo_api_ui/src/hooks/useMcpFieldState.js`
- Create: `demo_api_ui/src/__tests__/McpFieldContext.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// demo_api_ui/src/__tests__/McpFieldContext.test.js
import React from 'react';
import { render, act } from '@testing-library/react';
import { McpFieldProvider, useMcpField } from '../context/McpFieldContext';

function Consumer({ fieldKey }) {
  const { value, source } = useMcpField(fieldKey);
  return <div data-testid="val">{value}</div>;
}

function Writer({ fieldKey }) {
  const { setValue } = useMcpField(fieldKey);
  return (
    <button onClick={() => setValue('test-uuid', 'Step 2')}>write</button>
  );
}

function Wrapper({ children }) {
  return <McpFieldProvider>{children}</McpFieldProvider>;
}

test('value starts empty', () => {
  const { getByTestId } = render(
    <Wrapper><Consumer fieldKey="pingOneResourceId" /></Wrapper>
  );
  expect(getByTestId('val').textContent).toBe('');
});

test('setValue updates value and source reactively', () => {
  const { getByTestId, getByText } = render(
    <Wrapper>
      <Consumer fieldKey="pingOneResourceId" />
      <Writer fieldKey="pingOneResourceId" />
    </Wrapper>
  );
  act(() => { getByText('write').click(); });
  expect(getByTestId('val').textContent).toBe('test-uuid');
});

test('clear resets value to empty string', () => {
  function ClearConsumer() {
    const { value, setValue, clear } = useMcpField('pingOneResourceId');
    return (
      <>
        <div data-testid="val">{value}</div>
        <button onClick={() => setValue('abc', 'Step 2')}>write</button>
        <button onClick={clear}>clear</button>
      </>
    );
  }
  const { getByTestId, getByText } = render(
    <Wrapper><ClearConsumer /></Wrapper>
  );
  act(() => { getByText('write').click(); });
  expect(getByTestId('val').textContent).toBe('abc');
  act(() => { getByText('clear').click(); });
  expect(getByTestId('val').textContent).toBe('');
});

test('different keys are independent', () => {
  const { getAllByTestId, getByText } = render(
    <Wrapper>
      <Consumer fieldKey="pingOneResourceId" />
      <Consumer fieldKey="gatewayUrl" />
      <Writer fieldKey="pingOneResourceId" />
    </Wrapper>
  );
  act(() => { getByText('write').click(); });
  const vals = getAllByTestId('val');
  expect(vals[0].textContent).toBe('test-uuid');
  expect(vals[1].textContent).toBe('');
});

test('useMcpField throws when used outside provider', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => render(<Consumer fieldKey="x" />)).toThrow();
  spy.mockRestore();
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npx react-scripts test --testPathPattern="McpFieldContext" --watchAll=false --no-coverage 2>&1 | tail -20
```

Expected: `Cannot find module '../context/McpFieldContext'`

- [ ] **Step 3: Create McpFieldContext**

```js
// demo_api_ui/src/context/McpFieldContext.js
import React, { createContext, useContext, useReducer, useCallback } from 'react';

/**
 * State shape: { [fieldKey]: { value: string, source: string|null } }
 */
const McpFieldContext = createContext(null);

function reducer(state, action) {
  switch (action.type) {
    case 'SET_FIELD':
      return {
        ...state,
        [action.key]: { value: action.value, source: action.source || null },
      };
    case 'CLEAR_FIELD':
      return { ...state, [action.key]: { value: '', source: null } };
    default:
      return state;
  }
}

export function McpFieldProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, {});
  return (
    <McpFieldContext.Provider value={{ state, dispatch }}>
      {children}
    </McpFieldContext.Provider>
  );
}

/**
 * Low-level hook — returns raw context. Prefer useMcpFieldState for components.
 */
export function useMcpField(fieldKey) {
  const ctx = useContext(McpFieldContext);
  if (!ctx) throw new Error('useMcpField must be used inside McpFieldProvider');

  const entry = ctx.state[fieldKey] || { value: '', source: null };

  const setValue = useCallback(
    (value, source) => ctx.dispatch({ type: 'SET_FIELD', key: fieldKey, value, source }),
    [ctx, fieldKey]
  );

  const clear = useCallback(
    () => ctx.dispatch({ type: 'CLEAR_FIELD', key: fieldKey }),
    [ctx, fieldKey]
  );

  return { value: entry.value, source: entry.source, setValue, clear };
}
```

- [ ] **Step 4: Create useMcpFieldState hook**

```js
// demo_api_ui/src/hooks/useMcpFieldState.js
import { useEffect } from 'react';
import { useMcpField } from '../context/McpFieldContext';

/**
 * Public hook for components. Adds defaultValue seeding on mount.
 *
 * @param {string} fieldKey - Key from MCP_FIELD_KEYS
 * @param {object} [options]
 * @param {string} [options.defaultValue] - Seed value written on mount (e.g. from data.config.*)
 * @param {string} [options.source] - Source label for the chip (e.g. 'auto-filled', 'Step 2')
 * @returns {{ value: string, setValue: Function, source: string|null, clear: Function }}
 */
export function useMcpFieldState(fieldKey, options = {}) {
  const { defaultValue, source: defaultSource } = options;
  const { value, source, setValue, clear } = useMcpField(fieldKey);

  // Seed from defaultValue on mount — only if field is still empty
  useEffect(() => {
    if (defaultValue !== undefined && defaultValue !== '' && value === '') {
      setValue(defaultValue, defaultSource || 'auto-filled');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue]); // only re-run if defaultValue changes (e.g. after data load)

  return { value, setValue, source, clear };
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npx react-scripts test --testPathPattern="McpFieldContext" --watchAll=false --no-coverage 2>&1 | tail -20
```

Expected: `Tests: 5 passed, 5 total`

- [ ] **Step 6: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/context/McpFieldContext.js \
        demo_api_ui/src/hooks/useMcpFieldState.js \
        demo_api_ui/src/__tests__/McpFieldContext.test.js
git commit -m "feat: add McpFieldContext + useMcpFieldState hook"
```

---

## Task 3: CopyableValue component

**Files:**
- Create: `demo_api_ui/src/components/CopyableValue.jsx`
- Create: `demo_api_ui/src/components/CopyableValue.css`
- Create: `demo_api_ui/src/__tests__/CopyableValue.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// demo_api_ui/src/__tests__/CopyableValue.test.js
import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import { McpFieldProvider } from '../context/McpFieldContext';
import CopyableValue from '../components/CopyableValue';

// Mock clipboard
const writeText = jest.fn(() => Promise.resolve());
Object.assign(navigator, { clipboard: { writeText } });

function Wrapper({ children }) {
  return <McpFieldProvider>{children}</McpFieldProvider>;
}

test('renders label', () => {
  const { getByText } = render(
    <Wrapper>
      <CopyableValue label="Resource ID" fieldKey="pingOneResourceId" />
    </Wrapper>
  );
  expect(getByText('Resource ID')).toBeTruthy();
});

test('shows required badge when required and empty', () => {
  const { getByText } = render(
    <Wrapper>
      <CopyableValue label="Resource ID" fieldKey="pingOneResourceId" required />
    </Wrapper>
  );
  expect(getByText('required')).toBeTruthy();
});

test('does not show copy button when empty', () => {
  const { queryByText } = render(
    <Wrapper>
      <CopyableValue label="Resource ID" fieldKey="pingOneResourceId" required />
    </Wrapper>
  );
  expect(queryByText(/Copy/)).toBeNull();
});

test('shows copy button when value is present', () => {
  const { getByText } = render(
    <Wrapper>
      <CopyableValue label="Resource ID" fieldKey="pingOneResourceId" defaultValue="abc-123" />
    </Wrapper>
  );
  expect(getByText('⎘ Copy')).toBeTruthy();
});

test('copy button writes value to clipboard', async () => {
  const { getByText } = render(
    <Wrapper>
      <CopyableValue label="Resource ID" fieldKey="pingOneResourceId" defaultValue="abc-123" />
    </Wrapper>
  );
  fireEvent.click(getByText('⎘ Copy'));
  expect(writeText).toHaveBeenCalledWith('abc-123');
  await waitFor(() => expect(getByText('✅ Copied')).toBeTruthy());
});

test('shows source chip when source is set', () => {
  const { getByText } = render(
    <Wrapper>
      <CopyableValue
        label="Resource ID"
        fieldKey="pingOneResourceId"
        defaultValue="abc-123"
        defaultSource="Step 2"
      />
    </Wrapper>
  );
  expect(getByText('From Step 2')).toBeTruthy();
});

test('shows hint text when provided', () => {
  const { getByText } = render(
    <Wrapper>
      <CopyableValue
        label="Resource ID"
        fieldKey="pingOneResourceId"
        hint="Used in OAuth2ResourceServerFilter"
      />
    </Wrapper>
  );
  expect(getByText('Used in OAuth2ResourceServerFilter')).toBeTruthy();
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npx react-scripts test --testPathPattern="CopyableValue" --watchAll=false --no-coverage 2>&1 | tail -20
```

Expected: `Cannot find module '../components/CopyableValue'`

- [ ] **Step 3: Create CopyableValue.css**

```css
/* demo_api_ui/src/components/CopyableValue.css */

.copyable-value-wrapper {
  margin-bottom: 14px;
}

.copyable-value-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
  flex-wrap: wrap;
}

.copyable-value-label {
  font-size: 12px;
  font-weight: 600;
  color: #1a1a2e;
  line-height: 1.5;
  letter-spacing: 0.01em;
}

/* Source chip: "From Step 2" — blue */
.copyable-value-chip--source {
  background: #e0f2fe;
  color: #0369a1;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 9px;
  white-space: nowrap;
}

/* Auto-filled chip — green */
.copyable-value-chip--autofill {
  background: #d1fae5;
  color: #065f46;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 9px;
  white-space: nowrap;
}

/* Required badge — amber */
.copyable-value-chip--required {
  background: #fef3c7;
  color: #92400e;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 9px;
  border: 1px solid #fbbf24;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

/* The field row: input + copy button side by side */
.copyable-value-field {
  display: flex;
  align-items: stretch;
  border-radius: 6px;
  overflow: hidden;
}

/* Required/empty state */
.copyable-value-field--required {
  border: 1.5px solid #f59e0b;
}

/* Filled by user */
.copyable-value-field--filled {
  border: 1.5px solid #6366f1;
}

/* Auto-filled / read-only */
.copyable-value-field--autofill {
  border: 1px solid #a7f3d0;
}

.copyable-value-input {
  flex: 1;
  padding: 9px 12px;
  border: none;
  outline: none;
  font-size: 13px;
  line-height: 1.5;
  letter-spacing: 0.01em;
  min-width: 0;
}

.copyable-value-input--mono {
  font-family: ui-monospace, 'SFMono-Regular', Menlo, 'Courier New', monospace;
  letter-spacing: 0.03em;
}

/* Background tints per state */
.copyable-value-field--required .copyable-value-input  { background: #fffbeb; color: #92400e; }
.copyable-value-field--filled .copyable-value-input    { background: #eef2ff; color: #3730a3; }
.copyable-value-field--autofill .copyable-value-input  { background: #f0fdf4; color: #065f46; }

.copyable-value-copy-btn {
  padding: 0 14px;
  border: none;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  line-height: 1;
  transition: opacity 0.1s;
}

.copyable-value-copy-btn:hover { opacity: 0.8; }

.copyable-value-field--filled .copyable-value-copy-btn {
  background: #e0e7ff;
  color: #3730a3;
  border-left: 1px solid #c7d2fe;
}

.copyable-value-field--autofill .copyable-value-copy-btn {
  background: #d1fae5;
  color: #065f46;
  border-left: 1px solid #a7f3d0;
}

.copyable-value-hint {
  font-size: 11px;
  color: #6b7280;
  margin-top: 4px;
  line-height: 1.6;
}

.copyable-value-hint code {
  background: #f3f4f6;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  font-size: 11px;
}
```

- [ ] **Step 4: Create CopyableValue.jsx**

```jsx
// demo_api_ui/src/components/CopyableValue.jsx
import React, { useState, useCallback, useEffect } from 'react';
import { useMcpField } from '../context/McpFieldContext';
import './CopyableValue.css';

/**
 * A labelled field display with a fused copy button.
 * Reads/writes from McpFieldContext via fieldKey.
 *
 * Props:
 *   label        {string}   — Field label text
 *   fieldKey     {string}   — Key in McpFieldContext (use MCP_FIELD_KEYS constants)
 *   required     {boolean}  — Show amber "required" badge when empty
 *   readOnly     {boolean}  — True for derived/auto-filled fields
 *   defaultValue {string}   — Seed value written into context on mount if field is empty
 *   defaultSource{string}   — Source label for chip when defaultValue is used
 *   placeholder  {string}   — Placeholder text for empty editable fields
 *   hint         {string}   — Small help text rendered below the field
 *   monospace    {boolean}  — Use mono font for UUID/URL values
 *   onChange     {Function} — Called with new value when user types (editable fields only)
 */
export default function CopyableValue({
  label,
  fieldKey,
  required = false,
  readOnly = false,
  defaultValue,
  defaultSource,
  placeholder,
  hint,
  monospace = false,
  onChange,
}) {
  const { value, source, setValue } = useMcpField(fieldKey);
  const [copied, setCopied] = useState(false);

  // Seed defaultValue into context on mount if field is empty
  useEffect(() => {
    if (defaultValue !== undefined && defaultValue !== '' && value === '') {
      setValue(defaultValue, defaultSource || 'auto-filled');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue]);

  const handleChange = useCallback(
    (e) => {
      setValue(e.target.value, null);
      if (onChange) onChange(e.target.value);
    },
    [setValue, onChange]
  );

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [value]);

  // Determine visual state
  const isEmpty = !value;
  const isAutofill = !isEmpty && (source === 'auto-filled' || readOnly);
  const fieldStateClass = isEmpty
    ? 'copyable-value-field--required'
    : isAutofill
    ? 'copyable-value-field--autofill'
    : 'copyable-value-field--filled';

  // Determine chip
  let chip = null;
  if (isEmpty && required) {
    chip = <span className="copyable-value-chip--required">required</span>;
  } else if (!isEmpty && source === 'auto-filled') {
    chip = <span className="copyable-value-chip--autofill">auto-filled</span>;
  } else if (!isEmpty && source) {
    chip = <span className="copyable-value-chip--source">From {source}</span>;
  }

  return (
    <div className="copyable-value-wrapper">
      <div className="copyable-value-label-row">
        <span className="copyable-value-label">{label}</span>
        {chip}
      </div>

      <div className={`copyable-value-field ${fieldStateClass}`}>
        <input
          type="text"
          className={`copyable-value-input${monospace ? ' copyable-value-input--mono' : ''}`}
          value={value}
          readOnly={readOnly || isAutofill}
          onChange={readOnly || isAutofill ? undefined : handleChange}
          placeholder={isEmpty ? (placeholder || '') : ''}
          aria-label={label}
        />
        {!isEmpty && (
          <button
            type="button"
            className="copyable-value-copy-btn"
            onClick={handleCopy}
            aria-label={`Copy ${label}`}
          >
            {copied ? '✅ Copied' : '⎘ Copy'}
          </button>
        )}
      </div>

      {hint && <div className="copyable-value-hint">{hint}</div>}
    </div>
  );
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npx react-scripts test --testPathPattern="CopyableValue" --watchAll=false --no-coverage 2>&1 | tail -20
```

Expected: `Tests: 7 passed, 7 total`

- [ ] **Step 6: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/CopyableValue.jsx \
        demo_api_ui/src/components/CopyableValue.css \
        demo_api_ui/src/__tests__/CopyableValue.test.js
git commit -m "feat: add CopyableValue component with fused copy button"
```

---

## Task 4: Smart param controls (McpParamSelect, McpParamToggle, McpParamSuggest)

**Files:**
- Create: `demo_api_ui/src/components/McpParamSelect.jsx`
- Create: `demo_api_ui/src/components/McpParamToggle.jsx`
- Create: `demo_api_ui/src/components/McpParamSuggest.jsx`

No separate test files — these are thin wrappers; they are covered by the WebMcpPanel integration tests in Task 6.

- [ ] **Step 1: Create McpParamSelect.jsx**

```jsx
// demo_api_ui/src/components/McpParamSelect.jsx
import React from 'react';

/**
 * Dropdown param control for WebMcpPanel.
 *
 * Props:
 *   paramKey   {string}            — Tool param name (e.g. "account_id")
 *   label      {string}            — Display label
 *   options    {Array<{value, label}>} — Selectable options
 *   value      {string}            — Current value (controlled)
 *   onChange   {Function}          — Called with new string value
 *   required   {boolean}
 *   hint       {string}
 */
export default function McpParamSelect({ paramKey, label, options, value, onChange, required, hint }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', marginBottom: 10 }}>
      <span style={{ fontSize: 14, color: '#0f2044', marginBottom: 4, lineHeight: 1.5, letterSpacing: '0.01em' }}>
        {label}
        {required && !value && (
          <span style={{
            marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 7px',
            borderRadius: 9, border: '1px solid #fbbf24', background: '#fef3c7',
            color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>required</span>
        )}
      </span>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '8px 12px', border: '1px solid #c0ccd8', borderRadius: 6,
          background: '#f4f7fb', color: '#0f2044', fontSize: 14,
          lineHeight: 1.5, letterSpacing: '0.01em', cursor: 'pointer',
        }}
        aria-label={label}
      >
        <option value="">— select —</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {hint && (
        <span style={{ fontSize: 12, color: '#4a6080', marginTop: 3, lineHeight: 1.6 }}>{hint}</span>
      )}
    </label>
  );
}
```

- [ ] **Step 2: Create McpParamToggle.jsx**

```jsx
// demo_api_ui/src/components/McpParamToggle.jsx
import React from 'react';

/**
 * Boolean param control for WebMcpPanel.
 *
 * If paramKey === 'freeze': renders Freeze / Unfreeze radio pair.
 * If paramKey === 'confirm': renders a single confirmation checkbox.
 * Otherwise: renders a generic checkbox.
 *
 * Props:
 *   paramKey   {string}    — Tool param name
 *   label      {string}    — Display label
 *   value      {string}    — Current string value ('true'/'false' or '')
 *   onChange   {Function}  — Called with new string value
 *   hint       {string}
 */
export default function McpParamToggle({ paramKey, label, value, onChange, hint }) {
  const labelStyle = { fontSize: 14, color: '#0f2044', marginBottom: 4, lineHeight: 1.5, letterSpacing: '0.01em' };
  const hintStyle = { fontSize: 12, color: '#4a6080', marginTop: 3, lineHeight: 1.6 };

  if (paramKey === 'freeze') {
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={labelStyle}>{label}</div>
        <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
          {['true', 'false'].map((v) => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
              <input
                type="radio"
                name={`toggle-${paramKey}`}
                value={v}
                checked={value === v}
                onChange={() => onChange(v)}
              />
              {v === 'true' ? 'Freeze' : 'Unfreeze'}
            </label>
          ))}
        </div>
        {hint && <div style={hintStyle}>{hint}</div>}
      </div>
    );
  }

  if (paramKey === 'confirm') {
    return (
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={value === 'true'}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
            style={{ marginTop: 3, flexShrink: 0 }}
          />
          <span style={{ ...labelStyle, marginBottom: 0 }}>
            I confirm permanent deletion of this customer and all their data
          </span>
        </label>
        {hint && <div style={hintStyle}>{hint}</div>}
      </div>
    );
  }

  // Generic boolean
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        />
        <span style={labelStyle}>{label}</span>
      </label>
      {hint && <div style={hintStyle}>{hint}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Create McpParamSuggest.jsx**

```jsx
// demo_api_ui/src/components/McpParamSuggest.jsx
import React from 'react';

/**
 * Free-text input with clickable suggestion chips below.
 *
 * Props:
 *   paramKey    {string}         — Tool param name
 *   label       {string}         — Display label
 *   suggestions {string[]}       — Chip labels; clicking sets value
 *   value       {string}         — Current value (controlled)
 *   onChange    {Function}       — Called with new string value
 *   placeholder {string}
 *   hint        {string}
 */
export default function McpParamSuggest({ paramKey, label, suggestions, value, onChange, placeholder, hint }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', marginBottom: 10 }}>
      <span style={{ fontSize: 14, color: '#0f2044', marginBottom: 4, lineHeight: 1.5, letterSpacing: '0.01em' }}>
        {label}
      </span>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || ''}
        style={{
          padding: '8px 12px', border: '1px solid #c0ccd8', borderRadius: 6,
          background: '#f4f7fb', color: '#0f2044', fontSize: 14,
          lineHeight: 1.5, letterSpacing: '0.01em',
        }}
        aria-label={label}
      />
      {suggestions && suggestions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              style={{
                padding: '2px 10px', border: '1px solid #d0d9e8', borderRadius: 12,
                background: '#f4f7fb', color: '#0f2044', fontSize: 12, cursor: 'pointer',
                lineHeight: 1.5,
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {hint && (
        <span style={{ fontSize: 12, color: '#4a6080', marginTop: 3, lineHeight: 1.6 }}>{hint}</span>
      )}
    </label>
  );
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/McpParamSelect.jsx \
        demo_api_ui/src/components/McpParamToggle.jsx \
        demo_api_ui/src/components/McpParamSuggest.jsx
git commit -m "feat: add McpParamSelect, McpParamToggle, McpParamSuggest controls"
```

---

## Task 5: Wire McpFieldProvider into App.js

**Files:**
- Modify: `demo_api_ui/src/App.js`

- [ ] **Step 1: Add the import**

Open `demo_api_ui/src/App.js`. Find the block of context imports (around line 108–114). Add after the last context import:

```js
import { McpFieldProvider } from './context/McpFieldContext';
```

- [ ] **Step 2: Wrap with McpFieldProvider**

Find the `export default function App()` return (around line 1508). It currently reads:

```jsx
return (
  <SpinnerProvider>
    <AgentUiModeProvider>
      <ExchangeModeProvider>
        <Router ...>
          <AppWithAuth />
        </Router>
      </ExchangeModeProvider>
    </AgentUiModeProvider>
  </SpinnerProvider>
);
```

Change it to:

```jsx
return (
  <SpinnerProvider>
    <AgentUiModeProvider>
      <McpFieldProvider>
        <ExchangeModeProvider>
          <Router
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          >
            <AppWithAuth />
          </Router>
        </ExchangeModeProvider>
      </McpFieldProvider>
    </AgentUiModeProvider>
  </SpinnerProvider>
);
```

- [ ] **Step 3: Verify build compiles**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/App.js
git commit -m "feat: wrap App with McpFieldProvider"
```

---

## Task 6: Update WebMcpPanel — smart param dispatch + result extraction

**Files:**
- Modify: `demo_api_ui/src/components/WebMcpPanel.js`
- Modify: `demo_api_ui/src/components/WebMcpPanel.css`

- [ ] **Step 1: Add imports to WebMcpPanel.js**

At the top of `demo_api_ui/src/components/WebMcpPanel.js`, after the existing imports, add:

```js
import { useMcpField } from '../context/McpFieldContext';
import {
  ACCOUNT_ID_KEYS,
  USER_ID_KEYS,
  ADMIN_ACCOUNT_ID_KEYS,
  DESCRIPTION_SUGGESTIONS,
  QUERY_SUGGESTIONS,
} from '../constants/mcpFieldKeys';
import CopyableValue from './CopyableValue';
import McpParamSelect from './McpParamSelect';
import McpParamToggle from './McpParamToggle';
import McpParamSuggest from './McpParamSuggest';
```

- [ ] **Step 2: Add account/user options state and fetching**

Inside `export default function WebMcpPanel()`, after the existing `useState` declarations, add:

```js
const [accountOptions, setAccountOptions] = useState([]); // [{value, label}]
const [userOptions, setUserOptions]       = useState([]); // [{value, label}]
const [adminAccountOptions, setAdminAccountOptions] = useState([]); // [{value, label}]
const accountsFetched = useRef(false);

// Fetch user accounts once and cache in state for dropdowns
const ensureAccountOptions = useCallback(async () => {
  if (accountsFetched.current) return;
  accountsFetched.current = true;
  try {
    const res = await fetch(`${process.env.REACT_APP_API_BASE || ''}/api/accounts/my`, {
      credentials: 'include',
    });
    if (!res.ok) return;
    const data = await res.json();
    const accounts = data.accounts || data || [];
    setAccountOptions(
      accounts.map((a) => ({
        value: a.id,
        label: `${a.accountType ? a.accountType.charAt(0).toUpperCase() + a.accountType.slice(1) : 'Account'} — $${Number(a.balance || 0).toLocaleString()}`,
      }))
    );
  } catch {
    // best-effort — falls back to plain text input
  }
}, []);
```

- [ ] **Step 3: Trigger account fetch when a tool with account params is selected**

Replace the existing `selectTool` callback:

```js
const selectTool = useCallback((tool) => {
  setSelectedTool(tool);
  setParams({});
  setResult(null);
  setStreamEvents([]);
  setError(null);
  // Pre-fetch accounts if this tool has account_id params
  const toolProps = tool?.inputSchema?.properties || {};
  const hasAccountParam = Object.keys(toolProps).some((k) => ACCOUNT_ID_KEYS.has(k));
  if (hasAccountParam) ensureAccountOptions();
}, [ensureAccountOptions]);
```

- [ ] **Step 4: Extend interpretResult to extract structured data**

After the existing `interpretResult` function (around line 65), add a separate extraction helper:

```js
/**
 * Best-effort extraction of structured lists from tool results.
 * Returns { accountOptions, userOptions, adminAccountOptions } — any may be null if not applicable.
 */
function extractResultData(toolName, result) {
  try {
    // Tool handlers return result as JSON string in result.text or result.result.text
    const raw = result?.text ?? result?.result?.text ?? null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    if (toolName === 'get_my_accounts') {
      const accounts = Array.isArray(parsed) ? parsed : parsed?.accounts;
      if (!Array.isArray(accounts)) return null;
      return {
        accountOptions: accounts.map((a) => ({
          value: a.id,
          label: `${a.accountType ? a.accountType.charAt(0).toUpperCase() + a.accountType.slice(1) : 'Account'} — $${Number(a.balance || 0).toLocaleString()}`,
        })),
      };
    }

    if (toolName === 'lookup_customer') {
      const users = Array.isArray(parsed) ? parsed : parsed?.users;
      if (!Array.isArray(users)) return null;
      return {
        userOptions: users.map((u) => ({
          value: u.id,
          label: `${u.firstName || ''} ${u.lastName || ''} (${u.email || u.username || u.id})`.trim(),
        })),
      };
    }

    if (toolName === 'get_customer_accounts') {
      const accounts = Array.isArray(parsed) ? parsed : parsed?.accounts;
      if (!Array.isArray(accounts)) return null;
      return {
        adminAccountOptions: accounts.map((a) => ({
          value: a.id,
          label: `${a.name || a.accountType || 'Account'} — $${Number(a.balance || 0).toLocaleString()}`,
        })),
      };
    }
  } catch {
    // silent — plain JSON display is unaffected
  }
  return null;
}
```

- [ ] **Step 5: Apply extraction after a successful tool call**

In the `callSelectedTool` callback, after `setResult(res)` and `setWebMcpLastResult(res)`, add:

```js
// Extract structured data from result and update dropdown options
const extracted = extractResultData(selectedTool.name, res);
if (extracted?.accountOptions) {
  setAccountOptions(extracted.accountOptions);
  accountsFetched.current = true;
}
if (extracted?.userOptions)         setUserOptions(extracted.userOptions);
if (extracted?.adminAccountOptions) setAdminAccountOptions(extracted.adminAccountOptions);
```

- [ ] **Step 6: Replace the param render loop with smart dispatch**

Find the params render block (around line 287–314):

```jsx
{Object.keys(schemaProps).length > 0 && (
  <div className="webmcp-params">
    <h5>Parameters</h5>
    {Object.entries(schemaProps).map(([key, schema]) => (
      <label key={key} className="webmcp-param-label">
        ...
      </label>
    ))}
  </div>
)}
```

Replace with:

```jsx
{Object.keys(schemaProps).length > 0 && (
  <div className="webmcp-params">
    <h5>Parameters</h5>
    {Object.entries(schemaProps).map(([key, schema]) => {
      const required = requiredFields.includes(key);
      const hint = schema.description || '';
      const currentValue = params[key] || '';

      // Boolean toggles
      if (key === 'freeze' || key === 'confirm' || schema.type === 'boolean') {
        return (
          <McpParamToggle
            key={key}
            paramKey={key}
            label={key}
            value={currentValue}
            onChange={(v) => handleParamChange(key, v)}
            hint={hint}
          />
        );
      }

      // Account ID dropdowns
      if (ACCOUNT_ID_KEYS.has(key)) {
        // For create_transfer: to_account_id excludes the from_account_id selection
        const opts = key === 'to_account_id'
          ? accountOptions.filter((o) => o.value !== (params['from_account_id'] || ''))
          : accountOptions;
        return (
          <McpParamSelect
            key={key}
            paramKey={key}
            label={key}
            options={opts.length > 0 ? opts : []}
            value={currentValue}
            onChange={(v) => handleParamChange(key, v)}
            required={required}
            hint={hint || (opts.length === 0 ? 'Call get_my_accounts first to populate this dropdown' : '')}
          />
        );
      }

      // Admin user ID dropdowns
      if (USER_ID_KEYS.has(key)) {
        return (
          <McpParamSelect
            key={key}
            paramKey={key}
            label={key}
            options={userOptions}
            value={currentValue}
            onChange={(v) => handleParamChange(key, v)}
            required={required}
            hint={hint || (userOptions.length === 0 ? 'Call lookup_customer first to populate this dropdown' : '')}
          />
        );
      }

      // Admin account ID dropdowns
      if (ADMIN_ACCOUNT_ID_KEYS.has(key)) {
        return (
          <McpParamSelect
            key={key}
            paramKey={key}
            label={key}
            options={adminAccountOptions}
            value={currentValue}
            onChange={(v) => handleParamChange(key, v)}
            required={required}
            hint={hint || (adminAccountOptions.length === 0 ? 'Call get_customer_accounts first to populate this dropdown' : '')}
          />
        );
      }

      // account_type enum
      if (key === 'account_type' || schema.enum) {
        const enumOptions = (schema.enum || ['checking', 'savings', 'loan', 'credit', 'investment'])
          .map((v) => ({ value: v, label: v }));
        return (
          <McpParamSelect
            key={key}
            paramKey={key}
            label={key}
            options={enumOptions}
            value={currentValue}
            onChange={(v) => handleParamChange(key, v)}
            required={required}
            hint={hint}
          />
        );
      }

      // limit dropdown
      if (key === 'limit') {
        return (
          <McpParamSelect
            key={key}
            paramKey={key}
            label={key}
            options={[
              { value: '5', label: '5' },
              { value: '10', label: '10' },
              { value: '20', label: '20' },
              { value: '50', label: '50' },
            ]}
            value={currentValue}
            onChange={(v) => handleParamChange(key, v)}
            hint={hint}
          />
        );
      }

      // description suggestions
      if (key === 'description') {
        const suggestions = DESCRIPTION_SUGGESTIONS[selectedTool?.name] || [];
        return (
          <McpParamSuggest
            key={key}
            paramKey={key}
            label={key}
            suggestions={suggestions}
            value={currentValue}
            onChange={(v) => handleParamChange(key, v)}
            placeholder="optional description"
            hint={hint}
          />
        );
      }

      // query suggestions (sequential_think)
      if (key === 'query' && selectedTool?.name === 'sequential_think') {
        return (
          <McpParamSuggest
            key={key}
            paramKey={key}
            label={key}
            suggestions={QUERY_SUGGESTIONS}
            value={currentValue}
            onChange={(v) => handleParamChange(key, v)}
            placeholder="e.g. Should I transfer $500 to savings?"
            hint={hint}
          />
        );
      }

      // Default: plain text input (existing style)
      return (
        <label key={key} className="webmcp-param-label">
          <span>
            {key}
            {required && <span className="webmcp-required">*</span>}
            {hint && <span className="webmcp-param-hint"> — {hint}</span>}
          </span>
          <input
            type="text"
            className="webmcp-param-input"
            value={currentValue}
            onChange={(e) => handleParamChange(key, e.target.value)}
            placeholder={schema.type || ''}
          />
        </label>
      );
    })}
  </div>
)}
```

- [ ] **Step 7: Update WebMcpPanel.css typography**

Open `demo_api_ui/src/components/WebMcpPanel.css`. Find `.webmcp-param-label` (around line 202), `.webmcp-param-input` (around line 220), and `.webmcp-params h5` (around line 194). Apply these changes:

Find:
```css
.webmcp-params h5 {
  margin: 0 0 10px;
  font-size: 13px;
  color: #4a6080;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
```
Replace with:
```css
.webmcp-params h5 {
  margin: 0 0 10px;
  font-size: 13px;
  color: #4a6080;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
```

Find:
```css
.webmcp-param-label {
  display: flex;
  flex-direction: column;
  margin-bottom: 10px;
  font-size: 15px;
  color: #0f2044;
}
```
Replace with:
```css
.webmcp-param-label {
  display: flex;
  flex-direction: column;
  margin-bottom: 10px;
  font-size: 14px;
  color: #0f2044;
  line-height: 1.5;
  letter-spacing: 0.01em;
}
```

Find:
```css
.webmcp-param-input {
  margin-top: 6px;
  padding: 8px 12px;
  border: 1px solid #c0ccd8;
  border-radius: 4px;
  background: #f4f7fb;
  color: #0f2044;
  font-size: 15px;
  font-family: inherit;
}
```
Replace with:
```css
.webmcp-param-input {
  margin-top: 6px;
  padding: 8px 12px;
  border: 1px solid #c0ccd8;
  border-radius: 4px;
  background: #f4f7fb;
  color: #0f2044;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.5;
  letter-spacing: 0.01em;
}

.webmcp-param-input--mono {
  font-family: ui-monospace, 'SFMono-Regular', Menlo, 'Courier New', monospace;
  letter-spacing: 0.03em;
}
```

- [ ] **Step 8: Verify build**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully.`

- [ ] **Step 9: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/WebMcpPanel.js \
        demo_api_ui/src/components/WebMcpPanel.css
git commit -m "feat: WebMcpPanel smart param controls + result extraction"
```

---

## Task 7: Update McpGatewayConfig wizard

**Files:**
- Modify: `demo_api_ui/src/components/McpGatewayConfig.jsx`
- Modify: `demo_api_ui/src/components/McpGatewayConfig.css`

- [ ] **Step 1: Add imports to McpGatewayConfig.jsx**

At the top of `demo_api_ui/src/components/McpGatewayConfig.jsx`, after the existing `import "./McpGatewayConfig.css";` line, add:

```js
import CopyableValue from './CopyableValue';
import { useMcpFieldState } from '../hooks/useMcpFieldState';
import { MCP_FIELD_KEYS } from '../constants/mcpFieldKeys';
```

- [ ] **Step 2: Replace wizard Step 2 form fields**

Inside `McpGatewayConfig`, add these hook calls at the top of the component body, after all existing `useState` declarations:

```js
// Wizard field state — seeded from data.config.* once data loads
const { value: pingOneEnvUrlVal } = useMcpFieldState(MCP_FIELD_KEYS.PINGONE_ENV_URL, {
  defaultValue: data?.config?.pingOneEnvUrl || '',
  source: 'auto-filled',
});
const { value: introspectVal } = useMcpFieldState(MCP_FIELD_KEYS.INTROSPECT_ENDPOINT, {
  defaultValue: data?.config?.introspectEndpoint || '',
  source: 'auto-filled',
});
const { value: upstreamMcpVal } = useMcpFieldState(MCP_FIELD_KEYS.UPSTREAM_MCP_URL, {
  defaultValue: data?.config?.upstreamMcpUrl || '',
  source: 'auto-filled',
});
const { value: pingOneResourceIdVal, setValue: setPingOneResourceId } = useMcpFieldState(MCP_FIELD_KEYS.PINGONE_RESOURCE_ID);
const { value: gatewayUrlVal, setValue: setGatewayUrl } = useMcpFieldState(MCP_FIELD_KEYS.GATEWAY_URL);
const { value: mcpScopeVal, setValue: setMcpScope } = useMcpFieldState(MCP_FIELD_KEYS.MCP_SCOPE, {
  defaultValue: routeForm.mcpScope || 'mcp:invoke',
  source: 'auto-filled',
});
```

- [ ] **Step 3: Replace Step 2 form fields with CopyableValue**

In the Step 2 body (`{/* Step 2 — Configure Gateway Routes */}`), find the `<div className="mgc-push-form">` block. Replace the five `<label className="mgc-field">` elements with `CopyableValue` components:

```jsx
<div className="mgc-push-form">
  <CopyableValue
    label="PingOne Environment URL"
    fieldKey={MCP_FIELD_KEYS.PINGONE_ENV_URL}
    readOnly
    monospace
    hint="maps to properties.pingOneEnvID in mcp.json"
  />

  <CopyableValue
    label="PingOne Resource ID"
    fieldKey={MCP_FIELD_KEYS.PINGONE_RESOURCE_ID}
    required
    monospace
    placeholder="e.g., a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    hint="Used as username in OAuth2ResourceServerFilter for introspection. Maps to properties.pingOneResourceID."
    onChange={(v) => {
      setPingOneResourceId(v, null);
      setRouteForm((f) => ({ ...f, pingOneResourceId: v }));
    }}
  />

  <CopyableValue
    label="PingGateway Public URL"
    fieldKey={MCP_FIELD_KEYS.GATEWAY_URL}
    required
    placeholder="https://ig.example.com:8443"
    hint="The public HTTPS URL of your PingGateway instance. Maps to properties.gatewayUrl."
    onChange={(v) => {
      setGatewayUrl(v, null);
      setRouteForm((f) => ({ ...f, gatewayUrl: v }));
    }}
  />

  <CopyableValue
    label="Upstream MCP Server URL"
    fieldKey={MCP_FIELD_KEYS.UPSTREAM_MCP_URL}
    readOnly
    monospace
    hint="Maps to properties.mcpServerUrl and baseURI."
  />

  <CopyableValue
    label="MCP Scope"
    fieldKey={MCP_FIELD_KEYS.MCP_SCOPE}
    placeholder="mcp:invoke"
    hint="OAuth 2.0 scope required for token exchange."
    onChange={(v) => {
      setMcpScope(v, null);
      setRouteForm((f) => ({ ...f, mcpScope: v }));
    }}
  />

  <CopyableValue
    label="Token Introspection Endpoint"
    fieldKey={MCP_FIELD_KEYS.INTROSPECT_ENDPOINT}
    readOnly
    monospace
    hint="Auto-computed: PingOne Auth URL + /as/introspect"
  />

  <button type="button" className="mgc-push-btn" onClick={handleRouteSave} disabled={routeSaving}>
    {routeSaving ? 'Saving…' : '⬆ Save to Config'}
  </button>
  {routeSaveResult && (
    <div className={`mgc-alert ${routeSaveResult.ok ? 'mgc-alert--success' : 'mgc-alert--error'}`}>
      {routeSaveResult.ok ? '✅ ' : '❌ '}{routeSaveResult.msg}
    </div>
  )}
</div>
```

- [ ] **Step 4: Add "From Step 2" display in Step 3**

In the Step 3 body (`{/* Step 3 — Download Route File */}`), after the existing `<p>` instruction text and before the `<div className="mgc-code-block">`, add:

```jsx
<div style={{ marginBottom: 16 }}>
  <CopyableValue
    label="PingOne Resource ID"
    fieldKey={MCP_FIELD_KEYS.PINGONE_RESOURCE_ID}
    readOnly
    monospace
    hint="The value you entered in Step 2 — used in the downloaded mcp.json"
  />
  <CopyableValue
    label="PingGateway Public URL"
    fieldKey={MCP_FIELD_KEYS.GATEWAY_URL}
    readOnly
    hint="The value you entered in Step 2 — used in the downloaded mcp.json"
  />
</div>
```

- [ ] **Step 5: Update McpGatewayConfig.css typography**

Open `demo_api_ui/src/components/McpGatewayConfig.css`. Apply these changes:

Find the `.mgc-field-label` rule. If it doesn't exist as a standalone rule, add it; if it does, update it:
```css
.mgc-field-label {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
  font-weight: 600;
  color: #333;
  line-height: 1.5;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  margin-bottom: 4px;
}
```

Find `.mgc-field-hint` and update:
```css
.mgc-field-hint {
  font-size: 11px;
  color: #6b7280;
  margin-top: 4px;
  line-height: 1.6;
}
```

Find `.mgc-input` and add the two new properties:
```css
.mgc-input {
  /* existing properties ... */
  line-height: 1.5;
  letter-spacing: 0.01em;
}
```

Find `.mgc-pre--code` and update:
```css
.mgc-pre--code {
  /* existing properties ... */
  font-size: 12.5px;
  line-height: 1.6;
}
```

Find `.mgc-input--readonly` and add mono font:
```css
.mgc-input--readonly {
  /* existing properties ... */
  font-family: ui-monospace, 'SFMono-Regular', Menlo, 'Courier New', monospace;
}
```

- [ ] **Step 6: Verify build**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully.`

- [ ] **Step 7: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/McpGatewayConfig.jsx \
        demo_api_ui/src/components/McpGatewayConfig.css
git commit -m "feat: McpGatewayConfig wizard uses CopyableValue + cross-step auto-fill"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run all UI tests**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npx react-scripts test --watchAll=false --no-coverage 2>&1 | tail -30
```

Expected: all suites pass, no new failures.

- [ ] **Step 2: Run full build**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully.`

- [ ] **Step 3: Manual smoke check**

Start the app with `./run.sh` from the repo root, then verify all 7 success criteria from the spec:

1. Open `/mcp-gateway` → "Real PingGateway" tab → Step 2 → fill in `PingOne Resource ID` field → scroll to Step 3 → confirm it shows the value with "From Step 2" chip and a working copy button.
2. Open `/mcp` (WebMcpPanel) → select `get_my_accounts` → call it → select `get_account_balance` → confirm `account_id` shows a dropdown of the user's accounts.
3. Select `get_my_accounts` → confirm `account_type` renders as a dropdown (checking/savings/loan/credit/investment), not a text input.
4. Select `freeze_account` → confirm `freeze` renders as Freeze / Unfreeze radio pair.
5. Select `create_transfer` → fill in a value in any account field → confirm "⎘ Copy" button appears and clicking it copies the value.
6. Build already verified in Step 2.
7. Tests already verified in Step 1.

- [ ] **Step 4: Final commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add -A
git commit -m "feat: MCP smart fields — auto-fill, copy buttons, smart param controls

- McpFieldContext shares field values across wizard steps and tool panels
- CopyableValue shows auto-filled/user-entered values with fused copy button
- WebMcpPanel: account_id/userId/accountId dropdowns, freeze toggle, description suggestions
- McpGatewayConfig wizard: Step 2 values carry forward to Step 3 with source chips
- Typography fixes: line-height 1.5, letter-spacing 0.01em, mono font for UUIDs/URLs

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
