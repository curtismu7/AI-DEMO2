# AI Security Best Practices — Banking Chatbot / Agent

This document captures recommendations to harden a banking-focused chatbot/agent that can access sensitive banking data and execute actions. It is split into:

- **A) AI Security Controls** (threat model + runtime policy enforcement)
- **B) Coding Suggestions** (implementation patterns, schema validation, logging, testing)

---

## Implementation Status & Guidance

> **Design constraint:** This is an educational demo. Every security control must preserve (and ideally enhance) user-visible observability — the MCP Traffic panel, API Traffic viewer, token chain display, and spinner activity feed all depend on structured event flow. "Remove logging" recommendations must be interpreted as "migrate to `appEventService.logEvent()` not delete."

### Recommended implementation order

| # | What | File(s) | Risk to education |
|---|------|---------|-------------------|
| 1 | ✅ Fix `postMessageOrigin: "*"` → config value | `AuthenticationIntegration.ts` | None |
| 2 | ✅ Fix `statusEndpoint` localhost hardcode → env var | `AuthenticationIntegration.ts` | None |
| 3 | ✅ Delete `toolCallValidator.js` (wired to nothing — security theater) | `tools/toolCallValidator.js` | None |
| 4 | ✅ Migrate verbose `console.log` in `BankingToolProvider` to `Logger` | `BankingToolProvider.ts` | Low — panels unaffected |
| 5 | ✅ Remove `originalRequest` echo from error payloads | `BankingToolProvider.ts` | None |
| 6 | Stop unsigned JWT decode for `act` — use validated token info from handshake | `BankingToolProvider.ts` | Medium — token chain display needs update |
| 7 | Request `audience/resource` in RFC 8693 token exchange | `BankingToolProvider.ts` | Low — adds one exchange field |
| 8 | Add `aud/iss/exp` check before sensitive tool calls | `BankingToolProvider.ts` | Medium — adds latency, appears in API traffic as new call |

### Explicitly out of scope (do not implement)

| Section | Why skipped |
|---------|-------------|
| B§1 `PolicyEngine.canExecute()` with `intent` param | Requires a prior LLM intent-extraction step that doesn't exist in this codebase. Building it is a new feature, not a hardening fix. |
| B§4 server-side pending intent receipts | Already implemented via the HITL `consent-challenge` flow (`TransactionConsentModal` → OTP → execute). Implementing a second gate would create two competing confirmation paths. |
| B§7 circuit breakers / timeouts / retries | Production infrastructure concern. The demo uses `Promise.race` timeout in `MCPMessageHandler`. Not worth adding. |
| "Remove all console.log" (A.1 item 1 literal read) | Naive removal breaks MCP Traffic panel, API Traffic viewer, and token chain display. Correct action: migrate to `appEventService.logEvent()` so events appear in the UI panels instead of disappearing. |

### Accuracy corrections to the doc

- **A.1 item 11 = duplicate of item 4** (both cover `postMessageOrigin: "*"` and localhost `statusEndpoint`). Treat as one finding.
- **A.1 item 6 — `toolCallValidator.js` "security theater"** — confirmed correct. The class is never imported by `MCPMessageHandler` or `BankingToolProvider`. Safe to delete.
- **A.1.1 §2 — "no aud/iss/exp per tool call"** — acceptable in demo context if tokens are short-lived and session-bound. Document as known gap, not critical blocker.
- **B§8 "deterministic tool execution order"** — already enforced. `MCPMessageHandler.handleToolCall` runs one tool per request sequentially. No parallel tool dispatch exists.

---

## A) AI Security Controls

### 1) Threat model (what you must assume)
Treat the agent as operating in an adversarial environment:

