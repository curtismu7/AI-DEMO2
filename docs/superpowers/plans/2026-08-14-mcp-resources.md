# MCP Resources — Account & Transaction Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose banking account and transaction data as MCP `resources/list` + `resources/read` endpoints on `demo_mcp_server`, with the MCP gateway forwarding and enforcing P1AZ authorization on those endpoints.

**Architecture:** `demo_mcp_server` gains three new JSON-RPC handlers (`resources/list`, `resources/read`, `resources/subscribe`). Resources are scoped per-user: a bearer token arriving with the MCP session determines which account and transaction URIs are visible. The gateway adds `resources/list` and `resources/read` to its forwarding logic and sends the same P1AZ `McpResourceRead` decision context it already uses for `McpToolCall`. Subscriptions emit `notifications/resources/updated` when LMDB data changes — the BFF subscribes on behalf of the UI and pushes the update over the existing AG-UI SSE channel. No new auth primitives; no new session state.

**Tech Stack:** TypeScript + jest (demo_mcp_server, demo_mcp_gateway), CommonJS + Express (demo_api_server), React 19 / JSX (demo_api_ui), existing LMDB banking store, existing P1AZ guard pattern.

**Spec:** `docs/superpowers/specs/2026-08-14-mcp-annotations-elicitation-design.md` (gap #3 row in the Remaining MCP Gaps table)

## Global Constraints

- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`
- All modals must use `DraggableModal`
- Stage explicitly with named files — never `git add -A`
- Node >= 22; TypeScript strict mode in demo_mcp_server and demo_mcp_gateway
- Existing `tools/call` and `tools/list` P1AZ flows must remain completely unchanged
- All gateway unit tests: `cd demo_mcp_gateway && npm test`
- All mcp-server tests: `cd demo_mcp_server && npm test`
- All BFF tests: `cd demo_api_server && CI=true npm test -- --forceExit`
- UI build gate: `cd demo_api_ui && npm run test:unit && npm run build`
- Work in a git worktree — never edit main checkout directly

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `demo_mcp_server/src/handlers/resourceHandlers.ts` | Create | `resources/list`, `resources/read`, `resources/subscribe` handlers |
| `demo_mcp_server/src/handlers/__tests__/resourceHandlers.test.ts` | Create | Unit tests for resource handlers |
| `demo_mcp_server/src/index.ts` | Modify | Register resource handler routes |
| `demo_mcp_gateway/src/auth/pingAuthorizeGuard.ts` | Modify | Add `McpResourceRead` decision context type + `guardResourceRead()` |
| `demo_mcp_gateway/src/index.ts` | Modify | Forward `resources/list` + `resources/read` to mcp-server; enforce P1AZ |
| `demo_api_server/routes/agentRun.js` | Modify | Subscribe to resource updates; push `RESOURCE_UPDATED` event over SSE |
| `demo_api_ui/src/components/ResourceBrowser.jsx` | Create | Read-only panel listing accounts and transactions via `resources/list` |
| `demo_api_ui/src/components/__tests__/ResourceBrowser.test.jsx` | Create | Component tests |

---

## Resource URI scheme

Use a stable hierarchical URI format:

```
banking://accounts                                   list all accounts
banking://accounts/{account_id}                      one account record
banking://accounts/{account_id}/transactions         list transactions for account
banking://accounts/{account_id}/transactions/{tx_id} one transaction
```

These URIs are returned in `resources/list` and used in `resources/read` requests.

---

## Task 1: Read the banking data layer

Before writing any handler code, locate the existing data layer so handlers call it correctly.

**Files:** (read-only investigation, no changes)

- [ ] **Step 1: Locate the LMDB banking store in demo_mcp_server**

```bash
grep -r "lmdb\|bankingDb\|accounts\|transactions" \
  demo_mcp_server/src --include="*.ts" -l
```

Note which file exports the database handle and what functions it exposes (e.g., `getAccounts(userId)`, `getTransactions(accountId)`).

- [ ] **Step 2: Confirm the data shape**

```bash
grep -r "getAccounts\|getTransactions\|AccountRecord\|TransactionRecord" \
  demo_mcp_server/src --include="*.ts" -n | head -40
```

Record the exact function signatures and return types — the resource handler tests depend on them.

- [ ] **Step 3: Locate how existing tool handlers extract the bearer token's userId**

```bash
grep -r "userId\|sub\|decoded\|token\|auth" \
  demo_mcp_server/src/handlers --include="*.ts" -n | head -30
```

The resource handlers must use the same pattern.

---

## Task 2: `demo_mcp_server` resource handlers

**Files:**
- Create: `demo_mcp_server/src/handlers/resourceHandlers.ts`
- Create: `demo_mcp_server/src/handlers/__tests__/resourceHandlers.test.ts`

**Context:** The handlers receive the raw JSON-RPC `params` and must extract `userId` from the session token (same pattern as existing tool handlers found in Task 1). Resource URIs follow the scheme defined above.

**Interfaces:**
- Produces: exported `handleResourcesList`, `handleResourcesRead`, `handleResourcesSubscribe` — used by Task 3

- [ ] **Step 1: Write the failing tests**

```typescript
// demo_mcp_server/src/handlers/__tests__/resourceHandlers.test.ts
import { handleResourcesList, handleResourcesRead } from '../resourceHandlers';

// Replace mockDb and mockUserId with the actual module mock pattern
// used in other handler tests in this directory.
const mockAccounts = [
  { id: 'acct-1', name: 'Checking', balance: 1200 },
  { id: 'acct-2', name: 'Savings',  balance: 3400 },
];
const mockTransactions = [
  { id: 'tx-1', accountId: 'acct-1', amount: -50, description: 'Coffee' },
];

describe('handleResourcesList', () => {
  it('returns account URIs for authenticated user', async () => {
    // Mock the db functions using the pattern found in Task 1 Step 1
    jest.spyOn(bankingDb, 'getAccounts').mockResolvedValue(mockAccounts);
    const result = await handleResourcesList({ userId: 'user-1' });
    expect(result.resources).toHaveLength(2);
    expect(result.resources[0].uri).toBe('banking://accounts/acct-1');
    expect(result.resources[0].name).toBe('Checking');
    expect(result.resources[0].mimeType).toBe('application/json');
  });
});

describe('handleResourcesRead', () => {
  it('returns account record for valid URI', async () => {
    jest.spyOn(bankingDb, 'getAccounts').mockResolvedValue(mockAccounts);
    const result = await handleResourcesRead(
      { uri: 'banking://accounts/acct-1' },
      { userId: 'user-1' }
    );
    expect(result.contents[0].uri).toBe('banking://accounts/acct-1');
    expect(JSON.parse(result.contents[0].text).id).toBe('acct-1');
    expect(result.contents[0].mimeType).toBe('application/json');
  });

  it('returns transaction list for accounts/{id}/transactions URI', async () => {
    jest.spyOn(bankingDb, 'getTransactions').mockResolvedValue(mockTransactions);
    const result = await handleResourcesRead(
      { uri: 'banking://accounts/acct-1/transactions' },
      { userId: 'user-1' }
    );
    expect(result.contents[0].uri).toBe('banking://accounts/acct-1/transactions');
    const data = JSON.parse(result.contents[0].text);
    expect(data).toHaveLength(1);
  });

  it('returns error for unknown URI', async () => {
    await expect(
      handleResourcesRead({ uri: 'banking://unknown/path' }, { userId: 'user-1' })
    ).rejects.toMatchObject({ code: -32002, message: expect.stringContaining('not found') });
  });

  it('returns error for URI that belongs to a different user', async () => {
    jest.spyOn(bankingDb, 'getAccounts').mockResolvedValue(mockAccounts);
    // user-2 asks for acct-1 which belongs to user-1
    await expect(
      handleResourcesRead({ uri: 'banking://accounts/acct-1' }, { userId: 'user-2' })
    ).rejects.toMatchObject({ code: -32002 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd demo_mcp_server && npm test -- --testPathPattern=resourceHandlers
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `resourceHandlers.ts`**

```typescript
// demo_mcp_server/src/handlers/resourceHandlers.ts
// Replace 'bankingDb' with the actual import from Task 1 Step 1.
import { bankingDb } from '../db/bankingDb';

interface ResourceSession {
  userId: string;
}

interface ResourceItem {
  uri: string;
  name: string;
  description?: string;
  mimeType: string;
}

function parseUri(uri: string): { type: string; accountId?: string; txId?: string } {
  const m = uri.match(/^banking:\/\/accounts(?:\/([^/]+)(?:\/(transactions)(?:\/([^/]+))?)?)?$/);
  if (!m) return { type: 'unknown' };
  if (!m[1]) return { type: 'accounts' };
  if (!m[2]) return { type: 'account', accountId: m[1] };
  if (!m[3]) return { type: 'transactions', accountId: m[1] };
  return { type: 'transaction', accountId: m[1], txId: m[3] };
}

export async function handleResourcesList(session: ResourceSession) {
  const accounts = await bankingDb.getAccounts(session.userId);
  const resources: ResourceItem[] = accounts.map(a => ({
    uri: `banking://accounts/${a.id}`,
    name: a.name,
    description: `Balance: ${a.balance}`,
    mimeType: 'application/json',
  }));
  return { resources };
}

export async function handleResourcesRead(
  params: { uri: string },
  session: ResourceSession
) {
  const parsed = parseUri(params.uri);

  if (parsed.type === 'accounts') {
    const accounts = await bankingDb.getAccounts(session.userId);
    return {
      contents: [{
        uri: params.uri,
        mimeType: 'application/json',
        text: JSON.stringify(accounts),
      }],
    };
  }

  if (parsed.type === 'account') {
    const accounts = await bankingDb.getAccounts(session.userId);
    const acct = accounts.find(a => a.id === parsed.accountId);
    if (!acct) throw { code: -32002, message: `Resource not found: ${params.uri}` };
    return {
      contents: [{
        uri: params.uri,
        mimeType: 'application/json',
        text: JSON.stringify(acct),
      }],
    };
  }

  if (parsed.type === 'transactions') {
    // Verify account ownership first
    const accounts = await bankingDb.getAccounts(session.userId);
    if (!accounts.find(a => a.id === parsed.accountId)) {
      throw { code: -32002, message: `Resource not found: ${params.uri}` };
    }
    const txns = await bankingDb.getTransactions(parsed.accountId!);
    return {
      contents: [{
        uri: params.uri,
        mimeType: 'application/json',
        text: JSON.stringify(txns),
      }],
    };
  }

  throw { code: -32002, message: `Resource not found: ${params.uri}` };
}

export async function handleResourcesSubscribe(
  params: { uri: string },
  session: ResourceSession
) {
  // Validate the URI is accessible to this user first
  await handleResourcesRead(params, session);
  // Return subscription ack — change notifications handled by mcp-server index.ts
  return {};
}
```

- [ ] **Step 4: Run tests**

```bash
cd demo_mcp_server && npm test -- --testPathPattern=resourceHandlers
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_server/src/handlers/resourceHandlers.ts \
        demo_mcp_server/src/handlers/__tests__/resourceHandlers.test.ts
git commit -m "feat(mcp-server): add resources/list and resources/read handlers"
```

---

## Task 3: Register handlers in `demo_mcp_server/src/index.ts`

**Files:**
- Modify: `demo_mcp_server/src/index.ts`

**Context:** Locate the existing `tools/list` and `tools/call` routing in `index.ts` and add the resource methods alongside them.

- [ ] **Step 1: Locate the method routing**

```bash
grep -n '"tools/list"\|"tools/call"\|method.*tools' \
  demo_mcp_server/src/index.ts | head -20
```

Note the exact routing pattern (switch/if-chain/map).

- [ ] **Step 2: Add resource routes**

Following the exact same pattern:

```typescript
import { handleResourcesList, handleResourcesRead, handleResourcesSubscribe }
  from './handlers/resourceHandlers';

// In the method routing block, add:
case 'resources/list':
  result = await handleResourcesList({ userId: session.userId });
  break;
case 'resources/read':
  result = await handleResourcesRead(request.params, { userId: session.userId });
  break;
case 'resources/subscribe':
  result = await handleResourcesSubscribe(request.params, { userId: session.userId });
  break;
case 'resources/unsubscribe':
  result = {};  // no-op; subscriptions are session-scoped
  break;
```

- [ ] **Step 3: Run the full mcp-server suite**

```bash
cd demo_mcp_server && npm test
```
Expected: PASS — no existing tests broken.

- [ ] **Step 4: Commit**

```bash
git add demo_mcp_server/src/index.ts
git commit -m "feat(mcp-server): register resources/* JSON-RPC handlers"
```

---

## Task 4: Gateway forwards and guards resource calls

**Files:**
- Modify: `demo_mcp_gateway/src/auth/pingAuthorizeGuard.ts`
- Modify: `demo_mcp_gateway/src/index.ts`

**Context:** The gateway today forwards `tools/call` by:
1. Extracting the tool name and user token from the request
2. Calling `buildAuthorizeParameters` + P1AZ `evaluate`
3. On PERMIT: proxying the request to mcp-server

Resources need the same pattern, with a new `DecisionContext` value (`McpResourceRead`). The `ResourceUri` parameter replaces `ToolName`. Read-only resources should use `ToolReadOnly: "true"` (same convention as annotations task); `resources/list` is always read-only.

**Interfaces:**
- Produces: `guardResourceRead(uri, token, context)` — called by Task 4 index.ts changes

- [ ] **Step 1: Write the failing test (guard)**

In the existing `pingAuthorizeGuard.test.ts` file, add:

```typescript
describe('guardResourceRead', () => {
  it('sends McpResourceRead decision context to P1AZ', async () => {
    const capturedParams: Record<string, string>[] = [];
    jest.spyOn(pingAuthorizeClient, 'evaluate').mockImplementation(async (params) => {
      capturedParams.push(params);
      return { decision: 'PERMIT', statements: [] };
    });

    await guardResourceRead('banking://accounts/acct-1', mockToken, mockContext);

    expect(capturedParams[0].DecisionContext).toBe('McpResourceRead');
    expect(capturedParams[0].ResourceUri).toBe('banking://accounts/acct-1');
    expect(capturedParams[0].ToolReadOnly).toBe('true');
  });

  it('returns DENY result on resource the user cannot access', async () => {
    jest.spyOn(pingAuthorizeClient, 'evaluate').mockResolvedValue({
      decision: 'DENY',
      statements: [{ code: 'UNAUTHORIZED' }],
    });

    const result = await guardResourceRead('banking://accounts/other', mockToken, mockContext);

    expect(result.decision).toBe('DENY');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd demo_mcp_gateway && npm test -- --testPathPattern=pingAuthorizeGuard
```
Expected: FAIL — `guardResourceRead` not defined.

- [ ] **Step 3: Implement `guardResourceRead`**

In `pingAuthorizeGuard.ts`, add alongside `guardToolCall`:

```typescript
export async function guardResourceRead(
  uri: string,
  token: string,
  context: AuthorizeContext
): Promise<AuthorizeResult> {
  const params = await buildAuthorizeParameters(token, context);
  params.DecisionContext = 'McpResourceRead';
  params.ResourceUri = uri;
  params.ToolReadOnly = 'true';     // resources are always read-only
  params.ToolDestructive = 'false';
  params.ToolIdempotent = 'true';
  return pingAuthorizeClient.evaluate(params);
}
```

- [ ] **Step 4: Add forwarding in `index.ts`**

Find the existing `tools/call` forwarding block. Add alongside it:

```typescript
case 'resources/list':
case 'resources/read':
case 'resources/subscribe':
case 'resources/unsubscribe': {
  if (method === 'resources/read') {
    const uri = request.params?.uri as string;
    const authorizeResult = await guardResourceRead(uri, bearerToken, authorizeContext);
    const obligation = classifyStatements(authorizeResult.statements);
    if (authorizeResult.decision !== 'PERMIT' && obligation !== 'elicitation') {
      return res.json(buildObligationResponse(reqId, obligation, authorizeResult));
    }
  }
  // Forward to mcp-server (same proxy pattern as tools/call)
  return proxyToMcpServer(req, res, request);
}
```

`resources/list` does not require per-resource P1AZ checks — the handler in mcp-server already scopes the list to the user's token. Only `resources/read` needs a per-URI P1AZ guard.

- [ ] **Step 5: Run gateway tests**

```bash
cd demo_mcp_gateway && npm test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_gateway/src/auth/pingAuthorizeGuard.ts \
        demo_mcp_gateway/src/index.ts
git commit -m "feat(gateway): forward and P1AZ-guard resources/list and resources/read"
```

---

## Task 5: Resource subscriptions — change notifications

**Files:**
- Modify: `demo_mcp_server/src/index.ts`
- Modify: `demo_api_server/routes/agentRun.js`

**Context:** When LMDB data changes (after a write tool call), mcp-server should emit `notifications/resources/updated` with the affected URI. The BFF intercepts this notification while the agent SSE stream is live and pushes a `RESOURCE_UPDATED` event to the browser.

Read how `demo_mcp_server` currently emits notifications (search for `notification` in `index.ts`). If the mcp-server uses a WebSocket or SSE transport for notifications, use the same mechanism; if not, a simple in-memory EventEmitter pattern is sufficient.

- [ ] **Step 1: Locate the existing notification pattern**

```bash
grep -n "notification\|emit\|EventEmitter\|notify" \
  demo_mcp_server/src/index.ts | head -20
```

- [ ] **Step 2: Add post-write resource invalidation to `demo_mcp_server`**

After any tool call that mutates account/transaction data (find these by searching for write operations in the existing tool handlers), emit:

```typescript
// After a successful write tool that changes account data:
notifyResourceUpdated(`banking://accounts/${affectedAccountId}`);
notifyResourceUpdated(`banking://accounts/${affectedAccountId}/transactions`);
```

Where `notifyResourceUpdated` dispatches `notifications/resources/updated` to all active subscribers for that URI. Use the existing notification transport (found in Step 1) or add a simple EventEmitter:

```typescript
import { EventEmitter } from 'events';
export const resourceEvents = new EventEmitter();

export function notifyResourceUpdated(uri: string) {
  resourceEvents.emit('updated', { uri });
}
```

- [ ] **Step 3: Wire notification to BFF SSE in `agentRun.js`**

In the agent SSE stream setup (read the existing HITL subscription pattern), add:

```javascript
// After opening the agent SSE stream, subscribe to resource updates:
const onResourceUpdated = ({ uri }) => {
  res.write('data: ' + JSON.stringify({ type: 'RESOURCE_UPDATED', uri }) + '\n\n');
};
mcpServerResourceEvents.on('updated', onResourceUpdated);

// Cleanup when the SSE connection closes:
req.on('close', () => {
  mcpServerResourceEvents.off('updated', onResourceUpdated);
});
```

- [ ] **Step 4: Run BFF tests**

```bash
cd demo_api_server && CI=true npm test -- --forceExit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_server/src/index.ts \
        demo_api_server/routes/agentRun.js
git commit -m "feat: emit resources/updated notifications on write tool completion"
```

---

## Task 6: UI `ResourceBrowser` component

**Files:**
- Create: `demo_api_ui/src/components/ResourceBrowser.jsx`
- Create: `demo_api_ui/src/components/__tests__/ResourceBrowser.test.jsx`
- Modify: locate where the agent/banking panel renders (grep for `AgentView\|ChatPanel\|BankingPanel` in `demo_api_ui/src` to find the host component)

**Constraints:** Read-only display only. Uses `apiClient`. Refreshes on `RESOURCE_UPDATED` SSE event. Uses `DraggableModal` if any detail overlay is needed.

- [ ] **Step 1: Confirm API route for resources**

The BFF must expose `GET /api/mcp/resources/list` and `GET /api/mcp/resources/read?uri=...` endpoints that proxy to the gateway's `resources/list` and `resources/read` methods. Check if they exist:

```bash
grep -r "resources/list\|resources/read" \
  demo_api_server/routes --include="*.js" -n | head -10
```

If missing, add them to the relevant BFF router (alongside existing `/api/mcp/tools/*` routes):

```javascript
router.get('/resources/list', authenticateToken, async (req, res) => {
  const response = await mcpGatewayClient.post('/', {
    jsonrpc: '2.0', id: 1, method: 'resources/list', params: {}
  });
  res.json(response.data.result);
});

router.get('/resources/read', authenticateToken, async (req, res) => {
  const response = await mcpGatewayClient.post('/', {
    jsonrpc: '2.0', id: 1, method: 'resources/read',
    params: { uri: req.query.uri }
  });
  res.json(response.data.result);
});
```

- [ ] **Step 2: Write failing vitest**

```javascript
// demo_api_ui/src/components/__tests__/ResourceBrowser.test.jsx
import { render, screen, waitFor } from '@testing-library/react';
import ResourceBrowser from '../ResourceBrowser';
import apiClient from '../../services/apiClient';

jest.mock('../../services/apiClient');

it('renders account list from resources/list', async () => {
  apiClient.get.mockResolvedValue({
    data: {
      resources: [
        { uri: 'banking://accounts/acct-1', name: 'Checking' },
        { uri: 'banking://accounts/acct-2', name: 'Savings' },
      ]
    }
  });

  render(<ResourceBrowser />);

  await waitFor(() => {
    expect(screen.getByText('Checking')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
  });
});

it('shows loading state before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  render(<ResourceBrowser />);
  expect(screen.getByText(/loading/i)).toBeInTheDocument();
});

it('shows error state on fetch failure', async () => {
  apiClient.get.mockRejectedValue(new Error('Network error'));
  render(<ResourceBrowser />);
  await waitFor(() => {
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
cd demo_api_ui && npm run test:unit -- ResourceBrowser
```
Expected: FAIL — component not found.

- [ ] **Step 4: Implement `ResourceBrowser.jsx`**

```jsx
import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';

export default function ResourceBrowser({ onResourceUpdated }) {
  const [resources, setResources] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try {
      const res = await apiClient.get('/api/mcp/resources/list');
      setResources(res.data.resources);
      setError(null);
    } catch {
      setError('Failed to load resources.');
    }
  }

  useEffect(() => { load(); }, []);

  // Refresh when parent SSE stream signals RESOURCE_UPDATED
  useEffect(() => {
    if (onResourceUpdated) {
      onResourceUpdated(load);
    }
  }, [onResourceUpdated]);

  if (error) return <p className="resource-browser__error">{error}</p>;
  if (!resources) return <p className="resource-browser__loading">Loading...</p>;

  return (
    <ul className="resource-browser__list">
      {resources.map(r => (
        <li key={r.uri} className="resource-browser__item">
          <span className="resource-browser__name">{r.name}</span>
          <code className="resource-browser__uri">{r.uri}</code>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Run tests**

```bash
cd demo_api_ui && npm run test:unit -- ResourceBrowser
```
Expected: PASS (3 tests).

- [ ] **Step 6: Mount in the host component**

Find the host component (grep found in step introduction). Add `ResourceBrowser` alongside or below the existing banking data panel. Wire `onResourceUpdated` to a callback that the SSE stream calls when `type === 'RESOURCE_UPDATED'`.

- [ ] **Step 7: Run full UI checks**

```bash
cd demo_api_ui && npm run test:unit && npm run build
```
Expected: PASS, build green.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/components/ResourceBrowser.jsx \
        demo_api_ui/src/components/__tests__/ResourceBrowser.test.jsx \
        <host-component-file>
git commit -m "feat(ui): add ResourceBrowser component for MCP resources/list"
```

---

## Task 7: Integration gate

- [ ] **Step 1: Run all touched test suites**

```bash
cd demo_mcp_server  && npm test
cd demo_mcp_gateway && npm test
cd demo_api_server  && CI=true npm test -- --forceExit
cd demo_api_ui      && npm run test:unit && npm run build
npm run topology:verify
npm run hygiene:check
```

All must be green.

- [ ] **Step 2: Manual smoke test**

```bash
./run-docker.sh restart demo-api-server mcp-server mcp-gateway
```

1. Sign in at `https://local.ping-devops.com:4000`
2. Open the agent panel — confirm `ResourceBrowser` renders with current accounts
3. Trigger a write tool (e.g. withdrawal) — confirm `ResourceBrowser` updates after the tool completes
4. Confirm `resources/list` response is user-scoped (no accounts from other users visible)
5. Confirm `resources/read` for a valid URI returns the record
6. Confirm `resources/read` for a URI belonging to another user returns an error (P1AZ DENY)
7. Confirm `tools/call` and HITL flow still work unchanged

- [ ] **Step 3: Final commit and PR**

```bash
/commit-push-pr
```
or follow the commit-commands skill.
