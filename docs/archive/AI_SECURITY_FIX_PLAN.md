# AI Security “No-Holes” Fix Plan (Banking Chatbot / MCP server)

This plan is derived from tracing the real code paths in `banking_mcp_server`:
- `MCPMessageHandler` → `BankingToolProvider` → `BankingToolValidator` + `toolScopeMap` → `AuthorizationChallengeHandler/AuthenticationIntegration` → PingOne (`TokenIntrospector`, `AuthorizationManager`) → `TokenExchangeService` → forwarded token to `banking_api_server`.

## 0) Goals / Definitions
**Goal:** eliminate the security holes identified in `AI_SECURITY_BEST_PRACTICES.md` while preserving the education/demo experience by ensuring:
- **User-visible observability stays on**: the app may show tokens, scopes, audiences, exchanges, and request flow in the UI/SSE when appropriate for learning.
- **No accidental breakage**: do not remove user-facing logging/streaming/debug visibility unless it is specifically unsafe or clearly wrong.
- **Correct token chain enforcement** end-to-end: `aud` + `iss` + `exp` + delegation (`act`/`may_act`) are validated and repaired when possible.
- **RFC 8693 token exchange** requests constrained `audience`/`resource` and verifies delegated token indicators.
- **No unsigned JWT claim inspection** is used as an authorization decision.
- **Consistent authorization**: one source of truth for allow/deny.
- **Deterministic tool output shaping**: DTO allowlists per tool.

## 1) Logging & Audit Exfiltration Remediation (P0 / 0.5–2 days)
### Files to change (most urgent first)
- `banking_mcp_server/src/auth/TokenIntrospector.ts`
- `banking_mcp_server/src/auth/AuthorizationManager.ts`
- `banking_mcp_server/src/server/MCPMessageHandler.ts`
- `banking_mcp_server/src/server/BankingMCPServer.ts`
- `banking_mcp_server/src/banking/BankingAPIClient.ts`
- `banking_mcp_server/src/tools/BankingToolProvider.ts`
- `banking_mcp_server/src/utils/AuditLogger.ts`

### Actions
1. Add a shared utility:
   - `redactForLogs(value)` + `redactObjectDeep(obj)` for secrets/PII that should not leave internal traces or be replayed into downstream messages.
2. Keep user-visible observability intact:
   - SSE/debug streams can continue showing tokens, scopes, audience, and flow state in the UI where that is part of the education experience.
   - If a value is shown to the user, it should still be validated and repaired where possible before execution.
3. Gate only production-sensitive traces:
   - protect truly sensitive internal-only details with `DEBUG_TRACING=true` AND `NODE_ENV !== 'production'`
   - never log token material in a way that increases risk beyond the intended user-visible education output
4. Update `AuditLogger`:
   - ensure details can be summarized and educational, but do not silently mutate or hide operational state the UI needs to explain
5. Remove or heavily restrict:
   - only the parts of `createErrorResult(... originalRequest ...)` that would leak sensitive internals beyond the educational UI
   - any response echo in internal logs that is redundant with what the user already sees in the app

### Verification
- Add a test that runs with `NODE_ENV=production` and asserts log output does not contain:
  - `access_token`, `refresh_token`, `authorization_code`, `code_verifier`, `authorizationUrl`, `state=`, or regex-like JWT fragments (`^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.`)

## 2) RFC 8693 Token Exchange: Add aud/resource constraints (P0 / 1–3 days)
### Files
- `banking_mcp_server/src/tools/BankingToolProvider.ts`
- `banking_mcp_server/src/auth/TokenExchangeService.ts`
- `banking_mcp_server/src/services/tokenCacheService.ts` (may update cache key semantics)

### Actions
1. In `BankingToolProvider.executeSpecificTool()` when calling RFC 8693 exchange:
   - Request correct constrained `audience` and/or `resource` in `TokenExchangeRequest`
2. After exchange:
   - Hard-validate exchanged token includes expected `aud` / resource indicators
   - Fail closed (do not cache/use the token)
3. Update caching:
   - Include audience/resource in the cache key to prevent token reuse in wrong context

### Verification
- Unit test(s) for token exchange:
  - wrong aud/resource → must fail closed
  - missing resource indicators → must fail closed
  - correct aud/resource → exchange succeeds

## 3) Remove Unsigned JWT Claim Decisions (P0 / 1–2 days)
### Files
- `banking_mcp_server/src/tools/BankingToolProvider.ts`

### Actions
1. Remove/avoid `decodeJwtPayload()` “unsigned decode” path used to validate delegation/`act`.
2. Use validated flow instead:
   - call `TokenExchangeService.validateDelegatedToken(exchangedToken)`
   - or verify token signature via JWKS if that’s your intended architecture
