# BankingToolProvider Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `banking_mcp_server/src/tools/BankingToolProvider.ts` (1124 lines) into a ~250-line orchestrator plus four peer service modules (TokenResolver, JwtClaimVerifier, TransactionErrorMapper, TokenChainAuditor) and a `handlers/` subdirectory with one free-function handler per tool. No observable behavior change.

**Architecture:** Approach B1 from the design spec. Each new module owns one responsibility. Tool handlers become top-level async functions called via a registry map. The provider's `executeTool` shrinks to a linear pipeline: validate → auth-challenge → resolve-token → verify-claims → dispatch → audit → error-handle. Public surface (constructor, `executeTool` signature, `BankingToolResult`) is unchanged.

**Tech Stack:** TypeScript 5 strict mode, Node 20+, Jest with ts-jest, CommonJS modules. Compiled with `tsc` to `dist/`. Existing tests: `banking_mcp_server/tests/` (jest, classic `jest.mock(...)` pattern).

**Reference:** Design spec at [`docs/superpowers/specs/2026-05-14-banking-mcp-provider-split-design.md`](../specs/2026-05-14-banking-mcp-provider-split-design.md). All line-number references in this plan refer to `banking_mcp_server/src/tools/BankingToolProvider.ts` as of commit `6b5ba0b9`.

---

## Pre-flight (do once before starting Task 1)

- [ ] **Step 0.1: Capture baseline test state**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server
npm run build 2>&1 | tee /tmp/baseline-build.log
npm test 2>&1 | tee /tmp/baseline-tests.log
echo "exit=$?"
```
Expected: build exits 0, tests exit 0. The `/tmp/baseline-*` logs are the regression-comparison baseline for every subsequent step.

- [ ] **Step 0.2: Confirm protected-files acknowledgement**

`banking_mcp_server/` is in `REGRESSION_PLAN.md` §1. Before any edit, state in the commit body for each commit:
> "Refactor of BankingToolProvider.ts. No observable behavior change. Same constructor, same `executeTool` signature, same `BankingToolResult` shape, same error messages and log strings, same `tokenCache` keys, same env-var reads."

If the build or integration tests behave differently after any step, stop and diff against `/tmp/baseline-*`.

---

## File structure

After this plan, `banking_mcp_server/src/tools/` contains:

```
tools/
├── BankingToolProvider.ts          (modified — ~250 lines)
├── BankingToolRegistry.ts          (untouched)
├── BankingToolValidator.ts         (untouched)
├── AuthorizationChallengeHandler.ts (untouched)
├── toolScopeMap.ts                 (untouched)
├── index.ts                        (untouched)
├── TokenResolver.ts                (new — ~170 lines)
├── JwtClaimVerifier.ts             (new — ~85 lines)
├── TransactionErrorMapper.ts       (new — ~95 lines)
├── TokenChainAuditor.ts            (new — ~95 lines)
└── handlers/
    ├── index.ts                    (new — ~25 lines)
    ├── types.ts                    (new — ~20 lines)
    ├── results.ts                  (new — ~15 lines)
    ├── accountHandlers.ts          (new — ~75 lines)
    ├── transactionHandlers.ts      (new — ~140 lines)
    ├── identityHandlers.ts         (new — ~30 lines)
    └── reasoningHandlers.ts        (new — ~40 lines)
```

New tests:
```
banking_mcp_server/tests/tools/
├── TokenResolver.test.ts           (new)
├── JwtClaimVerifier.test.ts        (new)
├── TransactionErrorMapper.test.ts  (new)
└── TokenChainAuditor.test.ts       (new)
```

Existing tests remain unchanged: `tests/tools/BankingToolProvider.test.ts`, `tests/integration/mcp-protocol.integration.test.ts`, `tests/integration/banking-operations.integration.test.ts`.

---

## Task 1: Shared handler types and result helpers

Pure new files. Nothing imports them yet. Zero behavior change.

**Files:**
- Create: `banking_mcp_server/src/tools/handlers/types.ts`
- Create: `banking_mcp_server/src/tools/handlers/results.ts`

- [ ] **Step 1.1: Create `handlers/types.ts`**

```typescript
import type { BankingAPIClient } from '../../banking/BankingAPIClient';
import type { Logger } from '../../utils/Logger';
import type { BankingToolResult } from '../BankingToolProvider';

export interface HandlerDeps {
  apiClient: BankingAPIClient;
  logger: Logger;
}

export type HandlerFn = (
  deps: HandlerDeps,
  token: string,
  params: any,
) => Promise<BankingToolResult>;
```

- [ ] **Step 1.2: Create `handlers/results.ts`**

```typescript
import type { BankingToolResult } from '../BankingToolProvider';

