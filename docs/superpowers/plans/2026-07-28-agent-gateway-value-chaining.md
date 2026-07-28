# Agent Gateway Tester Value Chaining Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize `AgentGatewayTester.jsx`'s single-purpose `account_id` capture/autofill mechanism into a family-tagged system that chains id-shaped values between any two tool executions — banking, admin, and all ~90 generated vertical tools — without hardcoding a response-shape table per tool.

**Architecture:** Every captured value gains a `family` tag (e.g. `account`, `transaction`, `order`, `permit`) derived at runtime from the response's own key names, plus a small (~10-entry) override table for the handful of tools that return a single new record under a generic `data`/`transaction` key with no naming hint. On the consume side, a schema property's wanted family is derived from its own key name (`account_id`/`accountId` → `account`) or, for the bare-`id` outlier tools, from the tool's own name (`cancel_permit` → `permit`). Matching is case-insensitive substring comparison, most-recent match wins — same selection rule the existing code already uses.

**Tech Stack:** React 19.2 (plain JSX, no TypeScript) · Vitest 3.2 (`@testing-library/react`) · existing component `demo_api_ui/src/components/AgentGatewayTester.jsx`.

## Global Constraints

- Vitest, not Jest, for `demo_api_ui` (`npm run test:unit`).
- `npm run build` (vite build) is the real gate — a green test run alone is not sufficient.
- Work happens on worktree branch `worktree-agent-gateway-chain-design` (already checked out at `.claude/worktrees/agent-gateway-chain-design`).
- Stage files explicitly (`git add <path>`), never `git add -A`.
- No TypeScript sources in `demo_api_ui` — plain JS/JSX only.

---

### Task 1: Generalize capture/consume to family-tagged matching

**Files:**
- Modify: `demo_api_ui/src/components/AgentGatewayTester.jsx:90-128` (replace `ACCOUNT_ID_PATTERN`/`extractCapturedValues`/`mergeCapturedValues`/`buildArgsTemplate` block with the family-tagged versions), `:381-430` (`runChain` — delete the now-redundant optional-property backfill loop), `:684-699` (dropdown `onChange` — generalize key targeting)
- Test: `demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx` (append 4 new tests; 11 existing tests must keep passing unmodified)

**Interfaces:**
- Consumes: nothing from other tasks — this is the only task.
- Produces (for reference; nothing downstream in this plan, but this is the public shape of the new mechanism): `capturedValues` entries are now `{ family: string, label: string, value: string }` (was `{ label, value }`); `extractCapturedValues(toolName, result)` (was `extractCapturedValues(result)` — now takes the tool name as its first argument); `buildArgsTemplate(tool, capturedValues)` unchanged signature, but now also fills matched **optional** properties, not just required ones.

- [ ] **Step 1: Write the 4 new failing tests**

Append to `demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx` (after the last existing `test(...)` block, before the final closing of the file):