3. Ensure `act` enforcement happens only after validated token checks succeed.

### Verification
- Test that a token with spoofed `act` cannot pass delegation enforcement.

## 4) Harden tools/list scope filtering (P1 / 0.5–1.5 days)
### Files
- `banking_mcp_server/src/server/MCPMessageHandler.ts`

### Actions
- `tools/list` currently uses `decodeScopesFromToken()` (unsigned decode).
- Replace it with **validated token info/scopes** returned from:
  - `authManager.validateAgentToken()` path (or cached validated token info per session)

### Verification
- Test that tools/list cannot be influenced by a token whose signature/claims don’t validate.

## 5) User token ongoing validation for sensitive tools (P1 / 1–3 days)
### Files
- `banking_mcp_server/src/server/AuthenticationIntegration.ts`
- `banking_mcp_server/src/tools/BankingToolProvider.ts`

### Actions
1. For sensitive tools (Tier 2/3) before executing:
   - re-introspect or re-validate required claims:
     - `aud/iss/exp` at minimum
2. Ensure refresh tokens produce tokens that are validated beyond `scope` string matching.

### Verification
- Token with correct scopes but wrong aud/iss/expired must be rejected.

## 6) Single source of truth for authorization gating + integrate validator (P1 / 1–3 days)
### Files
- `banking_mcp_server/src/server/MCPMessageHandler.ts`
- `banking_mcp_server/src/tools/BankingToolProvider.ts`
- `banking_mcp_server/src/tools/toolCallValidator.js` (unused today)

### Actions
1. Decide one canonical authorization decision flow:
   - either `MCPMessageHandler` decides allow/deny OR `BankingToolProvider` decides, but avoid divergence
2. Integrate `toolCallValidator.js` (or delete it):
   - ensure it runs on every tool call
   - ensure rate limiting is real, not “always valid”

### Verification
- Test:
  - invalid token → deny
  - missing delegation (`act`) → deny
  - rate limit exceeded → deny (429 / MCP error mapping)

## 7) Align scope mapping tests (toolScopeMap ↔ registry) (P2 / 0.5–1 day)
### Files
- `banking_mcp_server/src/tools/toolScopeMap.ts`
- `banking_mcp_server/src/tools/BankingToolRegistry.ts`

### Actions
- Add CI test:
  - for each tool: `toolScopeMap.getScopesForTool(tool)` must include all `BankingToolRegistry.requiredScopes`
  - fail if any tool has missing scopes in narrow map

### Verification
- Prevent scope narrowing mismatches that break constrained exchange.

## 8) Output shaping: enforce DTO allowlists per tool (P2 / 1–3 days)
### Files
- `banking_mcp_server/src/tools/BankingToolProvider.ts`
- tool handler implementations per tool

### Actions
1. For each tool, return a DTO allowlist only:
   - strip sensitive/unneeded fields
   - cap lists and truncate safely
2. For tools like `query_user_by_email`, ensure “exists/not exists” is returned rather than raw upstream response.

### Verification
- Tests that forbidden fields never appear in `result.text`:
  - tokens, raw auth artifacts, full emails (unless necessary), raw internal error payloads.

## 9) Secure auth challenge payload (P2 / 0.5–1 day)
### Files
- `banking_mcp_server/src/server/AuthenticationIntegration.ts`

### Actions
- Remove `postMessageOrigin: "*"`
- Remove hardcoded `statusEndpoint: http://localhost:8080/...`
- Replace with configuration:
  - strict allowed origins
  - HTTPS-only endpoints

### Verification
- Integration test ensures challenge payload has no insecure defaults.

## Recommended Implementation Order (fastest path to “no holes”)
1. **P0:** logging/audit exfiltration with education-safe visibility preserved (Section 1)
2. **P0:** token exchange aud/resource constraints (Section 2)
3. **P0:** remove unsigned JWT claim decisions (Section 3)
4. **P1:** tools/list scope filtering hardening (Section 4)
5. **P1:** ongoing user token validation for sensitive tools (Section 5)
6. **P1:** unify authorization gating + integrate toolCallValidator (Section 6)
7. **P2:** scope mapping alignment CI test (Section 7)
8. **P2:** DTO allowlists for all tool outputs (Section 8)
9. **P2:** auth challenge payload security (Section 9)

## Deliverables
- [ ] Secure logging + audit redaction tests
- [ ] RFC 8693 token exchange constrained aud/resource enforcement + tests
- [ ] Delegation validation uses validated token checks (no unsigned decode)
- [ ] tools/list uses validated scopes
- [ ] DTO allowlists per tool + tests
- [ ] unified authorization gating + integrated precondition validator + rate limits
- [ ] CI scope mapping alignment test
- [ ] production-safe auth challenge payload