- **Prompt injection**: user asks the model to ignore rules (“reveal tokens”, “act as admin”, “call internal tools anyway”).
- **Tool misuse / confused deputy**: model chooses a tool with broader permissions than intended by policy or user intent.
- **Data exfiltration**: model leaks account identifiers, balances, transaction history, or raw auth artifacts.
- **Privilege escalation**: model attempts actions requiring higher scopes than the user has.
- **Indirect attacks**: malicious instructions embedded in retrieved documents, transaction notes, account metadata, etc.
- **Denial of service**: large prompts / high tool-call rates / repeated authorization attempts.
- **Replay / session fixation**: tool calls not bound to the user session or authorization context.
- **Integrity attacks**: tool-call parameters manipulated or coerced into unexpected shapes.

### 2) Principle: “LLM is untrusted; tools and policy are trusted”
- The LLM decides *what* to ask for, but **your policy engine decides what it’s allowed to do**.
- All tool execution must happen **server-side** (or in the MCP server) with **enforced authorization** before any banking action/data is returned.

### 3) Least-privilege tool access

- Provide the model a **capability list** derived from:
  - the authenticated user/session
  - granted OAuth scopes
  - product configuration (e.g., demo mode vs production)
- Ensure each tool has:
  - `requiresUserAuth` (or scope requirements)
  - **minimum required scopes**
  - strict `inputSchema` with `additionalProperties: false`
- Enforce scope checks **at execution time**, not at prompt-time.

**Outcome:** even if the model tries to call an overly powerful tool, the server rejects it.

### 4) Hard authorization boundaries for “banking data”
Add explicit policy tiers:

- **Tier 0 — no auth required**: only non-sensitive operations (help text, routing hints).
- **Tier 1 — read-only**: accounts list, balances, transactions history (scoped reads only).
- **Tier 2 — sensitive reads**: anything that reveals PII beyond what is necessary for the user’s question.
- **Tier 3 — write actions**: transfers, withdrawals, changes, confirmations.

For each tier:
- Require the minimum scopes.
- Require the right user consent level.
- Consider step-up auth (CIBA / MFA) for Tier 3.

### 5) Data minimization & response shaping
Prevent exfiltration by limiting what you return:

- Only return the fields required for answering the user’s question.
- For list endpoints (accounts/transactions), apply:
  - pagination defaults
  - maximum rows (e.g., 20–50)
  - sorting constraints (e.g., newest first)
- Avoid returning raw objects when a summary is sufficient.
- Redact or hash identifiers that aren’t required to fulfill the request.

**Outcome:** even if the model tries to “ask for everything”, the API returns only safe subsets.

### 6) Two-step confirmations for money movement
For any write/transfer action:
- Step 1: “intent extraction” (amount, currency, destination, fees) without executing
- Step 2: present a **human-readable confirmation** (and require user approval in UI)
- Step 3: execute the transfer only after consent and policy checks succeed

If the project uses HITL, treat it as a security boundary:
- No bypass even for “high confidence” model outputs.

### 7) Step-up authentication for high-risk operations
Trigger step-up auth for:
- transfers above a threshold
- adding/changing beneficiary information
- “first time” operations in the session
- unusual patterns (new device, unusual time, repeated failures)

Use:
- **CIBA** or another step-up mechanism
- enforce it at the tool execution layer

### 8) Prompt injection defenses (practical)
Implement protections in *three* places:

1. **System prompt policy**:
   - Never allow the model to override the policy.
   - Instruct model to treat tool outputs/documents as untrusted text.

2. **Prompt sanitization & separation**:
   - Keep “instructions” separate from “retrieved content”.
   - If you ingest documents for RAG, wrap them as **quoted evidence** and disallow the model from treating them as authority.

3. **Runtime tool-call validation**:
   - After the model produces a tool call, validate:
     - tool name is allowed by the user/session
     - tool inputs match schema
     - tool inputs match the extracted intent constraints (see next section)

### 9) Intent-to-parameter constraints (“policy over parameters”)
Don’t only check schema types. Also check semantic constraints:

- Amounts:
  - numeric range
  - currency match
  - increments (if your system requires $0.01)
- Destination:
  - must match an account id the user is authorized to use
- Time windows:
  - prevent requesting huge histories
