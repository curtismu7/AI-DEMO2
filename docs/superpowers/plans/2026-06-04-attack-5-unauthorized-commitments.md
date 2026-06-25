# Attack 5 — Unauthorized Commitments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `request_fee_waiver` MCP tool that constrains the agent to what it can actually do (submit a request for human review) rather than what it cannot do (grant a waiver), and add an "Unauthorized Commitments" tab to `AiAttacksPanel.js` that explains the Air Canada pattern and how scoped tooling prevents it.

**Architecture:** A new BFF route `POST /api/accounts/:id/fee-waiver-request` logs the request and returns a confirmation — it never mutates balances. A new MCP tool `request_fee_waiver` in `BankingToolRegistry.ts` routes through the existing handler pipeline. The handler `executeRequestFeeWaiver` in a new `commitmentHandlers.ts` calls `BankingAPIClient.requestFeeWaiver()`. A regression test suite covers the handler. The UI tab is added to the already-existing `AiAttacksPanel.js` (created by the attack-1 plan).

**Tech Stack:** TypeScript 5 (MCP server, CommonJS output via `tsc`), Node.js/Express CommonJS (BFF), React 18/JSX ES modules (UI), Jest + supertest

> **Prerequisite:** Task 6 modifies `demo_api_ui/src/components/education/AiAttacksPanel.js`. This file is created by `docs/superpowers/plans/2026-06-04-attack-1-prompt-injection.md`. If it does not exist yet when you reach Task 6, implement the attack-1 plan first (Tasks 4–5 of that plan create the file), then return here.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `demo_api_server/routes/accounts.js` | Modify | Add `POST /:id/fee-waiver-request` route before `module.exports` |
| `demo_mcp_server/src/banking/BankingAPIClient.ts` | Modify | Add `requestFeeWaiver(userToken, accountId, reason)` method |
| `demo_mcp_server/src/tools/handlers/commitmentHandlers.ts` | Create | `executeRequestFeeWaiver` handler — calls `apiClient.requestFeeWaiver` |
| `demo_mcp_server/src/tools/handlers/index.ts` | Modify | Import and register `executeRequestFeeWaiver` in `handlerMap` |
| `demo_mcp_server/src/tools/BankingToolRegistry.ts` | Modify | Add `request_fee_waiver` tool definition after `update_contact_email` |
| `demo_mcp_server/tests/tools/commitmentHandlers.regression.test.ts` | Create | Regression tests for `executeRequestFeeWaiver` |
| `demo_api_ui/src/components/education/AiAttacksPanel.js` | Modify | Add `"unauthorized-commitments"` tab |

---

## Task 1: Add the BFF route

**Files:**
- Modify: `demo_api_server/routes/accounts.js` (before `router.provisionDemoAccounts = ...` at line 524)

The route is `POST /:id/fee-waiver-request`. It checks the account exists, verifies the authenticated user owns it (matching against `req.user.sub` exactly as the existing `contact-email` route does), generates a `requestId`, logs it, and returns 201. It does NOT modify any balance, account record, or transaction.

- [ ] **Step 1.1: Add the route to accounts.js**

Open `demo_api_server/routes/accounts.js`. Find the block that ends with:
```js
router.provisionDemoAccounts = provisionDemoAccounts;
module.exports = router;
```

Insert the following immediately before those two lines:

```js
router.post('/:id/fee-waiver-request', authenticateToken, requireScopes(['write']), async (req, res) => {
  const account = dataStore.getAccountById(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.userId !== req.user.sub) return res.status(403).json({ error: 'Forbidden' });
  const requestId = `fwr-${Date.now()}`;
  console.log(`[FeeWaiver] Request ${requestId} logged for account ${req.params.id} — reason: ${req.body.reason || 'none'}`);
  res.status(201).json({
    submitted: true,
    requestId,
    accountId: req.params.id,
    note: 'Your fee waiver request has been logged for review. A human agent will respond within 2 business days.',
  });
});
```

- [ ] **Step 1.2: Verify the BFF test suite still passes**

