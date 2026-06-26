# MCP Servers — outputSchema + Pagination + New Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade both MCP servers (Banking + Dev) with typed structured outputs, pagination, and new tools.

**Architecture:** Three phases applied to both servers independently. Banking MCP uses a new `outputSchemas.ts` file + updated handlers/registry/message-handler. Dev MCP uses Zod output schemas alongside existing input schemas + a `pingone.ts` update for new tools.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk ^1.29`, Zod (dev MCP), Jest (banking MCP tests)

## Global Constraints

- `demo_mcp_server/` — TypeScript, Jest tests, no Zod (uses raw JSON Schema). Follow existing handler patterns: `createSuccessResult(text, data?)`.
- `dev_mcp/banking-dev/` — TypeScript, Zod + `zod-to-json-schema`, stdio transport.
- Never use `git add -A`. Stage specific files only. Always verify `git branch --show-current` before commit.
- Work in a git worktree per CLAUDE.md — do not edit directly on `main` or `fix/agent-cc-secret-configstore-lookup`.
- `BankingToolResult.structuredContent` flows to the top-level `result.structuredContent` in the MCP response (spec 2025-11-25), not inside a content array item.
- All `outputSchema` uses the same `JSONSchema` type as `inputSchema` in the banking server.
- Dev MCP output schemas use `zodToJsonSchema` — already imported and used for input schemas.

---

## File Map

### Banking MCP Server (`demo_mcp_server/`)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/tools/outputSchemas.ts` | **Create** | JSON Schema definitions for every tool's structured output |
| `src/tools/handlers/results.ts` | **Modify** | `createSuccessResult` accepts optional `data` arg; emits `structuredContent` |
| `src/interfaces/mcp.ts` | **Modify** | Add `structuredContent` to `ToolResult`; already present — verify only |
| `src/tools/BankingToolProvider.ts` | **Modify** | Add `structuredContent?: Record<string,any>` to `BankingToolResult` |
| `src/tools/BankingToolRegistry.ts` | **Modify** | Add `outputSchema` to every tool entry; add `offset` to `get_my_transactions` input schema; add two new tool entries |
| `src/tools/handlers/accountHandlers.ts` | **Modify** | Pass data to `createSuccessResult` |
| `src/tools/handlers/transactionHandlers.ts` | **Modify** | Pass data + add `offset` pagination |
| `src/tools/handlers/identityHandlers.ts` | **Modify** | Pass data |
| `src/tools/handlers/commitmentHandlers.ts` | **Modify** | Pass data |
| `src/tools/handlers/reasoningHandlers.ts` | **Modify** | Pass data |
| `src/tools/adminToolHandlers.ts` | **Modify** | Pass data |
| `src/tools/toolScopeMap.ts` | **Modify** | Add two new tool scope entries |
| `src/tools/handlers/index.ts` | **Modify** | Register two new handler exports |
| `src/server/MCPMessageHandler.ts` | **Modify** | Forward `outputSchema` in `tools/list`; forward `structuredContent` in `tools/call` result |
| `tests/tools/outputSchemas.test.ts` | **Create** | Validate every outputSchema is valid JSON Schema |
| `tests/tools/transactionHandlers.test.ts` | **Create** | Pagination unit tests |
| `tests/tools/newTools.test.ts` | **Create** | Tests for `search_transactions`, `get_transaction_detail` |

### Dev MCP Server (`dev_mcp/banking-dev/`)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/index.ts` | **Modify** | Add `outputSchema` field to `ToolEntry`; wire into `ListTools` response; register new tools |
| `src/tools/pingone.ts` | **Modify** | Add cursor param to `pingoneListUsers` + `pingoneListApps`; add `pingoneCreateWorkerApp`; add `pingoneCheckBootstrap` |

---

## Task 1: Banking MCP — Create `outputSchemas.ts`

**Files:**
- Create: `demo_mcp_server/src/tools/outputSchemas.ts`

**Interfaces:**
- Produces: `GET_MY_ACCOUNTS_OUTPUT`, `GET_ACCOUNT_BALANCE_OUTPUT`, `GET_SENSITIVE_ACCOUNT_DETAILS_OUTPUT`, `GET_MY_TRANSACTIONS_OUTPUT`, `WRITE_TRANSACTION_OUTPUT`, `QUERY_USER_BY_EMAIL_OUTPUT`, `REQUEST_FEE_WAIVER_OUTPUT`, `SEQUENTIAL_THINK_OUTPUT`, `SEARCH_TRANSACTIONS_OUTPUT`, `GET_TRANSACTION_DETAIL_OUTPUT`, `ADMIN_LOOKUP_OUTPUT`, `ADMIN_PROFILE_OUTPUT`, `ADMIN_ACCOUNTS_OUTPUT`, `ADMIN_TRANSACTIONS_OUTPUT`, `ADMIN_WRITE_OUTPUT` — all typed as `JSONSchema` from `'../interfaces/mcp'`

- [ ] **Step 1: Create the file**

```typescript
// demo_mcp_server/src/tools/outputSchemas.ts
import type { JSONSchema } from '../interfaces/mcp';

export const GET_MY_ACCOUNTS_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    count: { type: 'integer' },
    accounts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          accountType: { type: 'string' },
          name: { type: 'string' },
          accountNumber: { type: 'string' },
          balance: { type: 'number' },
          currency: { type: 'string' },
          status: { type: 'string' },
          accountHolderName: { type: 'string' },
          swiftCode: { type: 'string' },
          iban: { type: 'string' },
          branchName: { type: 'string' },
          branchCode: { type: 'string' },
          openedDate: { type: 'string' },
          notes: { type: 'string' },
          createdAt: { type: 'string' },
        },
        required: ['id', 'accountType', 'accountNumber', 'balance', 'currency', 'status', 'createdAt'],
      },
    },
  },
  required: ['success', 'count', 'accounts'],
};

export const GET_ACCOUNT_BALANCE_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    accountId: { type: 'string' },
    balance: { type: 'number' },
  },
  required: ['success', 'accountId', 'balance'],
};

export const GET_SENSITIVE_ACCOUNT_DETAILS_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    accounts: { type: 'array', items: { type: 'object' } },
    ok: { type: 'boolean' },
    step_up_required: { type: 'boolean' },
    consent_required: { type: 'boolean' },
    error: { type: 'string' },
  },
};

const TRANSACTION_ITEM: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['deposit', 'withdrawal', 'transfer'] },
    amount: { type: 'number' },
    date: { type: 'string' },
    fromAccountId: { type: 'string' },
    toAccountId: { type: 'string' },
    description: { type: 'string' },
  },
  required: ['id', 'type', 'amount', 'date'],
};

export const GET_MY_TRANSACTIONS_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    count: { type: 'integer' },
    total: { type: 'integer', description: 'Total available before pagination' },
    offset: { type: 'integer' },
    hasMore: { type: 'boolean' },
    nextOffset: { type: 'integer' },
    transactions: { type: 'array', items: TRANSACTION_ITEM },
  },
  required: ['success', 'count', 'total', 'offset', 'hasMore', 'transactions'],
};

export const SEARCH_TRANSACTIONS_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    count: { type: 'integer' },
    transactions: { type: 'array', items: TRANSACTION_ITEM },
  },
  required: ['success', 'count', 'transactions'],
};

export const GET_TRANSACTION_DETAIL_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    found: { type: 'boolean' },
    transaction: TRANSACTION_ITEM,
  },
  required: ['success', 'found'],
};

export const WRITE_TRANSACTION_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    operation: { type: 'string', enum: ['deposit', 'withdrawal', 'transfer'] },
    message: { type: 'string' },
    amount: { type: 'number' },
    accountId: { type: 'string' },
    fromAccountId: { type: 'string' },
    toAccountId: { type: 'string' },
    transaction: { type: 'object' },
    withdrawalTransaction: { type: 'object' },
    depositTransaction: { type: 'object' },
    description: { type: 'string' },
  },
  required: ['success', 'operation', 'amount'],
};

export const QUERY_USER_BY_EMAIL_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    exists: { type: 'boolean' },
    email: { type: 'string' },
    user: { type: 'object' },
    error: { type: 'string' },
  },
  required: ['exists'],
};

export const REQUEST_FEE_WAIVER_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    message: { type: 'string' },
    status: { type: 'string' },
  },
};

export const SEQUENTIAL_THINK_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    query: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['title', 'description'],
      },
    },
    conclusion: { type: 'string' },
  },
  required: ['success', 'query', 'steps', 'conclusion'],
};

export const ADMIN_LOOKUP_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    count: { type: 'integer' },
    users: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string' },
          role: { type: 'string' },
        },
        required: ['id', 'email'],
      },
    },
  },
  required: ['success', 'count', 'users'],
};

export const ADMIN_PROFILE_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    user: { type: 'object' },
  },
};

export const ADMIN_ACCOUNTS_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    count: { type: 'integer' },
    accounts: { type: 'array', items: { type: 'object' } },
  },
  required: ['success'],
};

export const ADMIN_TRANSACTIONS_OUTPUT: JSONSchema = GET_MY_TRANSACTIONS_OUTPUT;

export const ADMIN_WRITE_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    message: { type: 'string' },
  },
  required: ['success'],
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd demo_mcp_server && npx tsc --noEmit
```
Expected: no errors for the new file.

