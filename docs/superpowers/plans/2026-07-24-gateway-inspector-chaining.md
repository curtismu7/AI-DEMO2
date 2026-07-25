# Gateway Inspector Chaining Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `/pinggateway-inspector` (`AgentGatewayTester.jsx`) run MCP tools in a sensible order and carry values (account `id`) forward between calls, and let `get_sensitive_account_details` accept an optional `account_id` so it can join that chain.

**Architecture:** Two small, independent slices. (1) `demo_mcp_server` gains an optional `account_id` filter on one existing tool — pure additive schema + handler change, no new endpoints. (2) `demo_api_ui`'s `AgentGatewayTester.jsx` gains client-side state (`capturedValues`) that's populated from tool responses and used to autofill/offer values for the next call, plus a "Run chain" button that drives the existing `/api/mcp-gateway/test` endpoint three times in a row. No new backend endpoints anywhere.

**Tech Stack:** TypeScript + Jest (`demo_mcp_server`), React + Vitest + Testing Library (`demo_api_ui`).

## Global Constraints

- No new backend endpoints — the chain button reuses the existing `POST /api/mcp-gateway/test`, called once per step.
- `create_transfer` is never part of the auto-run chain (moves money / can trigger HITL); it stays manual-only, though its `from_account_id`/`to_account_id` still get autofill + the captured-values picker.
- The Arguments JSON `<textarea>` must remain a plain controlled input with no `readOnly`/`disabled` — autofill only changes the *initial* value on tool select, never overwrites text the user is actively editing.
- `get_sensitive_account_details`'s `account_id` param is **optional** (`required: []` stays) and `additionalProperties: false` stays on the schema — omitting it must reproduce today's exact behavior (all accounts).
- Work happens in the `gateway-inspector-chaining` worktree (already active — branch `worktree-gateway-inspector-chaining`). Stage files explicitly per commit, never `git add -A`.
- Spec: `docs/superpowers/specs/2026-07-24-gateway-inspector-chaining-design.md`.

---

## Task 1: Backend — optional `account_id` on `get_sensitive_account_details` schema

**Files:**
- Modify: `demo_mcp_server/src/tools/BankingToolRegistry.ts:190-220` (the `get_sensitive_account_details` tool entry)
- Test: `demo_mcp_server/tests/tools/BankingToolRegistry.test.ts`

**Interfaces:**
- Produces: `BankingToolRegistry.getTool('get_sensitive_account_details').inputSchema.properties.account_id` — `{ type: 'string', description: string }`, with `required: []` unchanged.

- [ ] **Step 1: Write the failing test**

Add this test in `demo_mcp_server/tests/tools/BankingToolRegistry.test.ts`, directly after the existing `'should require read scope for sensitive account details'` test (around line 224):

```ts
    it('get_sensitive_account_details accepts an optional account_id filter', () => {
      const tool = BankingToolRegistry.getTool('get_sensitive_account_details');
      expect(tool?.inputSchema.required).toEqual([]);
      expect(tool?.inputSchema.properties?.account_id?.type).toBe('string');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_mcp_server && NODE_ENV=test npx jest tests/tools/BankingToolRegistry.test.ts -t "accepts an optional account_id filter"`
Expected: FAIL — `tool?.inputSchema.properties?.account_id` is `undefined`, so `.type` throws / assertion fails.

- [ ] **Step 3: Add the property to the schema**

In `demo_mcp_server/src/tools/BankingToolRegistry.ts`, replace the `get_sensitive_account_details` entry's `description` and `inputSchema`:

```ts
      description: 'Retrieve sensitive account details (full account number and routing number). Requires sensitive:read scope and user consent — the UI will prompt the user to approve access before this data is released. Optionally pass account_id (from get_my_accounts) to limit the result to one account.',
```

```ts
      inputSchema: {
        type: 'object',
        properties: {
          account_id: {
            type: 'string',
            description: 'Optional account ID (UUID) from get_my_accounts. Omit to return every account\'s sensitive details.',
          },
        },
        required: [],
        additionalProperties: false
      }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_mcp_server && NODE_ENV=test npx jest tests/tools/BankingToolRegistry.test.ts`
