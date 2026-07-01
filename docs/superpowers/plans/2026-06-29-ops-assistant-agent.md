# Ops Assistant Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new READ-ONLY "Ops Assistant" agent that lets an operator ask questions about the customer currently looked up on a Vertical Ops console, grounded server-side in that customer's records.

**Architecture:** Reuse the existing in-house agent pattern (as `adminAgentService`): a service builds a grounded system prompt and calls `runReasonLoop` with an EMPTY tool list (a single grounded completion — structurally read-only), over a provider from `resolveLlmProvider`. A thin route exposes it; a new helper fetches the current customer's records server-side so the client never supplies them. The frontend drawer chat (a slot left by the console plan) calls the endpoint.

**Tech Stack:** Node/Express, `runReasonLoop` (`services/agentReasoningClient.js`), `resolveLlmProvider` (`services/llmProviderResolver.js`), Jest + supertest (backend); React + `bffAxios` + Vitest (frontend).

**Prerequisite:** The Vertical Ops Console plan (`2026-06-29-vertical-ops-console.md`) is implemented — `RecordDrawer.jsx` has a `data-testid="ops-assistant-slot"` placeholder and `VerticalOpsConsole.jsx` tracks the lookup query.

## Global Constraints

- READ-ONLY: the Ops Assistant passes NO tool schemas to `runReasonLoop` and makes no write calls.
- Grounding is server-side only: the service re-fetches the current customer's records; the client sends a `query` (the operator's lookup string) + `message`, never record data.
- Reuse the existing agent stack — no new agent framework / dependency (decision recorded in spec §5.3).
- `runReasonLoop` signature: `runReasonLoop({ messages, tools, provider, model, systemPrompt, helixConfig, anthropicApiKey, maxIterations, executeTool }) => { ok, answer, inputTokens, outputTokens } | { ok:false, reason }`.
- `resolveLlmProvider(langchainConfig) => { provider, model }`.
- Endpoint mounted under `authenticateToken` (any authenticated user — ops pages are not admin-gated). Do NOT add `requireAdmin`.
- Backend tests: Jest + supertest. Run one file: `npm test -- tests/<file>.test.js --forceExit` from `demo_api_server/`.
- Frontend tests: `npx vitest run <path>` from `demo_api_ui/`.

---

## File Structure

- Create: `demo_api_server/config/ops/systemPrompt.js` — `buildOpsSystemPrompt({ vertical, customer, records })`.
- Create: `demo_api_server/config/ops/responses.js` — canned strings.
- Create: `demo_api_server/services/verticalOpsData.js` — `getCustomerContext(vertical, query) => { customer, records }` (server-side grounding source).
- Create: `demo_api_server/services/opsAssistantService.js` — `processOpsMessage(...)`.
- Create: `demo_api_server/routes/opsAssistantRoutes.js` — `POST /:vertical/ops-assistant`.
- Modify: `demo_api_server/server.js` — mount the route under `authenticateToken`.
- Create: `demo_api_ui/src/components/verticalOps/OpsAssistantChat.jsx` — drawer chat UI.
- Modify: `demo_api_ui/src/components/verticalOps/RecordDrawer.jsx` — render the chat in the slot.
- Modify: `demo_api_ui/src/components/verticalOps/VerticalOpsConsole.jsx` — pass `query` to the drawer.

---

### Task 1: Grounding data helper

**Files:**
- Create: `demo_api_server/services/verticalOpsData.js`
- Test: `demo_api_server/tests/verticalOpsData.test.js`

**Interfaces:**
- Produces: `getCustomerContext(vertical: string, query: string) => { customer: {id,username,name,email}|null, records: object|null }`. For banking, `customer` is synthesized from matched accounts and `records` is `{ accounts, transactions }`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/verticalOpsData.test.js
jest.mock('../data/store', () => ({
  getAllUsers: () => [{ id: 'u1', username: 'maya', firstName: 'Maya', lastName: 'Chen', email: 'maya@x.com', role: 'user' }],
  getAllAccounts: () => [{ id: 'ac1', accountNumber: '0001', balance: 100, type: 'Checking' }],
  getTransactionsByAccountId: () => [{ id: 't1', amount: -5 }],
}));
jest.mock('../config/verticals/healthcare', () => ({
  getDataStore: () => ({ get: (id) => ({ appointments: [{ id: 'a1', status: 'Scheduled' }] }) }),
}), { virtual: true });