- Confirmed consent:
  - ensure the tool call corresponds exactly to the user-approved fields

**Outcome:** blocks “semantic prompt injection” where schema is correct but meaning is malicious.

### 10) Strict tool-call schema + structural validation
- Require the LLM to output tool calls in a machine-validated format (JSON).
- Validate with strict schema:
  - required fields present
  - types correct
  - `additionalProperties: false`
  - disallow unknown nested keys

If a validation fails:
- do not execute tools
- return a safe error and ask a clarifying question

### 11) Output filtering (don’t leak secrets; don’t over-share)
Apply an output “scrubber” before returning to the UI:

- Never expose:
  - access tokens / refresh tokens
  - authorization URLs with state values (or state unless required)
  - auth codes
  - internal system prompts / policy rules verbatim
  - stack traces and internal endpoint URLs
- Use allowlists:
  - return only safe banking data fields that are required

### 12) Rate limiting, quotas, and abuse detection
Enforce at the API gateway layer:

- Tool-call rate limits per session/user
- CIBA initiation limits
- Transaction write limits per time window
- Cap prompt size or message count
- Add exponential backoff for polling flows (authorization_pending/slow_down)

### 13) Audit logging (security-grade logging)
Log **events**, not secrets:

- tool call start/end
- policy allow/deny
- scopes required vs available
- input validation failures (sanitized)
- user confirmation timestamps
- step-up auth triggers

Include:
- correlation id
- session id / connection id
- tool name and action type
- error code categories

Redact:
- tokens, authorization codes, PII beyond what’s necessary, and raw user prompt content if required by policy.

### 14) Model and runtime safety controls
- Use the smallest model that meets quality needs for intent extraction.
- Disable or tightly control “free-form browsing” or arbitrary tool invocation.
- Consider:
  - function-calling / tool-calling mode only
  - structured reasoning internally but never returned

### 15) Make tool list deterministic and conservative
- Don’t advertise tools the agent can’t safely use.
- If the UI asks for “banking actions”, only list the subset for that session.
- For demo mode, disable destructive operations entirely.

### 16) Build “secure failure modes”
If anything goes wrong:
- fail closed (deny by default for sensitive operations)
- never fall back to “best effort” that increases data exposure
- return actionable but safe errors (“authorization required”, “insufficient permissions”)

---

## A.1) Code-aligned hardening gaps (based on this repo’s MCP implementation)

These are high-impact findings from the current `banking_mcp_server` code paths (`MCPMessageHandler` → `BankingToolProvider` → `BankingToolValidator`/`toolScopeMap` → `AuthenticationIntegration`):

1) **Sensitive logging in production**
- `BankingToolProvider.executeTool()` logs `Tool parameters` and many execution messages with `console.log`/`console.error`.
- `MCPMessageHandler.handleToolCall()` logs tool names and `message.params.arguments`.
- `BankingMCPServer.sendResponse()` logs the full JSON response.
**Recommendation:** remove or gate these logs behind an environment flag and redact/omit anything that could include account identifiers, amounts, emails, or other PII.

2) **Error responses may echo user-controlled inputs**
- `BankingToolProvider.createErrorResult()` can include `originalRequest` (tool params) in `result.originalRequest`.
**Recommendation:** do not echo tool arguments in error payloads in production. At most return a correlation id + validation error code.

3) **Scope narrowing map mismatch risk**
- `toolScopeMap.getScopesForTool()` is used during RFC 8693 token exchange to request *narrowed* scopes.
- In `TOOL_SCOPES`, `get_sensitive_account_details` is currently mapped to `['banking:read']`, while the tool registry requires `['banking:read', 'banking:sensitive:read']`.
**Recommendation:** enforce a test that every tool’s `toolScopeMap` narrowed scopes are a **superset** of `BankingToolRegistry.requiredScopes` (or at least include all requiredScopes), otherwise token exchange can fail or force unexpected downstream gating.