```jsx
test('running get_my_transactions captures the transaction id and autofills it into a consumer tool', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'get_my_transactions', description: 'List transactions.', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'get_transaction_detail', description: 'Get one transaction.', inputSchema: { type: 'object', properties: { transaction_id: { type: 'string' } }, required: ['transaction_id'] } },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post.mockResolvedValueOnce({
    data: { ok: true, result: { success: true, transactions: [{ id: 'txn-1', fromAccountId: 'acct-1', toAccountId: 'acct-2' }] }, durationMs: 8 },
  });
  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('get_my_transactions'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('get_transaction_detail'));
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ transaction_id: 'txn-1' }, null, 2));
});

test('a bare "id" param derives its family from the tool name, not a more-recently captured unrelated family', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'view_permits', description: 'List permits.', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'checkout', description: 'Place an order.', inputSchema: { type: 'object', properties: { product: { type: 'string' }, amount: { type: 'number' } }, required: ['product', 'amount'] } },
          { name: 'cancel_permit', description: 'Cancel a permit.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post
    .mockResolvedValueOnce({ data: { ok: true, result: { success: true, data: { permits: [{ id: 'permit-9', status: 'Active' }] } }, durationMs: 5 } })
    .mockResolvedValueOnce({ data: { ok: true, result: { success: true, data: { id: 'ord-1', product: 'Widget', status: 'Processing' } }, durationMs: 5 } });

  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('view_permits'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('checkout'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('cancel_permit'));
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ id: 'permit-9' }, null, 2));
});

test('the captured-values dropdown patches the matching family\'s key, not an unrelated id param', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'get_my_accounts', description: 'List accounts.', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'lookup_customer', description: 'Find a customer.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
          {
            name: 'get_customer_accounts',
            description: 'Admin: accounts for a customer.',
            inputSchema: { type: 'object', properties: { userId: { type: 'string' }, account_id: { type: 'string' } }, required: ['userId', 'account_id'] },
          },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post
    .mockResolvedValueOnce({
      data: {
        ok: true,
        result: {
          success: true,
          accounts: [
            { id: 'acct-checking', accountType: 'checking', accountNumber: '****1111' },
            { id: 'acct-savings', accountType: 'savings', accountNumber: '****2222' },
          ],
        },
        durationMs: 5,
      },
    })
    .mockResolvedValueOnce({ data: { ok: true, result: { success: true, users: [{ id: 'user-1', name: 'Jane Doe' }] }, durationMs: 5 } });

  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('get_my_accounts'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('lookup_customer'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('get_customer_accounts'));
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ userId: 'user-1', account_id: 'acct-checking' }, null, 2));

  fireEvent.change(screen.getByLabelText('Insert captured value'), { target: { value: 'acct-savings' } });
  const parsed = JSON.parse(screen.getByRole('textbox').value);
  expect(parsed.account_id).toBe('acct-savings');
  expect(parsed.userId).toBe('user-1');
});

test('an id-shaped param with no captured match falls back to the empty placeholder', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: { tools: [{ name: 'get_customer_profile', description: 'Admin: customer profile.', inputSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] } }], _source: 'live' },
    });
    return Promise.resolve({ data: {} });
  });
  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('get_customer_profile'));
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ userId: '' }, null, 2));
});
```

- [ ] **Step 2: Run the suite, confirm exactly the 4 new tests fail**