```bash
cd /Users/curtismuir/Development/AI-Demo
npm run test:api-server 2>&1 | tail -20
```

Expected: all suites pass, zero new failures.

- [ ] **Step 1.3: Commit**

```bash
git add demo_api_server/routes/accounts.js
git commit -m "feat(accounts): add POST /:id/fee-waiver-request route"
```

---

## Task 2: Add BankingAPIClient.requestFeeWaiver

**Files:**
- Modify: `demo_mcp_server/src/banking/BankingAPIClient.ts` (after the `updateContactEmail` method, around line 350)

- [ ] **Step 2.1: Add the method**

Open `demo_mcp_server/src/banking/BankingAPIClient.ts`. Find the `updateContactEmail` method which ends with:
```typescript
  async updateContactEmail(userToken: string, accountId: string, newEmail: string): Promise<Record<string, unknown>> {
    const response = await this.makeAuthenticatedRequest<Record<string, unknown>>(
      'PATCH',
      `/api/accounts/${encodeURIComponent(accountId)}/contact-email`,
      userToken,
      { new_email: newEmail }
    );
    return response.data;
  }
```

Add immediately after it (before the `getSensitiveAccountDetails` method):

```typescript
  async requestFeeWaiver(userToken: string, accountId: string, reason: string): Promise<Record<string, unknown>> {
    const response = await this.makeAuthenticatedRequest<Record<string, unknown>>(
      'POST',
      `/api/accounts/${encodeURIComponent(accountId)}/fee-waiver-request`,
      userToken,
      { reason }
    );
    return response.data;
  }
```

- [ ] **Step 2.2: Build the MCP server to verify TypeScript compiles**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_mcp_server && npm run build 2>&1 | tail -20
```

Expected: exit code 0, no TypeScript errors.

- [ ] **Step 2.3: Commit**

```bash
git add demo_mcp_server/src/banking/BankingAPIClient.ts
git commit -m "feat(mcp-client): add requestFeeWaiver method to BankingAPIClient"
```

---

## Task 3: Create the handler file and write the regression test first

**Files:**
- Create: `demo_mcp_server/src/tools/handlers/commitmentHandlers.ts`
- Create: `demo_mcp_server/tests/tools/commitmentHandlers.regression.test.ts`

Follow the TDD loop: write the test, run it to see it fail (file not found), create the handler, run it again to see it pass.

- [ ] **Step 3.1: Write the failing test**

Create `demo_mcp_server/tests/tools/commitmentHandlers.regression.test.ts`:

```typescript
import { executeRequestFeeWaiver } from '../../src/tools/handlers/commitmentHandlers';
import type { HandlerDeps } from '../../src/tools/handlers/types';
import { BankingAPIClient } from '../../src/banking/BankingAPIClient';
import { Logger } from '../../src/utils/Logger';

const mockRequestFeeWaiver = jest.fn();

const deps: HandlerDeps = {
  apiClient: {
    requestFeeWaiver: mockRequestFeeWaiver,
  } as unknown as BankingAPIClient,
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger,
};

const TOKEN = 'tok-abc';