4) **Authorization challenge UI wiring can be insecure**
- `AuthenticationIntegration.createAuthorizationChallengeResponse()` sets:
  - `postMessageOrigin: "*"` (overly permissive)
  - `statusEndpoint` to `http://localhost:8080/...` (hardcoded, insecure in real deployments)
**Recommendation:** set `postMessageOrigin` to your exact expected origin; make `statusEndpoint` come from configuration and use HTTPS. Never hardcode `localhost` for production auth flows.

5) **Output filtering is currently “best effort”, not guaranteed**
- Tools like `executeQueryUserByEmail()` and several tool handlers return the *full upstream response* or large objects inside `result.text`.
**Recommendation:** add a server-side response DTO allowlist per tool and strip fields not needed to answer the user. Treat the model output as untrusted and the upstream data as sensitive by default.

6) **Presence of an unused precondition validator**
- There is a `tools/toolCallValidator.js` that checks token type/scopes/delegation and rate limit, but the main path we saw uses `authIntegration.validateToolAuthentication()` and tool validation instead.
**Recommendation:** either delete the unused validator to avoid “security theater”, or integrate it into the actual tool-call path to ensure preconditions (including rate limiting) are consistently enforced.

7) **Token exchange does not request audience/resource (potential constraint bypass)**
- `BankingToolProvider` performs RFC 8693 token exchange by sending `scope` only.
- `TokenExchangeService` supports RFC 8707-style validation (`resourceUri` / audience), but enforcement only occurs if `tokenExchangeConfig.resourceUri` is configured *and* the exchanged token contains resource indicators.
**Recommendation:**
- For any delegated token that will be used against a specific upstream (your banking BFF / resource server), request and validate the expected `audience`/`resource` in the token exchange call.
- Add a hard assertion: if the exchanged token does not include the expected `aud` / resource indicators, fail closed before caching/using it.

8) **Unsigned JWT claim inspection (“decodeJwtPayload”) is security-sensitive**
- `BankingToolProvider` validates the delegation chain by unsigned-decoding the exchanged token payload and checking `act` claim shape.
**Recommendation:**
- Remove or minimize unsigned decode for security decisions.
- Prefer calling `TokenExchangeService.validateDelegatedToken()` (introspection + may_act/act checks), or verify JWT signatures via JWKS before trusting `act`.

9) **User token validation appears to be “eventual” (scope checks, limited claim checks)**
- After initial authorization, the server stores `accessToken/refreshToken` in `BankingSessionManager`.
- Subsequent tool calls primarily rely on:
  - scope checks (`validateBankingScopes`)
  - expiry buffering (`expiresIn` + refresh attempts)
- There’s no evidence of ongoing re-introspection of `aud/iss/exp` for each tool call in the paths we traced.
**Recommendation:**
- For sensitive read/write tools, re-introspect or at least verify required claims (`aud/iss/exp`) before use, or enforce short-lived tokens + strict refresh validation.

10) **“Never log secrets” violations exist in auth + transport code**
From the traced code paths:
- `TokenIntrospector` logs token introspection metadata and even `response.data`.
- `AuthorizationManager` logs token exchange request details and token response fields (access/refresh token substrings).
- MCP and transport layers log tool args and full JSON responses (`MCPMessageHandler.handleToolCall`, `BankingMCPServer.sendResponse`).
- `BankingAPIClient` request/response logging occurs via Axios interceptors, and tracing captures request/response bodies when enabled.
**Recommendation:**
- In production, remove token-related logging entirely (even truncated) and gate all verbose traces behind explicit `NODE_ENV !== 'production' && DEBUG_TRACING=true`.
- Implement a redaction layer for logs and audit “details” so account IDs, amounts, emails, and token-like strings cannot leak.

11) **Authorization challenge UI fields are not production-safe**
- `AuthenticationIntegration.createAuthorizationChallengeResponse()` currently uses:
  - `postMessageOrigin: "*"` (too permissive)
  - `statusEndpoint: http://localhost:8080/...` (hardcoded, insecure in real deployments)
