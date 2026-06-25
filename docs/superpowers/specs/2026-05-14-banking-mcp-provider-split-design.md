# BankingToolProvider Split — Design

**Date:** 2026-05-14
**Status:** Implemented (2026-05-15) — shipped across 7 commits `ff17d581`→`d15d54dd` on branch `refactor/mcp-provider-split`. Spec-vs-implementation audit passed: zero behavior drift, build 0, 110/110 tests green.
**Scope:** Refactor `banking_mcp_server/src/tools/BankingToolProvider.ts` (1124 lines) into a thin orchestrator (~355 lines as built; original target ~250 — see "New BankingToolProvider shape" for why the boundary lands higher) plus focused peer modules. No behavior change.
**Out of scope:** `BankingToolRegistry.ts` merge (Approach C — deferred to a follow-up spec); all other oversized files in the repo.

---

## Goal

`BankingToolProvider.ts` has grown to 1124 lines and now does seven distinct things: orchestration, token resolution, JWT verification, per-tool handlers, transactional error mapping, audit/chain tracking, and result shaping. Adding a new tool requires editing a mega-class; reading any one path requires holding the other six in mind.

Split it so each module has one job. Keep the public surface unchanged.

## Non-goals

- Change `BankingToolProvider`'s constructor or public-method signatures.
- Change `BankingToolResult` shape, error messages, log strings, or log levels.
- Change `tokenCache` keys or eviction semantics.
- Change env-var reads (`BANKING_API_RESOURCE_URI`, `STRICT_TOKEN_VERIFICATION`, `NODE_ENV`, `PINGONE_JWKS_URI` / `PINGONE_ISSUER` / `PINGONE_BASE_URL`, `HITL_THRESHOLD_USD`).
- Merge `BankingToolRegistry.ts` with handlers (Approach C — separate follow-up spec).
- Convert handlers to `ToolHandler` interface objects (Approach B2 — deferred).
- Touch other oversized files (`BankingSessionManager.ts`, `types/validation.ts`, `ErrorHandler.ts`, `AuditLogger.ts`, `HealthMonitor.ts`).
- Promote any current fail-open / dev-passthrough behavior to a hard error.

## Decisions already made during brainstorming

| Decision | Choice | Reason |
|---|---|---|
| Target file | `BankingToolProvider.ts` only | Biggest file, most-edited (new tools land here), splitting it cleanly teaches the boundary pattern for sibling refactors. |
| Approach | **B** — extract resolver + verifier + error mapper + auditor + per-tool handlers | A leaves ~870 lines mixed; C bleeds into the registry refactor we explicitly deferred. |
| Handler shape | **B1** — free functions, not objects | Smallest diff. If Approach C is greenlit later, function-to-object conversion is mechanical. |
| Path | **Path 1** — ship B1 now; do C as a follow-up spec | Each PR is independently reviewable and independently revertable. |

---

## File layout

Target structure under `banking_mcp_server/src/tools/`:

```
tools/
├── BankingToolProvider.ts         (1124 → ~250 lines: orchestration only)
├── BankingToolRegistry.ts         (unchanged — 489 lines, deferred to a future spec)
├── BankingToolValidator.ts        (unchanged — 233 lines)
├── AuthorizationChallengeHandler.ts (unchanged — 342 lines)
├── toolScopeMap.ts                (unchanged — 62 lines)
├── index.ts                       (unchanged barrel)
│
├── TokenResolver.ts               (NEW — ~170 lines)
├── JwtClaimVerifier.ts            (NEW — ~85 lines)
├── TransactionErrorMapper.ts      (NEW — ~95 lines)
├── TokenChainAuditor.ts           (NEW — ~95 lines)
│
└── handlers/                      (NEW directory)
    ├── index.ts                   (~25 lines — builds the handler map)
    ├── types.ts                   (~20 lines — HandlerDeps + HandlerFn types)
    ├── results.ts                 (~15 lines — shared createSuccessResult / createErrorResult)
    ├── accountHandlers.ts         (~75 lines — getMyAccounts, getAccountBalance, getSensitiveAccountDetails)
    ├── transactionHandlers.ts     (~140 lines — createDeposit, createWithdrawal, createTransfer, getMyTransactions)
    ├── identityHandlers.ts        (~30 lines — queryUserByEmail)
    └── reasoningHandlers.ts       (~40 lines — sequentialThink)
```