const { getCustomerContext } = require('../services/verticalOpsData');

describe('getCustomerContext', () => {
  test('resolves a user-centric vertical and returns plugin records', () => {
    const out = getCustomerContext('healthcare', 'maya');
    expect(out.customer.name).toBe('Maya Chen');
    expect(out.records.appointments[0].id).toBe('a1');
  });

  test('returns null customer when no match', () => {
    expect(getCustomerContext('healthcare', 'nobody').customer).toBeNull();
  });

  test('banking synthesizes a customer from accounts', () => {
    const out = getCustomerContext('banking', '0001');
    expect(out.records.accounts[0].id).toBe('ac1');
    expect(out.customer).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/verticalOpsData.test.js --forceExit`
Expected: FAIL — "Cannot find module '../services/verticalOpsData'".

- [ ] **Step 3: Implement**

```javascript
// services/verticalOpsData.js
'use strict';
const dataStore = require('../data/store');

const PLUGINS = {
  healthcare: () => require('../config/verticals/healthcare'),
  retail: () => require('../config/verticals/retail'),
  'sporting-goods': () => require('../config/verticals/sporting-goods'),
  workforce: () => require('../config/verticals/workforce'),
};

// Mirror of resolveUser() in routes/adminVerticals.js — resolve a free-text
// query to a single non-admin demo user.
function resolveCustomer(q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return null;
  const users = dataStore.getAllUsers().filter((u) => u.role !== 'admin' && u.username);
  const match = users.find((u) => {
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').toLowerCase();
    return (u.username || '').toLowerCase().includes(needle)
      || (u.email || '').toLowerCase().includes(needle)
      || name.includes(needle)
      || String(u.id || '').toLowerCase() === needle;
  });
  if (!match) return null;
  return { id: String(match.id), username: match.username, name: [match.firstName, match.lastName].filter(Boolean).join(' '), email: match.email || '' };
}

function bankingContext(q) {
  const needle = String(q || '').trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');
  const accounts = dataStore.getAllAccounts().filter((a) => {
    if (String(a.accountNumber).toLowerCase().includes(needle)) return true;
    if (String(a.id).toLowerCase().includes(needle)) return true;
    return digits.length > 0 && String(a.accountNumber).replace(/\D/g, '').includes(digits);
  });
  const transactions = accounts.flatMap((a) => dataStore.getTransactionsByAccountId(a.id).map((t) => ({ ...t, _accountNumber: a.accountNumber })));
  return {
    customer: accounts.length ? { id: String(accounts[0].id), username: '', name: accounts[0].holderName || 'Account holder', email: '' } : null,
    records: { accounts, transactions },
  };
}

function getCustomerContext(vertical, query) {
  if (vertical === 'banking') return bankingContext(query);
  const load = PLUGINS[vertical];
  if (!load) return { customer: null, records: null };
  const user = resolveCustomer(query);
  if (!user) return { customer: null, records: null };
  const records = load().getDataStore().get(user.id);
  return { customer: user, records };
}

module.exports = { getCustomerContext, resolveCustomer };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/verticalOpsData.test.js --forceExit`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/verticalOpsData.js tests/verticalOpsData.test.js
git commit -m "feat(ops-assistant): server-side customer grounding helper"
```

---

### Task 2: Ops system prompt + canned responses

**Files:**
- Create: `demo_api_server/config/ops/systemPrompt.js`
- Create: `demo_api_server/config/ops/responses.js`
- Test: `demo_api_server/tests/opsSystemPrompt.test.js`

**Interfaces:**
- Produces:
  - `buildOpsSystemPrompt({ vertical, customer, records }) => string`
  - `RESPONSES = { noCustomer, reasoningUnavailable }` (object of strings)

- [ ] **Step 1: Write the failing test**

```javascript
const { buildOpsSystemPrompt } = require('../config/ops/systemPrompt');

describe('buildOpsSystemPrompt', () => {
  test('grounds in the customer + records and forbids actions', () => {
    const p = buildOpsSystemPrompt({ vertical: 'healthcare', customer: { name: 'Maya Chen' }, records: { appointments: [{ id: 'a1', status: 'Scheduled' }] } });
    expect(p).toMatch(/Healthcare/i);
    expect(p).toMatch(/Maya Chen/);
    expect(p).toMatch(/a1/);                 // record data embedded
    expect(p).toMatch(/read-only|do not|cannot (take|perform)/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/opsSystemPrompt.test.js --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// config/ops/systemPrompt.js
'use strict';
const LABELS = { banking: 'Banking', healthcare: 'Healthcare', retail: 'Retail', 'sporting-goods': 'Sporting Goods', workforce: 'Workforce' };

function buildOpsSystemPrompt({ vertical, customer, records }) {
  const label = LABELS[vertical] || vertical;
  const name = customer?.name || 'the current customer';
  let json = '{}';
  try { json = JSON.stringify(records || {}, null, 0).slice(0, 12000); } catch { json = '{}'; }
  return [
    `You are the ${label} Ops Assistant, helping a support operator who is viewing one customer's records.`,
    `The current customer is ${name}. Here is their data (the ONLY data you may use):`,
    json,
    'Rules:',
    '- Answer questions and summarize using ONLY the data above. If something is not present, say so.',
    '- You are READ-ONLY: you cannot take actions, change records, or call tools. Never imply you did.',
    '- If asked to perform an action, explain that the operator must use the action buttons on the page.',
    '- Be concise and operator-focused.',
  ].join('\n');
}
module.exports = { buildOpsSystemPrompt };
```

```javascript
// config/ops/responses.js
'use strict';
module.exports = {
  noCustomer: 'No customer is loaded yet. Look up a customer first, then ask me about them.',
  reasoningUnavailable: 'The Ops Assistant is temporarily unavailable. Please try again shortly.',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/opsSystemPrompt.test.js --forceExit`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add config/ops/systemPrompt.js config/ops/responses.js tests/opsSystemPrompt.test.js
git commit -m "feat(ops-assistant): grounded read-only system prompt + responses"
```

---

### Task 3: Ops Assistant service

**Files:**
- Create: `demo_api_server/services/opsAssistantService.js`
- Test: `demo_api_server/tests/opsAssistantService.test.js`

**Interfaces:**
- Consumes: `getCustomerContext` (Task 1), `buildOpsSystemPrompt` + `RESPONSES` (Task 2), `runReasonLoop`, `resolveLlmProvider`.
- Produces: `processOpsMessage({ vertical, query, message, history=[], langchainConfig={} }) => { reply, success, toolsCalled:[], inputTokens, outputTokens, agentConfigured:true, error? }`.

- [ ] **Step 1: Write the failing test**

```javascript
jest.mock('../services/verticalOpsData', () => ({ getCustomerContext: jest.fn() }));
jest.mock('../services/agentReasoningClient', () => ({ runReasonLoop: jest.fn() }));
jest.mock('../services/llmProviderResolver', () => ({ resolveLlmProvider: () => ({ provider: 'helix', model: undefined }) }));

const { getCustomerContext } = require('../services/verticalOpsData');
const { runReasonLoop } = require('../services/agentReasoningClient');
const { processOpsMessage } = require('../services/opsAssistantService');

describe('processOpsMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  test('passes NO tools and returns the grounded answer envelope', async () => {
    getCustomerContext.mockReturnValue({ customer: { name: 'Maya Chen' }, records: { appointments: [] } });
    runReasonLoop.mockResolvedValue({ ok: true, answer: 'She has no open appointments.', inputTokens: 12, outputTokens: 8 });

    const out = await processOpsMessage({ vertical: 'healthcare', query: 'maya', message: 'summarize open items' });

    expect(runReasonLoop).toHaveBeenCalledTimes(1);
    expect(runReasonLoop.mock.calls[0][0].tools).toEqual([]); // read-only
    expect(out).toMatchObject({ reply: 'She has no open appointments.', success: true, toolsCalled: [], agentConfigured: true });
  });

  test('returns a helpful reply (success) when no customer resolves', async () => {
    getCustomerContext.mockReturnValue({ customer: null, records: null });
    const out = await processOpsMessage({ vertical: 'healthcare', query: 'nobody', message: 'hi' });
    expect(out.success).toBe(true);
    expect(out.reply).toMatch(/look up a customer/i);
    expect(runReasonLoop).not.toHaveBeenCalled();
  });

  test('returns success:false with error when the reason loop fails', async () => {
    getCustomerContext.mockReturnValue({ customer: { name: 'X' }, records: {} });
    runReasonLoop.mockResolvedValue({ ok: false, reason: 'reasoning_unavailable' });
    const out = await processOpsMessage({ vertical: 'healthcare', query: 'x', message: 'hi' });
    expect(out.success).toBe(false);
    expect(out.error).toBe('reasoning_unavailable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/opsAssistantService.test.js --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// services/opsAssistantService.js
'use strict';
const { getCustomerContext } = require('./verticalOpsData');
const { buildOpsSystemPrompt } = require('../config/ops/systemPrompt');
const RESPONSES = require('../config/ops/responses');
const { runReasonLoop } = require('./agentReasoningClient');
const { resolveLlmProvider } = require('./llmProviderResolver');

function _extractHelixConfig(cfg = {}) {
  return {
    helix_base_url: cfg.helix_base_url || '',
    helix_api_key: cfg.helix_api_key || '',
    helix_environment_id: cfg.helix_environment_id || '',
    helix_agent_id: cfg.helix_agent_id || '',
    helix_prompt_field_id: cfg.helix_prompt_field_id || '',
  };
}

async function processOpsMessage({ vertical, query, message, history = [], langchainConfig = {} }) {
  const { customer, records } = getCustomerContext(vertical, query);
  if (!customer) {
    return { reply: RESPONSES.noCustomer, success: true, toolsCalled: [], inputTokens: 0, outputTokens: 0, agentConfigured: true };
  }

  const { provider, model } = resolveLlmProvider({ ...langchainConfig, provider: undefined });
  const systemPrompt = buildOpsSystemPrompt({ vertical, customer, records });
  const messages = [...history.filter((m) => m && m.role && m.content), { role: 'user', content: message }];

  const loop = await runReasonLoop({
    messages,
    tools: [],                                   // READ-ONLY: no tools
    provider,
    model,
    systemPrompt,
    helixConfig: _extractHelixConfig(langchainConfig),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    maxIterations: 1,
    executeTool: async () => '',                 // never called (no tools)
  });

  if (loop.ok) {
    return { reply: loop.answer, success: true, toolsCalled: [], inputTokens: loop.inputTokens || 0, outputTokens: loop.outputTokens || 0, agentConfigured: true };
  }
  return { reply: RESPONSES.reasoningUnavailable, success: false, toolsCalled: [], inputTokens: 0, outputTokens: 0, agentConfigured: true, error: loop.reason || 'reasoning_failed' };
}

module.exports = { processOpsMessage };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/opsAssistantService.test.js --forceExit`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/opsAssistantService.js tests/opsAssistantService.test.js
git commit -m "feat(ops-assistant): read-only grounded service over runReasonLoop"
```

---

### Task 4: Route + server mount

**Files:**
- Create: `demo_api_server/routes/opsAssistantRoutes.js`
- Modify: `demo_api_server/server.js` (add one `app.use(...)` near the other `/api/admin` mounts)
- Test: `demo_api_server/tests/opsAssistantRoutes.test.js`

**Interfaces:**
- Consumes: `processOpsMessage` (Task 3).
- Produces: `POST /api/admin/:vertical/ops-assistant` with body `{ message, query, history? }`; responds `200` with the envelope, `400` on invalid input, `502` when `success:false`.

- [ ] **Step 1: Write the failing test**

```javascript
jest.mock('../services/opsAssistantService', () => ({ processOpsMessage: jest.fn() }));
const request = require('supertest');
const express = require('express');
const { processOpsMessage } = require('../services/opsAssistantService');
const opsRoutes = require('../routes/opsAssistantRoutes');

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { sub: 'op-1' }; next(); }); // stand-in for authenticateToken
  a.use('/api/admin', opsRoutes);
  return a;
}