Expected: PASS (all tests in the file, including the generic schema-shape test that iterates every tool).

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_server/src/tools/BankingToolRegistry.ts demo_mcp_server/tests/tools/BankingToolRegistry.test.ts
git commit -m "feat(mcp-server): add optional account_id to get_sensitive_account_details schema"
```

---

## Task 2: Backend — filter sensitive account details by `account_id`

**Files:**
- Modify: `demo_mcp_server/src/tools/handlers/accountHandlers.ts:116-152` (`executeGetSensitiveAccountDetails`)
- Test: Create `demo_mcp_server/tests/tools/handlers/accountHandlers.test.ts`

**Interfaces:**
- Consumes: `HandlerDeps` / `HandlerFn` from `demo_mcp_server/src/tools/handlers/types.ts` (`apiClient.getSensitiveAccountDetails(token): Promise<{ accounts?: Array<{id: string, ...}> }>`); `createSuccessResult(text, data)` from `./results.ts` (puts `data` under `result.structuredContent`).
- Produces: `executeGetSensitiveAccountDetails(deps, token, { account_id?: string })` — when `account_id` is provided, `structuredContent.accounts` is filtered to the matching `id` (empty array on no match); omitted → unchanged (all accounts).

- [ ] **Step 1: Write the failing tests**

Create `demo_mcp_server/tests/tools/handlers/accountHandlers.test.ts`:

```ts
import { executeGetSensitiveAccountDetails } from '../../../src/tools/handlers/accountHandlers';
import type { HandlerDeps } from '../../../src/tools/handlers/types';

function makeDeps(getSensitiveAccountDetails: jest.Mock): HandlerDeps {
  return {
    apiClient: { getSensitiveAccountDetails } as any,
    logger: { debug: jest.fn(), error: jest.fn() } as any,
  };
}

const ACCOUNTS_RESPONSE = {
  ok: true,
  accounts: [
    { id: 'acct-1', accountType: 'checking', accountNumberFull: '111122223333', routingNumber: '021000021' },
    { id: 'acct-2', accountType: 'savings', accountNumberFull: '444455556666', routingNumber: '021000021' },
  ],
};