export function createSuccessResult(text: string): BankingToolResult {
  return {
    type: 'text',
    text,
    success: true,
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

- [ ] **Step 1.3: Build to verify imports resolve**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server && npm run build
```
Expected: exit 0. No new warnings.

- [ ] **Step 1.4: Run full test suite**

Run: `npm test`
Expected: same pass count as `/tmp/baseline-tests.log`. No new failures.

- [ ] **Step 1.5: Commit**

```bash
cd /Users/curtismuir/Development/banking
git add banking_mcp_server/src/tools/handlers/types.ts banking_mcp_server/src/tools/handlers/results.ts
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
refactor(mcp): add handlers/types.ts and handlers/results.ts

Step 1/7 of BankingToolProvider split (B1, Path 1). Pure new files —
no consumers yet. Defines HandlerDeps + HandlerFn types and shared
createSuccessResult/createErrorResult helpers that subsequent tasks
will import.

No observable behavior change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extract `TransactionErrorMapper.ts`

Lowest-coupling extraction first to validate the pattern. Pure function — no state.

**Files:**
- Create: `banking_mcp_server/src/tools/TransactionErrorMapper.ts`
- Create: `banking_mcp_server/tests/tools/TransactionErrorMapper.test.ts`
- Modify: `banking_mcp_server/src/tools/BankingToolProvider.ts` lines 850-931 (delete `handleTransactionBankingError`); lines 678-680, 715-717, 759-761 (replace call sites with imported function)

- [ ] **Step 2.1: Write failing test `TransactionErrorMapper.test.ts`**

```typescript
import { mapTransactionError } from '../../src/tools/TransactionErrorMapper';
import { BankingAPIError } from '../../src/interfaces/banking';

describe('mapTransactionError', () => {
  it('returns null for non-BankingAPIError', () => {
    expect(mapTransactionError(new Error('plain'), 'deposit', 100)).toBeNull();
  });

  it('returns null for unrecognised errorCode', () => {
    const err = new BankingAPIError('boom', 400, 'unrecognized_code');
    expect(mapTransactionError(err, 'deposit', 100)).toBeNull();
  });

  it('maps amount_exceeds_hard_limit with limit from response', () => {
    const err = new BankingAPIError('exceeds', 400, 'amount_exceeds_hard_limit');
    (err as any).originalError = { response: { data: { limit: 750 } } };
    const result = mapTransactionError(err, 'transfer', 2000);
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    const payload = JSON.parse(result!.text);
    expect(payload.error).toBe('amount_exceeds_hard_limit');
    expect(payload.limit).toBe(750);
    expect(payload.amount).toBe(2000);
  });

  it('maps amount_exceeds_hard_limit with default limit when missing', () => {
    const err = new BankingAPIError('exceeds', 400, 'amount_exceeds_hard_limit');
    (err as any).originalError = { response: { data: {} } };
    const result = mapTransactionError(err, 'withdrawal', 1500);
    const payload = JSON.parse(result!.text);
    expect(payload.limit).toBe(1000);
  });

  it('maps hitl_required with hitl.type from response', () => {
    const err = new BankingAPIError('hitl', 428, 'hitl_required');
    (err as any).originalError = { response: { data: { hitl: { type: 'step_up' } } } };
    const result = mapTransactionError(err, 'transfer', 600);
    const payload = JSON.parse(result!.text);
    expect(payload.error).toBe('hitl_required');
    expect(payload.hitl.type).toBe('step_up');
    expect(payload.amount).toBe(600);
  });

  it('maps step_up_required with method', () => {
    const err = new BankingAPIError('stepup', 428, 'step_up_required');
    (err as any).originalError = { response: { data: { step_up_method: 'sms' } } };
    const result = mapTransactionError(err, 'transfer', 800);
    const payload = JSON.parse(result!.text);
    expect(payload.error).toBe('step_up_required');
    expect(payload.step_up_method).toBe('sms');
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server
npx jest tests/tools/TransactionErrorMapper.test.ts
```
Expected: FAIL — `Cannot find module '../../src/tools/TransactionErrorMapper'`.

- [ ] **Step 2.3: Create `TransactionErrorMapper.ts`**

Copy the body of `handleTransactionBankingError` from `BankingToolProvider.ts` lines 850-931 verbatim. Adapt to a top-level function.

```typescript
/**
 * Maps transactional banking errors (deposit / withdrawal / transfer) into structured
 * BankingToolResults. Returns null when the error is not a recognised code so the caller
 * can re-throw.
 *
 * Extracted from BankingToolProvider.handleTransactionBankingError. Behavior is identical;
 * only relocation.
 */
import { BankingAPIError } from '../interfaces/banking';
import type { BankingToolResult } from './BankingToolProvider';
import { createSuccessResult } from './handlers/results';

export type TransactionOperation = 'deposit' | 'withdrawal' | 'transfer';

const HITL_THRESHOLD_USD = Number(process.env.HITL_THRESHOLD_USD ?? 500);

export function mapTransactionError(
  error: unknown,
  operationLabel: TransactionOperation,
  amount: number,
): BankingToolResult | null {
  if (!(error instanceof BankingAPIError)) {
    console.log(`[DEBUG-MCP-ERROR] ❌ Not a BankingAPIError, ignoring: ${error}`);
    return null;
  }
  const axiosData = (error.originalError?.response?.data ?? {}) as Record<string, unknown>;

  console.log(`[DEBUG-MCP-HANDLER] 🔍 MCP ERROR HANDLER - Processing error:
  errorCode: ${error.errorCode}
  operationLabel: ${operationLabel}
  amount: $${amount}
  apiErrorDebugHitl: ${axiosData.debug_hitl_check}
  apiErrorDebugStepup: ${axiosData.debug_stepup_check}`);

  if (error.errorCode === 'amount_exceeds_hard_limit') {
    const limit = typeof axiosData['limit'] === 'number' ? axiosData['limit'] : 1000;
    const insufficientFundsAlso = axiosData['insufficient_funds_also'] === true;
    const reasonNote = insufficientFundsAlso
      ? `Note: your account also has insufficient funds for this amount.`
      : `This is a system limit set by the administrator (separate from your account balance).`;
    return createSuccessResult(
      JSON.stringify(
        {
          error: 'amount_exceeds_hard_limit',
          message: `The maximum ${operationLabel} amount is $${limit} per transaction. You requested $${amount}. ${reasonNote} Would you like me to try a smaller amount instead?`,
          limit,
          amount,
        },
        null,
        2,
      ),
    );
  }

  if (error.errorCode === 'hitl_required') {
    const hitlType: string =
      typeof (axiosData['hitl'] as any)?.type === 'string'
        ? (axiosData['hitl'] as any).type
        : 'consent';
    console.log(`[MCP-CONSENT] hitl_required (type=${hitlType}) for ${operationLabel} $${amount}`);
    return createSuccessResult(
      JSON.stringify(
        {
          error: 'hitl_required',
          hitl: { type: hitlType },
          message: error.message,
          hitl_threshold_usd: HITL_THRESHOLD_USD,
          amount: amount,
          type: operationLabel,
          fromAccountId: typeof axiosData['fromAccountId'] === 'string' ? axiosData['fromAccountId'] : null,
          toAccountId: typeof axiosData['toAccountId'] === 'string' ? axiosData['toAccountId'] : null,
        },
        null,
        2,
      ),
    );
  }

  if (error.errorCode === 'step_up_required') {
    const stepUpMethod: string =
      typeof axiosData['step_up_method'] === 'string' ? (axiosData['step_up_method'] as string) : 'email';
    console.log(`[MCP-STEPUP] step_up_required method=${stepUpMethod} for ${operationLabel} $${amount}`);
    return createSuccessResult(
      JSON.stringify(
        {
          error: 'step_up_required',
          hitl: { type: 'step_up' },
          step_up_required: true,
          step_up_method: stepUpMethod,
          message: `This transaction requires additional authentication (${stepUpMethod.toUpperCase()}). Please complete the step-up verification to proceed.`,
          amount_threshold: typeof axiosData['amount_threshold'] === 'number' ? axiosData['amount_threshold'] : null,
        },
        null,
        2,
      ),
    );
  }

  return null;
}
```

- [ ] **Step 2.4: Run new test to verify it passes**

Run: `npx jest tests/tools/TransactionErrorMapper.test.ts`
Expected: 5 tests pass.

- [ ] **Step 2.5: Update `BankingToolProvider.ts` to delegate**

Open `banking_mcp_server/src/tools/BankingToolProvider.ts`.

Add import near the top with the other tool imports (around line 12):
```typescript
import { mapTransactionError, TransactionOperation } from './TransactionErrorMapper';
```

In each of the three callers, replace:
- Line 678-680 (in `executeCreateDeposit`):
  ```typescript
  const handled = this.handleTransactionBankingError(error, 'deposit', params.amount);
  ```
  with:
  ```typescript
  const handled = mapTransactionError(error, 'deposit' as TransactionOperation, params.amount);
  ```
- Line 715-717 (in `executeCreateWithdrawal`): same replacement using `'withdrawal'`.
- Line 759-761 (in `executeCreateTransfer`): same replacement using `'transfer'`.

Delete the entire `handleTransactionBankingError` method (lines 842-931, including the doc comment).

The `HITL_THRESHOLD_USD` constant at line 63 of the provider is now duplicated in `TransactionErrorMapper.ts`. Leave the provider's copy for this commit — it will be removed in Task 6 when handlers move out. (Leaving it means `BankingToolProvider.ts` still compiles standalone and the build does not need any other coordinated change.)

- [ ] **Step 2.6: Verify build and tests**

Run:
```bash
npm run build
npm test
```
Expected: build exits 0. Test count = baseline + 5 (the new mapper tests). Zero pre-existing tests change behavior.

- [ ] **Step 2.7: Commit**

```bash
cd /Users/curtismuir/Development/banking
git add banking_mcp_server/src/tools/TransactionErrorMapper.ts banking_mcp_server/tests/tools/TransactionErrorMapper.test.ts banking_mcp_server/src/tools/BankingToolProvider.ts
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
refactor(mcp): extract TransactionErrorMapper from BankingToolProvider

Step 2/7 of BankingToolProvider split (B1, Path 1). Pure function
extraction of handleTransactionBankingError (lines 850-931) to a
new module. Three call sites updated to import mapTransactionError.

No observable behavior change. Same console.log debug lines, same
JSON payload shape, same HITL_THRESHOLD_USD value.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extract `TokenResolver.ts`

Highest-risk extraction. Copy the 120-line if/else verbatim into a class method. Behavior must be byte-identical.

**Files:**
- Create: `banking_mcp_server/src/tools/TokenResolver.ts`
- Create: `banking_mcp_server/tests/tools/TokenResolver.test.ts`
- Modify: `banking_mcp_server/src/tools/BankingToolProvider.ts` (replace lines 391-510 + delete `getUserTokenForScopes` 1101-1124)

- [ ] **Step 3.1: Write failing test `TokenResolver.test.ts`**

```typescript
import { TokenResolver } from '../../src/tools/TokenResolver';
import { BankingAuthenticationManager } from '../../src/auth/BankingAuthenticationManager';
import { TokenExchangeService } from '../../src/auth/TokenExchangeService';
import { Logger, createDefaultLoggerConfig } from '../../src/utils/Logger';
import { tokenCache } from '../../src/services/tokenCacheService';
import { Session, AuthenticationError, AuthErrorCodes } from '../../src/interfaces/auth';
import type { BankingToolDefinition } from '../../src/tools/BankingToolRegistry';

jest.mock('../../src/auth/BankingAuthenticationManager');
jest.mock('../../src/auth/TokenExchangeService');

const baseTool: BankingToolDefinition = {
  name: 'get_my_accounts',
  description: 'x',
  inputSchema: { type: 'object', properties: {} },
  requiredScopes: ['banking:read'],
  requiresUserAuth: true,
  handler: 'executeGetMyAccounts',
};

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 'sess-1',
    userTokens: {
      accessToken: 'user-tok',
      refreshToken: 'r',
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: 'banking:read banking:write',
      issuedAt: new Date(),
    },
    createdAt: new Date(),
    lastActivity: new Date(),
    ...overrides,
  } as Session;
}