describe('POST /api/admin/:vertical/ops-assistant', () => {
  beforeEach(() => jest.clearAllMocks());

  test('400 on empty message', async () => {
    const res = await request(app()).post('/api/admin/healthcare/ops-assistant').send({ query: 'maya' });
    expect(res.status).toBe(400);
  });

  test('200 returns the service envelope', async () => {
    processOpsMessage.mockResolvedValue({ reply: 'ok', success: true, toolsCalled: [], agentConfigured: true });
    const res = await request(app()).post('/api/admin/healthcare/ops-assistant').send({ message: 'hi', query: 'maya' });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('ok');
    expect(processOpsMessage).toHaveBeenCalledWith(expect.objectContaining({ vertical: 'healthcare', query: 'maya', message: 'hi' }));
  });

  test('502 when service reports failure', async () => {
    processOpsMessage.mockResolvedValue({ reply: 'down', success: false, error: 'reasoning_unavailable' });
    const res = await request(app()).post('/api/admin/banking/ops-assistant').send({ message: 'hi', query: '0001' });
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/opsAssistantRoutes.test.js --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

```javascript
// routes/opsAssistantRoutes.js
'use strict';
const express = require('express');
const router = express.Router();
const { processOpsMessage } = require('../services/opsAssistantService');

const VALID = new Set(['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce']);

router.post('/:vertical/ops-assistant', async (req, res) => {
  const { vertical } = req.params;
  if (!VALID.has(vertical)) return res.status(404).json({ error: 'unknown_vertical' });

  const { message, query, history } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message must be a non-empty string' });
  if (message.length > 2000) return res.status(400).json({ error: 'message too long (max 2000)' });

  const langchainConfig = (req.session && req.session.langchain_config) || {};
  try {
    const response = await processOpsMessage({
      vertical, query: String(query || ''), message,
      history: Array.isArray(history) ? history.slice(-10) : [],
      langchainConfig,
    });
    if (!response.success && response.error) return res.status(502).json(response);
    return res.json(response);
  } catch (err) {
    return res.status(500).json({ reply: '', success: false, error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/opsAssistantRoutes.test.js --forceExit`
Expected: PASS (3 tests).

- [ ] **Step 5: Mount in server.js**

Add this line next to the other `app.use('/api/admin', authenticateToken, …)` mounts (e.g. just before `app.use('/api/admin', authenticateToken, require('./routes/adminVerticals'));`). It does not collide — no other `/api/admin` router defines `/:vertical/ops-assistant`:

```javascript
app.use('/api/admin', authenticateToken, require('./routes/opsAssistantRoutes'));
```

- [ ] **Step 6: Commit**

```bash
git add routes/opsAssistantRoutes.js tests/opsAssistantRoutes.test.js server.js
git commit -m "feat(ops-assistant): POST /api/admin/:vertical/ops-assistant route + mount"
```

---

### Task 5: Frontend — drawer chat

**Files:**
- Create: `demo_api_ui/src/components/verticalOps/OpsAssistantChat.jsx`
- Modify: `demo_api_ui/src/components/verticalOps/RecordDrawer.jsx` (render chat in the slot; accept `vertical`, `query`)
- Modify: `demo_api_ui/src/components/verticalOps/VerticalOpsConsole.jsx` (pass `query={q}` to `RecordDrawer`)
- Test: `demo_api_ui/src/components/verticalOps/__tests__/OpsAssistantChat.test.jsx`

**Interfaces:**
- Consumes: `bffAxios`.
- Produces: `default function OpsAssistantChat({ vertical, query })` — posts `{ message, query }` to `/api/admin/${vertical}/ops-assistant` and renders the reply.

- [ ] **Step 1: Write the failing test**

```jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
jest.mock('../../../services/bffAxios', () => ({ __esModule: true, default: { post: jest.fn() } }));
import bffAxios from '../../../services/bffAxios';
import OpsAssistantChat from '../OpsAssistantChat';

it('sends the question to the ops-assistant endpoint and shows the reply', async () => {
  bffAxios.post.mockResolvedValueOnce({ data: { reply: 'No open appointments.', success: true } });
  render(<OpsAssistantChat vertical="healthcare" query="maya" />);
  fireEvent.change(screen.getByPlaceholderText(/ask about this customer/i), { target: { value: 'summarize' } });
  fireEvent.submit(screen.getByTestId('ops-chat-form'));
  await waitFor(() => expect(screen.getByText('No open appointments.')).toBeInTheDocument());
  expect(bffAxios.post).toHaveBeenCalledWith('/api/admin/healthcare/ops-assistant', { message: 'summarize', query: 'maya' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/verticalOps/__tests__/OpsAssistantChat.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the chat**

```jsx
// OpsAssistantChat.jsx
import React, { useState } from 'react';
import bffAxios from '../../services/bffAxios';

export default function OpsAssistantChat({ vertical, query }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState([]);
  const [busy, setBusy] = useState(false);

  async function ask(e) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setMsgs((m) => [...m, { role: 'u', text: q }]);
    setInput('');
    setBusy(true);
    try {
      const { data } = await bffAxios.post(`/api/admin/${vertical}/ops-assistant`, { message: q, query });
      setMsgs((m) => [...m, { role: 'a', text: data.reply || '…' }]);
    } catch (err) {
      setMsgs((m) => [...m, { role: 'a', text: 'Assistant offline. Try again shortly.' }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="vops-assistant">
      <button type="button" className="vops-assistant__bar" onClick={() => setOpen((o) => !o)}>
        🤖 <b>Ops Assistant</b> <span className="vops-assistant__ro">READ-ONLY</span>
      </button>
      {open && (
        <div className="vops-assistant__panel">
          <div className="vops-assistant__msgs">
            {msgs.length === 0 && <div className="vops-assistant__a">Ask me about this customer — I can summarize but can’t change anything.</div>}
            {msgs.map((m, i) => <div key={i} className={m.role === 'u' ? 'vops-assistant__u' : 'vops-assistant__a'}>{m.text}</div>)}
          </div>
          <form className="vops-assistant__in" data-testid="ops-chat-form" onSubmit={ask}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about this customer…" />
            <button type="submit" disabled={busy}>{busy ? '…' : 'Send'}</button>
          </form>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire it into the drawer + console**

In `RecordDrawer.jsx`: add `vertical` and `query` to the props and replace the slot:

```jsx
// add import at top:
import OpsAssistantChat from './OpsAssistantChat';
// change signature: export default function RecordDrawer({ open, vertical, category, row, customer, query, onClose, onAction })
// replace the stub line:
//   <div className="vops-assistant-stub" data-testid="ops-assistant-slot" />
// with:
<OpsAssistantChat vertical={vertical} query={query} />
```

In `VerticalOpsConsole.jsx`, pass the current lookup query to the drawer:

```jsx
// change the RecordDrawer usage to include query={q}:
<RecordDrawer open={!!drawer} vertical={vertical} category={drawer?.category || {}} row={drawer?.row} customer={result?.customer} query={q} onClose={() => setDrawer(null)} onAction={runAction} />
```

Append the chat styles to `VerticalOpsConsole.css`:

```css
.vops-assistant { margin:16px 0; }
.vops-assistant__bar { display:flex; align-items:center; gap:8px; width:100%; text-align:left; background:var(--tint); border:1px solid color-mix(in srgb,var(--accent) 22%, #fff); border-radius:12px; padding:11px 13px; cursor:pointer; }
.vops-assistant__ro { margin-left:auto; font-size:10px; font-weight:700; color:var(--accent2); background:#fff; border-radius:99px; padding:2px 8px; }
.vops-assistant__panel { border:1px solid #ebeef5; border-radius:12px; margin-top:8px; overflow:hidden; }
.vops-assistant__msgs { padding:12px; display:flex; flex-direction:column; gap:8px; max-height:220px; overflow:auto; }
.vops-assistant__u { align-self:flex-end; background:var(--accent); color:#fff; padding:8px 11px; border-radius:12px; font-size:12.5px; max-width:85%; }
.vops-assistant__a { align-self:flex-start; background:#f1f3f9; color:#23303f; padding:8px 11px; border-radius:12px; font-size:12.5px; max-width:85%; }
.vops-assistant__in { display:flex; gap:8px; padding:10px 12px; border-top:1px solid #f0f1f7; }
.vops-assistant__in input { flex:1; border:1px solid #e1e5ef; border-radius:9px; padding:8px 11px; font-size:12.5px; }
.vops-assistant__in button { background:var(--accent); color:#fff; border:0; border-radius:9px; padding:0 14px; font-weight:700; cursor:pointer; }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/verticalOps`
Expected: PASS — including `OpsAssistantChat` and the existing console/drawer suites (RecordDrawer still renders; the slot now contains the chat).

- [ ] **Step 6: Commit**

```bash
git add src/components/verticalOps/OpsAssistantChat.jsx src/components/verticalOps/RecordDrawer.jsx src/components/verticalOps/VerticalOpsConsole.jsx src/components/verticalOps/VerticalOpsConsole.css src/components/verticalOps/__tests__/OpsAssistantChat.test.jsx
git commit -m "feat(ops-assistant): drawer chat wired to ops-assistant endpoint"
```

---

### Task 6: Manual end-to-end verification

**Files:** none.

- [ ] **Step 1: Backend up** — restart `demo-api-server` (Node `--watch` should reload; the new route needs the server to pick up the new files). Confirm `/api/admin/healthcare/ops-assistant` exists.

- [ ] **Step 2: As a customer**, open `/admin/healthcare`, look up a patient, open a record, expand the Ops Assistant, and ask "summarize open items". Confirm: a grounded answer returns; asking it to "cancel the appointment" makes it decline and point to the action buttons (read-only); with no customer looked up it returns the "look up a customer first" message.

- [ ] **Step 3: Provider check** — if the configured LLM provider is unavailable, confirm the chat shows "Assistant offline"/the unavailable message rather than a broken bubble.

---

## Self-Review

- **Spec coverage (§5.3):** new `opsAssistantService` ✓; `POST /api/admin/<vertical>/ops-assistant` under `authenticateToken` ✓; per-vertical grounded system prompt ✓; server-side grounding via `getCustomerContext`, client never sends records ✓; `runReasonLoop` with empty tools (structurally read-only) ✓; standard envelope ✓; guardrails: 2000-char cap, prompt size cap 12000, scoped to resolved customer ✓. Conversation persistence via `conversationStore` is intentionally omitted from v1 (history is passed from the client, last 10) — note as optional enhancement aligning with the conversation-continuity memory.
- **Placeholder scan:** none — all steps have real code/commands.
- **Type consistency:** `getCustomerContext`→`{customer, records}`; `processOpsMessage({vertical, query, message, history, langchainConfig})`→envelope; route body `{message, query, history}`; `runReasonLoop` call uses the verified parameter names (`messages, tools, provider, model, systemPrompt, helixConfig, anthropicApiKey, maxIterations, executeTool`). Consistent across Tasks 1–5.
- **Note:** Slice field names used in the system prompt come straight from `records` (raw store objects), so prompt grounding is robust to the frontend field-name reconciliation in the console plan.