Run (from the worktree's `demo_api_ui`, symlink `node_modules` from the main checkout first if missing — see the `verify-ai-demo2` skill):

```bash
npm run test:unit
```

Expected: 11 pre-existing tests PASS, the 4 new tests FAIL (current code only recognizes `accounts[]`/`account_id`, has no tool-name-derived family fallback, and the dropdown only scans for the fixed account pattern).

- [ ] **Step 3: Replace lines 90-128 with the family-tagged mechanism**

In `demo_api_ui/src/components/AgentGatewayTester.jsx`, replace the block from `const ACCOUNT_ID_PATTERN = /_?account_id$/i;` through the end of the original `buildArgsTemplate` (original lines 90-128) with:

```js
const CAPTURED_VALUES_LIMIT = 20;

const DESCRIPTOR_FIELDS = ['accountType', 'name', 'product', 'provider', 'course', 'description', 'status'];

/** Label like "checking …9876" or "Widget …rd-1" for a captured id-bearing item. */
function labelFor(item, family) {
  const digitsSource = item.accountNumber || item.accountNumberFull || item.id;
  const digits = String(digitsSource).replace(/\D/g, '');
  const tail = digits.length >= 4 ? digits.slice(-4) : String(item.id).slice(-4);
  const descriptor = DESCRIPTOR_FIELDS.map((f) => item[f]).find((v) => typeof v === 'string' && v) || family;
  return tail ? `${descriptor} …${tail}` : descriptor;
}

/** "accounts" -> "account", "maintenanceTickets" -> "maintenanceTicket", "policies" -> "policy". */
function singularizeFamily(key) {
  if (/ies$/i.test(key)) return `${key.slice(0, -3)}y`;
  if (/s$/i.test(key) && !/ss$/i.test(key)) return key.slice(0, -1);
  return key;
}

/** Scan an object's own array-valued properties for id-bearing items; tag each by container key. */
function scanArrayFamilies(container) {
  const out = [];
  if (!container || typeof container !== 'object') return out;
  for (const [key, val] of Object.entries(container)) {
    if (!Array.isArray(val) || !val.length) continue;
    const items = val.filter((v) => v && typeof v === 'object' && v.id);
    if (!items.length) continue;
    const family = singularizeFamily(key).toLowerCase();
    for (const item of items) out.push({ family, label: labelFor(item, family), value: item.id });
  }
  return out;
}

/**
 * Tools whose response is a single new record under a generic key, so the
 * family can't be inferred from the key name alone (it's always bare "data",
 * or for these pre-existing banking write tools, a fixed transaction field).
 */
const SINGLE_RECORD_PRODUCERS = {
  checkout: [{ path: 'data', family: 'order' }],
  book_appointment: [{ path: 'data', family: 'appointment' }],
  register_course: [{ path: 'data', family: 'enrollment' }],
  submit_expense: [{ path: 'data', family: 'expense' }],
  create_deposit: [{ path: 'transaction', family: 'transaction' }],
  create_withdrawal: [{ path: 'transaction', family: 'transaction' }],
  create_transfer: [
    { path: 'withdrawalTransaction', family: 'transaction' },
    { path: 'depositTransaction', family: 'transaction' },
  ],
};

/** {family, label, value} for every id-bearing item found in a tool result. */
function extractCapturedValues(toolName, result) {
  if (!result || typeof result !== 'object') return [];
  const out = [];
  const producers = SINGLE_RECORD_PRODUCERS[toolName];
  if (producers) {
    for (const { path, family } of producers) {
      const item = result[path];
      if (item && typeof item === 'object' && item.id) {
        out.push({ family, label: labelFor(item, family), value: item.id });
      }
    }
  }
  out.push(...scanArrayFamilies(result));
  if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    out.push(...scanArrayFamilies(result.data));
  }
  return out;
}

/** Fresh entries first, deduped by value against the existing list, capped. */
function mergeCapturedValues(existing, fresh) {
  if (!fresh.length) return existing;
  const merged = [...fresh, ...existing.filter((e) => !fresh.some((f) => f.value === e.value))];
  return merged.slice(0, CAPTURED_VALUES_LIMIT);
}

const DIRECTION_PREFIX = /^(from|to)_?/i;

/** "account_id"/"from_account_id" -> "account"; "accountId"/"orderId" -> "account"/"order". */
function familyFromKey(key) {
  let m = key.match(/^(.+)_[Ii]d$/);
  if (!m) m = key.match(/^(.+)Id$/); // camelCase only — capital "I" avoids false hits like "valid"/"paid"
  if (!m || !m[1]) return null;
  return m[1].replace(DIRECTION_PREFIX, '').replace(/_/g, '').toLowerCase();
}

// Bare-"id" vertical tools (mostly the government pack) carry no family hint
// in the param name, so it's derived from the tool name's own entity noun.
const VERB_PREFIXES = new Set([
  'cancel', 'close', 'approve', 'reject', 'renew', 'dispute', 'submit', 'schedule',
  'reschedule', 'void', 'reopen', 'flag', 'complete', 'release', 'put', 'escalate', 'expedite',
]);

function familyFromToolName(toolName) {
  if (!toolName) return null;
  const parts = toolName.split('_').filter(Boolean);
  if (parts.length > 1 && VERB_PREFIXES.has(parts[0])) parts.shift();
  return parts.join('').toLowerCase() || null;
}

function idFamilyForProperty(toolName, key) {
  if (/^id$/i.test(key)) return familyFromToolName(toolName);
  return familyFromKey(key);
}

function familiesMatch(a, b) {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/** Most recent captured value whose family matches this schema property, if any. */
function bestCapturedMatch(toolName, key, capturedValues) {
  const wanted = idFamilyForProperty(toolName, key);
  if (!wanted) return null;
  return capturedValues.find((c) => familiesMatch(wanted, c.family)) || null;
}

/** Template args for a tool's inputSchema: required properties always present (captured-value-filled where a family matches, else type placeholder); optional properties included only when a captured value matches. */
const buildArgsTemplate = (tool, capturedValues = []) => {
  const properties = tool?.inputSchema?.properties || {};
  const required = tool?.inputSchema?.required || [];
  const template = {};
  for (const key of required) {
    const match = bestCapturedMatch(tool?.name, key, capturedValues);
    if (match) { template[key] = match.value; continue; }
    const propType = properties[key]?.type;
    template[key] = propType in ARG_PLACEHOLDER_BY_TYPE ? ARG_PLACEHOLDER_BY_TYPE[propType] : '';
  }
  for (const key of Object.keys(properties)) {
    if (key in template) continue;
    const match = bestCapturedMatch(tool?.name, key, capturedValues);
    if (match) template[key] = match.value;
  }
  return JSON.stringify(template, null, 2);
};
```

- [ ] **Step 4: Update the two call sites that pass a tool name into capture**

In `send` (around original line 313), change:

```js
      const fresh = extractCapturedValues(data?.result ?? data?.rpcData);
```

to:

```js
      const fresh = extractCapturedValues(selectedTool.name, data?.result ?? data?.rpcData);
```

In `runChain` (around original line 417), change:

```js
        const fresh = extractCapturedValues(data?.result ?? data?.rpcData);
```

to:

```js
        const fresh = extractCapturedValues(toolName, data?.result ?? data?.rpcData);
```

- [ ] **Step 5: Delete the now-redundant optional-property backfill in `runChain`**

`buildArgsTemplate` (Step 3) already fills matched optional properties, so the dedicated backfill loop is dead weight. Delete this block from `runChain` (originally right after `stepArgsText`/`args` are parsed, before the `apiClient.post` call):

```js
      // buildArgsTemplate only prefills required properties; account_id-like
      // *optional* filters (e.g. get_sensitive_account_details) still need the
      // chain to carry the id forward, so fill any unset schema property here.
      const latestId = liveCaptured[0]?.value;
      if (latestId) {
        for (const key of Object.keys(tool.inputSchema?.properties || {})) {
          if (ACCOUNT_ID_PATTERN.test(key) && !(key in args)) args[key] = latestId;
        }
      }
```

Delete it entirely — no replacement needed, `args` (parsed from `stepArgsText = buildArgsTemplate(tool, liveCaptured)`) already carries the matched optional properties.

- [ ] **Step 6: Generalize the "Insert captured value" dropdown handler**

Replace the dropdown's `onChange` body (originally around line 684-699):

```jsx
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
```

with:

```jsx
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) return;
                      const entry = capturedValues.find((c) => c.value === val);
                      if (!entry) return;
                      try {
                        const parsed = argsText.trim() ? JSON.parse(argsText) : {};
                        const schemaKeys = Object.keys(selectedTool?.inputSchema?.properties || {});
                        const key = [...Object.keys(parsed), ...schemaKeys].find(
                          (k) => familiesMatch(idFamilyForProperty(selectedTool?.name, k), entry.family),
                        );
                        if (key) {
                          parsed[key] = val;
                          setArgsText(JSON.stringify(parsed, null, 2));
                        }
                      } catch {
                        // Invalid JSON in the box — leave it for the user to fix.
                      }
                    }}
```

- [ ] **Step 7: Run the full suite, confirm all 15 tests pass**

```bash
npm run test:unit
```

Expected: all 11 pre-existing tests PASS (unchanged behavior for the account_id case), all 4 new tests PASS.

- [ ] **Step 8: Run the build gate**

```bash
npm run build
```

Expected: build succeeds (vite build — the real gate per `demo_api_ui/CLAUDE.md`).

- [ ] **Step 9: Commit**

```bash
git add demo_api_ui/src/components/AgentGatewayTester.jsx demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx
git commit -m "feat(agent-gateway-tester): generalize value chaining to all tool families

Extends the account_id-only capture/autofill mechanism to a family-tagged
system covering banking, admin, and all generated vertical tools, matching
docs/superpowers/specs/2026-07-27-agent-gateway-chaining-design.md."
```