describe('executeRequestFeeWaiver', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls apiClient.requestFeeWaiver with token, account_id, and reason', async () => {
    mockRequestFeeWaiver.mockResolvedValue({
      submitted: true,
      requestId: 'fwr-1234',
      accountId: 'acc-001',
      note: 'Your fee waiver request has been logged for review. A human agent will respond within 2 business days.',
    });

    await executeRequestFeeWaiver(deps, TOKEN, { account_id: 'acc-001', reason: 'Overdraft charge dispute' });

    expect(mockRequestFeeWaiver).toHaveBeenCalledWith(TOKEN, 'acc-001', 'Overdraft charge dispute');
  });

  it('returns a success result containing the requestId', async () => {
    mockRequestFeeWaiver.mockResolvedValue({
      submitted: true,
      requestId: 'fwr-9999',
      accountId: 'acc-002',
      note: 'Your fee waiver request has been logged for review. A human agent will respond within 2 business days.',
    });

    const result = await executeRequestFeeWaiver(deps, TOKEN, { account_id: 'acc-002', reason: 'Monthly fee' });

    expect(result.success).toBe(true);
    expect(result.text).toContain('fwr-9999');
  });

  it('falls back to "Customer request" when reason is omitted', async () => {
    mockRequestFeeWaiver.mockResolvedValue({
      submitted: true,
      requestId: 'fwr-0001',
      accountId: 'acc-003',
      note: 'Your fee waiver request has been logged for review. A human agent will respond within 2 business days.',
    });

    await executeRequestFeeWaiver(deps, TOKEN, { account_id: 'acc-003' });

    expect(mockRequestFeeWaiver).toHaveBeenCalledWith(TOKEN, 'acc-003', 'Customer request');
  });
});
```

- [ ] **Step 3.2: Run the test to confirm it fails (file not found)**

```bash
cd /Users/curtismuir/Development/AI-Demo
npx jest --testPathPattern='commitmentHandlers.regression' --no-coverage 2>&1 | tail -20
```

Expected: **FAIL** — `Cannot find module '../../src/tools/handlers/commitmentHandlers'`

- [ ] **Step 3.3: Create the handler**

Create `demo_mcp_server/src/tools/handlers/commitmentHandlers.ts`:

```typescript
import type { HandlerFn } from './types';
import { createSuccessResult } from './results';

export const executeRequestFeeWaiver: HandlerFn = async (deps, token, params) => {
  const { account_id, reason } = params as { account_id: string; reason?: string };
  const result = await deps.apiClient.requestFeeWaiver(token, account_id, reason || 'Customer request');
  return createSuccessResult(JSON.stringify(result, null, 2));
};
```

- [ ] **Step 3.4: Run the test to confirm it passes**

```bash
cd /Users/curtismuir/Development/AI-Demo
npx jest --testPathPattern='commitmentHandlers.regression' --no-coverage 2>&1 | tail -20
```

Expected: **PASS** — 3 tests, 0 failures.

- [ ] **Step 3.5: Build to verify TypeScript compiles**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_mcp_server && npm run build 2>&1 | tail -20
```

Expected: exit code 0.

- [ ] **Step 3.6: Commit**

```bash
git add demo_mcp_server/src/tools/handlers/commitmentHandlers.ts demo_mcp_server/tests/tools/commitmentHandlers.regression.test.ts
git commit -m "feat(mcp-handlers): add executeRequestFeeWaiver handler + regression tests"
```

---

## Task 4: Register the handler in index.ts

**Files:**
- Modify: `demo_mcp_server/src/tools/handlers/index.ts`

- [ ] **Step 4.1: Add the import and register the handler**

Open `demo_mcp_server/src/tools/handlers/index.ts`. The current top of the file reads:
```typescript
import { executeGetMyAccounts, executeGetAccountBalance, executeGetSensitiveAccountDetails, executeUpdateContactEmail } from './accountHandlers';
import { executeGetMyTransactions, executeCreateDeposit, executeCreateWithdrawal, executeCreateTransfer } from './transactionHandlers';
import { executeQueryUserByEmail } from './identityHandlers';
import { executeSequentialThink } from './reasoningHandlers';
import { verticalHandlerMap } from './verticalHandlers';
```

Add one import line after the `reasoningHandlers` import:
```typescript
import { executeRequestFeeWaiver } from './commitmentHandlers';
```

Then in the `handlerMap` object (after `executeSequentialThink`), add:
```typescript
  executeRequestFeeWaiver,
```