- [ ] **Step 3: Commit**

```bash
git add demo_mcp_server/src/tools/outputSchemas.ts
git commit -m "feat(mcp): add outputSchemas.ts with JSON Schema definitions for all banking tools"
```

---

## Task 2: Banking MCP — Wire `structuredContent` through result types and handlers

**Files:**
- Modify: `demo_mcp_server/src/tools/BankingToolProvider.ts` (add `structuredContent` to `BankingToolResult`)
- Modify: `demo_mcp_server/src/tools/handlers/results.ts` (accept optional data arg)
- Modify: `demo_mcp_server/src/tools/handlers/accountHandlers.ts`
- Modify: `demo_mcp_server/src/tools/handlers/transactionHandlers.ts`
- Modify: `demo_mcp_server/src/tools/handlers/identityHandlers.ts`
- Modify: `demo_mcp_server/src/tools/handlers/commitmentHandlers.ts`
- Modify: `demo_mcp_server/src/tools/handlers/reasoningHandlers.ts`

**Interfaces:**
- Consumes: `outputSchemas.ts` (Task 1)
- Produces: `createSuccessResult(text: string, data?: Record<string, any>): BankingToolResult` — used by all handlers

- [ ] **Step 1: Write failing test**

Create `demo_mcp_server/tests/tools/structuredContent.test.ts`:

```typescript
import { executeGetMyAccounts } from '../../src/tools/handlers/accountHandlers';
import { executeGetAccountBalance } from '../../src/tools/handlers/accountHandlers';
import { executeGetMyTransactions } from '../../src/tools/handlers/transactionHandlers';
import { BankingAPIClient } from '../../src/banking/BankingAPIClient';
import { Logger } from '../../src/utils/Logger';

jest.mock('../../src/banking/BankingAPIClient');
jest.mock('../../src/utils/Logger', () => ({
  Logger: { getInstance: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
  createDefaultLoggerConfig: () => ({}),
}));

const mockClient = new BankingAPIClient() as jest.Mocked<BankingAPIClient>;
const mockLogger = Logger.getInstance({} as any);
const deps = { apiClient: mockClient, logger: mockLogger };

describe('handlers emit structuredContent', () => {
  it('executeGetMyAccounts returns structuredContent', async () => {
    mockClient.getMyAccounts = jest.fn().mockResolvedValue([
      { id: 'acc-1', accountType: 'checking', accountNumber: '****1234',
        balance: 1000, currency: 'USD', status: 'active', createdAt: '2025-01-01' }
    ]);
    const result = await executeGetMyAccounts(deps, 'token', {});
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent!.success).toBe(true);
    expect(result.structuredContent!.count).toBe(1);
    expect(Array.isArray(result.structuredContent!.accounts)).toBe(true);
  });

  it('executeGetAccountBalance returns structuredContent', async () => {
    mockClient.getAccountBalance = jest.fn().mockResolvedValue({ balance: 500 });
    const result = await executeGetAccountBalance(deps, 'token', { account_id: 'acc-1' });
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent!.balance).toBe(500);
  });

  it('executeGetMyTransactions returns structuredContent', async () => {
    mockClient.getMyTransactions = jest.fn().mockResolvedValue([
      { id: 'tx-1', type: 'deposit', amount: 100, createdAt: '2025-01-01' }
    ]);
    const result = await executeGetMyTransactions(deps, 'token', {});
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent!.success).toBe(true);
    expect(Array.isArray(result.structuredContent!.transactions)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd demo_mcp_server && npx jest tests/tools/structuredContent.test.ts --no-coverage
```
Expected: FAIL — `result.structuredContent` is undefined.

- [ ] **Step 3: Add `structuredContent` to `BankingToolResult`**

In `demo_mcp_server/src/tools/BankingToolProvider.ts`, update the interface (it's around line 36):

```typescript
export interface BankingToolResult extends ToolResult {
  type: 'text';
  text: string;
  success?: boolean;
  error?: string;
  authChallenge?: AuthorizationRequest;
  originalRequest?: Record<string, any>;
  httpTrace?: HttpTraceEntry[];
  structuredContent?: Record<string, any>;  // add this line
}
```

- [ ] **Step 4: Update `createSuccessResult` in `results.ts`**

Replace the entire file `demo_mcp_server/src/tools/handlers/results.ts`:

```typescript
import type { BankingToolResult } from '../BankingToolProvider';

export function createSuccessResult(text: string, data?: Record<string, any>): BankingToolResult {
  return {
    type: 'text',
    text,
    success: true,
    ...(data !== undefined ? { structuredContent: data } : {}),
  };
}

export function createErrorResult(error: string): BankingToolResult {
  return {
    type: 'text',
    text: `Error: ${error}`,
    success: false,
    error,
  };
}
```

- [ ] **Step 5: Update `accountHandlers.ts` to pass data**

Replace `demo_mcp_server/src/tools/handlers/accountHandlers.ts`:

```typescript
import type { Account } from '../../interfaces/banking';
import type { HandlerFn } from './types';
import { createSuccessResult, createErrorResult } from './results';

export const executeGetMyAccounts: HandlerFn = async (deps, token, params) => {
  const { account_type } = params as { account_type?: string };
  deps.logger.debug(`[BankingToolProvider] Calling Banking API: getMyAccounts`);
  let accounts = await deps.apiClient.getMyAccounts(token);

  if (accounts && accounts.length !== undefined) {
    deps.logger.debug(`[BankingToolProvider] Banking API response: Found ${accounts.length} accounts`);
  }

  if (account_type) {
    accounts = accounts.filter((a: Account) => a.accountType === account_type);
  }

  const mappedAccounts = accounts.map((account: Account) => ({
    id: account.id,
    accountType: account.accountType,
    name: account.name || null,
    accountNumber: account.accountNumber,
    balance: account.balance,
    currency: account.currency || 'USD',
    status: account.status || 'active',
    accountHolderName: account.accountHolderName || null,
    swiftCode: account.swiftCode || null,
    iban: account.iban || null,
    branchName: account.branchName || null,
    branchCode: account.branchCode || null,
    openedDate: account.openedDate || null,
    notes: account.notes || null,
    createdAt: account.createdAt,
  }));

  const data = { success: true, count: accounts.length, accounts: mappedAccounts };
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};

export const executeGetAccountBalance: HandlerFn = async (deps, token, params) => {
  const { account_id } = params as { account_id: string };
  deps.logger.debug(`[BankingToolProvider] Calling Banking API: getAccountBalance for account ${account_id}`);
  const balanceResponse = await deps.apiClient.getAccountBalance(token, account_id);
  deps.logger.debug(`[BankingToolProvider] Banking API response: Account balance retrieved`);

  const data = { success: true, accountId: account_id, balance: balanceResponse.balance };
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};

export const executeUpdateContactEmail: HandlerFn = async (deps, token, params) => {
  const { account_id, new_email } = params as { account_id: string; new_email: string };
  deps.logger.debug(`[BankingToolProvider] Calling Banking API: updateContactEmail for account ${account_id}`);
  const result = await deps.apiClient.updateContactEmail(token, account_id, new_email);
  const data = { success: true, accountId: account_id, email: new_email, ...result };
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};

export const executeGetSensitiveAccountDetails: HandlerFn = async (deps, token, _params) => {
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

    const data = { success: true, accounts: (response as any).accounts || [] };
    return createSuccessResult(JSON.stringify(data, null, 2), data);
  } catch (error) {
    deps.logger.error('[BankingToolProvider] getSensitiveAccountDetails error:', {}, error instanceof Error ? error : undefined);
    return createErrorResult(
      `Failed to retrieve sensitive account details: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};