**Recommendation:** set `postMessageOrigin` to your exact expected origin; make `statusEndpoint` come from configuration and use HTTPS. Never hardcode `localhost` for production auth flows.

---

## A.1.1 End-to-end token/scope/audience trace (where enforcement happens + where holes remain)

This section is a “walk-through” of the real chain we traced in `banking_mcp_server`:

### 1) Agent token (MCP access token) — validated in MCP transport/handshake
- **Where:** `MCPMessageHandler.handleHandshake()` (and also `MCPMessageHandler.handleToolCall()` session bootstrapping)
- **Validation:** `authManager.validateAgentToken()` → `TokenIntrospector.validateAgentToken()`
  - `active` must be true
  - **audience check:** requires `tokenInfo.aud` to include `process.env.MCP_SERVER_RESOURCE_URI`
  - **may_act enforcement (optional):** when `REQUIRE_MAY_ACT=true`, token must contain `may_act.client_id == BFF_CLIENT_ID`
  - **optional act.* expectations (env vars):** `MCP_EXPECTED_ACT_SUB`, `MCP_EXPECTED_ACT_CLIENT_ID`, etc.

**Hole to fix / tighten:**
- `tools/list` and tool filtering uses `decodeScopesFromToken()` which **unsigned-decodes** JWT payload (it does not use token introspection results). This is only safe if you can prove the token used there is the same one validated earlier and never mutated, but the safer pattern is to use the validated token info/scopes from `validateAgentToken()`.

### 2) User authorization scopes (banking data access) — derived from stored user token scope claim
- **Where:** `AuthenticationIntegration.validateToolAuthentication()` → `checkUserAuthorization()`
- **Mechanism:** it checks `sessionManager.validateSession()` and `findTokensForScopes()`
  - `BankingAuthorizationManager.validateBankingScopes()` is essentially: does `userTokens.scope` string contain required banking scopes
  - refresh attempts exist for expired tokens (`refreshUserToken()`), but **there’s no ongoing aud/iss/exp validation** per tool call beyond expiry buffering.

**Hole to fix / tighten:**
- For sensitive tools, ensure you validate **aud/iss/exp** (and optionally cnf/DPoP if applicable) before using the token. Today the code is scope-driven and expiry-driven.

### 3) Tool execution gating — enforced twice (in different ways)
- **Where:** `MCPMessageHandler.handleToolCall()` and `BankingToolProvider.executeTool()`
  - `MCPMessageHandler` calls `authIntegration.validateToolAuthentication()` and can return:
    - `-32005 insufficient scope`
    - `authChallenge` (redirect/CIBA) when missing tokens
  - `BankingToolProvider` additionally:
    - validates tool params via `BankingToolValidator`
    - and can re-run `authChallengeHandler.detectAuthorizationChallenge()` for tools marked `requiresUserAuth`

**Hole to fix / tighten:**
- Ensure there’s exactly one source of truth for authorization decisioning, or at least ensure they are aligned. “Double gating” increases the chance that a mismatch path slips through (even if each is individually correct).

### 4) RFC 8693 token exchange — scope narrowing requested, but audience/resource not constrained
- **Where:** `BankingToolProvider.executeSpecificTool()` (when `tokenExchangeService` exists)
  - It builds an exchange request using only `scope` (`toolScopes.join(' ')`)
  - It does **not** request `audience` or `resource` in the token-exchange call

- **Validation after exchange (currently):**
  - It does an unsigned decode via `decodeJwtPayload(token)` and throws if `act` claim is missing.

**Holes to fix / tighten:**
- Request and enforce the expected **audience/resource** in token exchange (RFC 8707 / resource indicators).
- Replace unsigned claim inspection with proper delegated-token validation:
  - Prefer `TokenExchangeService.validateDelegatedToken()` (introspection + may_act/act/resource checks), or verify JWT signature via JWKS before trusting `act`.
- Add a hard fail if the exchanged token doesn’t match expected token audience/resource for the banking BFF API.