describe('TokenResolver', () => {
  let authManager: jest.Mocked<BankingAuthenticationManager>;
  let tokenExchangeService: jest.Mocked<TokenExchangeService>;
  let logger: Logger;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tokenCache.clear?.();
    authManager = new BankingAuthenticationManager({} as any) as jest.Mocked<BankingAuthenticationManager>;
    authManager.isTokenExpired = jest.fn(() => false);
    tokenExchangeService = new TokenExchangeService({} as any) as jest.Mocked<TokenExchangeService>;
    tokenExchangeService.exchangeToken = jest.fn();
    logger = Logger.getInstance(createDefaultLoggerConfig());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('agent-passthrough: returns agentToken when no resource URI configured', async () => {
    delete process.env.BANKING_API_RESOURCE_URI;
    const resolver = new TokenResolver({ authManager, tokenExchangeService, logger });
    const result = await resolver.resolve(makeSession(), baseTool, 'agent-tok');
    expect(result.token).toBe('agent-tok');
    expect(result.source).toBe('agent-passthrough');
    expect(tokenExchangeService.exchangeToken).not.toHaveBeenCalled();
  });

  it('agent-step9-exchange: exchanges when agentToken + resource URI present', async () => {
    process.env.BANKING_API_RESOURCE_URI = 'https://banking.example';
    tokenExchangeService.exchangeToken.mockResolvedValue({
      access_token: 'resource-tok',
      token_type: 'Bearer',
      expires_in: 60,
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    });
    const resolver = new TokenResolver({ authManager, tokenExchangeService, logger });
    const result = await resolver.resolve(makeSession(), baseTool, 'agent-tok');
    expect(result.token).toBe('resource-tok');
    expect(result.source).toBe('agent-step9-exchange');
    expect(tokenExchangeService.exchangeToken).toHaveBeenCalledTimes(1);
  });

  it('user-rfc8693-exchange: exchanges user token when no agentToken', async () => {
    tokenExchangeService.exchangeToken.mockResolvedValue({
      access_token: 'exchanged-tok',
      token_type: 'Bearer',
      expires_in: 60,
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    });
    const resolver = new TokenResolver({ authManager, tokenExchangeService, logger });
    const result = await resolver.resolve(makeSession(), baseTool, undefined);
    expect(result.token).toBe('exchanged-tok');
    expect(result.source).toBe('user-rfc8693-exchange');
  });

  it('user-passthrough-devtest: passes user token directly when no exchange service in test env', async () => {
    process.env.NODE_ENV = 'test';
    const resolver = new TokenResolver({ authManager, tokenExchangeService: undefined, logger });
    const result = await resolver.resolve(makeSession(), baseTool, undefined);
    expect(result.token).toBe('user-tok');
    expect(result.source).toBe('user-passthrough-devtest');
  });

  it('throws when no exchange service in production', async () => {
    process.env.NODE_ENV = 'production';
    const resolver = new TokenResolver({ authManager, tokenExchangeService: undefined, logger });
    await expect(resolver.resolve(makeSession(), baseTool, undefined)).rejects.toThrow(/Token passthrough fallback is not allowed/);
  });

  it('throws AuthenticationError when no user token has required scopes', async () => {
    const session = makeSession({
      userTokens: {
        accessToken: 'u',
        refreshToken: 'r',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'banking:other',
        issuedAt: new Date(),
      },
    });
    const resolver = new TokenResolver({ authManager, tokenExchangeService, logger });
    await expect(resolver.resolve(session, baseTool, undefined)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('caches and re-uses exchanged user token within TTL', async () => {
    tokenExchangeService.exchangeToken.mockResolvedValue({
      access_token: 'cached-tok',
      token_type: 'Bearer',
      expires_in: 60,
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    });
    const resolver = new TokenResolver({ authManager, tokenExchangeService, logger });
    await resolver.resolve(makeSession(), baseTool, undefined);
    await resolver.resolve(makeSession(), baseTool, undefined);
    expect(tokenExchangeService.exchangeToken).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `npx jest tests/tools/TokenResolver.test.ts`
Expected: FAIL — `Cannot find module '../../src/tools/TokenResolver'`.

- [ ] **Step 3.3: Create `TokenResolver.ts`**

The body is the verbatim relocation of `BankingToolProvider.executeSpecificTool` lines 391-510 + `getUserTokenForScopes` lines 1101-1124. Same conditionals, same error messages, same log strings, same cache keys.

```typescript
/**
 * Resolves the bearer token to send to the banking API for a tool call.
 *
 * Four resolution paths (mapped to TokenResolution.source):
 *   agent-passthrough          — agentToken present, no BANKING_API_RESOURCE_URI configured
 *   agent-step9-exchange       — agentToken present, exchange service + resource URI configured
 *   user-rfc8693-exchange      — no agentToken, exchange service configured
 *   user-passthrough-devtest   — no agentToken, no exchange service, dev/test env only (throws in prod)
 *
 * Extracted from BankingToolProvider.executeSpecificTool (lines 391-510) and
 * getUserTokenForScopes (lines 1101-1124). Behavior is identical to the originals.
 */
import { BankingAuthenticationManager } from '../auth/BankingAuthenticationManager';
import { TokenExchangeService } from '../auth/TokenExchangeService';
import { Logger } from '../utils/Logger';
import { tokenCache } from '../services/tokenCacheService';
import { getScopesForTool } from './toolScopeMap';
import type { BankingToolDefinition } from './BankingToolRegistry';
import { Session, AuthErrorCodes, AuthenticationError, UserTokens } from '../interfaces/auth';
import { TokenExchangeRequest } from '../interfaces/tokenExchange';

export interface TokenResolverDeps {
  authManager: BankingAuthenticationManager;
  tokenExchangeService?: TokenExchangeService;
  logger: Logger;
}

export interface TokenResolution {
  token: string;
  source:
    | 'agent-passthrough'
    | 'agent-step9-exchange'
    | 'user-rfc8693-exchange'
    | 'user-passthrough-devtest';
}

export class TokenResolver {
  constructor(private deps: TokenResolverDeps) {}

  async resolve(
    session: Session,
    tool: BankingToolDefinition,
    agentToken?: string,
  ): Promise<TokenResolution> {
    const { authManager, tokenExchangeService, logger } = this.deps;

    if (agentToken) {
      // Step 9: Second RFC 8693 exchange — exchange gateway-scoped token for resource-scoped token.
      // Gated on BANKING_API_RESOURCE_URI: when absent, fall back to using gateway token directly
      // for backward compatibility (e.g. local dev without full resource server config).
      if (tokenExchangeService && process.env.BANKING_API_RESOURCE_URI) {
        const toolScopes = getScopesForTool(tool.name);
        const agentCacheKey = `agent:${session.sessionId}:${[...toolScopes].sort().join(',')}`;
        const cachedResourceToken = tokenCache.get(agentCacheKey, toolScopes);
        if (cachedResourceToken) {
          logger.debug(`[BankingToolProvider] Step 9 resource cache hit for ${tool.name}`);
          return { token: cachedResourceToken, source: 'agent-step9-exchange' };
        }
        logger.info(
          `[BankingToolProvider] Step 9 resource exchange initiated for tool: ${tool.name}, scopes: ${toolScopes.join(',')}`,
        );
        try {
          const exchangeRequest: TokenExchangeRequest = {
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
            subject_token: agentToken,
            subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
            scope: toolScopes.join(' '),
            audience: process.env.BANKING_API_RESOURCE_URI,
          };
          const exchangeResponse = await tokenExchangeService.exchangeToken(exchangeRequest);
          const token = exchangeResponse.access_token;
          const expiresAt = Date.now() + exchangeResponse.expires_in * 1000;
          tokenCache.set(agentCacheKey, toolScopes, token, expiresAt);
          logger.info(
            `[BankingToolProvider] Step 9 resource exchange succeeded for ${tool.name} (expires_in: ${exchangeResponse.expires_in}s)`,
          );
          return { token, source: 'agent-step9-exchange' };
        } catch (exchangeError) {
          logger.error(
            `[BankingToolProvider] Step 9 resource exchange FAILED for ${tool.name}:`,
            {},
            exchangeError instanceof Error ? exchangeError : undefined,
          );
          throw new Error(
            `Step 9 token exchange failed for tool '${tool.name}': ${
              exchangeError instanceof Error ? exchangeError.message : 'Unknown error'
            }`,
          );
        }
      } else {
        // Backward compat: no resource URI configured — use gateway token directly
        logger.debug(
          `[BankingToolProvider] Using BFF-exchanged delegated token for ${tool.name} (no Step 9 resource exchange)`,
        );
        return { token: agentToken, source: 'agent-passthrough' };
      }
    }

    // Resolve user token from session
    const userToken = this.getUserTokenForScopes(session, tool.requiredScopes);
    if (!userToken) {
      throw new AuthenticationError(
        'No valid user tokens found for required scopes',
        AuthErrorCodes.USER_AUTHORIZATION_REQUIRED,
        undefined,
        tool.requiredScopes,
      );
    }

    if (tokenExchangeService) {
      // D-01: Lazy token exchange with cache
      // D-03: Narrowed scopes per tool via getScopesForTool()
      const toolScopes = getScopesForTool(tool.name);
      const cacheKey = session.sessionId;

      const cachedToken = tokenCache.get(cacheKey, toolScopes);
      if (cachedToken) {
        logger.debug(
          `[BankingToolProvider] Cache hit for ${tool.name} (scopes: ${toolScopes.join(',')})`,
        );
        return { token: cachedToken, source: 'user-rfc8693-exchange' };
      }

      logger.info(
        `[BankingToolProvider] Token exchange initiated for tool: ${tool.name}, scopes: ${toolScopes.join(',')}`,
      );
      try {
        const exchangeRequest: TokenExchangeRequest = {
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: userToken.accessToken,
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          scope: toolScopes.join(' '),
          ...(process.env.BANKING_API_RESOURCE_URI && {
            audience: process.env.BANKING_API_RESOURCE_URI,
          }),
        };
        const exchangeResponse = await tokenExchangeService.exchangeToken(exchangeRequest);
        const token = exchangeResponse.access_token;

        if (exchangeResponse.token_type !== 'Bearer' || !(exchangeResponse.expires_in > 0)) {
          throw new Error(
            `Token exchange for '${tool.name}' returned unexpected response — ` +
              `token_type: ${exchangeResponse.token_type}, expires_in: ${exchangeResponse.expires_in}`,
          );
        }

        const expiresAt = Date.now() + exchangeResponse.expires_in * 1000;
        tokenCache.set(cacheKey, toolScopes, token, expiresAt);

        logger.info(
          `[BankingToolProvider] Token exchange succeeded for ${tool.name} (expires_in: ${exchangeResponse.expires_in}s)`,
        );
        return { token, source: 'user-rfc8693-exchange' };
      } catch (exchangeError) {
        logger.error(
          `[BankingToolProvider] Token exchange FAILED for ${tool.name}:`,
          {},
          exchangeError instanceof Error ? exchangeError : undefined,
        );
        throw new Error(
          `Token exchange failed for tool '${tool.name}': ${
            exchangeError instanceof Error ? exchangeError.message : 'Unknown error'
          }`,
        );
      }
    }

    // MCP spec 2025-11-25 §Token Passthrough: "The MCP server MUST NOT pass through the token
    // it received from the MCP client." Outside dev/test the absence of TokenExchangeService is
    // a hard configuration error.
    const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
    const isDevOrTest =
      nodeEnv === 'development' || nodeEnv === 'dev' || nodeEnv === 'test' || nodeEnv === '';
    if (!isDevOrTest) {
      throw new Error(
        `Token passthrough fallback is not allowed in ${nodeEnv}: TokenExchangeService must be configured to satisfy MCP spec §Token Passthrough`,
      );
    }
    logger.warn(
      `[BankingToolProvider] No TokenExchangeService — passing user token directly to banking API (dev/test only; violates MCP spec in production)`,
    );
    return { token: userToken.accessToken, source: 'user-passthrough-devtest' };
  }

  private getUserTokenForScopes(session: Session, requiredScopes: string[]): UserTokens | null {
    if (!session.userTokens) return null;
    const tokens = Array.isArray(session.userTokens) ? session.userTokens : [session.userTokens];
    for (const userToken of tokens) {
      if (this.deps.authManager.isTokenExpired(userToken)) continue;
      const tokenScopes = userToken.scope.split(' ');
      const hasAllScopes = requiredScopes.every((scope) => tokenScopes.includes(scope));
      if (hasAllScopes) return userToken;
    }
    return null;
  }
}
```

- [ ] **Step 3.4: Run new test to verify it passes**

Run: `npx jest tests/tools/TokenResolver.test.ts`
Expected: 7 tests pass.

If `tokenCache.clear?.()` is undefined (i.e. the TokenCacheService doesn't export `clear`), inspect `src/services/tokenCacheService.ts` and use whatever the equivalent is (likely `tokenCache.evictAll()` or a fresh instance). Update the test's `beforeEach` accordingly.

- [ ] **Step 3.5: Update `BankingToolProvider.ts` to use `TokenResolver`**

In `BankingToolProvider.ts`:

1. Add import near the top:
   ```typescript
   import { TokenResolver } from './TokenResolver';
   ```

2. Remove the now-unused imports of `tokenCache` (line 21), `TokenExchangeRequest` (line 18), `getScopesForTool` from `toolScopeMap` (keep `filterToolsByScope`). Adjust line 22 to:
   ```typescript
   import { filterToolsByScope } from './toolScopeMap';
   ```

3. In the class, add a field after line 68:
   ```typescript
   private tokenResolver: TokenResolver;
   ```

4. In the constructor body (after line 79):
   ```typescript
   this.tokenResolver = new TokenResolver({
     authManager: this.authManager,
     tokenExchangeService: this.tokenExchangeService,
     logger: this.logger,
   });
   ```

5. In `executeSpecificTool`, replace the entire token-selection block (lines 391-510) with a single call:
   ```typescript
   // Auth tools: resolve token via TokenResolver (handles all four paths)
   const { token } = await this.tokenResolver.resolve(context.session, tool, agentToken);
   ```
   The lines being replaced are everything from the comment `// Token selection: prefer the BFF-issued delegated token…` through (and including) the final `token = userToken.accessToken;` line. The `let token: string;` declaration on line 395 is replaced by the `const { token } = ...` destructuring.

6. Delete the `getUserTokenForScopes` private method (lines 1098-1124, including its doc comment).

- [ ] **Step 3.6: Build and run all tests**

Run:
```bash
npm run build
npm test
```
Expected: build exits 0. All existing tests (including `BankingToolProvider.test.ts` and the integration tests) still pass. New test count = baseline + 5 (Task 2) + 7 (Task 3) = baseline + 12.

If `BankingToolProvider.test.ts` exercises any of the four token-resolution paths directly (it probably does — that file has cache-related test groups), they should still pass without modification because the public `executeTool` behavior is unchanged.

- [ ] **Step 3.7: Commit**

```bash
cd /Users/curtismuir/Development/banking
git add banking_mcp_server/src/tools/TokenResolver.ts banking_mcp_server/tests/tools/TokenResolver.test.ts banking_mcp_server/src/tools/BankingToolProvider.ts
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
refactor(mcp): extract TokenResolver from BankingToolProvider

Step 3/7 of BankingToolProvider split (B1, Path 1). The 120-line
token-selection block from executeSpecificTool moves verbatim into
TokenResolver.resolve(), which returns { token, source } where source
is one of agent-passthrough / agent-step9-exchange /
user-rfc8693-exchange / user-passthrough-devtest. Provider now calls
this.tokenResolver.resolve(...) once. tokenCache import moves to the
new module. getUserTokenForScopes also moves in as a private method.

No observable behavior change. Same cache keys, same error messages,
same log strings, same env-var reads, same prod-vs-dev throw.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Extract `JwtClaimVerifier.ts`

**Files:**
- Create: `banking_mcp_server/src/tools/JwtClaimVerifier.ts`
- Create: `banking_mcp_server/tests/tools/JwtClaimVerifier.test.ts`
- Modify: `banking_mcp_server/src/tools/BankingToolProvider.ts` (delete lines 26-41 module-level JWKS helpers; delete `SENSITIVE_HANDLERS` set lines 514-519; delete `decodeJwtPayload` lines 1023-1031; delete `assertTokenClaims` lines 1037-1096)

- [ ] **Step 4.1: Write failing test `JwtClaimVerifier.test.ts`**

```typescript
import { JwtClaimVerifier } from '../../src/tools/JwtClaimVerifier';
import { Logger, createDefaultLoggerConfig } from '../../src/utils/Logger';
import { AuthenticationError, AuthErrorCodes } from '../../src/interfaces/auth';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

describe('JwtClaimVerifier', () => {
  let logger: Logger;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    logger = Logger.getInstance(createDefaultLoggerConfig());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('isSensitiveHandler returns true for the four sensitive handlers', () => {
    const v = new JwtClaimVerifier(logger);
    expect(v.isSensitiveHandler('executeGetSensitiveAccountDetails')).toBe(true);
    expect(v.isSensitiveHandler('executeCreateTransfer')).toBe(true);
    expect(v.isSensitiveHandler('executeCreateWithdrawal')).toBe(true);
    expect(v.isSensitiveHandler('executeCreateDeposit')).toBe(true);
  });

  it('isSensitiveHandler returns false for non-sensitive handlers', () => {
    const v = new JwtClaimVerifier(logger);
    expect(v.isSensitiveHandler('executeGetMyAccounts')).toBe(false);
    expect(v.isSensitiveHandler('executeSequentialThink')).toBe(false);
  });

  it('decodePayload returns claims for valid JWT', () => {
    const v = new JwtClaimVerifier(logger);
    const tok = makeJwt({ sub: 'u123', scope: 'banking:read' });
    expect(v.decodePayload(tok)).toEqual({ sub: 'u123', scope: 'banking:read' });
  });

  it('decodePayload returns null for opaque (non-JWT) token', () => {
    const v = new JwtClaimVerifier(logger);
    expect(v.decodePayload('opaque-token-no-dots')).toBeNull();
  });

  it('assertClaims throws AuthenticationError when token is expired', async () => {
    delete process.env.PINGONE_JWKS_URI;
    delete process.env.PINGONE_ISSUER;
    delete process.env.PINGONE_BASE_URL;
    const v = new JwtClaimVerifier(logger);
    const expiredTok = makeJwt({ exp: Math.floor(Date.now() / 1000) - 60, iss: 'x' });
    await expect(v.assertClaims(expiredTok, 'tool')).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('assertClaims is a no-op for opaque tokens', async () => {
    const v = new JwtClaimVerifier(logger);
    await expect(v.assertClaims('opaque', 'tool')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `npx jest tests/tools/JwtClaimVerifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4.3: Create `JwtClaimVerifier.ts`**

```typescript
/**
 * Verifies JWT claims on bearer tokens passed to sensitive banking tools.
 *
 * Owns:
 *   - The SENSITIVE_HANDLERS set (which handlers require pre-flight claim verification)
 *   - The JWKS RemoteKeySet memo (instance-scoped — single-instance reality)
 *   - decodePayload (unsigned JWT body decode for claim inspection)
 *   - assertClaims (exp/iss/aud structural check + optional JWKS signature verification)
 *
 * SECURITY NOTE on decodePayload: this is intentionally unsigned decode. The token was issued
 * by PingOne during RFC 8693 token exchange — PingOne verified the subject and actor tokens
 * before issuing. We only inspect claims here; the BFF/MCP server validated the token signature
 * at the transport boundary before it reached this point.
 *
 * Extracted from BankingToolProvider — module-level _jwksKeySet + getJwksKeySet (lines 26-41),
 * SENSITIVE_HANDLERS set (lines 514-519), decodeJwtPayload (lines 1023-1031), and
 * assertTokenClaims (lines 1037-1096). Behavior is identical.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Logger } from '../utils/Logger';
import { AuthenticationError, AuthErrorCodes } from '../interfaces/auth';

const SENSITIVE_HANDLERS = new Set<string>([
  'executeGetSensitiveAccountDetails',
  'executeCreateTransfer',
  'executeCreateWithdrawal',
  'executeCreateDeposit',
]);

export class JwtClaimVerifier {
  private jwksKeySet: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(private logger: Logger) {}

  isSensitiveHandler(handlerName: string): boolean {
    return SENSITIVE_HANDLERS.has(handlerName);
  }

  decodePayload(token: string): Record<string, unknown> | null {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async assertClaims(token: string, toolName: string): Promise<void> {
    const payload = this.decodePayload(token);
    if (!payload) return; // opaque token — skip all checks

    const now = Math.floor(Date.now() / 1000);
    const exp = typeof payload.exp === 'number' ? payload.exp : null;
    const iss = typeof payload.iss === 'string' ? payload.iss : null;
    const aud = payload.aud;

    if (exp !== null && exp < now) {
      throw new AuthenticationError(
        `Token for '${toolName}' has expired (exp: ${new Date(exp * 1000).toISOString()})`,
        AuthErrorCodes.TOKEN_EXPIRED,
      );
    }

    if (!iss) {
      this.logger.warn(`[BankingToolProvider] Token for sensitive tool '${toolName}' has no iss claim`);
    }

    const expectedAud = process.env.BANKING_API_RESOURCE_URI;
    if (expectedAud && aud) {
      const audArray: string[] = Array.isArray(aud) ? (aud as string[]) : [aud as string];
      if (!audArray.includes(expectedAud)) {
        this.logger.warn(
          `[BankingToolProvider] Token aud [${audArray.join(', ')}] does not include expected audience '${expectedAud}' for '${toolName}'`,
        );
      }
    }

    // JWKS Cryptographic Signature Verification (RFC 7515) — fail-open unless
    // STRICT_TOKEN_VERIFICATION=true.
    const jwks = this.getJwksKeySet();
    if (jwks) {
      try {
        const verifyOpts: Parameters<typeof jwtVerify>[2] = {};
        if (expectedAud) verifyOpts.audience = expectedAud;
        if (iss) verifyOpts.issuer = iss;
        await jwtVerify(token, jwks, verifyOpts);
        this.logger.info(`[BankingToolProvider] JWKS sig ✅ verified for sensitive tool '${toolName}'`);
      } catch (jwksErr) {
        const msg = jwksErr instanceof Error ? jwksErr.message : String(jwksErr);
        if (!msg.includes('expired')) {
          if (process.env.STRICT_TOKEN_VERIFICATION === 'true') {
            throw new Error(`Token signature verification failed for '${toolName}': ${msg}`);
          }
          this.logger.warn(`[BankingToolProvider] JWKS sig ⚠ warning for '${toolName}': ${msg} (fail-open)`);
        }
      }
    } else {
      this.logger.debug(`[BankingToolProvider] JWKS not configured — skipping sig verification for '${toolName}'`);
    }
  }

  private getJwksKeySet(): ReturnType<typeof createRemoteJWKSet> | null {
    if (this.jwksKeySet) return this.jwksKeySet;
    const jwksUri =
      process.env.PINGONE_JWKS_URI ||
      (process.env.PINGONE_ISSUER ? `${process.env.PINGONE_ISSUER}/jwks` : null) ||
      (process.env.PINGONE_BASE_URL ? `${process.env.PINGONE_BASE_URL}/jwks` : null);
    if (!jwksUri) return null;
    try {
      this.jwksKeySet = createRemoteJWKSet(new URL(jwksUri));
      return this.jwksKeySet;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4.4: Run new test to verify it passes**

Run: `npx jest tests/tools/JwtClaimVerifier.test.ts`
Expected: 6 tests pass.

- [ ] **Step 4.5: Update `BankingToolProvider.ts` to use `JwtClaimVerifier`**

1. Add import:
   ```typescript
   import { JwtClaimVerifier } from './JwtClaimVerifier';
   ```

2. Delete `jose` import on line 23 (no longer needed in this file).

3. Delete the module-level `_jwksKeySet` declaration (line 26) and the entire `getJwksKeySet` helper (lines 28-41).

4. Add a class field next to `tokenResolver` (added in Task 3):
   ```typescript
   private jwtVerifier: JwtClaimVerifier;
   ```

5. In the constructor body:
   ```typescript
   this.jwtVerifier = new JwtClaimVerifier(this.logger);
   ```

6. In `executeSpecificTool`, replace lines 514-522 (the `SENSITIVE_HANDLERS` const declaration + the `if (SENSITIVE_HANDLERS.has(...))` block) with:
   ```typescript
   if (this.jwtVerifier.isSensitiveHandler(tool.handler)) {
     await this.jwtVerifier.assertClaims(token, tool.name);
   }
   ```

7. Inside `executeTool`'s success path (lines 195-196), replace `this.decodeJwtPayload(userToken.accessToken)` with `this.jwtVerifier.decodePayload(userToken.accessToken)`.

8. Delete `decodeJwtPayload` (lines 1015-1031, including doc comment).

9. Delete `assertTokenClaims` (lines 1033-1096, including doc comment).

- [ ] **Step 4.6: Build and run all tests**

Run:
```bash
npm run build
npm test
```
Expected: build exits 0. All tests pass. Test count = baseline + 5 + 7 + 6 = baseline + 18.

- [ ] **Step 4.7: Commit**

```bash
cd /Users/curtismuir/Development/banking
git add banking_mcp_server/src/tools/JwtClaimVerifier.ts banking_mcp_server/tests/tools/JwtClaimVerifier.test.ts banking_mcp_server/src/tools/BankingToolProvider.ts
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
refactor(mcp): extract JwtClaimVerifier from BankingToolProvider

Step 4/7 of BankingToolProvider split (B1, Path 1). SENSITIVE_HANDLERS,
the JWKS RemoteKeySet memo, decodeJwtPayload, and assertTokenClaims
move into JwtClaimVerifier. JWKS cache becomes instance-scoped (single
provider instance in the live process; matches existing reality).

No observable behavior change. Same fail-open semantics for JWKS
errors, same STRICT_TOKEN_VERIFICATION promote-to-throw, same expired-
token AuthenticationError throw.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Extract `TokenChainAuditor.ts`

**Files:**
- Create: `banking_mcp_server/src/tools/TokenChainAuditor.ts`
- Create: `banking_mcp_server/tests/tools/TokenChainAuditor.test.ts`
- Modify: `banking_mcp_server/src/tools/BankingToolProvider.ts` (delete `chainIndexBySession` field; delete `incrementChainIndex` lines 87-98; replace `clearSessionChainIndex` body with auditor delegation; replace lines 184-259 inline audit block with single `auditor.record(...)` call)

- [ ] **Step 5.1: Write failing test `TokenChainAuditor.test.ts`**

```typescript
import { TokenChainAuditor } from '../../src/tools/TokenChainAuditor';
import { JwtClaimVerifier } from '../../src/tools/JwtClaimVerifier';
import { AuditLogger } from '../../src/utils/AuditLogger';
import { Logger, createDefaultLoggerConfig } from '../../src/utils/Logger';
import type { Session } from '../../src/interfaces/auth';
import type { BankingToolDefinition } from '../../src/tools/BankingToolRegistry';
import type { BankingToolResult } from '../../src/tools/BankingToolProvider';

jest.mock('../../src/utils/AuditLogger');

const baseTool: BankingToolDefinition = {
  name: 'get_my_accounts',
  description: 'x',
  inputSchema: { type: 'object', properties: {} },
  requiredScopes: ['banking:read'],
  requiresUserAuth: true,
  handler: 'executeGetMyAccounts',
};

function makeSession(sessionId = 'sess-1'): Session {
  return {
    sessionId,
    userTokens: undefined,
    createdAt: new Date(),
    lastActivity: new Date(),
  } as Session;
}

const baseResult: BankingToolResult = { type: 'text', text: 'ok', success: true };

describe('TokenChainAuditor', () => {
  let auditLogger: jest.Mocked<AuditLogger>;
  let verifier: JwtClaimVerifier;
  let logger: Logger;

  beforeEach(() => {
    logger = Logger.getInstance(createDefaultLoggerConfig());
    auditLogger = { logTokenChain: jest.fn() } as unknown as jest.Mocked<AuditLogger>;
    verifier = new JwtClaimVerifier(logger);
  });

  it('record increments chain index per session', async () => {
    const a = new TokenChainAuditor(auditLogger, verifier, logger);
    await a.record({ toolName: 'get_my_accounts', tool: baseTool, session: makeSession('s1'), result: baseResult, executionTime: 5 });
    await a.record({ toolName: 'get_my_accounts', tool: baseTool, session: makeSession('s1'), result: baseResult, executionTime: 5 });
    const calls = auditLogger.logTokenChain.mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][1]).toBe(1); // chainIndex
    expect(calls[1][1]).toBe(2);
  });

  it('record keeps chain indices independent across sessions', async () => {
    const a = new TokenChainAuditor(auditLogger, verifier, logger);
    await a.record({ toolName: 't', tool: baseTool, session: makeSession('s1'), result: baseResult, executionTime: 1 });
    await a.record({ toolName: 't', tool: baseTool, session: makeSession('s2'), result: baseResult, executionTime: 1 });
    expect(auditLogger.logTokenChain.mock.calls[0][1]).toBe(1);
    expect(auditLogger.logTokenChain.mock.calls[1][1]).toBe(1);
  });

  it('clearSession removes the chain index for that session', async () => {
    const a = new TokenChainAuditor(auditLogger, verifier, logger);
    await a.record({ toolName: 't', tool: baseTool, session: makeSession('s1'), result: baseResult, executionTime: 1 });
    a.clearSession('s1');
    await a.record({ toolName: 't', tool: baseTool, session: makeSession('s1'), result: baseResult, executionTime: 1 });
    expect(auditLogger.logTokenChain.mock.calls[1][1]).toBe(1); // restarted at 1
  });

  it('record never throws even when auditLogger throws', async () => {
    auditLogger.logTokenChain = jest.fn().mockRejectedValue(new Error('audit boom'));
    const a = new TokenChainAuditor(auditLogger, verifier, logger);
    await expect(
      a.record({ toolName: 't', tool: baseTool, session: makeSession('s1'), result: baseResult, executionTime: 1 }),
    ).resolves.toBeUndefined();
  });

  it('record builds exchangedTokenInfo when agentToken is provided', async () => {
    const a = new TokenChainAuditor(auditLogger, verifier, logger);
    await a.record({
      toolName: 't',
      tool: baseTool,
      session: makeSession('s1'),
      agentToken: 'agent-tok',
      result: baseResult,
      executionTime: 1,
    });
    const exchanged = auditLogger.logTokenChain.mock.calls[0][3]; // 4th arg
    expect(exchanged).not.toBeNull();
    expect((exchanged as any).sub).toBe('mcp-agent');
  });

  it('record passes null exchangedTokenInfo when no agentToken', async () => {
    const a = new TokenChainAuditor(auditLogger, verifier, logger);
    await a.record({ toolName: 't', tool: baseTool, session: makeSession('s1'), result: baseResult, executionTime: 1 });
    expect(auditLogger.logTokenChain.mock.calls[0][3]).toBeNull();
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `npx jest tests/tools/TokenChainAuditor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5.3: Create `TokenChainAuditor.ts`**

The body relocates `incrementChainIndex` (lines 87-98), `clearSessionChainIndex` body (lines 104-106), the `MAX_SESSION_CHAIN_ENTRIES` constant (line 60), and the entire audit block from `executeTool` (lines 184-259) wrapped in its own `try/catch`.

```typescript
/**
 * Records token-chain audit events for tool executions. Owns the per-session chain index
 * counter and the call to AuditLogger.logTokenChain.
 *
 * Extracted from BankingToolProvider — chainIndexBySession field (line 69),
 * incrementChainIndex (lines 87-98), clearSessionChainIndex body (lines 104-106),
 * MAX_SESSION_CHAIN_ENTRIES (line 60), and the inline audit block in executeTool
 * (lines 184-259). The try/catch swallow that previously lived inline in executeTool
 * now wraps the entire record() body — audit failure never blocks tool result.
 */
import { AuditLogger, UserTokenInfo, ExchangedTokenInfo } from '../utils/AuditLogger';
import { Logger } from '../utils/Logger';
import { JwtClaimVerifier } from './JwtClaimVerifier';
import type { Session } from '../interfaces/auth';
import type { BankingToolDefinition } from './BankingToolRegistry';
import type { BankingToolResult } from './BankingToolProvider';

/** Maximum number of distinct sessions tracked before FIFO eviction. */
const MAX_SESSION_CHAIN_ENTRIES = 1_000;

export interface AuditRecordArgs {
  toolName: string;
  tool: BankingToolDefinition;
  session: Session;
  agentToken?: string;
  result: BankingToolResult;
  executionTime: number;
}

export class TokenChainAuditor {
  private chainIndexBySession: Map<string, number> = new Map();

  constructor(
    private auditLogger: AuditLogger,
    private jwtVerifier: JwtClaimVerifier,
    private logger: Logger,
  ) {}

  async record(args: AuditRecordArgs): Promise<void> {
    try {
      const { toolName, tool, session, agentToken, result, executionTime } = args;
      const chainIndex = this.incrementChainIndex(session.sessionId);

      let userToken = session.userTokens;
      if (Array.isArray(userToken)) userToken = userToken[0];

      const userTokenClaims = userToken ? this.jwtVerifier.decodePayload(userToken.accessToken) : null;
      const userSub = typeof userTokenClaims?.sub === 'string' ? userTokenClaims.sub : 'unknown';

      const userTokenInfo: UserTokenInfo = userToken
        ? {
            sub: userSub,
            scope: userToken.scope?.split(' ') || [],
            issuedAt: new Date(userToken.issuedAt).toISOString(),
            expiresAt: new Date(
              new Date(userToken.issuedAt).getTime() + (userToken.expiresIn || 3600) * 1000,
            ).toISOString(),
            tokenId: userSub,
          }
        : {
            sub: 'unknown',
            scope: [],
            issuedAt: new Date().toISOString(),
            expiresAt: undefined,
            tokenId: 'unknown',
          };

      const exchangedTokenInfo: ExchangedTokenInfo | null = agentToken
        ? {
            sub: 'mcp-agent',
            act: { iss: 'pingone', sub: userSub },
            scope: tool.requiredScopes || [],
            issuedAt: new Date().toISOString(),
            expiresAt: undefined,
            tokenId: 'exchange',
          }
        : null;

      const toolResultSummary = result.success ? `${toolName} completed` : `${toolName} failed`;

      await this.auditLogger.logTokenChain(
        toolName,
        chainIndex,
        userTokenInfo,
        exchangedTokenInfo,
        {
          sessionId: session.sessionId,
          userId: undefined,
          ipAddress: undefined,
          userAgent: undefined,
        },
        'completed',
        {
          success: result.success || false,
          errorCode: result.error ? 'TOOL_ERROR' : undefined,
          duration: executionTime,
          toolResultSummary,
          toolResultJson: result.success
            ? { text: result.text, isError: !!result.error }
            : undefined,
        },
      );
    } catch (auditError) {
      this.logger.warn(
        `[BankingToolProvider] Failed to log token chain: ${
          auditError instanceof Error ? auditError.message : String(auditError)
        }`,
      );
    }
  }

  clearSession(sessionId: string): void {
    this.chainIndexBySession.delete(sessionId);
  }

  private incrementChainIndex(sessionId: string): number {
    const current = this.chainIndexBySession.get(sessionId) || 0;
    const next = current + 1;

    if (
      !this.chainIndexBySession.has(sessionId) &&
      this.chainIndexBySession.size >= MAX_SESSION_CHAIN_ENTRIES
    ) {
      const oldestKey = this.chainIndexBySession.keys().next().value as string | undefined;
      if (oldestKey !== undefined) this.chainIndexBySession.delete(oldestKey);
    }

    this.chainIndexBySession.set(sessionId, next);
    return next;
  }
}
```

- [ ] **Step 5.4: Run new test to verify it passes**

Run: `npx jest tests/tools/TokenChainAuditor.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5.5: Update `BankingToolProvider.ts` to use the auditor**

1. Add import:
   ```typescript
   import { TokenChainAuditor } from './TokenChainAuditor';
   ```

2. Remove the now-unused imports of `UserTokenInfo`, `ExchangedTokenInfo`, `TokenChainExecutionResult` from `AuditLogger` (line 19 — keep only `AuditLogger` itself, which the provider still uses to construct the auditor).

3. Delete the `chainIndexBySession` field declaration (line 69).

4. Delete the `auditLogger` private field if it exists; or keep it but route through the auditor. Cleaner: delete the field, construct the AuditLogger inline when creating the auditor.

5. Add field after `jwtVerifier`:
   ```typescript
   private auditor: TokenChainAuditor;
   ```

6. In the constructor body, replace the `this.auditLogger = AuditLogger.getInstance(this.logger);` line (around line 79) with:
   ```typescript
   this.auditor = new TokenChainAuditor(
     AuditLogger.getInstance(this.logger),
     this.jwtVerifier,
     this.logger,
   );
   ```

7. Delete `incrementChainIndex` (lines 87-98 with doc comment).

8. Replace `clearSessionChainIndex` body (line 105) with:
   ```typescript
   clearSessionChainIndex(sessionId: string): void {
     this.auditor.clearSession(sessionId);
   }
   ```
   (Keep the public method — the spec preserves it even though grep showed no external callers; the regression-guard "do not silently revert load-bearing surface" rule applies.)

9. In `executeTool`, replace the entire audit block (lines 184-259 — everything from `// Log token chain audit event (D-03, D-04)` through the closing brace of the catch handler) with a single line:
   ```typescript
   await this.auditor.record({ toolName, tool, session, agentToken, result, executionTime });
   ```

   Place this line where line 184 currently is — directly after `const executionTime = Date.now() - startTime;` (line 181) and the success log (line 182).

- [ ] **Step 5.6: Build and run all tests**

Run:
```bash
npm run build
npm test
```
Expected: build exits 0. All tests pass. Test count = baseline + 5 + 7 + 6 + 6 = baseline + 24.

- [ ] **Step 5.7: Commit**

```bash
cd /Users/curtismuir/Development/banking
git add banking_mcp_server/src/tools/TokenChainAuditor.ts banking_mcp_server/tests/tools/TokenChainAuditor.test.ts banking_mcp_server/src/tools/BankingToolProvider.ts
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
refactor(mcp): extract TokenChainAuditor from BankingToolProvider

Step 5/7 of BankingToolProvider split (B1, Path 1). chainIndexBySession,
incrementChainIndex, MAX_SESSION_CHAIN_ENTRIES, and the 76-line inline
audit block in executeTool all move into TokenChainAuditor.record().
The try/catch swallow that previously lived in executeTool wraps
record()'s body — same semantics, fewer lines in the provider.
clearSessionChainIndex stays on the provider as a thin delegation
(preserves public surface).

No observable behavior change. Same chainIndex semantics, same FIFO
eviction at 1000 sessions, same UserTokenInfo/ExchangedTokenInfo
shapes, same audit-failure swallow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Extract per-tool handlers into `handlers/`

Largest mechanical move. Each of the eight current `private async executeX` methods becomes a top-level function in one of four handler files. Provider's `executeSpecificTool` becomes a registry lookup.

**Files:**
- Create: `banking_mcp_server/src/tools/handlers/accountHandlers.ts`
- Create: `banking_mcp_server/src/tools/handlers/transactionHandlers.ts`
- Create: `banking_mcp_server/src/tools/handlers/identityHandlers.ts`
- Create: `banking_mcp_server/src/tools/handlers/reasoningHandlers.ts`
- Create: `banking_mcp_server/src/tools/handlers/index.ts`
- Modify: `banking_mcp_server/src/tools/BankingToolProvider.ts` (delete all eight `executeX` private methods lines 555-839, 933-970; rewrite `executeSpecificTool` to use the handler map; delete `HITL_THRESHOLD_USD` line 63)

- [ ] **Step 6.1: Create `handlers/accountHandlers.ts`**

The bodies are line-for-line copies of `executeGetMyAccounts` (lines 557-591), `executeGetAccountBalance` (lines 596-611), and `executeGetSensitiveAccountDetails` (lines 799-839) with `this.apiClient` → `deps.apiClient`, `this.logger` → `deps.logger`, `this.createSuccessResult` → `createSuccessResult`, `this.createErrorResult` → `createErrorResult`.

```typescript
import type { HandlerFn, HandlerDeps } from './types';
import type { Account } from '../../interfaces/banking';
import { createSuccessResult, createErrorResult } from './results';
import type { BankingToolResult } from '../BankingToolProvider';

export const executeGetMyAccounts: HandlerFn = async (
  deps: HandlerDeps,
  userToken: string,
  params: { account_type?: string } = {},
): Promise<BankingToolResult> => {
  deps.logger.debug(`[BankingToolProvider] Calling Banking API: getMyAccounts`);
  let accounts = await deps.apiClient.getMyAccounts(userToken);

  if (accounts && accounts.length !== undefined) {
    deps.logger.debug(`[BankingToolProvider] Banking API response: Found ${accounts.length} accounts`);
  }

  if (params.account_type) {
    accounts = accounts.filter((a: Account) => a.accountType === params.account_type);
  }

  const response = {
    success: true,
    count: accounts.length,
    accounts: accounts.map((account: Account) => ({
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
      createdAt: account.createdAt,
    })),
  };

  return createSuccessResult(JSON.stringify(response, null, 2));
};

export const executeGetAccountBalance: HandlerFn = async (
  deps: HandlerDeps,
  userToken: string,
  params: { account_id: string },
): Promise<BankingToolResult> => {
  deps.logger.debug(
    `[BankingToolProvider] Calling Banking API: getAccountBalance for account ${params.account_id}`,
  );
  const balanceResponse = await deps.apiClient.getAccountBalance(userToken, params.account_id);
  deps.logger.debug(`[BankingToolProvider] Banking API response: Account balance retrieved`);

  const response = {
    success: true,
    accountId: params.account_id,
    balance: balanceResponse.balance,
  };

  return createSuccessResult(JSON.stringify(response, null, 2));
};

export const executeGetSensitiveAccountDetails: HandlerFn = async (
  deps: HandlerDeps,
  userToken: string,
  _params: unknown,
): Promise<BankingToolResult> => {
  deps.logger.debug(`[BankingToolProvider] Calling Banking API: getSensitiveAccountDetails`);
  try {
    const response = await deps.apiClient.getSensitiveAccountDetails(userToken);

    if (response && (response as any).ok === false && (response as any).step_up_required === true) {
      return createSuccessResult(
        JSON.stringify(
          {
            ok: false,
            step_up_required: true,
            error: 'step_up_required',
            step_up_method: (response as any).step_up_method || 'email',
          },
          null,
          2,
        ),
      );
    }

    if (response && (response as any).ok === false && (response as any).consent_required) {
      return createSuccessResult(
        JSON.stringify(
          {
            ok: false,
            consent_required: true,
            reason: (response as any).reason || 'sensitive_data_access',
          },
          null,
          2,
        ),
      );
    }

    if (!response || (response as any).ok === false) {
      return createErrorResult(`Access denied: ${(response as any)?.reason || 'paz_denied'}`);
    }

    return createSuccessResult(
      JSON.stringify(
        {
          success: true,
          accounts: (response as any).accounts || [],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    deps.logger.error(
      '[BankingToolProvider] getSensitiveAccountDetails error:',
      {},
      error instanceof Error ? error : undefined,
    );
    return createErrorResult(
      `Failed to retrieve sensitive account details: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
};
```

- [ ] **Step 6.2: Create `handlers/transactionHandlers.ts`**

Bodies copy `executeGetMyTransactions` (lines 616-643), `executeCreateDeposit` (lines 648-682), `executeCreateWithdrawal` (lines 687-719), and `executeCreateTransfer` (lines 724-763). Each transactional handler imports `mapTransactionError` for its error-handling branch.

```typescript
import type { HandlerFn, HandlerDeps } from './types';
import { BankingAPIError } from '../../interfaces/banking';
import { createSuccessResult, createErrorResult } from './results';
import { mapTransactionError } from '../TransactionErrorMapper';
import type { BankingToolResult } from '../BankingToolProvider';

export const executeGetMyTransactions: HandlerFn = async (
  deps: HandlerDeps,
  userToken: string,
  params?: { limit?: number },
): Promise<BankingToolResult> => {
  let transactions = await deps.apiClient.getMyTransactions(userToken);
  if (params?.limit && params.limit > 0) {
    transactions = transactions.slice(0, params.limit);
  }

  if (!Array.isArray(transactions)) {
    deps.logger.warn(`[BankingToolProvider] Expected transactions array, got: ${typeof transactions}`);
    return createErrorResult(
      `Invalid response format from banking API (received: ${typeof transactions})`,
    );
  }

  const response = {
    success: true,
    count: transactions.length,
    transactions: transactions.map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      amount: transaction.amount,
      date: transaction.createdAt,
      fromAccountId: transaction.fromAccountId || null,
      toAccountId: transaction.toAccountId || null,
      description: transaction.description || null,
    })),
  };

  return createSuccessResult(JSON.stringify(response, null, 2));
};

export const executeCreateDeposit: HandlerFn = async (
  deps: HandlerDeps,
  userToken: string,
  params: { to_account_id: string; amount: number; description?: string },
): Promise<BankingToolResult> => {
  deps.logger.info(
    `[BankingToolProvider] Calling Banking API: createDeposit - Amount: ${params.amount}, Account: ${params.to_account_id}`,
  );
  try {
    const response = await deps.apiClient.createDeposit(
      userToken,
      params.to_account_id,
      params.amount,
      params.description,
    );
    deps.logger.info(`[BankingToolProvider] Banking API response: Deposit successful`);

    const result = {
      success: true,
      operation: 'deposit',
      message: response.message,
      transaction: response.transaction
        ? {
            id: response.transaction.id,
            amount: params.amount,
            toAccountId: params.to_account_id,
            description: params.description || null,
          }
        : null,
      amount: params.amount,
      accountId: params.to_account_id,
    };

    return createSuccessResult(JSON.stringify(result, null, 2));
  } catch (error) {
    const handled = mapTransactionError(error, 'deposit', params.amount);
    if (handled) return handled;
    throw error;
  }
};

export const executeCreateWithdrawal: HandlerFn = async (
  deps: HandlerDeps,
  userToken: string,
  params: { from_account_id: string; amount: number; description?: string },
): Promise<BankingToolResult> => {
  try {
    const response = await deps.apiClient.createWithdrawal(
      userToken,
      params.from_account_id,
      params.amount,
      params.description,
    );

    const result = {
      success: true,
      operation: 'withdrawal',
      message: response.message,
      transaction: response.transaction
        ? {
            id: response.transaction.id,
            amount: params.amount,
            fromAccountId: params.from_account_id,
            description: params.description || null,
          }
        : null,
      amount: params.amount,
      accountId: params.from_account_id,
    };

    return createSuccessResult(JSON.stringify(result, null, 2));
  } catch (error) {
    const handled = mapTransactionError(error, 'withdrawal', params.amount);
    if (handled) return handled;
    throw error;
  }
};

export const executeCreateTransfer: HandlerFn = async (
  deps: HandlerDeps,
  userToken: string,
  params: { from_account_id: string; to_account_id: string; amount: number; description?: string },
): Promise<BankingToolResult> => {
  try {
    const response = await deps.apiClient.createTransfer(
      userToken,
      params.from_account_id,
      params.to_account_id,
      params.amount,
      params.description,
    );

    const result = {
      success: true,
      operation: 'transfer',
      message: response.message,
      withdrawalTransaction: response.withdrawalTransaction
        ? {
            id: response.withdrawalTransaction.id,
            amount: params.amount,
            fromAccountId: params.from_account_id,
          }
        : null,
      depositTransaction: response.depositTransaction
        ? {
            id: response.depositTransaction.id,
            amount: params.amount,
            toAccountId: params.to_account_id,
          }
        : null,
      amount: params.amount,
      fromAccountId: params.from_account_id,
      toAccountId: params.to_account_id,
      description: params.description || null,
    };

    return createSuccessResult(JSON.stringify(result, null, 2));
  } catch (error) {
    const handled = mapTransactionError(error, 'transfer', params.amount);
    if (handled) return handled;
    throw error;
  }
};
```

- [ ] **Step 6.3: Create `handlers/identityHandlers.ts`**

Body copies `executeQueryUserByEmail` (lines 768-791).

```typescript
import type { HandlerFn, HandlerDeps } from './types';
import { BankingAPIError } from '../../interfaces/banking';
import { createSuccessResult } from './results';
import type { BankingToolResult } from '../BankingToolProvider';

export const executeQueryUserByEmail: HandlerFn = async (
  deps: HandlerDeps,
  userToken: string,
  params: { email: string },
): Promise<BankingToolResult> => {
  try {
    deps.logger.debug(`[BankingToolProvider] Calling Banking API: queryUserByEmail`);
    const response = await deps.apiClient.queryUserByEmail(userToken, params.email);
    deps.logger.debug(`[BankingToolProvider] Banking API response: queryUserByEmail completed`);
    return createSuccessResult(JSON.stringify(response, null, 2));
  } catch (error) {
    if (error instanceof BankingAPIError && error.statusCode === 404) {
      return createSuccessResult(
        JSON.stringify({ exists: false, email: params.email, error: 'User not found' }, null, 2),
      );
    }
    throw error;
  }
};
```

- [ ] **Step 6.4: Create `handlers/reasoningHandlers.ts`**

Body copies `executeSequentialThink` (lines 937-970).

```typescript
import type { HandlerFn, HandlerDeps } from './types';
import { createSuccessResult } from './results';
import type { BankingToolResult } from '../BankingToolProvider';

export const executeSequentialThink: HandlerFn = async (
  deps: HandlerDeps,
  _token: string,
  params: { query: string; context?: string },
): Promise<BankingToolResult> => {
  const { query, context: ctx } = params;

  const steps: Array<{ title: string; description: string }> = [
    {
      title: 'Understand the request',
      description: `Parsing: "${query}"${ctx ? `. Additional context: ${ctx}` : ''}.`,
    },
    {
      title: 'Identify relevant factors',
      description:
        'Considering account balances, transaction history, applicable limits, and user goals.',
    },
    {
      title: 'Evaluate options',
      description:
        'Weighing the available actions against constraints: authorization scopes, daily limits, and account eligibility.',
    },
    {
      title: 'Assess risk and impact',
      description:
        'Checking for potential issues: insufficient funds, scope requirements, consent gates, or regulatory flags.',
    },
    {
      title: 'Formulate recommendation',
      description:
        'Based on analysis, selecting the most appropriate approach that satisfies the request safely.',
    },
  ];

  const conclusion = `Analysis complete for: "${query}". Proceeding with recommended approach.`;
  const result = { steps, conclusion };
  deps.logger.debug(
    `[BankingToolProvider] sequential_think completed: ${steps.length} steps for query: "${query.slice(0, 60)}"`,
  );

  return createSuccessResult(JSON.stringify(result, null, 2));
};
```

- [ ] **Step 6.5: Create `handlers/index.ts`**

```typescript
import {
  executeGetMyAccounts,
  executeGetAccountBalance,
  executeGetSensitiveAccountDetails,
} from './accountHandlers';
import {
  executeGetMyTransactions,
  executeCreateDeposit,
  executeCreateWithdrawal,
  executeCreateTransfer,
} from './transactionHandlers';
import { executeQueryUserByEmail } from './identityHandlers';
import { executeSequentialThink } from './reasoningHandlers';
import type { HandlerFn } from './types';

export const handlerMap: Record<string, HandlerFn> = {
  executeGetMyAccounts,
  executeGetAccountBalance,
  executeGetMyTransactions,
  executeCreateDeposit,
  executeCreateWithdrawal,
  executeCreateTransfer,
  executeQueryUserByEmail,
  executeGetSensitiveAccountDetails,
  executeSequentialThink,
};

export type { HandlerFn, HandlerDeps } from './types';
```

- [ ] **Step 6.6: Update `BankingToolProvider.ts` to dispatch via the handler map**

1. Add imports:
   ```typescript
   import { handlerMap, HandlerDeps } from './handlers';
   ```

2. Remove now-unused imports: `Account` from interfaces/banking (line 17 — used only in handler bodies), `HttpTraceEntry` if no longer referenced in the provider's own code (keep if `BankingToolResult` still types it — verify by grep), `tokenCache` (already removed in Task 3), `getScopesForTool` (already removed in Task 3). After Task 5, also remove `UserTokenInfo`, `ExchangedTokenInfo`, `TokenChainExecutionResult`.

3. Delete the `HITL_THRESHOLD_USD` constant (line 63) — now lives only in `TransactionErrorMapper.ts`.

4. Add a class field:
   ```typescript
   private handlerDeps: HandlerDeps;
   ```

5. In the constructor body:
   ```typescript
   this.handlerDeps = { apiClient: this.apiClient, logger: this.logger };
   ```

6. Rewrite `executeSpecificTool` (lines 360-552) — rename to `dispatch` for clarity, but keep the old name as a thin wrapper if any test exercises it (grep first: `grep -n executeSpecificTool tests/`). Default: rename to `dispatch`, since it's a private method.

   ```typescript
   private async dispatch(
     tool: BankingToolDefinition,
     context: ToolExecutionContext,
     agentToken?: string,
   ): Promise<BankingToolResult> {
     // No-auth tools: skip token resolution entirely
     if (!tool.requiresUserAuth) {
       if (tool.handler === 'executeQueryUserByEmail' && !agentToken) {
         return this.createErrorResult(
           'query_user_by_email requires an agent-delegated token; no agentToken was provided in this request.',
         );
       }
       const handler = handlerMap[tool.handler];
       if (!handler) {
         return this.createErrorResult(`Unknown non-auth tool handler: ${tool.handler}`);
       }
       // For no-auth handlers that ignore the token (e.g. sequentialThink) we pass ''.
       // For executeQueryUserByEmail the guard above ensures agentToken is defined.
       return await handler(this.handlerDeps, agentToken ?? '', context.params);
     }

     // Auth tools: resolve token, optionally verify claims, then dispatch
     const { token } = await this.tokenResolver.resolve(context.session, tool, agentToken);
     if (this.jwtVerifier.isSensitiveHandler(tool.handler)) {
       await this.jwtVerifier.assertClaims(token, tool.name);
     }
     const handler = handlerMap[tool.handler];
     if (!handler) {
       return this.createErrorResult(`Unknown tool handler: ${tool.handler}`);
     }
     return await handler(this.handlerDeps, token, context.params);
   }
   ```

7. Update the one call to `executeSpecificTool` inside `executeTool` (line 178) — change to `this.dispatch(tool, context, agentToken)`.

8. Delete all eight private execute methods:
   - `executeGetMyAccounts` (lines 557-591)
   - `executeGetAccountBalance` (lines 596-611)
   - `executeGetMyTransactions` (lines 616-643)
   - `executeCreateDeposit` (lines 648-682)
   - `executeCreateWithdrawal` (lines 687-719)
   - `executeCreateTransfer` (lines 724-763)
   - `executeQueryUserByEmail` (lines 768-791)
   - `executeGetSensitiveAccountDetails` (lines 799-839)
   - `executeSequentialThink` (lines 937-970)

9. Update `createErrorResult` to drop the `_originalRequest` parameter (it's unused — the doc comment on lines 985-989 confirms it's intentionally not echoed):
   ```typescript
   private createErrorResult(error: string): BankingToolResult {
     return { type: 'text', text: `Error: ${error}`, success: false, error };
   }
   ```
   Update internal call sites in this file accordingly (they were already passing nothing or a `params` arg that gets dropped — search and remove the second arg).

- [ ] **Step 6.7: Build and run all tests**

Run:
```bash
npm run build
npm test
```
Expected: build exits 0. All tests pass. Test count = baseline + 24 (no new test suites in this task — handler extractions are mechanical and covered by the existing integration tests).

If `BankingToolProvider.test.ts` breaks: examine why. Most likely it mocked `BankingAPIClient` methods that the new handler functions now call through `deps.apiClient`. Same calls, same mocks, same expectations — should work without edits. If it does break, the failure tells us a behavior drift exists; fix it before continuing.

- [ ] **Step 6.8: Commit**

```bash
cd /Users/curtismuir/Development/banking
git add banking_mcp_server/src/tools/handlers/ banking_mcp_server/src/tools/BankingToolProvider.ts
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
refactor(mcp): extract per-tool handlers into handlers/

Step 6/7 of BankingToolProvider split (B1, Path 1). Each of the eight
private executeX methods on BankingToolProvider becomes a top-level
async function exported from one of accountHandlers /
transactionHandlers / identityHandlers / reasoningHandlers. The
executeSpecificTool switch is replaced by handlerMap lookup in a new
dispatch() method.

No observable behavior change. Same per-tool response JSON, same log
strings, same error paths, same mapTransactionError integration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final cleanup of `BankingToolProvider.ts`

Polish the now-thin provider: extract `handleExecutionError`, remove dead imports, tidy doc comments. After this step the file is ~250 lines.

**Files:**
- Modify: `banking_mcp_server/src/tools/BankingToolProvider.ts`

- [ ] **Step 7.1: Extract `handleExecutionError`**

The `catch (error)` block in `executeTool` (currently lines ~265-294 after Task 5's audit-block deletion) has grown to 30 lines of error-shape decisions. Extract to a private method:

```typescript
private async handleExecutionError(
  error: unknown,
  toolName: string,
  params: Record<string, any>,
  session: Session,
): Promise<BankingToolResult> {
  const errorTrace = this.apiClient.stopTrace();
  this.logger.error(
    `[BankingToolProvider] Error executing tool ${toolName}:`,
    {},
    error instanceof Error ? error : undefined,
  );

  const attachTrace = (r: BankingToolResult): BankingToolResult => {
    if (errorTrace.length > 0) r.httpTrace = errorTrace;
    return r;
  };

  if (error instanceof AuthenticationError) {
    this.logger.warn(`[BankingToolProvider] Authentication error for ${toolName}: ${error.message}`);
    if (error.code === AuthErrorCodes.USER_AUTHORIZATION_REQUIRED && error.authorizationUrl) {
      const challenge = await this.authChallengeHandler.generateAuthorizationChallenge(
        session.sessionId,
        error.requiredScopes || [],
      );
      return this.createAuthChallengeResult(challenge);
    }
    return attachTrace(this.createErrorResult(`Authentication error: ${error.message}`));
  }

  if (error instanceof BankingAPIError) {
    this.logger.warn(`[BankingToolProvider] Banking API error for ${toolName}: ${error.message}`);
    return attachTrace(this.createErrorResult(`Banking API error: ${error.message}`));
  }

  return attachTrace(
    this.createErrorResult(
      `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    ),
  );
}
```

In `executeTool`, replace the entire `} catch (error) { ... }` body with:
```typescript
} catch (error) {
  return this.handleExecutionError(error, toolName, params, session);
}
```

- [ ] **Step 7.2: Sweep unused imports**

Open `BankingToolProvider.ts`. Remove imports no longer referenced in the file body. Likely candidates after the previous tasks:
- `BankingAPIClient` — still needed (constructor arg + `apiClient.startTrace/stopTrace`)
- `HttpTraceEntry` — still needed (typed in `BankingToolResult`)
- `BankingAuthenticationManager` — still needed (constructor arg, used by `tokenResolver`)
- `BankingSessionManager` — still needed (constructor arg, used in `executeTool` for re-fetch)
- `BankingToolRegistry` — still needed (`BankingToolRegistry.getTool` in `executeTool`, `BankingToolRegistry.getAllTools` in `getAvailableTools`)
- `BankingToolValidator` — still needed
- `AuthorizationChallengeHandler` — still needed
- `Account` — **remove** (handlers own this)
- `TokenExchangeService` — still needed (constructor arg)
- `AuditLogger` — still needed (constructed inline when building `TokenChainAuditor`)
- `Logger` + `createDefaultLoggerConfig` — still needed
- `tokenCache` — already removed in Task 3
- `getScopesForTool` — already removed in Task 3
- `createRemoteJWKSet`, `jwtVerify` from jose — already removed in Task 4
- `TokenExchangeRequest` — already removed in Task 3
- `UserTokenInfo`, `ExchangedTokenInfo`, `TokenChainExecutionResult` from AuditLogger — already removed in Task 5

Run:
```bash
npx tsc --noEmit
```
Expected: zero "is declared but its value is never read" warnings on this file. If any appear, delete those imports.

- [ ] **Step 7.3: Verify final file size**

Run:
```bash
wc -l banking_mcp_server/src/tools/BankingToolProvider.ts
```
Expected: between 220 and 300 lines. (Spec target: ~250.) If significantly outside that range, re-inspect for dead code.

- [ ] **Step 7.4: Final full build + full test suite**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server
npm run build 2>&1 | tee /tmp/final-build.log
npm test 2>&1 | tee /tmp/final-tests.log
echo "exit=$?"
```
Expected: build exits 0. Tests exit 0. Compare against `/tmp/baseline-*`: same pre-existing-test pass count plus 24 new tests from Tasks 2-5.

- [ ] **Step 7.5: Run the repo-wide test suite**

Run:
```bash
cd /Users/curtismuir/Development/banking
npm test
```
Expected: exits 0. Confirms no consumer of `BankingToolProvider` (BFF, gateway, integration tests in other packages) breaks.

- [ ] **Step 7.6: Commit**

```bash
cd /Users/curtismuir/Development/banking
git add banking_mcp_server/src/tools/BankingToolProvider.ts
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
refactor(mcp): final cleanup of BankingToolProvider (now ~250 lines)

Step 7/7 of BankingToolProvider split (B1, Path 1). Extracts the
catch-block error-shape logic into a private handleExecutionError
method and sweeps imports left dead by the previous six commits. The
provider is now a thin orchestrator: validate → auth-challenge →
resolve-token → verify-claims → dispatch → audit → error-handle.

No observable behavior change. Same constructor, same executeTool
signature, same BankingToolResult shape. The seven-commit refactor is
complete.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Post-flight

- [ ] **Run the regression-plan-§1 mental checklist:**
  - OAuth flow unchanged? Confirm `oauthStatus` tests pass.
  - HITL gate unchanged? Confirm `hitlRoute` tests pass.
  - MCP token chain still emits `act` when agentToken present? Confirm via:
    ```bash
    npx jest tests/integration/mcp-protocol.integration.test.ts -t 'token chain'
    ```
  - `clearSessionChainIndex` still callable on the provider? Confirm via:
    ```bash
    grep -n clearSessionChainIndex banking_mcp_server/src/tools/BankingToolProvider.ts
    ```
    Expected: one match (the public method).

- [ ] **Update CHANGELOG.md** if the project enforces it (pre-commit hook on Step 1.5 warned about this). Add one line under `[Unreleased] → Changed`:
  ```
  - banking_mcp_server: refactor BankingToolProvider into focused peer modules
  ```

- [ ] **Spot-check the final shape** — open `BankingToolProvider.ts` and confirm the only methods on the class are:
  - constructor
  - `executeTool` (public)
  - `dispatch` (private)
  - `handleExecutionError` (private)
  - `getAvailableTools` / `getAvailableToolsForToken` (public)
  - `handleAuthorizationCode` / `checkReauthorizationNeeded` (public)
  - `clearSessionChainIndex` (public)
  - `createSuccessResult` / `createErrorResult` / `createAuthChallengeResult` (private)

  If any other private method survived, it's a leftover from one of the extractions — delete it.

---

## What is explicitly out of scope for this plan

- Touching `BankingToolRegistry.ts` (489 lines — deferred to a future Approach C spec).
- Touching `BankingSessionManager.ts`, `types/validation.ts`, or any other oversized file.
- Changing `BankingToolProvider`'s constructor or public-method signatures.
- Changing `tokenCache` eviction semantics or scope-narrowing rules.
- Promoting `STRICT_TOKEN_VERIFICATION` default to `true`.
- Promoting the dev/test passthrough fallback to a hard error in development.
- Adding per-handler unit tests (the integration suite covers them; minimal-diff principle).