```

- [ ] **Step 6: Update `identityHandlers.ts`**

Replace `demo_mcp_server/src/tools/handlers/identityHandlers.ts`:

```typescript
import { BankingAPIError } from '../../interfaces/banking';
import type { HandlerFn } from './types';
import { createSuccessResult } from './results';

export const executeQueryUserByEmail: HandlerFn = async (deps, token, params) => {
  const { email } = params as { email: string };
  try {
    deps.logger.debug(`[BankingToolProvider] Calling Banking API: queryUserByEmail`);
    const response = await deps.apiClient.queryUserByEmail(token, email);
    deps.logger.debug(`[BankingToolProvider] Banking API response: queryUserByEmail completed`);
    return createSuccessResult(JSON.stringify(response, null, 2), response as Record<string, any>);
  } catch (error) {
    if (error instanceof BankingAPIError && error.statusCode === 404) {
      const notFoundResponse = { exists: false, email, error: 'User not found' };
      return createSuccessResult(JSON.stringify(notFoundResponse, null, 2), notFoundResponse);
    }
    throw error;
  }
};
```

- [ ] **Step 7: Update `commitmentHandlers.ts`**

Replace `demo_mcp_server/src/tools/handlers/commitmentHandlers.ts`:

```typescript
import type { HandlerFn } from './types';
import { createSuccessResult } from './results';

export const executeRequestFeeWaiver: HandlerFn = async (deps, token, params) => {
  const { account_id, reason } = params as { account_id: string; reason?: string };
  const result = await deps.apiClient.requestFeeWaiver(token, account_id, reason || 'Customer request');
  const data = result as Record<string, any>;
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};
```

- [ ] **Step 8: Update `reasoningHandlers.ts` to pass data**

In `demo_mcp_server/src/tools/handlers/reasoningHandlers.ts`, find the return at the bottom of `executeSequentialThink` and replace it. The function currently builds `steps` and `conclusion` — keep that unchanged, only update the return:

```typescript
// At the end of executeSequentialThink, replace:
//   return createSuccessResult(JSON.stringify({ success: true, query, steps, conclusion }, null, 2));
// with:
  const data = { success: true, query, steps, conclusion };
  return createSuccessResult(JSON.stringify(data, null, 2), data);
```

- [ ] **Step 9: Run the test — expect PASS**

```bash
cd demo_mcp_server && npx jest tests/tools/structuredContent.test.ts --no-coverage
```
Expected: PASS (3 tests).

- [ ] **Step 10: Run full test suite — expect no regressions**

```bash
cd demo_mcp_server && npm test -- --forceExit 2>&1 | tail -20
```
Expected: all pre-existing tests still pass.

- [ ] **Step 11: Commit**

```bash
git add demo_mcp_server/src/tools/BankingToolProvider.ts \
  demo_mcp_server/src/tools/handlers/results.ts \
  demo_mcp_server/src/tools/handlers/accountHandlers.ts \
  demo_mcp_server/src/tools/handlers/identityHandlers.ts \
  demo_mcp_server/src/tools/handlers/commitmentHandlers.ts \
  demo_mcp_server/src/tools/handlers/reasoningHandlers.ts \
  demo_mcp_server/tests/tools/structuredContent.test.ts
git commit -m "feat(mcp): emit structuredContent from all banking tool handlers"
```

---

## Task 3: Banking MCP — Wire `outputSchema` into registry + message handler

**Files:**
- Modify: `demo_mcp_server/src/tools/BankingToolRegistry.ts`
- Modify: `demo_mcp_server/src/server/MCPMessageHandler.ts`
- Create: `demo_mcp_server/tests/tools/outputSchemas.test.ts`

**Interfaces:**
- Consumes: `outputSchemas.ts` (Task 1), `BankingToolResult.structuredContent` (Task 2)

- [ ] **Step 1: Write failing test for MCPMessageHandler forwarding**

Create `demo_mcp_server/tests/tools/outputSchemas.test.ts`:

```typescript
import { BankingToolRegistry } from '../../src/tools/BankingToolRegistry';