### 5) MCP server → Banking API server — Bearer token forwarding
- **Where:** `BankingAPIClient.makeAuthenticatedRequest()` attaches:
  - `Authorization: Bearer ${userToken}`
- The Banking API server ultimately should enforce:
  - access token validity
  - scope enforcement
  - (ideally) audience checks

**Hole to fix / tighten:**
- Relying on upstream scope checks alone means you’re vulnerable to token confusion if your upstream enforcement is incomplete. Add explicit audience/resource enforcement earlier (at exchange + token validation).

### 6) Logging + error payloads — security-critical for exfiltration
- Observed in traced code paths:
  - token-related logs (even truncated) in `TokenIntrospector` and `AuthorizationManager`
  - tool args + full response logging in MCP/tool layers
  - `originalRequest` echoed in some errors

**Hole to fix / tighten:**
- Create a single redaction policy for:
  - logs
  - audit events “details”
  - error payloads
- Then enforce “no secrets / no PII / no token-like strings in logs” in production.

---

## B) Coding Suggestions (implementation hardening)

### 1) Centralize authorization and policy checks
Create a single server-side place that answers:
- “Is this tool allowed for this session, for this user intent, with this parameter set?”

Pattern:
- `PolicyEngine.canExecute({ session, toolName, params, intent }) -> { allowed, reason, requiredScopes }`

Then:
- MCP server (or BankingToolProvider) calls PolicyEngine **before executing**.

### 2) Validate tool parameters at the boundary
At execution time (not earlier):
- JSON schema validation (strict)
- semantic constraints validation (intent matching + allowed ids)

Rules:
- Reject unknown keys.
- Reject negative amounts, NaN, huge numbers.
- Reject account ids not present/authorized for the session.

### 3) Bind every tool call to the session/authorization context
- Tool calls must include/derive `sessionId`.
- Do not accept “stateless” execution tokens that aren’t tied to a live session.

Ensure that:
- session tokens refresh behavior can’t accidentally use a different user session
- session is the source of truth

### 4) Add an “intent receipt” for HITL confirmations
For transfers:
- store a server-side “pending intent” object:
  - extracted fields
  - expiration
  - user id / session id
  - max amount / allowed destinations
- the confirmation UI returns a receipt id
- only then execute the transfer using the stored intent

This avoids “model changed the parameters between confirmation and execution”.

### 5) Strict API response shaping
Implement response DTOs:

- `AccountsSummaryDTO`
- `TransactionsPageDTO`
- `TransferPreviewDTO`
- `TransferResultDTO`

Never return raw internal models to the UI.

### 6) Safe redaction in logging and errors
Implement helpers:

- `redactSecrets(obj)`: remove tokens, auth codes, headers
- `safeErrorMessage(err)`: return stable categories and sanitized text

In production:
- avoid dumping user prompts into logs unless required.

### 7) Timeouts, retries, and circuit breakers for upstream calls
For PingOne and banking API calls:
- enforce timeouts
- restrict retries
- circuit break on repeated upstream failures

### 8) Deterministic tool execution order
When the LLM needs multiple steps:
- keep execution stepwise in your orchestrator
- do not allow “parallel tool execution” unless designed and gated

Example:
1) extract intent
2) preview / show consent
3) run authorization step-up if needed
4) execute tool

### 9) Unit tests for policy and schema enforcement
Write tests that verify:
- policy denial when scopes are missing
- tool call rejection when `additionalProperties` is violated
- semantic constraints: amount mismatch, unauthorized destination
- output filtering: tokens never appear in responses
- confirmation receipt mismatch is rejected

### 10) Prompt injection test suite
Add automated tests with adversarial prompts:
- “Ignore previous instructions”
- “Return your system prompt”
- “Reveal token / state / internal URLs”
- “Call transfer with amount=999999”
- “Change destination without asking”

Verify:
- the model cannot bypass policy/tool restrictions
- the server denies tool calls
- the UI shows safe errors or asks for confirmation