**Net change:** 1 modified file (`BankingToolProvider.ts`), 11 new files, 1 new subdirectory. No file deletions. `tools/index.ts` barrel exports unchanged — consumers of `BankingToolProvider` keep working without edits.

**Naming convention:** extracted services keep PascalCase to match existing peers (`BankingToolValidator`, `AuthorizationChallengeHandler`). Handler files are camelCase + lowercase folder because they export plain functions, not classes.

---

## Module contracts

### `TokenResolver.ts`

**Purpose:** decide which bearer token the banking API call should use. Encapsulates the four paths currently tangled in `executeSpecificTool` lines 391–510.

```typescript
export interface TokenResolverDeps {
  authManager: BankingAuthenticationManager;
  tokenExchangeService?: TokenExchangeService;
  logger: Logger;
}

export interface TokenResolution {
  token: string;
  source: 'agent-passthrough' | 'agent-step9-exchange' | 'user-rfc8693-exchange' | 'user-passthrough-noexchange';
}

export class TokenResolver {
  constructor(private deps: TokenResolverDeps) {}
  async resolve(session: Session, tool: BankingToolDefinition, agentToken?: string): Promise<TokenResolution>;
}
```

The four `source` values map 1:1 to the four paths in today's code:
- `agent-passthrough` — `agentToken` present, no `BANKING_API_RESOURCE_URI` configured (backward-compat path, today's line 431-432)
- `agent-step9-exchange` — `agentToken` present, `tokenExchangeService` and `BANKING_API_RESOURCE_URI` configured (today's Step-9 block, lines 400-428)
- `user-rfc8693-exchange` — no `agentToken`, `tokenExchangeService` configured (today's lines 446-495)
- `user-passthrough-noexchange` — no `agentToken`, no `tokenExchangeService` (today's lines 496-509). **Unconditional passthrough of the session user token in ALL environments — it does NOT throw in production.** Verified against pre-refactor source (`git show ff17d581~1:BankingToolProvider.ts` lines 496-500): the original code had no `NODE_ENV` guard. The `source` value is named `-noexchange` (not `-devtest`) to reflect that the discriminator is the absence of a token-exchange service, not an env check. (An earlier draft of this spec incorrectly described this path as dev/test-gated with a prod throw; the Non-goal "do not promote the dev/test passthrough fallback to a hard error" is the correct intent and is preserved.)

The `tokenCache` import moves from `BankingToolProvider` into `TokenResolver` (the cache is part of "resolving a token"). The `getUserTokenForScopes` helper (today's lines 1101-1124) moves in as a private method. Throws `AuthenticationError` and `Error` exactly as today — no exception type changes.

### `JwtClaimVerifier.ts`

**Purpose:** JWKS key-set memo, JWT payload decoding, claim assertion (`exp`/`iss`/`aud`), and JWKS signature verification. Owns the `SENSITIVE_HANDLERS` set.

```typescript
export class JwtClaimVerifier {
  constructor(private logger: Logger) {}

  isSensitiveHandler(handlerName: string): boolean;
  decodePayload(token: string): Record<string, unknown> | null;
  async assertClaims(token: string, toolName: string): Promise<void>;
}
```

`SENSITIVE_HANDLERS` (today's lines 514-519), `_jwksKeySet` (becomes an instance field — see Risks for the lifetime tradeoff), `getJwksKeySet()` helper, `decodeJwtPayload()` (today's lines 1023-1031), and `assertTokenClaims()` (today's lines 1037-1096) all move here. `STRICT_TOKEN_VERIFICATION` env read stays inside `assertClaims`.

### `TransactionErrorMapper.ts`

**Purpose:** pure function. The 90-line `handleTransactionBankingError` (today's lines 850-931) becomes a top-level exported function plus its three private formatters.

```typescript
export type TransactionOperation = 'deposit' | 'withdrawal' | 'transfer';

export function mapTransactionError(
  error: unknown,
  operation: TransactionOperation,
  amount: number,
): BankingToolResult | null;
```

No class — there is no state. The three `console.log` debug lines (preserved verbatim — they are observable behavior used during debugging) and `HITL_THRESHOLD_USD` constant move with it. Returns `null` for non-recognised errors so the caller re-throws, matching today's contract.

### `TokenChainAuditor.ts`

**Purpose:** owns the per-session chain index and the audit logging call.

```typescript
export class TokenChainAuditor {
  constructor(
    private auditLogger: AuditLogger,
    private jwtVerifier: JwtClaimVerifier,
    private logger: Logger,
  ) {}

  async record(args: {
    toolName: string;
    tool: BankingToolDefinition;
    session: Session;
    agentToken?: string;
    result: BankingToolResult;
    executionTime: number;
  }): Promise<void>;

  clearSession(sessionId: string): void;
}
```

`MAX_SESSION_CHAIN_ENTRIES` (today's line 60), `chainIndexBySession` map, `incrementChainIndex()` (today's lines 87-98), `clearSessionChainIndex()` (today's lines 104-106), and the audit-logger call block (today's lines 184-259) all move here. The `try/catch` that swallows audit failures (today's lines 256-259) moves *inside* `record()` so the provider does not need its own. JWT payload decoding for the audit info objects is delegated to `jwtVerifier.decodePayload(...)` — one method, one home.

### `handlers/types.ts`

```typescript
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

### `handlers/results.ts`

```typescript
export function createSuccessResult(text: string): BankingToolResult;
export function createErrorResult(error: string): BankingToolResult;
```

Shared by every handler file and by `BankingToolProvider`. The `_originalRequest` parameter in today's `createErrorResult` is dropped because it is already unused at every call site (lines 986-996 comment confirms it is intentionally not echoed).

### `handlers/index.ts`

Single export — the registry the provider dispatches against:

```typescript
import { executeGetMyAccounts, executeGetAccountBalance, executeGetSensitiveAccountDetails } from './accountHandlers';
import { executeGetMyTransactions, executeCreateDeposit, executeCreateWithdrawal, executeCreateTransfer } from './transactionHandlers';
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
```

### `handlers/{account,transaction,identity,reasoning}Handlers.ts`

Each tool's current `private async executeX(token, params)` method becomes a top-level `async function executeX(deps, token, params)`. Bodies are line-for-line identical to today, except:
- `this.apiClient` → `deps.apiClient`
- `this.logger` → `deps.logger`
- `this.createSuccessResult(...)` / `this.createErrorResult(...)` → imported from `handlers/results.ts`
- `this.handleTransactionBankingError(...)` → imported `mapTransactionError` from `TransactionErrorMapper.ts`

`createAuthChallengeResult` stays on the provider — only the orchestration path produces auth challenges.

---

## New `BankingToolProvider` shape

> **As-built note (2026-05-15):** the provider landed at **355 lines**, not the ~250 estimate. The
> ~105-line delta is legitimately orchestration and was always intended to stay per the
> "Methods that stay on the provider" table below: `handleExecutionError` (~38 lines, the extracted
> `catch` block — error-shape decisions + trace attachment are orchestration concerns),
> `handleAuthorizationCode`, the `tools/list` methods, and per-method JSDoc. The audit confirmed no
> handler/resolver/verifier/audit logic leaked back in — `executeSpecificTool` delegates cleanly to
> `tokenResolver` / `jwtVerifier` / `handlerMap`. The ~250 estimate was optimistic; the boundary is
> correct.

### Constructor (signature unchanged)

```typescript
constructor(
  private apiClient: BankingAPIClient,
  private authManager: BankingAuthenticationManager,
  private sessionManager: BankingSessionManager,
  private tokenExchangeService?: TokenExchangeService,
) {
  this.logger = Logger.getInstance(createDefaultLoggerConfig());
  this.authChallengeHandler = new AuthorizationChallengeHandler(authManager, sessionManager);
  this.tokenResolver = new TokenResolver({ authManager, tokenExchangeService, logger: this.logger });
  this.jwtVerifier = new JwtClaimVerifier(this.logger);
  this.auditor = new TokenChainAuditor(AuditLogger.getInstance(this.logger), this.jwtVerifier, this.logger);
  this.handlerDeps = { apiClient, logger: this.logger };
}
```

### `executeTool` (orchestration only)

```typescript
async executeTool(toolName, params, session, agentToken?): Promise<BankingToolResult> {
  const startTime = Date.now();
  try {
    const tool = BankingToolRegistry.getTool(toolName);
    if (!tool) return this.createErrorResult(`Unknown tool: ${toolName}`);

    const paramValidation = BankingToolValidator.validateToolParams(toolName, params);
    if (!paramValidation.isValid) return this.createErrorResult(`Invalid parameters: ${paramValidation.errors.join(', ')}`);

    // Auth challenge gate
    if (tool.requiresUserAuth && tool.requiredScopes.length > 0 && !agentToken) {
      const challengeResult = await this.authChallengeHandler.detectAuthorizationChallenge(session, tool.requiredScopes);
      if (challengeResult.challengeNeeded) return this.createAuthChallengeResult(challengeResult.challenge!);
      const refreshed = await this.sessionManager.getSession(session.sessionId);
      if (refreshed) session = refreshed;
    }

    // Dispatch
    this.apiClient.startTrace();
    const result = await this.dispatch(tool, session, paramValidation.sanitizedParams!, agentToken);
    result.httpTrace = this.apiClient.stopTrace();

    // Audit (best-effort, never blocks)
    await this.auditor.record({ toolName, tool, session, agentToken, result, executionTime: Date.now() - startTime });
    return result;

  } catch (error) {
    return this.handleExecutionError(error, toolName, params, session);
  }
}
```

### `dispatch` (replaces `executeSpecificTool`)

```typescript
private async dispatch(tool, session, params, agentToken?): Promise<BankingToolResult> {
  // No-auth tools: skip token resolution entirely
  if (!tool.requiresUserAuth) {
    if (tool.handler === 'executeQueryUserByEmail' && !agentToken) {
      return this.createErrorResult('query_user_by_email requires an agent-delegated token; no agentToken was provided in this request.');
    }
    const handler = handlerMap[tool.handler];
    if (!handler) return this.createErrorResult(`Unknown non-auth tool handler: ${tool.handler}`);
    // For no-auth tools that ignore the token arg (e.g. sequentialThink) we pass `''`.
    // For executeQueryUserByEmail the guard above ensures agentToken is defined.
    return await handler(this.handlerDeps, agentToken ?? '', params);
  }

  // Auth tools: resolve token, optionally verify claims, then dispatch
  const { token } = await this.tokenResolver.resolve(session, tool, agentToken);
  if (this.jwtVerifier.isSensitiveHandler(tool.handler)) {
    await this.jwtVerifier.assertClaims(token, tool.name);
  }
  const handler = handlerMap[tool.handler];
  if (!handler) return this.createErrorResult(`Unknown tool handler: ${tool.handler}`);
  return await handler(this.handlerDeps, token, params);
}
```

### Methods that stay on the provider

| Method | Reason |
|---|---|
| `executeTool` | Public entry point — the orchestration pipeline |
| `dispatch` (renamed from `executeSpecificTool`) | Branches on `requiresUserAuth`, calls resolver + verifier — orchestration glue |
| `handleExecutionError` (new private, extracted from today's `catch (error)` block lines 263-294) | Error shape decisions are orchestration concerns; calls `apiClient.stopTrace()` and attaches the trace |
| `getAvailableTools` / `getAvailableToolsForToken` | Public API for `tools/list` |
| `handleAuthorizationCode` / `checkReauthorizationNeeded` | Public API — unchanged |
| `clearSessionChainIndex` | Delegates to `this.auditor.clearSession(...)` — caller signature preserved (`BankingSessionManager` calls this) |
| `createAuthChallengeResult` | Only the orchestration path generates auth challenges |
| `createSuccessResult` / `createErrorResult` | Provider also produces results in error/challenge paths; imports from `handlers/results.ts` instead of duplicating |

### Where each piece of `executeTool`'s removed logic lands

| Removed logic | New owner | Called from |
|---|---|---|
| Build `UserTokenInfo` / `ExchangedTokenInfo` (today's lines 188-227) | `TokenChainAuditor.record()` builds them internally | `executeTool` calls `auditor.record(...)` once after dispatch |
| Increment chain index (today's lines 87-98 + line 186) | `TokenChainAuditor` (private) | Inside `auditor.record(...)` |
| Decode JWT (today's lines 1023-1031 + line 195-196 call) | `JwtClaimVerifier.decodePayload()` | (1) `auditor.record` for sub extraction; (2) `verifier.assertClaims` internally |
| Pick which token to send (today's lines 391-510) | `TokenResolver.resolve()` | `BankingToolProvider.dispatch()` exactly once on the `requiresUserAuth` branch |
| Verify JWT signature/claims (today's lines 514-522 + 1037-1096 + 26-41) | `JwtClaimVerifier` | `BankingToolProvider.dispatch()` right after `tokenResolver.resolve(...)`, gated on `isSensitiveHandler(tool.handler)` |
| Format transactional banking errors (today's lines 850-931) | `TransactionErrorMapper.mapTransactionError()` (pure function) | Inside `executeCreateDeposit` / `executeCreateWithdrawal` / `executeCreateTransfer` in `transactionHandlers.ts`, in their existing `try/catch` wrappers |
| Format per-tool result JSON (today's lines 557-839) | `handlers/*.ts` — one function per tool | `BankingToolProvider.dispatch()` via `handlerMap[tool.handler](...)` |

### Behavioral guarantees (zero-change contract)

1. Same constructor signature.
2. Same `executeTool` signature and return shape. `BankingToolResult` unchanged.
3. Same error messages, error codes, log strings, log levels. The audit `try/catch` swallow remains a swallow.
4. Same `tokenCache` keys (`agent:${sessionId}:${sortedScopes}` and `${sessionId}`) — preserved verbatim inside `TokenResolver`.
5. Same `HITL_THRESHOLD_USD`, `MAX_SESSION_CHAIN_ENTRIES`, `SENSITIVE_HANDLERS` constants — relocated, not changed.
6. Same env-var reads, relocated.
7. Same observable side effects: `apiClient.startTrace()` / `stopTrace()` still bracket dispatch; `httpTrace` attached on both success and error paths.

---

## Tests

This is a pure refactor — behavior preserved, public surface unchanged. **The existing test suite passes unchanged.** No new test logic required for behavior coverage; only mechanical updates for moved symbols where unit tests reference internals.

### Existing tests — run unchanged
- `tests/integration/mcp-protocol.integration.test.ts` — exercises `executeTool` end-to-end. Primary regression signal.
- `tests/server/MCPMessageHandler.test.ts` — verifies the message handler invokes the provider correctly.
- `tests/server/HttpMCPTransport.test.ts` — unchanged.
- `tests/auth/TokenIntrospector.test.ts` — unrelated; passes unchanged.

### New unit tests added in the refactor PR
1. `tests/tools/TokenResolver.test.ts` — four `resolve()` paths produce expected `source` values; cache hit vs miss; dev/test vs prod fallback throws in prod.
2. `tests/tools/TransactionErrorMapper.test.ts` — three error codes (`amount_exceeds_hard_limit`, `hitl_required`, `step_up_required`) plus the `null` case for unrecognised errors.
3. `tests/tools/JwtClaimVerifier.test.ts` — `decodePayload` happy/opaque path; `assertClaims` expired-token throw; `STRICT_TOKEN_VERIFICATION=true` promotes JWKS failure to throw.
4. `tests/tools/TokenChainAuditor.test.ts` — chain index increments per session and evicts at `MAX_SESSION_CHAIN_ENTRIES`; audit failure inside `record` does not throw.

### Tests deliberately not added
Per-handler unit tests for the eight tool handlers. Each handler is a mechanical extraction of an existing `private async executeX(...)` method, body unchanged. The integration test already exercises every handler via `executeTool`. Adding 8 thin handler-level unit tests would be redundant with the integration test and against the "minimal change" principle in CLAUDE.md.

### Verification gate
```bash
cd banking_mcp_server && npm run build    # must exit 0
cd banking_mcp_server && npm test          # all existing + 4 new suites pass
cd .. && npm test                           # full repo suite
```

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Hidden behavior drift in token-resolution code path** — the 120-line if/else block has four nested branches with distinct error messages and cache keys. Subtle reordering changes semantics. | High | Copy lines 391-510 verbatim into `TokenResolver.resolve()`. Don't refactor the conditional shape during extraction. Diff `resolve()` against the original block line-by-line in the PR. |
| **`tokenCache` is a module-level singleton import** — `services/tokenCacheService.ts` is shared across the process. Moving the cache reads/writes into `TokenResolver` is correct, but a stray double-import would create a second cache instance. | Medium | Keep the import as `import { tokenCache } from '../services/tokenCacheService'` in `TokenResolver` only. Provider no longer imports it. |
| **Audit `try/catch` swallow relocation** — moving it from `executeTool` into `auditor.record()` is correct, but if `record()` ever throws synchronously before its inner `try/catch`, the provider would see it. | Low | Place `try/catch` at the very top of `record()`'s body so it wraps the entire method. |
| **JWKS key-set cache lifetime change** — today it's module-level (process lifetime). After extraction it becomes a `JwtClaimVerifier` instance field. If multiple providers were constructed, they'd each have their own JWKS cache. | Low | `BankingMCPServer.ts` instantiates the provider once at startup — single-instance reality matches instance-level cache. Confirmed by spot-check during planning. |
| **Sensitive handler set drift** — if someone adds a new sensitive handler but only updates one location. | Low | After move, `SENSITIVE_HANDLERS` lives only in `JwtClaimVerifier.ts`. There is nowhere else to forget it. |
| **`clearSessionChainIndex` call sites** — `BankingSessionManager` calls this method on session teardown. | Medium | Keep the public method on `BankingToolProvider` (it delegates to `auditor.clearSession`). Caller signatures unchanged. Confirm via repo-wide grep before merging. |
| **REGRESSION_PLAN §1 protected directory** — `banking_mcp_server` is in the protected list. | Required step | Pre-edit: state explicitly which §1 invariants this refactor will not break. This is a refactor with no observable behavior change, so no §4 Bug Fix Log entry. If anything observable changes, that is a regression and we stop. |

---

## Rollout

Single PR, in commits that can be reviewed independently:

1. **Commit 1:** Add `handlers/types.ts`, `handlers/results.ts`. No behavior change. Pure new files.
2. **Commit 2:** Extract `TransactionErrorMapper.ts` + test. Provider calls it via a thin wrapper to limit blast radius of this commit.
3. **Commit 3:** Extract `TokenResolver.ts` + test. Update provider's `dispatch` to call it.
4. **Commit 4:** Extract `JwtClaimVerifier.ts` + test. Update provider.
5. **Commit 5:** Extract `TokenChainAuditor.ts` + test. Update provider.
6. **Commit 6:** Extract `handlers/*.ts` files + handler map. Update `dispatch` to use the map.
7. **Commit 7:** Final cleanup — delete now-unused private methods on provider, slim the file to ~250 lines.

After each commit: `npm run build` must exit 0 and the integration test must pass.

**Estimated PR size:** ~1300 lines added (new files), ~870 lines removed from provider. Net +430 lines. The readability win is in the *concentration* per file, not the LOC total.

---

## Explicitly out of scope

- Touching `BankingToolRegistry.ts` (the 489-line sibling).
- Merging tool definitions with handlers (Approach C — separate follow-up spec).
- Changing any public method signature on `BankingToolProvider`.
- Changing `tokenCache` eviction semantics or scope-narrowing rules.
- Promoting `STRICT_TOKEN_VERIFICATION` default to `true`.
- Promoting the dev/test passthrough fallback to a hard error in development.
- Touching `BankingSessionManager.ts`, `types/validation.ts`, or any other oversized file.

---

## Next steps

**Done.** The 7-commit rollout shipped on branch `refactor/mcp-provider-split`:

| Commit | Rollout step |
|---|---|
| `ff17d581` | refactor(mcp): extract TransactionErrorMapper from BankingToolProvider |
| `8a234a52` | refactor(mcp): remove dead HITL_THRESHOLD_USD from BankingToolProvider |
| `4165d65e` | refactor(mcp): extract TokenResolver from BankingToolProvider |
| `13be50fd` | refactor(mcp): extract JwtClaimVerifier from BankingToolProvider |
| `f13909f9` | refactor(mcp): extract TokenChainAuditor from BankingToolProvider |
| `5594c43b` | refactor(mcp): extract per-tool handlers into handlers/ |
| `d15d54dd` | refactor(mcp): final cleanup of BankingToolProvider |

Spec-vs-implementation audit (2026-05-15): all module contracts and the 7 behavioral guarantees
verified against pre-refactor source; `npm run build` exits 0; 110/110 tests pass (incl. the
`mcp-protocol.integration` primary regression signal). Three documentation inaccuracies in this spec
were corrected post-audit (status header, the `user-passthrough-noexchange` contract row, the
~250→355 line target); the `source` enum value was renamed `user-passthrough-devtest` →
`user-passthrough-noexchange` in code + tests so the label no longer implies a prod guard that
never existed.

Follow-up (unchanged, still deferred): Approach C — merge `BankingToolRegistry.ts` with handlers —
remains a separate future spec.