describe('BankingToolRegistry outputSchema', () => {
  const tools = BankingToolRegistry.getAllTools();

  it('every tool has an outputSchema defined', () => {
    const missing = tools.filter(t => !t.outputSchema).map(t => t.name);
    expect(missing).toEqual([]);
  });

  it('every outputSchema has type "object"', () => {
    tools.forEach(t => {
      expect(t.outputSchema!.type).toBe('object');
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd demo_mcp_server && npx jest tests/tools/outputSchemas.test.ts --no-coverage
```
Expected: FAIL — `missing` array contains many tool names.

- [ ] **Step 3: Add `outputSchema` imports and entries to `BankingToolRegistry.ts`**

At the top of `demo_mcp_server/src/tools/BankingToolRegistry.ts`, add the import after the existing imports:

```typescript
import {
  GET_MY_ACCOUNTS_OUTPUT,
  GET_ACCOUNT_BALANCE_OUTPUT,
  GET_SENSITIVE_ACCOUNT_DETAILS_OUTPUT,
  GET_MY_TRANSACTIONS_OUTPUT,
  WRITE_TRANSACTION_OUTPUT,
  QUERY_USER_BY_EMAIL_OUTPUT,
  REQUEST_FEE_WAIVER_OUTPUT,
  SEQUENTIAL_THINK_OUTPUT,
  ADMIN_LOOKUP_OUTPUT,
  ADMIN_PROFILE_OUTPUT,
  ADMIN_ACCOUNTS_OUTPUT,
  ADMIN_TRANSACTIONS_OUTPUT,
  ADMIN_WRITE_OUTPUT,
} from './outputSchemas';
```

Then in the `TOOLS` map, add `outputSchema` to each entry. Mapping:

| Tool name | outputSchema constant |
|-----------|----------------------|
| `get_my_accounts` | `GET_MY_ACCOUNTS_OUTPUT` |
| `get_account_balance` | `GET_ACCOUNT_BALANCE_OUTPUT` |
| `get_sensitive_account_details` | `GET_SENSITIVE_ACCOUNT_DETAILS_OUTPUT` |
| `update_contact_email` | `ADMIN_WRITE_OUTPUT` |
| `get_my_transactions` | `GET_MY_TRANSACTIONS_OUTPUT` |
| `create_deposit` | `WRITE_TRANSACTION_OUTPUT` |
| `create_withdrawal` | `WRITE_TRANSACTION_OUTPUT` |
| `create_transfer` | `WRITE_TRANSACTION_OUTPUT` |
| `query_user_by_email` | `QUERY_USER_BY_EMAIL_OUTPUT` |
| `request_fee_waiver` | `REQUEST_FEE_WAIVER_OUTPUT` |
| `sequential_think` | `SEQUENTIAL_THINK_OUTPUT` |
| `lookup_customer` | `ADMIN_LOOKUP_OUTPUT` |
| `get_customer_profile` | `ADMIN_PROFILE_OUTPUT` |
| `get_customer_accounts` | `ADMIN_ACCOUNTS_OUTPUT` |
| `get_customer_transactions` | `ADMIN_TRANSACTIONS_OUTPUT` |
| `freeze_account` | `ADMIN_WRITE_OUTPUT` |
| `reset_customer_password` | `ADMIN_WRITE_OUTPUT` |
| `adjust_balance` | `ADMIN_WRITE_OUTPUT` |
| `delete_customer` | `ADMIN_WRITE_OUTPUT` |

For vertical tools (generated from `VERTICAL_TOOLS`), add `outputSchema: ADMIN_WRITE_OUTPUT` inside `VERTICAL_TOOL_DEFS` reduction (one line inside the `acc[t.name] = { ... }` block).

- [ ] **Step 4: Update `MCPMessageHandler.handleListTools` to forward `outputSchema`**

In `demo_mcp_server/src/server/MCPMessageHandler.ts`, find the `mcpTools` map inside `handleListTools` (~line 227). Add `outputSchema: tool.outputSchema,` to the mapped object:

```typescript
const mcpTools = bankingTools.map(tool => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: tool.inputSchema,
  outputSchema: tool.outputSchema,       // add this line
  icons: tool.icons,
  annotations: this.toSpecAnnotations(tool),
  requiresUserAuth: tool.requiresUserAuth,
  requiredScopes: tool.requiredScopes,
  readOnly: tool.readOnly,
  vertical: tool.vertical,
}));
```

- [ ] **Step 5: Update `MCPMessageHandler.handleToolCall` to forward `structuredContent`**

In `MCPMessageHandler.handleToolCall`, find the return statement after tool execution (~line 485). Replace:

```typescript
      return {
        id: message.id ?? 'unknown',
        result: {
          content: mcpContent,
          isError: !toolResult.success,
          ...(toolResult.authChallenge ? { _meta: { authChallenge: toolResult.authChallenge } } : {})
        }
      };
```

with:

```typescript
      return {
        id: message.id ?? 'unknown',
        result: {
          content: mcpContent,
          isError: !toolResult.success,
          ...(toolResult.structuredContent ? { structuredContent: toolResult.structuredContent } : {}),
          ...(toolResult.authChallenge ? { _meta: { authChallenge: toolResult.authChallenge } } : {})
        }
      };
```

- [ ] **Step 6: Run outputSchema test — expect PASS**

```bash
cd demo_mcp_server && npx jest tests/tools/outputSchemas.test.ts --no-coverage
```
Expected: PASS (2 tests).

- [ ] **Step 7: Run full suite — no regressions**

```bash
cd demo_mcp_server && npm test -- --forceExit 2>&1 | tail -20
```

- [ ] **Step 8: Commit**

```bash
git add demo_mcp_server/src/tools/BankingToolRegistry.ts \
  demo_mcp_server/src/server/MCPMessageHandler.ts \
  demo_mcp_server/tests/tools/outputSchemas.test.ts
git commit -m "feat(mcp): wire outputSchema into tools/list and structuredContent into tools/call response"
```

---

## Task 4: Banking MCP — Pagination for `get_my_transactions`

**Files:**
- Modify: `demo_mcp_server/src/tools/handlers/transactionHandlers.ts`
- Modify: `demo_mcp_server/src/tools/BankingToolRegistry.ts` (input schema for `get_my_transactions`)
- Create: `demo_mcp_server/tests/tools/transactionPagination.test.ts`

**Interfaces:**
- Consumes: `GET_MY_TRANSACTIONS_OUTPUT` (Task 1), `createSuccessResult(text, data)` (Task 2)
- Produces: `executeGetMyTransactions` now accepts `{ limit?: number, offset?: number }` and returns `{ count, total, offset, hasMore, nextOffset, transactions }`

- [ ] **Step 1: Write failing tests**

Create `demo_mcp_server/tests/tools/transactionPagination.test.ts`:

```typescript
import { executeGetMyTransactions } from '../../src/tools/handlers/transactionHandlers';
import { BankingAPIClient } from '../../src/banking/BankingAPIClient';
import { Logger } from '../../src/utils/Logger';

jest.mock('../../src/banking/BankingAPIClient');
jest.mock('../../src/utils/Logger', () => ({
  Logger: { getInstance: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
  createDefaultLoggerConfig: () => ({}),
}));

const mockClient = new BankingAPIClient() as jest.Mocked<BankingAPIClient>;
const deps = { apiClient: mockClient, logger: Logger.getInstance({} as any) };

const makeTx = (i: number) => ({
  id: `tx-${i}`, type: 'deposit' as const, amount: i * 10,
  createdAt: '2025-01-01', userId: 'u1'
});

beforeEach(() => {
  mockClient.getMyTransactions = jest.fn().mockResolvedValue(
    Array.from({ length: 25 }, (_, i) => makeTx(i))
  );
});

describe('get_my_transactions pagination', () => {
  it('returns all 25 with no params', async () => {
    const r = await executeGetMyTransactions(deps, 'tok', {});
    expect(r.structuredContent!.total).toBe(25);
    expect(r.structuredContent!.count).toBe(25);
    expect(r.structuredContent!.hasMore).toBe(false);
    expect(r.structuredContent!.offset).toBe(0);
  });

  it('returns first page of 10', async () => {
    const r = await executeGetMyTransactions(deps, 'tok', { limit: 10 });
    expect(r.structuredContent!.count).toBe(10);
    expect(r.structuredContent!.total).toBe(25);
    expect(r.structuredContent!.hasMore).toBe(true);
    expect(r.structuredContent!.nextOffset).toBe(10);
  });

  it('returns second page with offset', async () => {
    const r = await executeGetMyTransactions(deps, 'tok', { limit: 10, offset: 10 });
    expect(r.structuredContent!.count).toBe(10);
    expect(r.structuredContent!.offset).toBe(10);
    expect(r.structuredContent!.nextOffset).toBe(20);
    expect(r.structuredContent!.hasMore).toBe(true);
  });

  it('last partial page shows hasMore false', async () => {
    const r = await executeGetMyTransactions(deps, 'tok', { limit: 10, offset: 20 });
    expect(r.structuredContent!.count).toBe(5);
    expect(r.structuredContent!.hasMore).toBe(false);
    expect(r.structuredContent!.nextOffset).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd demo_mcp_server && npx jest tests/tools/transactionPagination.test.ts --no-coverage
```
Expected: FAIL — `structuredContent.total` undefined, no `offset`/`hasMore` fields.

- [ ] **Step 3: Update `transactionHandlers.ts` — `executeGetMyTransactions`**

Replace the `executeGetMyTransactions` function in `demo_mcp_server/src/tools/handlers/transactionHandlers.ts` (leave the other three functions unchanged):

```typescript
export const executeGetMyTransactions: HandlerFn = async (deps, token, params) => {
  const { limit, offset: rawOffset } = params as { limit?: number; offset?: number };
  const offset = (rawOffset && rawOffset > 0) ? rawOffset : 0;

  let transactions = await deps.apiClient.getMyTransactions(token);

  if (!Array.isArray(transactions)) {
    deps.logger.warn(`[BankingToolProvider] Expected transactions array, got: ${typeof transactions}`);
    return createErrorResult(`Invalid response format from banking API (received: ${typeof transactions})`);
  }

  const total = transactions.length;
  const paged = (limit && limit > 0) ? transactions.slice(offset, offset + limit) : transactions.slice(offset);
  const hasMore = (limit && limit > 0) ? (offset + limit) < total : false;

  const data = {
    success: true,
    count: paged.length,
    total,
    offset,
    hasMore,
    ...(hasMore ? { nextOffset: offset + limit! } : {}),
    transactions: paged.map(transaction => ({
      id: transaction.id,
      type: transaction.type,
      amount: transaction.amount,
      date: transaction.createdAt,
      fromAccountId: transaction.fromAccountId || null,
      toAccountId: transaction.toAccountId || null,
      description: transaction.description || null,
    })),
  };

  return createSuccessResult(JSON.stringify(data, null, 2), data);
};
```

- [ ] **Step 4: Add `offset` to `get_my_transactions` inputSchema in BankingToolRegistry.ts**

Find the `inputSchema` block for `get_my_transactions` in `BankingToolRegistry.ts` and update it:

```typescript
inputSchema: {
  type: 'object',
  properties: {
    limit: {
      type: 'integer',
      description: 'Maximum number of transactions to return per page (default: all)',
      minimum: 1,
    },
    offset: {
      type: 'integer',
      description: 'Number of transactions to skip (for pagination). Use nextOffset from prior response.',
      minimum: 0,
      default: 0,
    },
  },
  required: [],
  additionalProperties: false,
}
```

- [ ] **Step 5: Run pagination tests — expect PASS**

```bash
cd demo_mcp_server && npx jest tests/tools/transactionPagination.test.ts --no-coverage
```
Expected: PASS (4 tests).

- [ ] **Step 6: Run full suite — no regressions**

```bash
cd demo_mcp_server && npm test -- --forceExit 2>&1 | tail -20
```

- [ ] **Step 7: Commit**

```bash
git add demo_mcp_server/src/tools/handlers/transactionHandlers.ts \
  demo_mcp_server/src/tools/BankingToolRegistry.ts \
  demo_mcp_server/tests/tools/transactionPagination.test.ts
git commit -m "feat(mcp): add offset pagination to get_my_transactions with total/hasMore/nextOffset"
```

---

## Task 5: Banking MCP — New tools: `search_transactions` + `get_transaction_detail`

**Files:**
- Create: `demo_mcp_server/src/tools/handlers/searchHandlers.ts`
- Modify: `demo_mcp_server/src/tools/handlers/index.ts`
- Modify: `demo_mcp_server/src/tools/BankingToolRegistry.ts`
- Modify: `demo_mcp_server/src/tools/toolScopeMap.ts`
- Create: `demo_mcp_server/tests/tools/searchHandlers.test.ts`

**Interfaces:**
- Consumes: `createSuccessResult(text, data)` (Task 2), `SEARCH_TRANSACTIONS_OUTPUT`, `GET_TRANSACTION_DETAIL_OUTPUT` (Task 1)
- Produces: `executeSearchTransactions`, `executeGetTransactionDetail` — both `HandlerFn`

- [ ] **Step 1: Write failing tests**

Create `demo_mcp_server/tests/tools/searchHandlers.test.ts`:

```typescript
import { executeSearchTransactions, executeGetTransactionDetail } from '../../src/tools/handlers/searchHandlers';
import { BankingAPIClient } from '../../src/banking/BankingAPIClient';
import { Logger } from '../../src/utils/Logger';

jest.mock('../../src/banking/BankingAPIClient');
jest.mock('../../src/utils/Logger', () => ({
  Logger: { getInstance: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
  createDefaultLoggerConfig: () => ({}),
}));

const mockClient = new BankingAPIClient() as jest.Mocked<BankingAPIClient>;
const deps = { apiClient: mockClient, logger: Logger.getInstance({} as any) };

const TX = [
  { id: 'tx-1', type: 'deposit' as const, amount: 100, createdAt: '2025-01-15', userId: 'u1', description: 'pay' },
  { id: 'tx-2', type: 'withdrawal' as const, amount: 50, createdAt: '2025-02-10', userId: 'u1' },
  { id: 'tx-3', type: 'deposit' as const, amount: 200, createdAt: '2025-03-01', userId: 'u1' },
];

beforeEach(() => {
  mockClient.getMyTransactions = jest.fn().mockResolvedValue(TX);
});

describe('executeSearchTransactions', () => {
  it('returns all when no filters', async () => {
    const r = await executeSearchTransactions(deps, 'tok', {});
    expect(r.structuredContent!.count).toBe(3);
    expect(r.structuredContent!.success).toBe(true);
  });

  it('filters by type', async () => {
    const r = await executeSearchTransactions(deps, 'tok', { type: 'deposit' });
    expect(r.structuredContent!.count).toBe(2);
    expect(r.structuredContent!.transactions.every((t: any) => t.type === 'deposit')).toBe(true);
  });

  it('filters by min_amount', async () => {
    const r = await executeSearchTransactions(deps, 'tok', { min_amount: 100 });
    expect(r.structuredContent!.count).toBe(2);
  });

  it('filters by max_amount', async () => {
    const r = await executeSearchTransactions(deps, 'tok', { max_amount: 100 });
    expect(r.structuredContent!.count).toBe(2);
  });

  it('filters by from_date', async () => {
    const r = await executeSearchTransactions(deps, 'tok', { from_date: '2025-02-01' });
    expect(r.structuredContent!.count).toBe(2);
  });

  it('filters by to_date', async () => {
    const r = await executeSearchTransactions(deps, 'tok', { to_date: '2025-02-01' });
    expect(r.structuredContent!.count).toBe(1);
  });
});

describe('executeGetTransactionDetail', () => {
  it('returns found:true for known id', async () => {
    const r = await executeGetTransactionDetail(deps, 'tok', { transaction_id: 'tx-2' });
    expect(r.structuredContent!.found).toBe(true);
    expect(r.structuredContent!.transaction.id).toBe('tx-2');
  });

  it('returns found:false for unknown id', async () => {
    const r = await executeGetTransactionDetail(deps, 'tok', { transaction_id: 'no-such' });
    expect(r.structuredContent!.found).toBe(false);
    expect(r.structuredContent!.transaction).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd demo_mcp_server && npx jest tests/tools/searchHandlers.test.ts --no-coverage
```
Expected: FAIL — module `searchHandlers` not found.

- [ ] **Step 3: Create `searchHandlers.ts`**

Create `demo_mcp_server/src/tools/handlers/searchHandlers.ts`:

```typescript
import type { Transaction } from '../../interfaces/banking';
import type { HandlerFn } from './types';
import { createSuccessResult, createErrorResult } from './results';

export const executeSearchTransactions: HandlerFn = async (deps, token, params) => {
  const {
    type,
    min_amount,
    max_amount,
    from_date,
    to_date,
  } = params as {
    type?: 'deposit' | 'withdrawal' | 'transfer';
    min_amount?: number;
    max_amount?: number;
    from_date?: string;
    to_date?: string;
  };

  let transactions: Transaction[] = await deps.apiClient.getMyTransactions(token);

  if (!Array.isArray(transactions)) {
    return createErrorResult(`Invalid response format from banking API (received: ${typeof transactions})`);
  }

  if (type) {
    transactions = transactions.filter(t => t.type === type);
  }
  if (min_amount !== undefined) {
    transactions = transactions.filter(t => t.amount >= min_amount);
  }
  if (max_amount !== undefined) {
    transactions = transactions.filter(t => t.amount <= max_amount);
  }
  if (from_date) {
    transactions = transactions.filter(t => t.createdAt >= from_date);
  }
  if (to_date) {
    transactions = transactions.filter(t => t.createdAt <= to_date);
  }

  const data = {
    success: true,
    count: transactions.length,
    transactions: transactions.map(t => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      date: t.createdAt,
      fromAccountId: t.fromAccountId || null,
      toAccountId: t.toAccountId || null,
      description: t.description || null,
    })),
  };

  return createSuccessResult(JSON.stringify(data, null, 2), data);
};

export const executeGetTransactionDetail: HandlerFn = async (deps, token, params) => {
  const { transaction_id } = params as { transaction_id: string };

  const transactions: Transaction[] = await deps.apiClient.getMyTransactions(token);

  if (!Array.isArray(transactions)) {
    return createErrorResult(`Invalid response format from banking API`);
  }

  const tx = transactions.find(t => t.id === transaction_id) || null;

  const data = {
    success: true,
    found: tx !== null,
    transaction: tx ? {
      id: tx.id,
      type: tx.type,
      amount: tx.amount,
      date: tx.createdAt,
      fromAccountId: tx.fromAccountId || null,
      toAccountId: tx.toAccountId || null,
      description: tx.description || null,
    } : null,
  };

  return createSuccessResult(JSON.stringify(data, null, 2), data);
};
```

- [ ] **Step 4: Register handlers in `handlers/index.ts`**

Add to imports and exports in `demo_mcp_server/src/tools/handlers/index.ts`:

```typescript
// Add to imports:
import { executeSearchTransactions, executeGetTransactionDetail } from './searchHandlers';

// Add to handlerMap:
export const handlerMap: Record<string, HandlerFn> = {
  // ... existing entries ...
  executeSearchTransactions,
  executeGetTransactionDetail,
};
```

- [ ] **Step 5: Add tool entries in `BankingToolRegistry.ts`**

Add to the `TOOLS` object (after `get_my_transactions`, before `create_deposit`):

```typescript
search_transactions: {
  name: 'search_transactions',
  title: 'Search Transactions',
  description: 'Search and filter the user\'s transactions by type, amount range, or date range. All filters are optional and combinable. Returns matching transactions sorted by date descending.',
  requiresUserAuth: true,
  requiredScopes: ['read'],
  handler: 'executeSearchTransactions',
  readOnly: true,
  icons: [],
  annotations: {
    userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false }
  },
  outputSchema: SEARCH_TRANSACTIONS_OUTPUT,
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['deposit', 'withdrawal', 'transfer'],
        description: 'Filter by transaction type',
      },
      min_amount: {
        type: 'number',
        description: 'Minimum transaction amount (inclusive)',
        minimum: 0,
      },
      max_amount: {
        type: 'number',
        description: 'Maximum transaction amount (inclusive)',
        minimum: 0,
      },
      from_date: {
        type: 'string',
        description: 'Earliest date (ISO 8601, e.g. "2025-01-01"). Matches on createdAt string prefix.',
      },
      to_date: {
        type: 'string',
        description: 'Latest date (ISO 8601, e.g. "2025-12-31"). Matches on createdAt string prefix.',
      },
    },
    required: [],
    additionalProperties: false,
  },
},

get_transaction_detail: {
  name: 'get_transaction_detail',
  title: 'Transaction Detail',
  description: 'Fetch a single transaction by ID. Returns full transaction details or found:false if the ID does not exist.',
  requiresUserAuth: true,
  requiredScopes: ['read'],
  handler: 'executeGetTransactionDetail',
  readOnly: true,
  icons: [],
  annotations: {
    userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false }
  },
  outputSchema: GET_TRANSACTION_DETAIL_OUTPUT,
  inputSchema: {
    type: 'object',
    properties: {
      transaction_id: {
        type: 'string',
        description: 'The transaction ID to look up (from get_my_transactions or search_transactions response)',
      },
    },
    required: ['transaction_id'],
    additionalProperties: false,
  },
},
```

Also add the two output schema imports to the existing import block at the top (added in Task 3):
```typescript
  SEARCH_TRANSACTIONS_OUTPUT,
  GET_TRANSACTION_DETAIL_OUTPUT,
```

- [ ] **Step 6: Add scope entries to `toolScopeMap.ts`**

In `demo_mcp_server/src/tools/toolScopeMap.ts`, add to `TOOL_SCOPES`:
```typescript
  search_transactions: ['read'],
  get_transaction_detail: ['read'],
```

- [ ] **Step 7: Run tests — expect PASS**

```bash
cd demo_mcp_server && npx jest tests/tools/searchHandlers.test.ts tests/tools/outputSchemas.test.ts --no-coverage
```
Expected: PASS (8 + 2 tests).

- [ ] **Step 8: Run full suite**

```bash
cd demo_mcp_server && npm test -- --forceExit 2>&1 | tail -20
```

- [ ] **Step 9: Build**

```bash
cd demo_mcp_server && npm run build:clean 2>&1 | tail -10
```
Expected: no TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add demo_mcp_server/src/tools/handlers/searchHandlers.ts \
  demo_mcp_server/src/tools/handlers/index.ts \
  demo_mcp_server/src/tools/BankingToolRegistry.ts \
  demo_mcp_server/src/tools/toolScopeMap.ts \
  demo_mcp_server/tests/tools/searchHandlers.test.ts
git commit -m "feat(mcp): add search_transactions and get_transaction_detail tools with outputSchema"
```

---

## Task 6: Dev MCP — Add `outputSchema` to all tool definitions

**Files:**
- Modify: `dev_mcp/banking-dev/src/index.ts`

The dev MCP server already returns `structuredContent` in every tool call response. This task adds `outputSchema` declarations to the tool definitions so clients know the return shape.

- [ ] **Step 1: Add `outputSchema` field to `ToolEntry` interface**

In `dev_mcp/banking-dev/src/index.ts`, update the `ToolEntry` interface:

```typescript
interface ToolEntry {
  name: string;
  description: string;
  schema: ZodTypeAny;
  outputSchema?: Record<string, unknown>;  // add this line
  handler: (args: unknown) => Promise<unknown> | unknown;
  readOnly: boolean;
}
```

- [ ] **Step 2: Wire `outputSchema` into the ListTools response**

In the `ListToolsRequestSchema` handler, update the `exposed` map:

```typescript
const exposed: Tool[] = tools.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: toJsonSchema(t.schema) as Tool["inputSchema"],
  ...(t.outputSchema ? { outputSchema: t.outputSchema as Tool["inputSchema"] } : {}),
  annotations: {
    readOnlyHint: t.readOnly,
    destructiveHint: !t.readOnly,
    idempotentHint: t.readOnly,
    openWorldHint: t.name.startsWith("pingone_") || t.name === "tokenchain_introspect",
  },
}));
```

- [ ] **Step 3: Define and attach outputSchema for each tool group**

Add the following Zod-derived schemas and attach them to the relevant tool entries. Add these schema constants **before** the `tools` array definition:

```typescript
// Output schemas (Zod → JSON Schema via toJsonSchema)
const LOG_RESULT_SCHEMA = toJsonSchema(z.object({
  lines: z.array(z.string()),
  count: z.number().int(),
  truncated: z.boolean().optional(),
}));

const STATE_SESSIONS_LIST_SCHEMA = toJsonSchema(z.object({
  count: z.number().int(),
  sessions: z.array(z.object({
    sid: z.string(),
    sub: z.string().optional(),
    scope: z.string().optional(),
    aud: z.string().optional(),
    expiry: z.string().optional(),
  })),
}));

const STATE_CONFIG_SCHEMA = toJsonSchema(z.object({
  key: z.string(),
  value: z.unknown(),
  source: z.enum(['runtimeData', 'env', 'not_found']),
}));

const STATE_KEY_LIST_SCHEMA = toJsonSchema(z.object({
  keys: z.array(z.string()),
  count: z.number().int(),
}));

const STATE_GENERIC_SCHEMA = toJsonSchema(z.object({
  summary: z.string(),
  details: z.record(z.unknown()).optional(),
}));

const TOKEN_DECODE_SCHEMA = toJsonSchema(z.object({
  header: z.record(z.unknown()),
  payload: z.record(z.unknown()),
  summary: z.object({
    aud: z.union([z.string(), z.array(z.string())]).optional(),
    scope: z.string().optional(),
    act: z.record(z.unknown()).optional(),
    may_act: z.record(z.unknown()).optional(),
    exp: z.number().optional(),
    expired: z.boolean(),
  }),
}));

const TOKEN_DIFF_SCHEMA = toJsonSchema(z.object({
  differences: z.array(z.object({
    field: z.string(),
    a: z.unknown(),
    b: z.unknown(),
  })),
  summary: z.string(),
}));

const TOKEN_EXPLAIN_SCHEMA = toJsonSchema(z.object({
  verdict: z.enum(['ok', 'warning', 'fail']),
  reasons: z.array(z.string()),
  payload: z.record(z.unknown()).optional(),
}));

const PINGONE_USERS_SCHEMA = toJsonSchema(z.object({
  count: z.number().int(),
  nextCursor: z.string().optional(),
  users: z.array(z.object({
    id: z.string(),
    username: z.string().optional(),
    email: z.string().optional(),
    enabled: z.boolean().optional(),
  })),
}));

const PINGONE_USER_SCHEMA = toJsonSchema(z.object({
  found: z.boolean(),
  user: z.record(z.unknown()).nullable(),
}));

const PINGONE_APPS_SCHEMA = toJsonSchema(z.object({
  count: z.number().int(),
  nextCursor: z.string().optional(),
  apps: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
    type: z.string().optional(),
    enabled: z.boolean().optional(),
  })),
}));

const PINGONE_APP_SCHEMA = toJsonSchema(z.object({
  found: z.boolean(),
  app: z.record(z.unknown()).nullable(),
  grants: z.array(z.record(z.unknown())).optional(),
}));

const PINGONE_RESOURCES_SCHEMA = toJsonSchema(z.object({
  count: z.number().int(),
  resources: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.string().optional(),
  })),
}));

const PINGONE_SCOPES_SCHEMA = toJsonSchema(z.object({
  resourceId: z.string(),
  count: z.number().int(),
  scopes: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
  })),
}));
```

Then add `outputSchema` to each tool in the `tools` array:

```typescript
// logs_tail
{ name: "logs_tail", ..., outputSchema: LOG_RESULT_SCHEMA, ... }

// logs_grep
{ name: "logs_grep", ..., outputSchema: LOG_RESULT_SCHEMA, ... }

// logs_correlate
{ name: "logs_correlate", ..., outputSchema: LOG_RESULT_SCHEMA, ... }

// logs_errors
{ name: "logs_errors", ..., outputSchema: LOG_RESULT_SCHEMA, ... }

// logs_oauth_flow
{ name: "logs_oauth_flow", ..., outputSchema: LOG_RESULT_SCHEMA, ... }

// state_sessions_list
{ name: "state_sessions_list", ..., outputSchema: STATE_SESSIONS_LIST_SCHEMA, ... }

// state_sessions_get  (same shape as list but single session)
{ name: "state_sessions_get", ..., outputSchema: STATE_SESSIONS_LIST_SCHEMA, ... }

// state_config_get
{ name: "state_config_get", ..., outputSchema: STATE_CONFIG_SCHEMA, ... }

// state_config_list_keys
{ name: "state_config_list_keys", ..., outputSchema: STATE_KEY_LIST_SCHEMA, ... }

// state_sample_data_summary
{ name: "state_sample_data_summary", ..., outputSchema: STATE_GENERIC_SCHEMA, ... }

// state_backup_list
{ name: "state_backup_list", ..., outputSchema: STATE_GENERIC_SCHEMA, ... }

// state_bootstrap_summary
{ name: "state_bootstrap_summary", ..., outputSchema: STATE_GENERIC_SCHEMA, ... }

// tokenchain_decode
{ name: "tokenchain_decode", ..., outputSchema: TOKEN_DECODE_SCHEMA, ... }

// tokenchain_diff
{ name: "tokenchain_diff", ..., outputSchema: TOKEN_DIFF_SCHEMA, ... }

// tokenchain_explain
{ name: "tokenchain_explain", ..., outputSchema: TOKEN_EXPLAIN_SCHEMA, ... }

// pingone_list_users
{ name: "pingone_list_users", ..., outputSchema: PINGONE_USERS_SCHEMA, ... }

// pingone_get_user
{ name: "pingone_get_user", ..., outputSchema: PINGONE_USER_SCHEMA, ... }

// pingone_list_apps
{ name: "pingone_list_apps", ..., outputSchema: PINGONE_APPS_SCHEMA, ... }

// pingone_get_app
{ name: "pingone_get_app", ..., outputSchema: PINGONE_APP_SCHEMA, ... }

// pingone_list_resources
{ name: "pingone_list_resources", ..., outputSchema: PINGONE_RESOURCES_SCHEMA, ... }

// pingone_get_resource_scopes
{ name: "pingone_get_resource_scopes", ..., outputSchema: PINGONE_SCOPES_SCHEMA, ... }
```

- [ ] **Step 4: Build and verify**

```bash
cd dev_mcp/banking-dev && npm run build:clean 2>&1 | tail -10
```
Expected: clean build, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add dev_mcp/banking-dev/src/index.ts
git commit -m "feat(dev-mcp): add outputSchema declarations to all tool definitions"
```

---

## Task 7: Dev MCP — Cursor pagination for `pingone_list_users` + `pingone_list_apps`

**Files:**
- Modify: `dev_mcp/banking-dev/src/tools/pingone.ts`
- Modify: `dev_mcp/banking-dev/src/index.ts` (update `outputSchema` constants from Task 6 — already include `nextCursor`)

PingOne paginates via `_links.next.href` in the response. The cursor is the full next-page URL.

- [ ] **Step 1: Update `pingoneListUsers` to support cursor**

In `dev_mcp/banking-dev/src/tools/pingone.ts`, update the schema and function:

```typescript
export const pingoneListUsersSchema = z.object({
  filter: z.string().optional().describe('PingOne SCIM filter, e.g. username sw "demo"'),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().url().optional().describe('Next-page URL from prior response nextCursor field'),
});

export async function pingoneListUsers(input: z.infer<typeof pingoneListUsersSchema>): Promise<{
  count: number;
  nextCursor?: string;
  users: Array<{ id: string; username: string | undefined; email: string | undefined; enabled: boolean | undefined }>;
}> {
  let url: string;
  if (input.cursor) {
    url = input.cursor;
  } else {
    const params = new URLSearchParams();
    params.set("limit", String(input.limit));
    if (input.filter) params.set("filter", input.filter);
    url = `/users?${params.toString()}`;
  }

  const data = await pingOneGet<Embedded<User> & { _links?: { next?: { href?: string } } }>(url);
  const users = data._embedded?.users ?? [];
  const nextCursor = data._links?.next?.href;

  return {
    count: users.length,
    ...(nextCursor ? { nextCursor } : {}),
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      enabled: u.enabled,
    })),
  };
}
```

- [ ] **Step 2: Update `pingoneListApps` to support cursor**

Update schema and function for `pingoneListApps` in the same file:

```typescript
export const pingoneListAppsSchema = z.object({
  filter: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(100),
  cursor: z.string().url().optional().describe('Next-page URL from prior response nextCursor field'),
});

export async function pingoneListApps(input: z.infer<typeof pingoneListAppsSchema>): Promise<{
  count: number;
  nextCursor?: string;
  apps: Array<{ id: string; name?: string; type?: string; enabled?: boolean }>;
}> {
  let url: string;
  if (input.cursor) {
    url = input.cursor;
  } else {
    const params = new URLSearchParams();
    params.set("limit", String(input.limit));
    if (input.filter) params.set("filter", input.filter);
    url = `/applications?${params.toString()}`;
  }

  const data = await pingOneGet<Embedded<AppRecord> & { _links?: { next?: { href?: string } } }>(url);
  const apps = data._embedded?.applications ?? [];
  const nextCursor = data._links?.next?.href;

  return {
    count: apps.length,
    ...(nextCursor ? { nextCursor } : {}),
    apps: apps.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      enabled: a.enabled,
    })),
  };
}
```

- [ ] **Step 3: Build**

```bash
cd dev_mcp/banking-dev && npm run build:clean 2>&1 | tail -10
```
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add dev_mcp/banking-dev/src/tools/pingone.ts
git commit -m "feat(dev-mcp): add cursor pagination to pingone_list_users and pingone_list_apps"
```

---

## Task 8: Dev MCP — New tools: `pingone_check_bootstrap` + `pingone_create_worker_app`

**Files:**
- Modify: `dev_mcp/banking-dev/src/tools/pingone.ts` (add two functions + schemas)
- Modify: `dev_mcp/banking-dev/src/index.ts` (register tools + outputSchemas)

**Why these tools:**
- `pingone_check_bootstrap` — answers "is the demo configured?" by verifying required env vars exist, then calling PingOne to confirm the Worker App is reachable and a worker token is obtainable. Maps directly to the `/mcp` bootstrap question.
- `pingone_create_worker_app` — creates a new WORKER application in PingOne via the Management API. Gated behind `DEV_MCP_PINGONE_WRITE=1` (same pattern as `pingone_update_user_attribute`).

- [ ] **Step 1: Add `pingoneCheckBootstrap` to `pingone.ts`**

```typescript
export const pingoneCheckBootstrapSchema = z.object({});

export async function pingoneCheckBootstrap(): Promise<{
  configured: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  summary: string;
}> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  const envVars = [
    'PINGONE_ENVIRONMENT_ID',
    'PINGONE_WORKER_CLIENT_ID',
    'PINGONE_WORKER_CLIENT_SECRET',
  ];
  for (const v of envVars) {
    const val = process.env[v];
    checks.push({
      name: `env:${v}`,
      ok: !!val && val.length > 0,
      detail: val ? 'set' : 'MISSING',
    });
  }

  const envOk = checks.every(c => c.ok);
  if (envOk) {
    try {
      const token = await getWorkerToken();
      checks.push({ name: 'worker_token', ok: true, detail: `obtained (${token.slice(0, 10)}…)` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push({ name: 'worker_token', ok: false, detail: `failed: ${msg}` });
    }
  } else {
    checks.push({ name: 'worker_token', ok: false, detail: 'skipped — env vars missing' });
  }

  const configured = checks.every(c => c.ok);
  const failing = checks.filter(c => !c.ok).map(c => c.name);
  const summary = configured
    ? 'Bootstrap complete — all checks passed.'
    : `Bootstrap incomplete. Failing: ${failing.join(', ')}. Run: pingcli init`;

  return { configured, checks, summary };
}
```

- [ ] **Step 2: Add `pingoneCreateWorkerApp` to `pingone.ts`**

```typescript
export const pingoneCreateWorkerAppSchema = z.object({
  name: z.string().min(1).describe('Display name for the new Worker application'),
  description: z.string().optional().describe('Optional description'),
});

export async function pingoneCreateWorkerApp(input: z.infer<typeof pingoneCreateWorkerAppSchema>): Promise<{
  created: boolean;
  appId?: string;
  name?: string;
  type?: string;
  error?: string;
}> {
  try {
    const body = {
      name: input.name,
      description: input.description ?? '',
      enabled: true,
      type: 'WORKER',
    };

    const app = await pingOnePost<AppRecord & { id: string }>('/applications', body);

    return {
      created: true,
      appId: app.id,
      name: app.name,
      type: app.type,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { created: false, error: msg };
  }
}
```

Also add `pingOnePost` to the shared utilities in `src/shared/pingone.ts`:

```typescript
export async function pingOnePost<T>(pathSegment: string, body: unknown): Promise<T> {
  const token = await getWorkerToken();
  const url = `${pingOneBaseUrl()}${pathSegment}`;
  const res = await axios.post<T>(url, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15_000,
  });
  return res.data;
}
```

- [ ] **Step 3: Register new tools in `index.ts`**

Add imports at the top of `dev_mcp/banking-dev/src/index.ts`:

```typescript
import {
  // ... existing imports ...
  pingoneCheckBootstrap,
  pingoneCheckBootstrapSchema,
  pingoneCreateWorkerApp,
  pingoneCreateWorkerAppSchema,
} from "./tools/pingone";
```

Add output schema constants (after the existing constants from Task 6):

```typescript
const PINGONE_BOOTSTRAP_SCHEMA = toJsonSchema(z.object({
  configured: z.boolean(),
  summary: z.string(),
  checks: z.array(z.object({
    name: z.string(),
    ok: z.boolean(),
    detail: z.string(),
  })),
}));

const PINGONE_CREATE_APP_SCHEMA = toJsonSchema(z.object({
  created: z.boolean(),
  appId: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  error: z.string().optional(),
}));
```

Add `pingone_check_bootstrap` to the unconditional push block at the end of the `tools.push(...)` section:

```typescript
  {
    name: "pingone_check_bootstrap",
    description:
      "Verify that the demo environment is fully bootstrapped: checks required env vars (PINGONE_ENVIRONMENT_ID, PINGONE_WORKER_CLIENT_ID, PINGONE_WORKER_CLIENT_SECRET) and confirms a worker token can be obtained. Returns a per-check breakdown and a human-readable summary.",
    schema: pingoneCheckBootstrapSchema,
    outputSchema: PINGONE_BOOTSTRAP_SCHEMA,
    handler: () => pingoneCheckBootstrap(),
    readOnly: true,
  },
```

Add `pingone_create_worker_app` inside the `DEV_MCP_PINGONE_WRITE=1` gate (next to `pingone_update_user_attribute`):

```typescript
if (process.env.DEV_MCP_PINGONE_WRITE === "1") {
  tools.push(
    {
      name: "pingone_update_user_attribute",
      // ... existing entry unchanged ...
    },
    {
      name: "pingone_create_worker_app",
      description:
        "Create a new WORKER application in PingOne. Returns appId and name on success. Requires DEV_MCP_PINGONE_WRITE=1.",
      schema: pingoneCreateWorkerAppSchema,
      outputSchema: PINGONE_CREATE_APP_SCHEMA,
      handler: (a) => pingoneCreateWorkerApp(pingoneCreateWorkerAppSchema.parse(a)),
      readOnly: false,
    }
  );
}
```

- [ ] **Step 4: Build**

```bash
cd dev_mcp/banking-dev && npm run build:clean 2>&1 | tail -10
```
Expected: clean build, no errors.

- [ ] **Step 5: Smoke-test `pingone_check_bootstrap` manually**

```bash
cd dev_mcp/banking-dev && node -e "
  require('dotenv').config({ path: '../../../demo_api_server/.env' });
  const { pingoneCheckBootstrap } = require('./dist/tools/pingone');
  pingoneCheckBootstrap().then(r => console.log(JSON.stringify(r, null, 2)));
"
```
Expected: JSON object with `configured: true/false` and per-check breakdown.

- [ ] **Step 6: Commit**

```bash
git add dev_mcp/banking-dev/src/tools/pingone.ts \
  dev_mcp/banking-dev/src/shared/pingone.ts \
  dev_mcp/banking-dev/src/index.ts
git commit -m "feat(dev-mcp): add pingone_check_bootstrap and pingone_create_worker_app tools"
```

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|-------------|------|
| Banking MCP: outputSchema on all tools | Tasks 1, 3 |
| Banking MCP: structuredContent in handler responses | Task 2 |
| Banking MCP: structuredContent forwarded in tools/call result | Task 3 |
| Banking MCP: outputSchema in tools/list response | Task 3 |
| Banking MCP: pagination (offset/limit/total/hasMore/nextOffset) on get_my_transactions | Task 4 |
| Banking MCP: search_transactions new tool | Task 5 |
| Banking MCP: get_transaction_detail new tool | Task 5 |
| Dev MCP: outputSchema on all tools | Task 6 |
| Dev MCP: cursor pagination on pingone_list_users | Task 7 |
| Dev MCP: cursor pagination on pingone_list_apps | Task 7 |
| Dev MCP: pingone_check_bootstrap new tool | Task 8 |
| Dev MCP: pingone_create_worker_app new tool (gated) | Task 8 |

### Type consistency check

- `createSuccessResult(text, data?)` — used identically in Tasks 2, 4, 5. ✓
- `GET_MY_TRANSACTIONS_OUTPUT` — declared in Task 1 with `total`/`offset`/`hasMore`/`nextOffset`; handler in Task 4 returns those fields. ✓
- `SEARCH_TRANSACTIONS_OUTPUT` / `GET_TRANSACTION_DETAIL_OUTPUT` — declared in Task 1; imported in Task 5. ✓
- `pingoneListUsers` return type — includes `nextCursor?` in Task 7; `PINGONE_USERS_SCHEMA` in Task 6 already includes `nextCursor: z.string().optional()`. ✓
- `pingoneListApps` return type — same as above. ✓
- `pingone_check_bootstrap` — no write env gate needed (read-only). ✓

### No placeholder audit

No TBD, TODO, "similar to Task N", or missing code blocks found.