The updated file should look like:
```typescript
import { executeGetMyAccounts, executeGetAccountBalance, executeGetSensitiveAccountDetails, executeUpdateContactEmail } from './accountHandlers';
import { executeGetMyTransactions, executeCreateDeposit, executeCreateWithdrawal, executeCreateTransfer } from './transactionHandlers';
import { executeQueryUserByEmail } from './identityHandlers';
import { executeSequentialThink } from './reasoningHandlers';
import { executeRequestFeeWaiver } from './commitmentHandlers';
import { verticalHandlerMap } from './verticalHandlers';
import {
  executeLookupCustomer,
  executeGetCustomerProfile,
  executeGetCustomerAccounts,
  executeGetCustomerTransactions,
  executeFreezeAccount,
  executeResetCustomerPassword,
  executeAdjustBalance,
  executeDeleteCustomer,
} from '../adminToolHandlers';
import type { HandlerFn } from './types';

export const handlerMap: Record<string, HandlerFn> = {
  executeGetMyAccounts,
  executeGetAccountBalance,
  executeUpdateContactEmail,
  executeGetMyTransactions,
  executeCreateDeposit,
  executeCreateWithdrawal,
  executeCreateTransfer,
  executeQueryUserByEmail,
  executeGetSensitiveAccountDetails,
  executeSequentialThink,
  executeRequestFeeWaiver,
  ...verticalHandlerMap,
  executeLookupCustomer,
  executeGetCustomerProfile,
  executeGetCustomerAccounts,
  executeGetCustomerTransactions,
  executeFreezeAccount,
  executeResetCustomerPassword,
  executeAdjustBalance,
  executeDeleteCustomer,
};

export type { HandlerFn, HandlerDeps } from './types';
```

- [ ] **Step 4.2: Build to verify TypeScript compiles**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_mcp_server && npm run build 2>&1 | tail -20
```

Expected: exit code 0.

- [ ] **Step 4.3: Commit**

```bash
git add demo_mcp_server/src/tools/handlers/index.ts
git commit -m "feat(mcp-handlers): register executeRequestFeeWaiver in handlerMap"
```

---

## Task 5: Register the tool in BankingToolRegistry

**Files:**
- Modify: `demo_mcp_server/src/tools/BankingToolRegistry.ts` (after the `update_contact_email` block, around line 378)

- [ ] **Step 5.1: Add the tool definition**

Open `demo_mcp_server/src/tools/BankingToolRegistry.ts`. Find the end of the `update_contact_email` block:
```typescript
    update_contact_email: {
      ...
      inputSchema: {
        ...
        required: ['account_id', 'new_email'],
        additionalProperties: false
      }
    },
```

Add the `request_fee_waiver` tool definition immediately after the closing `},` of `update_contact_email` and before the `query_user_by_email` block:

```typescript
    request_fee_waiver: {
      name: 'request_fee_waiver',
      title: 'Request Fee Waiver',
      description: 'Submit a fee waiver request for review by a human agent. This logs the request — it does NOT grant a waiver. A human reviewer will respond within 2 business days.',
      requiresUserAuth: true,
      requiredScopes: ['write'],
      handler: 'executeRequestFeeWaiver',
      readOnly: false,
      icons: [{ src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z%22/%3E%3C/svg%3E', mimeType: 'image/svg+xml', sizes: ['16x16', '32x32'] }],
      annotations: { userFacing: { readable: false, destructive: false, idempotent: false, openWorld: false } },
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'Account ID to request the fee waiver for' },
          reason: { type: 'string', description: 'Reason for the waiver request' }
        },
        required: ['account_id'],
        additionalProperties: false
      }
    },
```

- [ ] **Step 5.2: Build to verify TypeScript compiles**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_mcp_server && npm run build 2>&1 | tail -20
```

Expected: exit code 0.

- [ ] **Step 5.3: Run the full MCP test suite to confirm no regressions**