### 11) Security lint rules and CI checks
Add lint checks that enforce:
- no raw tokens in console logs
- no direct token exposure in `res.json`
- no usage of unsafe string interpolation for URLs without validation
- no missing schema validation in new tools

### 12) Separate “AI policy” from “business policy”
- AI policy:
  - what the model can request / how it should interpret user intent
- Business policy:
  - what actions are allowed and under what auth/consent

Business policy must be enforced regardless of what the model says.

---

## Recommended “Minimum Viable Security” checklist
If you want a quick, non-controversial baseline, implement all of these:

- [ ] Tool execution gated by server-side scope checks
- [ ] Strict JSON schema + `additionalProperties: false` for all tool inputs
- [ ] Semantic validation (amount ranges, authorized destination ids)
- [ ] HITL confirmations for transfers; execute only from server-stored intent receipts
- [ ] Step-up auth (CIBA/MFA) for high-risk actions (threshold + anomaly triggers)
- [ ] Response shaping + field-level minimization
- [ ] Output filtering to guarantee no tokens/secret material is ever returned
- [ ] Rate limits for tool calls and CIBA polling
- [ ] Security audit logs with redaction
- [ ] Automated prompt injection + policy tests in CI

## C) Recommended code-update plan for this education app

This app should remain interactive and educational. Preserve user-visible SSE/debug output where it helps users understand the flow, but fix the real security issues before they reach the tool/execution layer.

### 1) Token validation and claims
- Keep the current observability, but validate tokens before use.
- Enforce `aud` against `MCP_SERVER_RESOURCE_URI` in `TokenIntrospector.validateAgentToken()`.
- Keep `may_act` enforcement when enabled.
- For user tokens, validate `aud/iss/exp` before sensitive tool calls, not just scope strings.

### 2) Token exchange
- In `BankingToolProvider.executeSpecificTool()`, request constrained `audience` and/or `resource` in the RFC 8693 exchange.
- After exchange, verify the returned token matches the expected audience/resource before caching or using it.
- Update token cache keys to include audience/resource context.

### 3) Delegation validation
- Stop using unsigned JWT decoding as a security gate for `act`.
- Replace it with validated delegated-token checks via `TokenExchangeService.validateDelegatedToken()` or signature-verified JWT claims.

### 4) tools/list hardening
- Stop deriving tool visibility from unsigned-decoded scopes.
- Use validated token info from `validateAgentToken()` or cached validated scopes.

### 5) Authorization challenge UX
- Keep the existing UX, but make it production-safe.
- Remove `postMessageOrigin: "*"` from challenge payloads.
- Replace hardcoded localhost status endpoints with config/HTTPS.

### 6) Authorization flow consistency
- Consolidate allow/deny logic so `MCPMessageHandler` and `BankingToolProvider` do not drift.
- Integrate `toolCallValidator.js` into the real tool path or remove it if redundant.
- Ensure rate limiting and delegation checks actually execute.

### 7) Output shaping
- Return safe DTO allowlists per tool instead of raw upstream responses.
- Keep enough data for the education UI to explain what happened.
- Redact only fields that are unnecessary or dangerous.

### 8) Scope mapping tests
- Add a test that every tool’s narrowed scope map includes the registry’s required scopes.
- This prevents exchange failures and keeps scope behavior consistent.

### 9) Errors and debug data
- Avoid echoing raw request params in errors unless the UI explicitly needs them for learning.
- Prefer structured errors with a correlation id and clear explanation.

### 10) Logging boundaries
- Do not remove educational logging/SSE.
- Separate user-visible debug/flow data from internal-only sensitive traces.
- Preserve what the app shows, but avoid leaking extra internal secrets beyond what the demo needs.

### 11) Educational security outcome
- This code-update plan should make the app technically correct on AI security while keeping it educational.
- Validate strictly in the backend, explain clearly in the UI/SSE, and never silently break the teaching flow.
- Users should still see what tokens, scopes, audience, delegation, and tool decisions are happening, but the app must repair or reject invalid auth state before using protected banking actions.
