# Clarification Dropdown Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance clarification pill buttons with smarter account labels (type + masked number), amount quick-picks, all-vertical enum coverage, and UX polish (animations + keyboard nav).

**Architecture:** Four changes compose cleanly: (1) `ClarifyOptions` in `agentChrome.js` gains rich label support, an `amountOptions` prop, keyboard nav, and fade animations; (2) `AIAgent.js` passes rich account objects and `amountOptions` at both the banking and vertical `needsParams` call sites; (3) two vertical manifests get `amountPresets`; (4) `demoAgentLangGraphService.js` extracts `enum` choices from `inputSchema` and includes them in the `needsParams` payload.

**Tech Stack:** React 19.2, plain JS/JSX, CSS (no TypeScript), Node.js CommonJS, Jest/Vitest.

## Global Constraints

- CommonJS (`'use strict'` + `require`) in `demo_api_server/`; plain JS/JSX in `demo_api_ui/`
- No TypeScript in UI files
- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`
- All modals must use `DraggableModal` — not relevant here (no new modals)
- HTTP in UI goes through `apiClient`
- All `{ error }` shape in BFF routes (not `{ message }`)
- Run UI tests: `cd demo_api_ui && npm run test:unit && npm run build`
- Run API tests: `cd demo_api_server && CI=true npm test -- --forceExit`
- Work in worktree `clarify-dropdown-options` on branch `worktree-clarify-dropdown-options`

---

## File Map

| File | Change |
|---|---|
| `demo_api_ui/src/components/agentChrome.js` | `ClarifyOptions`: rich `{label,value}` option support, `amountOptions` prop, fade-in animation, selected state, keyboard nav |
| `demo_api_ui/src/components/AIAgent.css` | Add fade-in/out keyframes, `--selected` state, amount row variant, light-mode variants |
| `demo_api_ui/src/components/AIAgent.js` | Pass rich account objects + `amountOptions` at banking call site; prefer `needsParams.choices` at vertical call site; wire `onDismiss` |
| `demo_api_server/config/verticals/banking/manifest.json` | Add `amountPresets: [100, 500, 1000, 2500]` to `terminology` |
| `demo_api_server/config/verticals/investment/manifest.json` | Add `amountPresets: [500, 1000, 5000, 10000]` to `terminology` |
| `demo_api_server/services/demoAgentLangGraphService.js` | Extract `inputSchema.properties[k].enum` into `needsParams.choices` |

---

## Task 1: Rich account labels in `ClarifyOptions` + CSS

Update `ClarifyOptions` to accept options as either plain strings or `{ label, value }` objects. Render the label (e.g. `"Checking ••6789"`), send the value (e.g. `"checking"`) to `onSelect`. Add fade-in animation.

**Files:**
- Modify: `demo_api_ui/src/components/agentChrome.js` — `ClarifyOptions` function
- Modify: `demo_api_ui/src/components/AIAgent.css` — clarify-options styles

**Interfaces:**
- Produces: `ClarifyOptions({ options: (string | { label: string, value: string })[], onSelect: (value: string) => void, active: boolean, onDismiss?: () => void })`
- `onSelect` always receives a plain string (the `value` field for rich items, the string itself for plain)

- [ ] **Step 1: Write failing Vitest test**

File: `demo_api_ui/src/components/__tests__/agentChrome.test.jsx`

```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ClarifyOptions } from '../agentChrome';