```bash
cd /Users/curtismuir/Development/AI-Demo
npm run test:mcp-server 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5.4: Commit**

```bash
git add demo_mcp_server/src/tools/BankingToolRegistry.ts
git commit -m "feat(mcp-registry): add request_fee_waiver tool definition"
```

---

## Task 6: Add "Unauthorized Commitments" tab to AiAttacksPanel.js

**Files:**
- Modify: `demo_api_ui/src/components/education/AiAttacksPanel.js`

This file was created by the attack-1 plan. It already has a `tabs` array with at least a `"prompt-injection"` tab. This task adds one more tab object to the `tabs` array. Do not touch any other part of the file.

- [ ] **Step 6.1: Add the new tab to the tabs array**

Open `demo_api_ui/src/components/education/AiAttacksPanel.js`. Find the `tabs` array — it ends just before the `return (` statement. Append the following object to the array (after the last existing tab's closing `},`):

```js
    {
      id: 'unauthorized-commitments',
      label: 'Unauthorized Commitments',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>The Air Canada pattern</h3>
          <p style={{ color: '#374151' }}>
            In 2024, Air Canada&apos;s chatbot promised a bereavement discount that was not in the
            actual policy. A court held Air Canada responsible — not for a code bug, but because the
            company could not distinguish between what the agent <em>said</em> and what it was{' '}
            <em>mechanically capable of doing</em>. The agent had no tool to grant discounts, yet
            the customer reasonably relied on its words.
          </p>
          <div
            style={{
              background: 'rgba(239,68,68,0.07)',
              borderLeft: '3px solid #ef4444',
              padding: '8px 12px',
              borderRadius: 4,
              marginBottom: '1rem',
            }}
          >
            <strong>Root cause:</strong> the LLM filled the gap between &ldquo;what the user
            asked for&rdquo; and &ldquo;what tools exist&rdquo; with natural-language promises it
            could never execute.
          </div>
          <h3>The key insight</h3>
          <p style={{ color: '#374151' }}>
            In a tool-use agent, the <strong>tool set IS the authorization boundary</strong>. If
            there is no <code>waive_fee</code> tool, the agent cannot waive a fee — no matter what
            it says in natural language. This is a design property, not a runtime check.
          </p>
          <ul style={{ color: '#374151' }}>
            <li>&ldquo;I&apos;ll waive your overdraft fee&rdquo; → no <code>waive_fee</code> tool → hallucinated commitment</li>
            <li>&ldquo;I&apos;ll open a new account for you right now&rdquo; → no <code>create_account</code> tool → hallucinated commitment</li>
            <li>&ldquo;I&apos;ll apply the promotional rate&rdquo; → no <code>apply_rate</code> tool → hallucinated commitment</li>
          </ul>
          <h3>How this demo prevents it</h3>
          <p style={{ color: '#374151' }}>
            The <strong>request_fee_waiver</strong> MCP tool constrains the agent to what it can
            actually do. It does not grant a waiver — it submits a request for human review and
            returns a confirmation with a request ID. The tool description is explicit:{' '}
            <em>&ldquo;This logs the request — it does NOT grant a waiver.&rdquo;</em>
          </p>
          <p style={{ color: '#374151' }}>
            When the agent says &ldquo;I&apos;ve submitted a fee waiver request for you (request ID
            fwr-1234567890)&rdquo;, that statement is backed by a real tool call with a real audit
            trail. The bank never promised a waiver — only that a human will review it.
          </p>
          <div
            style={{
              background: 'rgba(99,102,241,0.08)',
              borderLeft: '3px solid #6366f1',
              padding: '8px 12px',
              borderRadius: 4,
            }}
          >
            Try it: ask the agent &ldquo;Can you waive the fee on my checking account?&rdquo; The
            agent calls <code>request_fee_waiver</code> and returns the request ID — it cannot
            silently grant the waiver because no such tool exists.
          </div>
        </>
      ),
    },
```

- [ ] **Step 6.2: Build the UI to verify zero compile errors**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: exit code 0, no React/JSX errors.

- [ ] **Step 6.3: Commit**

```bash
git add demo_api_ui/src/components/education/AiAttacksPanel.js
git commit -m "feat(edu): add Unauthorized Commitments tab to AiAttacksPanel"
```

---

## Task 7: Final verification

- [ ] **Step 7.1: Run full test suites**

```bash
cd /Users/curtismuir/Development/AI-Demo
npm run test:api-server 2>&1 | tail -20
npm run test:mcp-server 2>&1 | tail -20
```

Expected: all existing tests pass; `commitmentHandlers.regression` (3 tests) and any BFF tests pass.

- [ ] **Step 7.2: Build the UI one final time**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: exit code 0.

- [ ] **Step 7.3: Build the MCP server one final time**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_mcp_server && npm run build 2>&1 | tail -10
```

Expected: exit code 0.
