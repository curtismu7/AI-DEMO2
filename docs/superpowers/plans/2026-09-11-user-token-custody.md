# Plan: the LLM can never use the user token to get around the gateway or P1AZ

**Status:** implemented on branch `fix/llm-token-custody` (2026-09-11). This replaces the earlier browser-custody version of this file (PR #3128). Where the build differs from this plan, gap 3 says so.

## Context

Showing tokens in the UI is fine; that is the teaching. The security rule is about the AI. The user token lives only in deterministic code, and nothing the LLM produces can change that. The LLM produces a tool name, tool arguments, a choice of specialist, and text. None of those may pick:

- a credential,
- a destination,
- the route (gateway or direct),
- the exchange audience or scopes,
- a feature flag.

Every backend call the LLM triggers must pass the MCP gateway and PingOne Authorize (P1AZ). There is one accepted, documented exception: `call_pingone_tool` may run `createUser` on the admin's own delegated token, gated only by that admin's PingOne roles (gap 3).

Decisions made:

- Fix all four gaps below.
- No-gateway mode fails closed for A2A specialist calls.
- Keep the cross-user delegation fix from the earlier version.
- Keep `createUser` in the `call_pingone_tool` allowlist as a documented exception to the no-bypass rule.

## What already holds (audit, 2026-09-11)

- **No raw token in LLM context.** Prompts, history, memory and tool results carry decoded claims only. Token events are claims-only (`services/agentMcpTokenService.js:425-449`). The `requestJson` display copy has the token redacted (`services/mcpToolPipeline.js:243-248`).
- **No tool argument is ever read as a bearer.** Gateway or direct routing, gateway URL, audience, scopes, `suppliedToken` and flags all come from the session, env or configStore (`mcpToolPipeline.js:255, 280-283, 1003-1044`). No LLM-callable tool writes config or flags.
- **External agents hold no user token.** langchain, openai, pydantic and mastra hold a shared secret plus a session ID fixed by the BFF at run start (`routes/agentRun.js:600`). Every tool call comes back to `/internal/agent-tool` and runs the full pipeline: exchange, then P1AZ, then gateway.
  - langchain's `auth_token` and direct-MCP path is dead: no MCP endpoint is configured, and oauth-mcp would reject its token.
- **HITL and elicitation arguments** (`_hitl_challenge_id`, `_elicitation_*`) are verified, bound and consumed at the gateway (`demo_mcp_gateway/src/hitlClient.ts:189-274`, `authorizeMcpRequest.ts:596-632`).

## Gaps to close

### 1. A2A specialist calls skip P1AZ when there is no gateway

- `services/mcpToolPipeline.js:506` honours `ctx.skipBffAuthorize` whether or not a gateway exists. The comment directly above it says it must not skip when there is no other checkpoint. `bffMcpToolExecutor.js:393` sets the flag on every A2A call.
  - Fix: skip only when the gateway is authoritative: `if (gatewayAuthoritative || guestPublicTool)`. Keep the `'a2a_supplied_token'` skip reason when `ctx.skipBffAuthorize && gatewayAuthoritative`, so existing labels and tests hold.
  - Update the comment at `bffMcpToolExecutor.js:389-393`.
  - **Fail closed:** in no-gateway mode the BFF's P1AZ check now runs on specialist tools. The policy has no specialist rules, so those calls are denied until it does. Gateway mode is unchanged.
- **Local serve** (`services/demoAgentLangGraphService.js:1053-1098`) runs the specialist tool in-process after `mcp_error`, `gateway_error` or `mcp_unreachable`. None of these proves a PERMIT:
  - `mcp_error` is returned for any failure that isn't a connection failure (`mcpToolPipeline.js:1833`).
  - `mcp_unreachable` means the gateway never answered.
  - `gateway_error` is never produced by the pipeline.
  - Fix, pipeline side: in the catch that returns `mcp_error` (`mcpToolPipeline.js:1833`), add `gatewayDecision: err.gwAuditTrail?.authorize?.decision ?? null` to the body. The trail is already on the thrown error (`mcpGatewayClient.js:720-726`) and already turned into token events just above. Confirm the field name in `_parseGwAuditTrail`.
  - Fix, executor side: `executeBffToolWithToken` (the A2A path, `bffMcpToolExecutor.js:437`) rebuilds error results with only `error` and `message`, which would drop the new field. Add `gatewayDecision: outcome.body?.gatewayDecision ?? null` to that return.
  - Fix, local-serve side: serve locally only when `toolResult.gatewayDecision === 'PERMIT'`, and drop the other two error codes from the list.

### 2. Nothing strips tokens from what the LLM receives, and tool names are not checked

- **BFF agents:** `runReasonLoop` (`services/agentReasoningClient.js:122-140`) is the single loop behind the demo, banking, admin and ops agents.
  - Before running a tool: if `call.name` is not in `p.tools`, don't run it. Return the tool message `{"error":"tool_not_offered"}` instead.
  - After running it: `resultStr = redactMessage(resultStr)` from `utils/logRedact.js`. Its pattern is unanchored and catches a token inside error text ("Bearer eyJ…"); `scrubRawJwts` only matches a whole-string JWT. Apply this before the result goes to `toolMessages` or `toolResults`.
  - The no-tool return shape must stay byte-identical, because `agentReasoningLoop.regression.test.js` compares it with `toEqual`.
- **External agents:** `routes/agentTool.js` (`/internal/agent-tool`).
  - In `routes/agentRun.js`, after `tools` is built (~:508), add the run's tool names to `req.session.agentRunToolNames` and save the session. The existing save at :388 runs before tools are resolved.
  - Add to the stored list; never replace it. Callbacks carry only the session ID, not a run ID, so two overlapping runs in one session would otherwise overwrite each other and reject a tool their own run was offered. Anything extra this accepts was still offered to the same user in the same session, and still passes the gateway and P1AZ. Binding the list to a run ID would mean changing all four agents' callback bodies; that goes in TECH_DEBT.
  - In `agentTool.js`, after loading the session (~:92), return 403 `{ error: 'tool_not_offered' }` for a `tool` that is not in `session.agentRunToolNames`. A session with no list is also refused. `delegate_to_specialist` must be in the offered list; confirm the a2a overlay puts it there, and if not, allow it explicitly.
  - Run the response through `redactValue` (`utils/logRedact.js`) before sending it.

### 3. `call_pingone_tool` lets the LLM run any hosted PingOne tool

- `config/verticals/pingone-admin/tools.js` `callPingOneTool` (:317) sends any name and arguments the model picks to `mcp.pingone.com`, using the admin's delegated token. There is no gateway, no P1AZ and no allowlist. The host and environment are pinned.
- Fix: refuse names outside an allowlist before `adapter.callTool`. The allowlist is every read tool the admin chips and intents use: `CORE_TOOLS` (:10: `listUsers`, `getUser`, `listPopulations`, `listApplications`, `getEnvironment`) plus `listResources`, `getEnvironmentServices`, `listDavinciFlows`, `listDavinciApplications` and `listDavinciConnectors`. On top of those comes `createUser`, which the admin agent's "create a user" intent routes to (`pingone-admin/index.js:43`).
  - Changed in the build: the first version of this plan listed only `CORE_TOOLS` plus `createUser`. That broke five admin features, and `tests/oas/pingone-admin.test.js` caught it.
- **`createUser` is a documented exception to the no-bypass rule** (decided 2026-09-11). It writes to PingOne with no gateway or P1AZ check, gated only by the signed-in admin's PingOne roles. It runs on the admin's own delegated token, never the user token. Recorded in TECH_DEBT.
- The tool description now says tools outside the allowlist are refused.
  - Changed in the build: the `scopes: ['read']` label stays. `scripts/gen-vertical-tools.js:75` reads it into a generated artifact, and it gates nothing on this path, which goes straight to PingOne. Recorded in TECH_DEBT.
- This path still has no gateway or P1AZ hop. The allowlist caps it; routing it through the gateway is out of scope (TECH_DEBT).

### 4. The JWT verifier fetches URLs the LLM chooses (SSRF)

- `demo_mcp_jwt_verifier/server.py`: `jwt_verify_signature(jwksUri)` (:102, via `PyJWKClient`) and `jwt_fetch_jwks(uri)` (:199, via `httpx.get`) accept any URL. The verifier is in the agent's gateway catalog.
- Fix: one helper that allows only `https` on the host of `PINGONE_JWKS_URI`, an env var the server already requires (:30). Refuse anything else: `jwt_verify_signature` returns `{"valid": False, "error": "jwks_uri_not_allowed"}` and `jwt_fetch_jwks` raises. Token handling stays decode-only.

### 5. Cross-user delegation leak (kept from the earlier version)

- `/api/delegation/admin/all` and `/granted-to-me` return another user's live access token. This is not teaching.
- Fix: in `services/delegationService.js:51` `toRecord`, destructure out `access_token`.
- Revocation is unaffected. The admin hard revoke reads the raw row through `delegationStore.getDelegationById`, and `agentAuthorization.js:138-143` revokes the session token.

## Guard

`demo_api_server/tests/llmTokenCustody.regression.test.js`. Case 1 can go in `src/__tests__/mcpToolPipeline.authzBypass.test.js` instead if its fixtures are reusable. Each case fails if its fix is reverted:

1. With `ctx.skipBffAuthorize` and no gateway, the BFF P1AZ check runs (`evaluateMcpFirstToolGate` is called). With a gateway, it is skipped.
2. A2A local serve: `mcp_error` with no `gatewayDecision` is not served locally; with `'PERMIT'` it is. `executeBffToolWithToken` passes `gatewayDecision` through its error result. That part is tested on the executor itself, because `a2aExecution.test.js` mocks the executor.
3. `runReasonLoop`: when the model emits a tool that is not in `p.tools`, `executeTool` is not called and the tool message is `tool_not_offered`.
4. `runReasonLoop`: a result containing `Bearer eyJ…` reaches the model as `[REDACTED_JWT]`.
5. `/internal/agent-tool`: a tool not in `session.agentRunToolNames` gets a 403, and a response containing a JWT is redacted.
6. `callPingOneTool({ name: 'deleteUser' })` is refused, and `adapter.callTool` is not called.
7. `toRecord` output has no `access_token`.

Python: `demo_mcp_jwt_verifier/test_jwks_allowlist.py`, one small file. It refuses `http://169.254.169.254/` and another host, and accepts the `PINGONE_JWKS_URI` host. It runs locally; CI does not wire this service's tests.

Existing suites to re-run, updating any that assert the old behaviour:

- `tests/agentReasoningLoop.regression.test.js`, `src/__tests__/agentReasoningClientLoopGuard.test.js`, `tests/agentReasoningClient.tokens.test.js`
- `src/__tests__/mcpToolPipeline.authzBypass.test.js`, `src/__tests__/mcpToolPipeline.authorizeEvaluations.test.js`
- `src/__tests__/a2aExecution.test.js` (its local-serve case must now supply a PERMIT)
- `tests/agentTool.a2aFastPath.test.js`, `tests/agentTool.wireContract.regression.test.js`, `tests/agentTool.elicitation.test.js`
- `tests/pingoneAdminCaseRetry.test.js`, `tests/adminChipDeadends.test.js`, `tests/bankingAgentLangGraphService.pingoneAdminToolsCalled.test.js`, `tests/stepVerification.pingone-admin.test.js`

## Docs (same PR)

- `REGRESSION_PLAN.md` §1: add an "LLM token custody" row stating the invariant, pointing to this plan, and naming the guard test.
- `REGRESSION_PLAN.md` §4: add a reverse-chronological entry.
- `TECH_DEBT.md`: record what is deliberately left:
  - **`/internal/agent-tool` auth is a shared secret only.** The default `dev-shared-secret-change-me` is accepted unless `VAULT_INTERNAL_STRICT=true`. Port 3001 is published, and the "loopback" comment at `agentTool.js:18` is wrong. Anyone with the secret and a session ID can act as that user. The LLM cannot reach this.
  - **Platform mode** gives OpenAI or Anthropic an exchanged gateway token (`services/platformAgentRuntime.js:35-62`). The gateway and P1AZ still check each call.
  - `call_pingone_tool` has no gateway or P1AZ hop, and `createUser` is allowed through it as a documented exception.
  - The external-agent tool allowlist covers the whole session, not one run, because callbacks carry no run ID.
  - oauth-mcp does no P1AZ itself (scope checks only), and `:8080` is published.
  - The langchain `auth_token` and direct-MCP path is dead code.
  - The P1AZ policy has no rules for A2A specialist tools, so no-gateway A2A is denied by design.

## Out of scope

- Tokens shown in the browser are teaching, and that is fine. Every browser item from the earlier version of this plan is dropped (Show Token, the `_auth` cookie id_token, the `jwt_decode_full` chip injection, `test-introspect`, `/api/api-calls/tokens`, the A2A response token, the SSE scrub). The only exception is the cross-user delegation fix (gap 5).

## Do-not-break (regression-guard)

- Gateway-mode A2A is unchanged: the gateway decides and the BFF check stays skipped.
- Non-A2A tool calls are unchanged.
- The `runReasonLoop` no-tool shape stays byte-identical, and `toolResults` still carries the payloads (grounded answers), with only JWTs redacted.
- The admin agent's read intents and its "create a user" intent keep working.
- The JWT verifier's decode and validate tools, and verification against PingOne's JWKS, keep working.
- Delegation revocation, both normal and admin hard revoke, keeps working.

## Execution

In a worktree, on branch `fix/llm-token-custody`, with files staged explicitly. One PR.

## Verification

1. **Scoped:** `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/llmTokenCustody.regression.test.js <the existing suites above> --forceExit`.
2. **Full server suite** (`CI=true npm test -- --forceExit`), because this touches the MCP pipeline's authorize path.
3. **Python:** `cd demo_mcp_jwt_verifier && python -m pytest test_jwks_allowlist.py`.
4. **Prove the guard works:** revert the `mcpToolPipeline.js:506` change and confirm case 1 goes red, then restore it.
5. **Live**, after merge and deploy, with the stack generation pinned before and after, on `local.ping-devops.com:4000` with the Super Sports vertical:
   - A2A handoff ("hand off to a specialist") still works in gateway mode, and the token chain shows the gateway's P1AZ decision.
   - Admin agent: "list users" and "create a user" work. Asking it to delete a user is refused as not allowed.
   - Asking the agent to verify a JWT against `http://169.254.169.254/` returns `jwks_uri_not_allowed`.
   - No-gateway mode is proven by guard case 1. The shared stack is only switched to `docker-compose.no-gateway.yml` if whoever holds it agrees.