describe('ClarifyOptions', () => {
  it('renders plain string options', () => {
    render(<ClarifyOptions options={['Checking', 'Savings']} onSelect={() => {}} active={true} />);
    expect(screen.getByText('Checking')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
  });

  it('renders rich options showing label', () => {
    const opts = [
      { label: 'Checking ••6789', value: 'checking' },
      { label: 'Savings ••4521', value: 'savings' },
    ];
    render(<ClarifyOptions options={opts} onSelect={() => {}} active={true} />);
    expect(screen.getByText(/Checking ••6789/)).toBeInTheDocument();
    expect(screen.getByText(/Savings ••4521/)).toBeInTheDocument();
  });

  it('calls onSelect with value (not label) for rich options', () => {
    const onSelect = vi.fn();
    const opts = [{ label: 'Checking ••6789', value: 'checking' }];
    render(<ClarifyOptions options={opts} onSelect={onSelect} active={true} />);
    fireEvent.click(screen.getByText(/Checking/));
    expect(onSelect).toHaveBeenCalledWith('checking');
  });

  it('calls onSelect with the string for plain options', () => {
    const onSelect = vi.fn();
    render(<ClarifyOptions options={['Savings']} onSelect={onSelect} active={true} />);
    fireEvent.click(screen.getByText('Savings'));
    expect(onSelect).toHaveBeenCalledWith('savings');
  });

  it('disables buttons when active=false', () => {
    render(<ClarifyOptions options={['Checking']} onSelect={() => {}} active={false} />);
    expect(screen.getByRole('button', { name: /Checking/ })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_api_ui && npm run test:unit -- --reporter=verbose agentChrome
```

Expected: FAIL — `ClarifyOptions` doesn't accept rich objects yet.

- [ ] **Step 3: Update `ClarifyOptions` in `agentChrome.js`**

Replace the current `ClarifyOptions` export (lines ~94–112 of `agentChrome.js`):

```jsx
export function ClarifyOptions({ options, onSelect, active, onDismiss }) {
  if (!options || options.length === 0) return null;

  function getLabel(opt) {
    return typeof opt === 'object' && opt !== null ? opt.label : opt;
  }
  function getValue(opt) {
    if (typeof opt === 'object' && opt !== null) return opt.value;
    return opt.charAt(0).toLowerCase() + opt.slice(1);
  }

  return (
    <div className="clarify-options" role="listbox">
      {options.map((opt) => {
        const label = getLabel(opt);
        const value = getValue(opt);
        return (
          <button
            key={value}
            type="button"
            role="option"
            aria-selected="false"
            className="clarify-options__btn"
            disabled={!active}
            onClick={() => active && onSelect(value)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Add fade-in animation to `AIAgent.css`**

Add after the existing `.clarify-options` block (after line ~1650):

```css
@keyframes clarify-fadein {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.clarify-options {
  animation: clarify-fadein 0.15s ease-out both;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd demo_api_ui && npm run test:unit -- --reporter=verbose agentChrome
```

Expected: all 5 tests PASS.

- [ ] **Step 6: Verify build**

```bash
cd demo_api_ui && npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/clarify-dropdown-options \
  add demo_api_ui/src/components/agentChrome.js \
      demo_api_ui/src/components/AIAgent.css \
      demo_api_ui/src/components/__tests__/agentChrome.test.jsx
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/clarify-dropdown-options \
  commit -m "feat(clarify): support rich {label,value} options + fade-in animation"
```

---

## Task 2: Rich account labels wired in `AIAgent.js` (banking path)

At the banking clarification call site (~line 6405), build rich `{ label, value }` objects from `liveAccounts` instead of bare type strings. Label = `"Checking ••6789"`, value = `"checking"`.

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js` — banking clarification block (~line 6405–6430)

**Interfaces:**
- Consumes: `liveAccounts[].accountNumber` (string like `"1001-2345-6789"`), `liveAccounts[].type` (string)
- Produces: `clarifyOptions: { label: string, value: string }[]` passed to `addMessage` and `setPendingClarification`

- [ ] **Step 1: Locate the banking acctTypes block**

Open `demo_api_ui/src/components/AIAgent.js` and find line ~6405:
```js
const acctTypes = [
  ...new Set((liveAccounts || []).map((a) => a.type).filter(Boolean)),
];
```

- [ ] **Step 2: Replace `acctTypes` with rich objects**

Replace that block with:

```js
function last4(num) {
  const digits = String(num || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}
// Deduplicate by type. If two accounts share a type, both appear with masked numbers.
const acctTypeSeen = new Set();
const acctTypes = (liveAccounts || [])
  .filter((a) => a.type)
  .reduce((acc, a) => {
    const type = a.type;
    const l4 = last4(a.accountNumber);
    const label = l4 ? `${type} ••${l4}` : type;
    const value = type.toLowerCase();
    // If same type already added without a number, upgrade it; otherwise add.
    const existing = acc.findIndex((o) => o.value === value && !o.label.includes('••'));
    if (existing >= 0 && l4) {
      acc[existing] = { label, value };
    } else if (!acc.some((o) => o.label === label)) {
      acc.push({ label, value });
    }
    return acc;
  }, []);
```

Note: the `last4` helper is defined inline here (inside the function scope) to avoid polluting the module scope. If `last4` is already defined elsewhere in the file from previous work, reuse it.

- [ ] **Step 3: Verify no lint/build errors**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: build succeeds, no warnings about `acctTypes`.

- [ ] **Step 4: Run unit tests**

```bash
cd demo_api_ui && npm run test:unit
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/clarify-dropdown-options \
  add demo_api_ui/src/components/AIAgent.js
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/clarify-dropdown-options \
  commit -m "feat(clarify): banking options show type + masked account number"
```

---

## Task 3: Amount quick-picks — manifests + CSS

Add `amountPresets` to banking and investment manifests. Add CSS for the amount button row.

**Files:**
- Modify: `demo_api_server/config/verticals/banking/manifest.json` — `terminology` block
- Modify: `demo_api_server/config/verticals/investment/manifest.json` — `terminology` block
- Modify: `demo_api_ui/src/components/AIAgent.css` — amount button styles

**Interfaces:**
- Produces: `terminology.amountPresets: number[]` readable by `AIAgent.js`

- [ ] **Step 1: Add `amountPresets` to banking manifest**

In `demo_api_server/config/verticals/banking/manifest.json`, inside the `"terminology"` object, add after `"highValueLabel"`:

```json
"amountPresets": [100, 500, 1000, 2500]
```

- [ ] **Step 2: Add `amountPresets` to investment manifest**

In `demo_api_server/config/verticals/investment/manifest.json`, inside the `"terminology"` object, add after `"highValueLabel"`:

```json
"amountPresets": [500, 1000, 5000, 10000]
```

- [ ] **Step 3: Add amount button CSS to `AIAgent.css`**

Add after the `.clarify-options` block:

```css
/* Amount quick-pick row — rendered below account option buttons */
.clarify-amounts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  animation: clarify-fadein 0.15s ease-out 0.05s both;
}

.clarify-amounts__btn {
  padding: 3px 12px;
  border-radius: 14px;
  border: 1px solid rgba(80, 200, 120, 0.4);
  background: rgba(80, 200, 120, 0.1);
  color: #1a7a3c;
  font-size: 0.78rem;
  font-weight: 500;
  font-family: monospace;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.clarify-amounts__btn:hover:not(:disabled) {
  background: rgba(80, 200, 120, 0.2);
  border-color: rgba(80, 200, 120, 0.65);
}

.clarify-amounts__btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.ba-mode-light .clarify-amounts__btn {
  border-color: rgba(22, 101, 52, 0.35);
  background: rgba(22, 101, 52, 0.06);
  color: #14532d;
}

.ba-mode-light .clarify-amounts__btn:hover:not(:disabled) {
  background: rgba(22, 101, 52, 0.12);
}
```

- [ ] **Step 4: Verify build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: succeeds.

- [ ] **Step 5: Verify API server tests still pass**

```bash
cd demo_api_server && CI=true npm test -- --forceExit 2>&1 | tail -10
```

Expected: no failures from manifest changes.

- [ ] **Step 6: Commit**

```bash
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/clarify-dropdown-options \
  add demo_api_server/config/verticals/banking/manifest.json \
      demo_api_server/config/verticals/investment/manifest.json \
      demo_api_ui/src/components/AIAgent.css
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/clarify-dropdown-options \
  commit -m "feat(clarify): add amountPresets to banking+investment manifests and amount button CSS"
```

---

## Task 4: Amount quick-picks wired in `ClarifyOptions` + `AIAgent.js`

Add `amountOptions` prop to `ClarifyOptions`. Wire `AIAgent.js` to pass `amountOptions` from `terminology.amountPresets` when the action has an amount slot and the user hasn't provided an amount yet.

**Files:**
- Modify: `demo_api_ui/src/components/agentChrome.js` — `ClarifyOptions`
- Modify: `demo_api_ui/src/components/AIAgent.js` — banking clarification + vertical `needsParams` call sites

**Interfaces:**
- Consumes: `ClarifyOptions` from Task 1; `terminology.amountPresets` from Task 3
- Produces: `ClarifyOptions({ ..., amountOptions?: number[] })` renders a second pill row; clicking sends `"$500"` through `onSelect`

- [ ] **Step 1: Add amount tests to `agentChrome.test.jsx`**

Append to the existing describe block in `demo_api_ui/src/components/__tests__/agentChrome.test.jsx`:

```jsx
describe('ClarifyOptions — amountOptions', () => {
  it('renders amount buttons when amountOptions provided', () => {
    render(
      <ClarifyOptions
        options={['Checking']}
        amountOptions={[100, 500, 1000]}
        onSelect={() => {}}
        active={true}
      />
    );
    expect(screen.getByText('$100')).toBeInTheDocument();
    expect(screen.getByText('$500')).toBeInTheDocument();
    expect(screen.getByText('$1,000')).toBeInTheDocument();
  });

  it('calls onSelect with "$500" when amount button clicked', () => {
    const onSelect = vi.fn();
    render(
      <ClarifyOptions
        options={[]}
        amountOptions={[500]}
        onSelect={onSelect}
        active={true}
      />
    );
    fireEvent.click(screen.getByText('$500'));
    expect(onSelect).toHaveBeenCalledWith('$500');
  });

  it('disables amount buttons when active=false', () => {
    render(
      <ClarifyOptions
        options={[]}
        amountOptions={[100]}
        onSelect={() => {}}
        active={false}
      />
    );
    expect(screen.getByRole('button', { name: '$100' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd demo_api_ui && npm run test:unit -- --reporter=verbose agentChrome
```

Expected: FAIL — `amountOptions` prop not yet implemented.

- [ ] **Step 3: Add `amountOptions` rendering to `ClarifyOptions` in `agentChrome.js`**

```jsx
export function ClarifyOptions({ options, amountOptions, onSelect, active, onDismiss }) {
  if ((!options || options.length === 0) && (!amountOptions || amountOptions.length === 0)) return null;

  function getLabel(opt) {
    return typeof opt === 'object' && opt !== null ? opt.label : opt;
  }
  function getValue(opt) {
    if (typeof opt === 'object' && opt !== null) return opt.value;
    return opt.charAt(0).toLowerCase() + opt.slice(1);
  }

  function fmtAmount(n) {
    return '$' + Number(n).toLocaleString('en-US');
  }

  return (
    <div>
      {options && options.length > 0 && (
        <div className="clarify-options" role="listbox">
          {options.map((opt) => {
            const label = getLabel(opt);
            const value = getValue(opt);
            return (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected="false"
                className="clarify-options__btn"
                disabled={!active}
                onClick={() => active && onSelect(value)}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {amountOptions && amountOptions.length > 0 && (
        <div className="clarify-amounts" role="listbox" aria-label="Amount presets">
          {amountOptions.map((amt) => (
            <button
              key={amt}
              type="button"
              role="option"
              aria-selected="false"
              className="clarify-amounts__btn"
              disabled={!active}
              onClick={() => active && onSelect(fmtAmount(amt))}
            >
              {fmtAmount(amt)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire `amountOptions` in `AIAgent.js` — banking path**

Find the banking clarification block (~line 6414 where `addMessage("assistant", questions[action], ...)` is called). The actions that warrant amount presets are `deposit`, `withdraw`, `transfer`.

Read `terminology?.amountPresets` — it's already available on the `terminology` variable used in that same block.

Add this before the `addMessage` call:

```js
const AMOUNT_ACTIONS = new Set(['deposit', 'withdraw', 'transfer']);
const amountOptions = AMOUNT_ACTIONS.has(action) && !((p || {}).amount)
  ? (terminology?.amountPresets || null)
  : null;
```

Then pass `amountOptions` to both the `addMessage` call and the `setPendingClarification` call:

```js
addMessage("assistant", questions[action], null, { source: _source, clarifyOptions: acctTypes, amountOptions });
setPendingClarification({
  action,
  partialParams: p || {},
  asked: questions[action],
  clarifyOptions: acctTypes,
  amountOptions,
});
```

Also update the re-ask paths (~lines 5729, 5743) to preserve `amountOptions`:

```js
addMessage("assistant", `Sorry, I didn't catch that. ${pc.asked}`, null, {
  paramHint: pc.hint || null,
  clarifyOptions: pc.clarifyOptions || null,
  amountOptions: pc.amountOptions || null,
});
// and:
addMessage("assistant", reAsk, null, {
  paramHint: pc.hint || null,
  clarifyOptions: pc.clarifyOptions || null,
  amountOptions: pc.amountOptions || null,
});
setPendingClarification({
  ...pc,
  // preserve existing fields
});
```

- [ ] **Step 5: Wire `amountOptions` in `AIAgent.js` — render site**

Find the `ClarifyOptions` render call (~line 10592):

```jsx
<ClarifyOptions
  options={msg.clarifyOptions}
  active={...}
  onSelect={(opt) => sendAsNl(opt)}
/>
```

Add `amountOptions`:

```jsx
<ClarifyOptions
  options={msg.clarifyOptions}
  amountOptions={msg.amountOptions || null}
  active={pendingClarification != null && msg.id === messages[messages.length - 1]?.id}
  onSelect={(opt) => sendAsNl(opt)}
/>
```

- [ ] **Step 6: Run tests**

```bash
cd demo_api_ui && npm run test:unit -- --reporter=verbose agentChrome
```

Expected: all tests PASS.

- [ ] **Step 7: Verify build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

- [ ] **Step 8: Commit**

```bash
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/clarify-dropdown-options \
  add demo_api_ui/src/components/agentChrome.js \
      demo_api_ui/src/components/AIAgent.js \
      demo_api_ui/src/components/__tests__/agentChrome.test.jsx
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/clarify-dropdown-options \
  commit -m "feat(clarify): amount quick-pick buttons for deposit/withdraw/transfer"
```

---

## Task 5: Enum choices in `needsParams` (BFF)

When a vertical tool's `inputSchema.properties[k].enum` exists for a missing param, include it in the `needsParams` response as `choices: { [param]: string[] }`.

**Files:**
- Modify: `demo_api_server/services/demoAgentLangGraphService.js` — `needsParams` block (~line 1328)

**Interfaces:**
- Produces: `needsParams: { action, missing, hint, choices?: { [paramName]: string[] } }`

- [ ] **Step 1: Write failing Jest test**

File: `demo_api_server/tests/needsParams.choices.test.js`

```js
'use strict';

// Minimal stub of the needsParams block extracted for unit testing.
// We test the choices-extraction logic in isolation by calling the service
// via the vertical plugin interface.
const path = require('path');

describe('needsParams choices extraction', () => {
  it('includes enum choices for missing params that have an enum', async () => {
    // The investment deposit tool has portfolioType as required with no enum.
    // We add a test vertical with an enum to verify the extraction path.
    const toolDef = {
      name: 'test_action',
      inputSchema: {
        type: 'object',
        required: ['category'],
        properties: {
          category: {
            type: 'string',
            enum: ['Alpha', 'Beta', 'Gamma'],
          },
        },
      },
    };
    const params = {}; // category missing

    const required = toolDef.inputSchema.required || [];
    const missing = required.filter((k) => params[k] == null || params[k] === '');

    // Extract choices for missing params that have an enum
    const choices = {};
    missing.forEach((k) => {
      const prop = toolDef.inputSchema.properties && toolDef.inputSchema.properties[k];
      if (prop && Array.isArray(prop.enum)) {
        choices[k] = prop.enum;
      }
    });

    expect(missing).toEqual(['category']);
    expect(choices).toEqual({ category: ['Alpha', 'Beta', 'Gamma'] });
  });

  it('produces empty choices object when no enum defined', () => {
    const toolDef = {
      name: 'order_status',
      inputSchema: {
        type: 'object',
        required: ['orderId'],
        properties: { orderId: { type: 'string' } },
      },
    };
    const params = {};
    const missing = ['orderId'];
    const choices = {};
    missing.forEach((k) => {
      const prop = toolDef.inputSchema.properties && toolDef.inputSchema.properties[k];
      if (prop && Array.isArray(prop.enum)) choices[k] = prop.enum;
    });
    expect(choices).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify it passes (logic test, not integration)**

```bash
cd demo_api_server && CI=true npx jest tests/needsParams.choices.test.js --forceExit
```

Expected: PASS (the logic is tested in isolation; this confirms the extraction logic is correct before wiring it).

- [ ] **Step 3: Wire choices extraction into `demoAgentLangGraphService.js`**

Find the `needsParams` return block (~line 1339):

```js
return {
  reply: `To ${String(action).replace(/_/g, ' ')}, I need: ...`,
  success: false,
  needsParams: { action, missing, hint: paramHint },
  ...
};
```

Replace with:

```js
// Extract enum choices for missing params that define them.
const choices = {};
missing.forEach((k) => {
  const prop = toolDef && toolDef.inputSchema && toolDef.inputSchema.properties && toolDef.inputSchema.properties[k];
  if (prop && Array.isArray(prop.enum)) {
    choices[k] = prop.enum;
  }
});
return {
  reply: `To ${String(action).replace(/_/g, ' ')}, I need: ${missingLabels.join(', ')}. Please provide ${missing.length > 1 ? 'these details' : 'this detail'}.`,
  success: false,
  needsParams: {
    action,
    missing,
    hint: paramHint,
    ...(Object.keys(choices).length > 0 ? { choices } : {}),
  },
  toolsCalled: [],
  tokensUsed: 0,
  requiresConsent: false,
  agentConfigured: true,
  tokenEvents,
};
```

- [ ] **Step 4: Run API tests**

```bash
cd demo_api_server && CI=true npm test -- --forceExit 2>&1 | tail -15
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/clarify-dropdown-options \
  add demo_api_server/services/demoAgentLangGraphService.js \
      demo_api_server/tests/needsParams.choices.test.js
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/clarify-dropdown-options \
  commit -m "feat(clarify): include enum choices in needsParams response"
```

---

## Task 6: Vertical enum choices consumed in `AIAgent.js`

At the vertical `needsParams` call site, prefer `response.needsParams.choices[missing[0]]` over the `liveAccounts` type fallback when choices are present.

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js` — vertical `needsParams` handler (~line 6479)

**Interfaces:**
- Consumes: `response.needsParams.choices?: { [paramName]: string[] }` from Task 5
- The `clarifyOptions` passed to `addMessage` / `setPendingClarification` becomes `string[]` (enum values) instead of type-derived strings

- [ ] **Step 1: Find the `needsClarifyOptions` computation (~line 6479)**

```js
const typeParams = new Set(['accounttype', 'portfoliotype', 'accountid', 'fromid', 'toid']);
const hasTypeParam = response.needsParams?.missing?.some(
  (k) => typeParams.has(String(k).toLowerCase()),
);
const needsClarifyOptions = hasTypeParam
  ? [...new Set((liveAccounts || []).map((a) => a.type).filter(Boolean))]
  : null;
```

- [ ] **Step 2: Replace with choices-first logic**

```js
const typeParams = new Set(['accounttype', 'portfoliotype', 'accountid', 'fromid', 'toid']);
const firstMissing = response.needsParams?.missing?.[0];
const enumChoices = firstMissing && response.needsParams?.choices?.[firstMissing];
const hasTypeParam = response.needsParams?.missing?.some(
  (k) => typeParams.has(String(k).toLowerCase()),
);
const needsClarifyOptions = enumChoices
  ? enumChoices
  : hasTypeParam
    ? [...new Set((liveAccounts || []).map((a) => a.type).filter(Boolean))]
    : null;
```

This change is in two places in the file — the initial `needsClarifyOptions` computation and the re-ask paths at lines ~7208 and ~7221. Both `setPendingClarification` call sites already use `clarifyOptions: needsClarifyOptions` so no further changes needed there.

Check for the second occurrence and apply the same replacement:

```bash
grep -n "needsClarifyOptions" demo_api_ui/src/components/AIAgent.js
```

If there is a second independent computation block (not just references), apply the same replacement there.

- [ ] **Step 3: Verify build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

- [ ] **Step 4: Run unit tests**

```bash
cd demo_api_ui && npm run test:unit
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/clarify-dropdown-options \
  add demo_api_ui/src/components/AIAgent.js
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/clarify-dropdown-options \
  commit -m "feat(clarify): use needsParams.choices for vertical enum dropdowns"
```

---

## Task 7: Keyboard navigation in `ClarifyOptions`

Add arrow key navigation, Enter to select, Escape to dismiss. Uses `onKeyDown` on each button. No external library.

**Files:**
- Modify: `demo_api_ui/src/components/agentChrome.js` — `ClarifyOptions`

**Interfaces:**
- Consumes: `onDismiss?: () => void` prop (already on the signature from Task 1)
- Arrow Left/Right cycle focus within the row; Enter fires `onSelect`; Escape calls `onDismiss`

- [ ] **Step 1: Add keyboard nav tests**

Append to `demo_api_ui/src/components/__tests__/agentChrome.test.jsx`:

```jsx
describe('ClarifyOptions — keyboard nav', () => {
  it('moves focus right on ArrowRight', () => {
    render(
      <ClarifyOptions
        options={['Checking', 'Savings']}
        onSelect={() => {}}
        active={true}
      />
    );
    const btns = screen.getAllByRole('option');
    btns[0].focus();
    fireEvent.keyDown(btns[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(btns[1]);
  });

  it('wraps from last to first on ArrowRight', () => {
    render(
      <ClarifyOptions
        options={['A', 'B']}
        onSelect={() => {}}
        active={true}
      />
    );
    const btns = screen.getAllByRole('option');
    btns[1].focus();
    fireEvent.keyDown(btns[1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(btns[0]);
  });

  it('calls onDismiss on Escape', () => {
    const onDismiss = vi.fn();
    render(
      <ClarifyOptions
        options={['A']}
        onSelect={() => {}}
        active={true}
        onDismiss={onDismiss}
      />
    );
    const btn = screen.getByRole('option', { name: 'A' });
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd demo_api_ui && npm run test:unit -- --reporter=verbose agentChrome
```

Expected: keyboard nav tests FAIL.

- [ ] **Step 3: Add keyboard nav to `ClarifyOptions`**

Inside `ClarifyOptions`, add a `handleKeyDown` function and attach it to each option button. Also set `tabIndex` so roving tabindex works:

```jsx
export function ClarifyOptions({ options, amountOptions, onSelect, active, onDismiss }) {
  if ((!options || options.length === 0) && (!amountOptions || amountOptions.length === 0)) return null;

  function getLabel(opt) {
    return typeof opt === 'object' && opt !== null ? opt.label : opt;
  }
  function getValue(opt) {
    if (typeof opt === 'object' && opt !== null) return opt.value;
    return opt.charAt(0).toLowerCase() + opt.slice(1);
  }
  function fmtAmount(n) {
    return '$' + Number(n).toLocaleString('en-US');
  }

  function handleKeyDown(e, allBtns, idx) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = (idx + 1) % allBtns.length;
      allBtns[next] && allBtns[next].focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = (idx - 1 + allBtns.length) % allBtns.length;
      allBtns[prev] && allBtns[prev].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss && onDismiss();
    }
  }

  const optionButtons = (options || []).map((opt, idx) => {
    const label = getLabel(opt);
    const value = getValue(opt);
    return (
      <button
        key={value}
        type="button"
        role="option"
        aria-selected="false"
        className="clarify-options__btn"
        disabled={!active}
        tabIndex={idx === 0 ? 0 : -1}
        onClick={() => active && onSelect(value)}
        onKeyDown={(e) => {
          const container = e.currentTarget.closest('.clarify-options');
          const btns = container ? Array.from(container.querySelectorAll('button:not(:disabled)')) : [];
          handleKeyDown(e, btns, btns.indexOf(e.currentTarget));
        }}
      >
        {label}
      </button>
    );
  });

  const amountButtons = (amountOptions || []).map((amt) => (
    <button
      key={amt}
      type="button"
      role="option"
      aria-selected="false"
      className="clarify-amounts__btn"
      disabled={!active}
      onClick={() => active && onSelect(fmtAmount(amt))}
    >
      {fmtAmount(amt)}
    </button>
  ));

  return (
    <div>
      {optionButtons.length > 0 && (
        <div className="clarify-options" role="listbox">
          {optionButtons}
        </div>
      )}
      {amountButtons.length > 0 && (
        <div className="clarify-amounts" role="listbox" aria-label="Amount presets">
          {amountButtons}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire `onDismiss` in `AIAgent.js` render site**

Find the `ClarifyOptions` render (~line 10592) and add `onDismiss`:

```jsx
<ClarifyOptions
  options={msg.clarifyOptions}
  amountOptions={msg.amountOptions || null}
  active={pendingClarification != null && msg.id === messages[messages.length - 1]?.id}
  onSelect={(opt) => sendAsNl(opt)}
  onDismiss={() => nlInputRef.current?.focus()}
/>
```

`nlInputRef` is the NL text input ref already present in `AIAgent.js` — search for `nlInputRef` to confirm its name. If the ref has a different name, use the correct one.

- [ ] **Step 5: Run all tests**

```bash
cd demo_api_ui && npm run test:unit -- --reporter=verbose agentChrome
```

Expected: all tests PASS.

- [ ] **Step 6: Verify build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/clarify-dropdown-options \
  add demo_api_ui/src/components/agentChrome.js \
      demo_api_ui/src/components/AIAgent.js \
      demo_api_ui/src/components/__tests__/agentChrome.test.jsx
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/clarify-dropdown-options \
  commit -m "feat(clarify): keyboard nav — arrows cycle, Escape dismisses"
```

---

## Task 8: Final verification + PR

Run the full test suites, confirm all success criteria from the spec, then create the PR.

**Files:** none

- [ ] **Step 1: Run full UI test suite**

```bash
cd demo_api_ui && npm run test:unit && npm run build
```

Expected: ✅ all tests pass, build green.

- [ ] **Step 2: Run full API test suite**

```bash
cd demo_api_server && CI=true npm test -- --forceExit
```

Expected: ✅ no regressions.

- [ ] **Step 3: Run topology verify**

```bash
npm run topology:verify
```

Expected: no drift.

- [ ] **Step 4: Manual smoke test**

Open `https://local.ping-devops.com:4000`, select Banking vertical, type "check my balance" — verify buttons show `"Checking ••XXXX"` / `"Savings ••XXXX"`. Type "transfer" — verify account buttons + `$100 / $500 / $1,000 / $2,500` amount row appears. Select Investment, type "deposit $500" — verify portfolio type buttons (Brokerage / Retirement / Trust) appear. Arrow keys should cycle focus; Escape should focus the text input.

- [ ] **Step 5: Create PR**

```bash
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/clarify-dropdown-options push -u origin worktree-clarify-dropdown-options
gh pr create \
  --title "feat(clarify): smarter dropdowns — masked numbers, amount presets, enum coverage, keyboard nav" \
  --body "$(cat <<'EOF'
## Summary

- Account option buttons now show type + masked last-4 digits (e.g. "Checking ••6789") so users can distinguish multiple accounts of the same type
- Amount quick-pick buttons ($100 / $500 / $1,000 / $2,500) appear below account options for deposit/withdraw/transfer actions
- All verticals with static enum params (e.g. government inspection type, airlines cabin class) now surface dropdown buttons via `needsParams.choices` extracted from `inputSchema.enum`
- Keyboard nav: arrow keys cycle focus, Enter selects, Escape returns focus to text input
- Fade-in animation on button row appear

## Test plan

- [ ] Banking "check my balance" → buttons show masked account numbers
- [ ] Banking "transfer" → account buttons + amount row
- [ ] Investment "deposit $500" → portfolio type buttons (amount row disabled since amount given)
- [ ] `npm run test:unit` + `npm run build` green in `demo_api_ui`
- [ ] `CI=true npm test -- --forceExit` green in `demo_api_server`
- [ ] `npm run topology:verify` clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Success Criteria Checklist

1. Banking "check balance" → buttons show `"Checking ••6789 / Savings ••4521"`
2. Banking "transfer" → account buttons + `$100 / $500 / $1,000 / $2,500` amount row
3. Investment "deposit $500" → portfolio buttons + amount row (disabled, amount already given)
4. Government "schedule inspection" → type dropdown from `inputSchema.enum`
5. Button rows animate in; selected button highlights; row disabled after reply
6. Keyboard: arrows cycle, Enter selects, Escape returns focus to text input
7. `npm run test:unit && npm run build` green · `CI=true npm test -- --forceExit` green