describe('executeGetSensitiveAccountDetails', () => {
  it('returns every account when account_id is omitted', async () => {
    const deps = makeDeps(jest.fn().mockResolvedValue(ACCOUNTS_RESPONSE));
    const result = await executeGetSensitiveAccountDetails(deps, 'token', {});
    expect(result.success).toBe(true);
    expect(result.structuredContent?.accounts).toHaveLength(2);
  });

  it('filters to the matching account when account_id is provided', async () => {
    const deps = makeDeps(jest.fn().mockResolvedValue(ACCOUNTS_RESPONSE));
    const result = await executeGetSensitiveAccountDetails(deps, 'token', { account_id: 'acct-2' });
    expect(result.success).toBe(true);
    expect(result.structuredContent?.accounts).toEqual([
      expect.objectContaining({ id: 'acct-2', accountType: 'savings' }),
    ]);
  });

  it('returns an empty accounts array for an unknown account_id', async () => {
    const deps = makeDeps(jest.fn().mockResolvedValue(ACCOUNTS_RESPONSE));
    const result = await executeGetSensitiveAccountDetails(deps, 'token', { account_id: 'nope' });
    expect(result.success).toBe(true);
    expect(result.structuredContent?.accounts).toEqual([]);
  });

  it('still surfaces consent_required and ignores account_id on that path', async () => {
    const deps = makeDeps(
      jest.fn().mockResolvedValue({ ok: false, consent_required: true, reason: 'sensitive_data_access' })
    );
    const result = await executeGetSensitiveAccountDetails(deps, 'token', { account_id: 'acct-1' });
    expect(result.success).toBe(true);
    expect(result.structuredContent?.consent_required).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_mcp_server && NODE_ENV=test npx jest tests/tools/handlers/accountHandlers.test.ts`
Expected: FAIL on the "filters to the matching account" and "empty accounts array" cases (handler ignores `account_id` today and always returns both accounts).

- [ ] **Step 3: Implement the filter**

In `demo_mcp_server/src/tools/handlers/accountHandlers.ts`, replace `executeGetSensitiveAccountDetails`:

```ts
export const executeGetSensitiveAccountDetails: HandlerFn = async (deps, token, params) => {
  const { account_id } = (params || {}) as { account_id?: string };
  deps.logger.debug(`[BankingToolProvider] Calling Banking API: getSensitiveAccountDetails`);
  try {
    const response = await deps.apiClient.getSensitiveAccountDetails(token);

    if (response && (response as any).ok === false && (response as any).step_up_required === true) {
      const stepUpPayload = {
        ok: false,
        step_up_required: true,
        error: 'step_up_required',
        step_up_method: (response as any).step_up_method || 'email',
      };
      return createSuccessResult(JSON.stringify(stepUpPayload, null, 2), stepUpPayload);
    }

    if (response && (response as any).ok === false && (response as any).consent_required) {
      const consentPayload = {
        ok: false,
        consent_required: true,
        reason: (response as any).reason || 'sensitive_data_access',
      };
      return createSuccessResult(JSON.stringify(consentPayload, null, 2), consentPayload);
    }

    if (!response || (response as any).ok === false) {
      return createErrorResult(`Access denied: ${(response as any)?.reason || 'paz_denied'}`);
    }

    let accounts = (response as any).accounts || [];
    if (account_id) {
      accounts = accounts.filter((a: any) => a.id === account_id);
    }
    const data = { success: true, accounts };
    return createSuccessResult(JSON.stringify(data, null, 2), data);
  } catch (error) {
    deps.logger.error('[BankingToolProvider] getSensitiveAccountDetails error:', {}, error instanceof Error ? error : undefined);
    return createErrorResult(
      `Failed to retrieve sensitive account details: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};
```

(Only the signature — `_params` → `params` — and the new `account_id` destructure + filter block change; the step-up / consent / denied / catch branches are unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_mcp_server && NODE_ENV=test npx jest tests/tools/handlers/accountHandlers.test.ts tests/tools/BankingToolRegistry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_server/src/tools/handlers/accountHandlers.ts demo_mcp_server/tests/tools/handlers/accountHandlers.test.ts
git commit -m "feat(mcp-server): filter get_sensitive_account_details by optional account_id"
```

---

## Task 3: Frontend — capture values from responses, autofill matching args

**Files:**
- Modify: `demo_api_ui/src/components/AgentGatewayTester.jsx`
- Test: `demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx`

**Interfaces:**
- Produces (module-level, used by Tasks 4 & 5 too):
  - `ACCOUNT_ID_PATTERN = /_?account_id$/i`
  - `CAPTURED_VALUES_LIMIT = 20`
  - `extractCapturedValues(result) => Array<{label: string, value: string}>` — reads `result.accounts` (array of `{id, accountType?, name?, accountNumber?, accountNumberFull?}`), returns one entry per item with an `id`.
  - `mergeCapturedValues(existing, fresh) => Array<{label, value}>` — fresh entries first, deduped by `value`, capped at `CAPTURED_VALUES_LIMIT`.
  - `buildArgsTemplate(tool, capturedValues = [])` — existing function, now takes a second param; required props matching `ACCOUNT_ID_PATTERN` are prefilled from `capturedValues[0]?.value` when present.
- Produces (component state): `capturedValues` (`useState([])`), read by Task 4's picker and Task 5's `runChain`.

- [ ] **Step 1: Write the failing test**

Add to `demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx`:

```jsx
test('running get_my_accounts captures the account id and autofills it into get_account_balance', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'get_my_accounts', description: 'List accounts.', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'get_account_balance', description: 'Get balance.', inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] } },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post.mockResolvedValueOnce({
    data: { ok: true, result: { success: true, accounts: [{ id: 'acct-123', accountType: 'checking', accountNumber: '****9876' }] }, durationMs: 10 },
  });
  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('get_my_accounts'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('get_account_balance'));
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ account_id: 'acct-123' }, null, 2));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AgentGatewayTester.test.jsx`
Expected: FAIL — `get_account_balance`'s textarea still shows `{"account_id": ""}` (no capture/autofill exists yet).

- [ ] **Step 3: Implement capture + autofill**

In `demo_api_ui/src/components/AgentGatewayTester.jsx`, add these consts right after `ARG_PLACEHOLDER_BY_TYPE` (after line 74, before `buildArgsTemplate`):

```jsx
const ACCOUNT_ID_PATTERN = /_?account_id$/i;
const CAPTURED_VALUES_LIMIT = 20;

/** {label, value} for each id-bearing account in a tool result's `accounts` array. */
function extractCapturedValues(result) {
  const accounts = result && Array.isArray(result.accounts) ? result.accounts : [];
  return accounts
    .filter((a) => a && a.id)
    .map((a) => {
      const digits = String(a.accountNumber || a.accountNumberFull || '').replace(/\D/g, '');
      const last4 = digits.slice(-4);
      const descriptor = a.accountType || a.name || 'account';
      return { label: last4 ? `${descriptor} …${last4}` : descriptor, value: a.id };
    });
}

/** Fresh entries first, deduped by value against the existing list, capped. */
function mergeCapturedValues(existing, fresh) {
  if (!fresh.length) return existing;
  const merged = [...fresh, ...existing.filter((e) => !fresh.some((f) => f.value === e.value))];
  return merged.slice(0, CAPTURED_VALUES_LIMIT);
}
```

Replace `buildArgsTemplate` (lines 76-86) to accept and use `capturedValues`:

```jsx
/** Template args for a tool's required inputSchema properties; account_id-like keys autofill from the most recent captured value. */
const buildArgsTemplate = (tool, capturedValues = []) => {
  const required = tool?.inputSchema?.required || [];
  if (!required.length) return '{}';
  const template = {};
  const latestId = capturedValues[0]?.value;
  for (const key of required) {
    if (latestId && ACCOUNT_ID_PATTERN.test(key)) {
      template[key] = latestId;
      continue;
    }
    const propType = tool.inputSchema.properties?.[key]?.type;
    template[key] = propType in ARG_PLACEHOLDER_BY_TYPE ? ARG_PLACEHOLDER_BY_TYPE[propType] : '';
  }
  return JSON.stringify(template, null, 2);
};
```

Add state, right after `const [argsText, setArgsText] = useState('{}');` (line 118):

```jsx
  const [capturedValues, setCapturedValues] = useState([]);
```

Update `selectTool` (lines 316-321) to pass captured values:

```jsx
  const selectTool = (t) => {
    setSelectedTool(t);
    setArgsText(buildArgsTemplate(t, capturedValues));
    setResp(null);
    setOutputTab('result');
  };
```

Update `send` (lines 245-265) to capture values from a successful response — after the existing `setResp(data); setOutputTab('result');` lines inside the `try` block, append:

```jsx
      setResp(data);
      setOutputTab('result');
      const fresh = extractCapturedValues(data?.result ?? data?.rpcData);
      if (fresh.length) setCapturedValues((prev) => mergeCapturedValues(prev, fresh));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AgentGatewayTester.test.jsx`
Expected: PASS (all tests in the file, including the pre-existing ones — `buildArgsTemplate`'s new second param is optional so the existing `selecting a tool populates...` test, which never runs `send()` first, still gets `{"account_id": ""}`).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/AgentGatewayTester.jsx demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx
git commit -m "feat(ui): capture account ids from gateway responses and autofill them into the next tool's args"
```

---

## Task 4: Frontend — captured-values picker (manual override)

**Files:**
- Modify: `demo_api_ui/src/components/AgentGatewayTester.jsx`
- Test: `demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx`

**Interfaces:**
- Consumes: `capturedValues` state and `ACCOUNT_ID_PATTERN` from Task 3.
- No new exports — this is a UI-only addition inside the `middle` panel's Arguments field.

- [ ] **Step 1: Write the failing test**

Add to `demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx`:

```jsx
test('the captured-values dropdown patches a different account id into the arguments JSON', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'get_my_accounts', description: 'List accounts.', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'get_account_balance', description: 'Get balance.', inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] } },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post.mockResolvedValueOnce({
    data: {
      ok: true,
      result: {
        success: true,
        accounts: [
          { id: 'acct-checking', accountType: 'checking', accountNumber: '****1111' },
          { id: 'acct-savings', accountType: 'savings', accountNumber: '****2222' },
        ],
      },
      durationMs: 10,
    },
  });
  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('get_my_accounts'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('get_account_balance'));
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ account_id: 'acct-checking' }, null, 2));

  fireEvent.change(screen.getByLabelText('Insert captured value'), { target: { value: 'acct-savings' } });
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ account_id: 'acct-savings' }, null, 2));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AgentGatewayTester.test.jsx`
Expected: FAIL — no element with label "Insert captured value" exists yet.

- [ ] **Step 3: Add the picker**

In `demo_api_ui/src/components/AgentGatewayTester.jsx`, inside the `middle` panel's `inspector-shell-field` block (around lines 516-529), insert the picker between the `<label>` and the `<textarea>`:

```jsx
              <div className="inspector-shell-field">
                <label>
                  Arguments (JSON)
                  <span className="type">object</span>
                </label>
                {capturedValues.length > 0 && (
                  <select
                    aria-label="Insert captured value"
                    value=""
                    style={{ marginBottom: 6, fontSize: 11 }}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) return;
                      try {
                        const parsed = argsText.trim() ? JSON.parse(argsText) : {};
                        const key =
                          Object.keys(parsed).find((k) => ACCOUNT_ID_PATTERN.test(k)) ||
                          (selectedTool?.inputSchema?.required || []).find((k) => ACCOUNT_ID_PATTERN.test(k));
                        if (key) {
                          parsed[key] = val;
                          setArgsText(JSON.stringify(parsed, null, 2));
                        }
                      } catch {
                        // Invalid JSON in the box — leave it for the user to fix.
                      }
                    }}
                  >
                    <option value="">Insert captured value…</option>
                    {capturedValues.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                )}
                <textarea
                  value={argsText}
                  onChange={e => setArgsText(e.target.value)}
                  placeholder='{}'
                  spellCheck={false}
                  rows={6}
                  style={{ fontFamily: "'SF Mono', monospace" }}
                />
              </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AgentGatewayTester.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/AgentGatewayTester.jsx demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx
git commit -m "feat(ui): add captured-values picker to override the autofilled account id"
```

---

## Task 5: Frontend — "Run chain" + Chain output tab + order badges

**Files:**
- Modify: `demo_api_ui/src/components/AgentGatewayTester.jsx`
- Modify: `demo_api_ui/src/components/shared/InspectorShell.css`
- Test: `demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx`

**Interfaces:**
- Consumes: `extractCapturedValues`, `mergeCapturedValues`, `buildArgsTemplate`, `capturedValues`/`setCapturedValues` from Task 3.
- Produces: `CHAIN_STEPS = ['get_my_accounts', 'get_account_balance', 'get_sensitive_account_details']`; `chainRunning`, `chainResults` state; `runChain()` handler; a `'chain'` entry in the output tabs.

- [ ] **Step 1: Write the failing test**

Add to `demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx`:

```jsx
test('Run chain executes the three tools in order, carrying the account id forward', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'get_my_accounts', description: 'List accounts.', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'get_account_balance', description: 'Get balance.', inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] } },
          { name: 'get_sensitive_account_details', description: 'Sensitive details.', inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: [] } },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post
    .mockResolvedValueOnce({ data: { ok: true, result: { success: true, accounts: [{ id: 'acct-1', accountType: 'checking' }] }, durationMs: 5 } })
    .mockResolvedValueOnce({ data: { ok: true, result: { success: true, accountId: 'acct-1', balance: 500 }, durationMs: 6 } })
    .mockResolvedValueOnce({ data: { ok: true, result: { success: true, accounts: [{ id: 'acct-1', routingNumber: '021000021' }] }, durationMs: 7 } });

  render(<AgentGatewayTester />);
  await screen.findByText('Demo Agent Gateway | Authz: simulated');
  fireEvent.click(screen.getByText('Config'));
  fireEvent.click(screen.getByText(/Run chain/));

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(3));
  expect(apiClient.post).toHaveBeenNthCalledWith(1, '/api/mcp-gateway/test', { tool: 'get_my_accounts', args: {} });
  expect(apiClient.post).toHaveBeenNthCalledWith(2, '/api/mcp-gateway/test', { tool: 'get_account_balance', args: { account_id: 'acct-1' } });
  expect(apiClient.post).toHaveBeenNthCalledWith(3, '/api/mcp-gateway/test', { tool: 'get_sensitive_account_details', args: { account_id: 'acct-1' } });
});

test('order badges mark the chained tools 1, 2, 3 in the tool tree', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'get_my_accounts', description: '', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'get_account_balance', description: '', inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] } },
          { name: 'get_sensitive_account_details', description: '', inputSchema: { type: 'object', properties: {}, required: [] } },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  render(<AgentGatewayTester />);
  await screen.findByText('get_my_accounts');
  const row1 = screen.getByText('get_my_accounts').closest('.inspector-shell-tree-item');
  const row2 = screen.getByText('get_account_balance').closest('.inspector-shell-tree-item');
  const row3 = screen.getByText('get_sensitive_account_details').closest('.inspector-shell-tree-item');
  expect(row1).toHaveTextContent('1');
  expect(row2).toHaveTextContent('2');
  expect(row3).toHaveTextContent('3');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AgentGatewayTester.test.jsx`
Expected: FAIL — no "Run chain" text and no order badges exist yet.

- [ ] **Step 3: Implement `CHAIN_STEPS`, `runChain`, the Chain tab, and order badges**

In `demo_api_ui/src/components/AgentGatewayTester.jsx`, add near `TOOL_GROUPS` (after line 92):

```jsx
const CHAIN_STEPS = ['get_my_accounts', 'get_account_balance', 'get_sensitive_account_details'];

const chainOrder = (name) => {
  const idx = CHAIN_STEPS.indexOf(name);
  return idx === -1 ? null : idx + 1;
};
```

Add state, after `const [capturedValues, setCapturedValues] = useState([]);`:

```jsx
  const [chainRunning, setChainRunning] = useState(false);
  const [chainResults, setChainResults] = useState([]);
```

Add `runChain`, after `runBurst` (after line 290):

```jsx
  const runChain = useCallback(async () => {
    setChainRunning(true);
    setChainResults([]);
    setOutputTab('chain');
    let liveCaptured = capturedValues;
    const results = [];
    for (const toolName of CHAIN_STEPS) {
      const tool = tools.find((t) => t.name === toolName);
      if (!tool) {
        results.push({ tool: toolName, ok: false, skipped: true, data: { clientError: 'Tool not available.' } });
        setChainResults([...results]);
        continue;
      }
      const stepArgsText = buildArgsTemplate(tool, liveCaptured);
      let args;
      try {
        args = stepArgsText.trim() ? JSON.parse(stepArgsText) : {};
      } catch {
        results.push({ tool: toolName, ok: false, data: { clientError: 'Arguments must be valid JSON.' } });
        setChainResults([...results]);
        break;
      }
      try {
        const { data } = await apiClient.post('/api/mcp-gateway/test', { tool: toolName, args });
        const ok = !data.clientError && data.ok !== false;
        results.push({ tool: toolName, ok, data });
        setChainResults([...results]);
        const fresh = extractCapturedValues(data?.result ?? data?.rpcData);
        if (fresh.length) {
          liveCaptured = mergeCapturedValues(liveCaptured, fresh);
          setCapturedValues(liveCaptured);
        }
        if (!ok) break;
      } catch (e) {
        results.push({ tool: toolName, ok: false, data: { clientError: formatAxiosError(e, 'Request failed') } });
        setChainResults([...results]);
        break;
      }
    }
    setChainRunning(false);
  }, [tools, capturedValues]);
```

Add the "Chain" tab to the `InspectorTabs` list (line 564-570):

```jsx
            tabs={[
              { key: 'result', label: 'Result' },
              { key: 'audit', label: 'Audit Trail' },
              { key: 'authorize', label: 'Authorize Decision' },
              { key: 'mcpAudit', label: 'McpAudit (5W1H)' },
              { key: 'form', label: 'Form' },
              { key: 'chain', label: 'Chain' },
            ]}
```

Restructure the top-level `right` panel conditional (line 574: `{resp ? ( ... ) : burstResp ? ( ... ) : ( ... )}`) so a `'chain'` outputTab renders regardless of `resp`/`burstResp`. Change the opening of that block from:

```jsx
          {resp ? (
```

to:

```jsx
          {outputTab === 'chain' ? (
            <div className="inspector-shell-output-body">
              <pre className="inspector-shell-output-code">
                {chainResults.length === 0 ? (
                  <div style={{ padding: 16, color: '#64748b', fontSize: 12 }}>
                    {chainRunning ? 'Running chain…' : 'Click "Run chain" (Config tab) to execute get_my_accounts → get_account_balance → get_sensitive_account_details in order.'}
                  </div>
                ) : (
                  chainResults.map((step, i) => (
                    <div
                      key={`${step.tool}-${i}`}
                      onClick={() => { if (!step.skipped) { setResp(step.data); setOutputTab('result'); } }}
                      style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', cursor: step.skipped ? 'default' : 'pointer', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}
                    >
                      <span>{i + 1}. {step.tool}</span>
                      <span style={{ color: step.ok ? '#16a34a' : '#dc2626' }}>
                        {step.skipped ? 'skipped' : step.ok ? `OK (${step.data.durationMs ?? '?'}ms)` : 'error'}
                      </span>
                    </div>
                  ))
                )}
              </pre>
            </div>
          ) : resp ? (
```

(leave the rest of the `resp ? (...) : burstResp ? (...) : (...)` chain exactly as-is — this only adds one new leading branch.)

Add the "Run chain" tree item to the Config section, inside `treeSection === 'config'` (after the "Rate Limiting (UC18)" group, before "Demo Presets", around line 464):

```jsx
              <div className="inspector-shell-tree-group">
                <div className="inspector-shell-tree-group__label">Sequential Chain</div>
                <div
                  className="inspector-shell-tree-item"
                  onClick={() => !chainRunning && runChain()}
                  style={{ color: chainRunning ? '#475569' : '#3b82f6', fontSize: 11 }}
                >
                  <span className="inspector-shell-tree-item__dot" style={{ background: '#6366f1' }} />
                  <span>{chainRunning ? 'Running chain…' : 'Run chain (accounts → balance → sensitive)'}</span>
                </div>
              </div>
```

Add order badges to the tool tree items (lines 392-406), right after `<span>{t.name}</span>`:

```jsx
                        <span>{t.name}</span>
                        {chainOrder(t.name) && (
                          <span className="inspector-shell-tree-item__badge inspector-shell-tree-item__badge--order">{chainOrder(t.name)}</span>
                        )}
```

In `demo_api_ui/src/components/shared/InspectorShell.css`, add after line 177 (`.inspector-shell-tree-item__badge--sensitive { ... }`):

```css
.inspector-shell-tree-item__badge--order { background: #e0e7ff; color: #3730a3; margin-left: 6px; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AgentGatewayTester.test.jsx`
Expected: PASS (full file, all tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/AgentGatewayTester.jsx demo_api_ui/src/components/shared/InspectorShell.css demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx
git commit -m "feat(ui): add Run chain button, Chain output tab, and tool-order badges"
```

---

## Task 6: Verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend unit suite**

Run: `cd demo_mcp_server && NODE_ENV=test npx jest --testPathIgnorePatterns=integration --forceExit`
Expected: PASS, no new failures.

- [ ] **Step 2: Run the full frontend unit suite**

Run: `cd demo_api_ui && npx vitest run`
Expected: PASS, no new failures.

- [ ] **Step 3: Build the UI**

Run: `cd demo_api_ui && npm run build`
Expected: build succeeds (this repo's regression gate for any `demo_api_ui` change).

- [ ] **Step 4: Live smoke-test**

With the stack running (`./run-docker.sh` or `./run.sh`), open `https://local.ping-devops.com:4000/pinggateway-inspector`, switch to the Config sub-tab, click "Run chain", and confirm the Chain tab shows three OK steps and the third step's `account_id` matches the `id` from the first step's account list. Then manually select `get_account_balance` and confirm its textarea autofills with the same id, and that the captured-values dropdown lets you swap in a different account if more than one was returned.
