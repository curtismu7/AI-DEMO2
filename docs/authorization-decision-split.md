# Authorization Decision Split — Agent Gateway vs PingOne Authorize (P1AZ)

**Scope:** what decisions the *Agent Gateway* (PEP) makes locally, what decisions
*PingOne Authorize* (PDP) makes, and whether that split matches best practice.

**Source of truth for this doc:** code read on `main` at 2026-07-18. Every claim
below carries a `file:line`. Two gateway implementations exist and the split
differs between them — that difference is itself a finding.

---

## 0. TL;DR

| Question | Answer |
|---|---|
| Who decides *authentication* (token real, live, mine)? | Gateway. Correct. |
| Who decides *coarse* access (scope, audience, anti-bypass)? | **Both** — gateway locally *and* the mock PDP. Duplicated. |
| Who decides *business* policy (amount, tier, group, step-up, HITL)? | P1AZ (mock). **The real cloud P1AZ policy sees almost none of it** — see §5. |
| Is the PDP authoritative? | No. The gateway silently substitutes its own local scope engine when P1AZ is off (`MCP_GW_P1AZ_ENABLED` default **false**). |
| Is the same policy evaluated twice? | Yes — BFF `McpFirstTool` gate + gateway `McpToolCall` gate. The product's own flag help text admits it (`demo_api_server/routes/featureFlags.js:657`). |
| Biggest correctness defect | `DecisionContext` mismatch makes the entire MCP Delegation policy unreachable for `tools/list` and non-tool calls (§5.1). |

---

## 1. The two topologies

`ff_mcp_gateway_pinggateway` (`demo_api_server/services/configStore.js:320`,
default **`'true'`**) picks the gateway:

- **Path B (DEFAULT): PingGateway / IG** — `ping-gateway/config/routes/*.json`,
  policy call in `ping-gateway/scripts/groovy/p1az-decision.groovy`.
- **Path A: Node gateway** — `demo_mcp_gateway/`, policy call in
  `src/auth/PingOneAuthorizeClient.ts`.

They do **not** enforce the same things. Any statement of the form "the gateway
checks X" must name the path.

---

## 2. Decision order for one agent tool call (default path)

```
1. UI chip / chat                 session cookie
2. BFF requireSession             middleware/auth.js:1148
3. BFF mints Intent Token         server.js:1888-1946        [MINT]
4. BFF token chain (RFC 8693)     agentMcpTokenService.js:2023
      CC#1 agent actor -> Exchange#1 -> CC#2 mcp actor -> Exchange#2
5. BFF HITL receipt verify        mcpToolAuthorizationService.js:279   <- BEFORE decision
6. BFF -> P1AZ  DECISION #1       pingOneAuthorizeService.js:521  DecisionContext=McpFirstTool
7. BFF RFC 7662 introspection     mcpToolPipeline.js:497
8. BFF -> Gateway                 mcpGatewayClient.js:88
9. Gateway authn (introspect/JWKS, aud, scope)
10. Gateway local policy (rate limit, shape, arg schema, HITL, intent, DPoP, RAR)
11. Gateway -> P1AZ DECISION #2   p1az-decision.groovy:383 / PingOneAuthorizeClient.ts:279
12. Gateway RFC 8693 Exchange#3   olb-token-exchange.groovy:100 / McpTokenExchangeClient.ts:73
13. MCP server: D-05 upstream contract + per-tool scope   MCPMessageHandler.ts:340
```

Two full policy evaluations per tool call (steps 6 and 11). HITL *verification*
is always an **input** to the decision; HITL *challenge creation* is always a
**consequence** of an `INDETERMINATE` decision.

---

## 3. What the AGENT GATEWAY decides

### 3.1 Node gateway (Path A) — `demo_mcp_gateway/`

| Decision | Where | Deny | Notes |
|---|---|---|---|
| CORS origin | `GatewayServer.ts:670` | 403 | `:672` no `Origin` header ⇒ pass. Not applied to `DELETE /mcp` (`:336`). |
| Bearer present | `GatewayServer.ts:453` | 401 + RFC 9728 hint | |
| JWT signature (JWKS) | `tokenValidator.ts:176-212` | 401 | `:181` kid-less token verified against `ks[0]`. |
| `exp`, `aud` | `tokenValidator.ts:230,238` | 401 | **`nbf`, `iss`, `iat`, `azp` never checked** |
| RFC 7662 introspection | `authorizeMcpRequestCore.ts:87` | 401 / 503 | fail-closed. Introspected `scope`/`aud` returned but never compared to the JWT (`:99-107`). |
| `sub` present, `act.sub` shape | `GatewayTokenPolicy.ts:44,56` | 401 | actor **allow-list** is dead code — `validateActClaim` imported, never invoked. |
| D-05 anti-bypass (aud not an upstream RS) | `GatewayTokenPolicy.ts:101` | 401 | |
| UC16 require-`act` | `GatewayTokenPolicy.ts:74` | -32403 | **unreachable on HTTP** — `authorizeMcpRequestCore.ts:112` calls `validate()` without `toolName`/`decisionContext`. |
| Rate limit (UC18) | `authorizeMcpRequest.ts:171` | 429 | `sub` decoded **unverified** (`:179`); limiter singleton frozen at first request (`:128`). |
| JSON-RPC envelope + method allow-list | `mcpRequestValidation.ts:37` | 400 | |
| Per-tool arg JSON Schema | `mcpRequestValidation.ts:53` | 400 | unknown tool fails closed. Good. |
| HITL receipt verify | `authorizeMcpRequest.ts:447` | 403 / 503 | `:447` if `HITL_SERVICE_URL` unset the receipt is **silently ignored**. |
| Intent token HMAC + exp + tool binding | `intentTokenValidator.ts:73` | 403 only if `INTENT_TOKEN_REQUIRED=true` | `iss`, `sub`, `jti` replay, `prompt_hash` parsed, **none enforced**. |
| DPoP (RFC 9449) | `dpopVerify.ts:53` | 401 only if `REQUIRE_DPOP_PROOF=true` | `htu` path only, origin not pinned. No DPoP on WebSocket at all. |
| Web Bot Auth (RFC 9421) | `webBotAuthVerify.ts:104` | 401 only in `enforce`; default `monitor` | `Signature-Agent` origin not allow-listed. |
| RAR subset (RFC 9396) | `rarEnforce.ts:42` | 403 only if `REQUIRE_RAR_INTENT=true` | grant source is the **unsigned** `X-TraT-Context`. |
| **Local scope PERMIT/DENY** | `toolScopes.ts:56`, used at `PingOneAuthorizeClient.ts:203` | 403 | **This is a second PDP.** Runs whenever `MCP_GW_P1AZ_ENABLED=false` (the default). |
| RFC 8693 Exchange#3 | `McpTokenExchangeClient.ts:73` | 502 | no `actor_token` sent; issued token never validated (`:124`). |
| Backend dispatch | `apiKeyDispatch.ts:142`, `dualTokenDispatch.ts:104` | -32401/-32500 | dual-token forwards the **inbound gateway-aud bearer unchanged** (`:114`) to a URI that `GatewayTokenPolicy.ts:105` blacklists. |

### 3.2 PingGateway / IG (Path B, default)

| Decision | Where | Deny |
|---|---|---|
| Introspection + `aud` (resourceId) + scope `gateway:mcp:invoke` | `01-mcp-olb.json:40-48,95-101` | 401/403 |
| JWKS local validation variant (`X-Token-Validation: jwks`) — sig, `exp`, `nbf`, **`iss`**, `aud`, scope | `jwks-token-validation.groovy:115-181` | 401 |
| Method allow-list + tool arg subset-schema | `mcp-request-validation.groovy:50-87` | 400 |
| Rate limit | `uc18-rate-limit.groovy:27` | 429 |
| Trusted-caller gate on delegation headers | `p1az-decision.groovy:71-82` | headers dropped, request continues |
| RFC 8693 Exchange#3 | `olb-token-exchange.groovy:100` | 401/502 |
| API-key dispatch tool allow-list | `apikey-dispatch.groovy:106` | -32601 |

**IG does NOT enforce locally:** actor allow-list, D-05 anti-bypass, intent
token, DPoP, RAR, TraT, per-tool scope. All of that is either delegated to the
PDP or (intent/TraT/DPoP/RAR) **enforced nowhere on this path** — see §6.1.

---

## 4. What P1AZ decides

### 4.1 Real cloud policy (`snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json`)

> **The cloud policy has no tracked source of truth.** `.gitignore:32` ignores
> `snapshots/*`, so every file cited in this section is an untracked local
> artifact. PingOne Authorize also exposes no policy API for COMPARISON
> conditions (`snapshots/gen-authorize-snapshot.js` header) — the policy can only
> be changed by importing a snapshot. The nearest thing to a SoT is that
> reconciler script plus `scope-topology.json`. A `…FIXED.json` variant is
> present in the main checkout and silently drops three tools from the consent
> list; importing it is now blocked (§6.3 item 7).

PolicySet `Super Banking Policies`, `DenyOverrides`, `evaluateAll:true`, two
children gated on `IsMcpFirstToolRequest` = `DecisionContext == "McpFirstTool" OR "McpToolCall"`.

**Policy `Super Banking Transaction Authorization`** (guard: NOT MCP):

| Rule | Condition | Statement |
|---|---|---|
| Deny Large Transactions | `Amount > 2000` | `transaction-denied` |
| Require Step-Up MFA | `Amount > 500 AND type in (transfer,withdrawal) AND NOT Acr==Multi_Factor` | `step-up-required` |
| Require Consent | `Amount > 250` | `HITL_CONSENT` |
| Permit Standard | always | `transaction-approved` |

**Policy `Super Banking MCP Delegation Authorization`** (guard: MCP):

| Rule | Condition |
|---|---|
| Deny — Invalid Token Audience | `NOT (TokenAudience == McpResourceUri)` |
| Deny — Missing User ID | `UserId in ("none","")` |
| Deny — Invalid Actor Chain | `ActClientId` not in a 7-entry client-id allow-list |
| Deny — Invalid A2A Generalist | `ActChainDepth > 1 AND NestedActClientId != 71e878ea-…` |
| Deny — Tier Tool Not Allowed | `UserTier==Standard AND ToolName in (create_withdrawal, withdraw)` |
| Deny — Tier Amount Exceeded | `Standard>2000 OR PrivateBanking>50000` |
| Deny — Not In Required Group | `RequiredGroup != none AND InRequiredGroup == false` |
| Require HITL Consent | `ToolName in <14 sensitive tools> AND HitlApproved != true` |
| Require Step-Up | `ToolName in <10 write tools> AND NOT Acr==Multi_Factor` |
| Permit Valid Tool Invocation | always |

17 Trust-Framework attributes only: `Amount, TransactionType, UserId, Acr,
Timestamp, ipAddress, DecisionContext, ToolName, TokenAudience, ActClientId,
NestedActClientId, McpResourceUri, HitlApproved, ActChainDepth, UserTier,
RequiredGroup, InRequiredGroup`.

### 4.2 Mock PDP (`demo_authz_server/routes/decision.js:110`)

23 rules in order — a **superset** of the cloud policy. Cloud has no equivalent
for any of these:

| Mock rule | Line | Cloud equivalent |
|---|---|---|
| 0b aud in expected set | `:211` | partial (`HasValidMcpAudience`) |
| 0b-2 D-05 anti-bypass | `:231` | **none** |
| 0c/0d/0e/0f `exp` `iat` `nbf` `iss` | `:259-295` | **none** |
| 1 tools/list + PingOne user lookup + advice | `:300` | **none** |
| 0a2 user exists / enabled / active | `:354` | partial (`HasValidUserId` is a string test only) |
| 1b ChipAuthorization | `:384` | **none** |
| 1c A2A act chain | `:413` | yes |
| 2 actor allow-list | `:441` | yes |
| 2.5 UC16 require-`act` | `:461` | **none** |
| 3 per-tool required scopes | `:472` | **none** |
| 3.5a resource-owner match | `:501` | **none** |
| 3.5b group membership | `:514` | yes |
| 3b hard amount ceiling 2000 | `:554` | yes (transaction policy only) |
| 3c RAR amount/payee | `:573` | **none** |
| 3d entitlement tier | `:614` | yes |
| 4 STEP_UP / HITL_CONSENT | `:647` | yes |
| 4a/4b intent tamper / mismatch | `:694` | **none** |

Mock returns `{decision, reason, decision_id}` plus `advice` on the tools/list
path. It **never emits `statements` or `obligations`** — the shape the cloud
returns. Consumers therefore parse two different response contracts
(`pingOneAuthorizeService.js:1156-1190` merges six possible locations).

---

## 5. Reachability — which rules actually fire

Diffing the 17 cloud attribute names against each caller's payload keys:

### 5.1 `DecisionContext` mismatch kills the MCP policy (**critical**)

`IsMcpFirstToolRequest` matches only `McpFirstTool` or `McpToolCall` (verified in
the snapshot condition). Both gateways send:

- `McpToolCall` for `tools/call` — matches ✓
- **`McpToolsList` for `tools/list`** (`pingAuthorizeGuard.ts:96`, `p1az-decision.groovy`)
- **`McpRequest` for everything else** (`PingOneAuthorizeClient.ts:104`)

For the latter two, `NOT IsMcpFirstToolRequest` is true, so the **Transaction**
policy runs instead with no `Amount` present, reaching only the always-true
`Permit Standard Transactions` rule → unconditional PERMIT. **No MCP delegation
rule ever evaluates for tool discovery or session lifecycle against the real
policy.**

### 5.2 Dead attributes on the gateway paths

Neither gateway sends `Acr`, `Amount`, `UserTier`, `RequiredGroup`,
`InRequiredGroup`, `Timestamp`, `ipAddress`. Consequences:

- Tier tool/amount rules and group rule are **permanently dead** on both gateway paths.
- `RequiresMcpStepUp` reduces to a pure tool-name test — `NOT (Acr == Multi_Factor)`
  is always true when `Acr` defaults to `none`, so a completed MFA **never**
  discharges step-up on a gateway-originated call.
- Both gateways send `TransactionAmount`; the Trust Framework only defines
  `Amount`. **The gateways' amount value is silently dropped by the real policy.**
  There is no amount ceiling at all on the MCP branch.

### 5.3 `TokenAudience` is a constant, so its rule can never fire

`PingOneAuthorizeClient.ts:121-122` and `p1az-decision.groovy:340-342` set
`TokenAudience` **and** `McpResourceUri` to the same `gatewayResourceUri`. Cloud
rule `HasValidMcpAudience` and mock Rule 0c compare exactly those two values —
they are equal by construction. `demo_authz_server/routes/decision.js:249-250`
states this in a comment. Only `TokenAudActual` (mock-only) carries signal.

### 5.4 BFF path

`evaluateMcpToolDelegation` (`pingOneAuthorizeService.js:521`) never sends
`ActChainDepth` (default `0`), so **`Deny — Invalid A2A Generalist` is
unreachable from the BFF**. It sends seven params with no matching attribute
(`ResourceOwnerId`, `RarMaxAmount`, `RarPermittedPayees`, `ToAccountId`,
`HitlChallengeId`, `TransactionAmount`, `Vertical`) — inert against the cloud.

### 5.5 Mock rules unreachable from the BFF

Mock Rules 2.5 (UC16) and 3d (tier) are gated on `DecisionContext === 'McpToolCall'`
(`decision.js:462,614`). The BFF sends `McpFirstTool` → both skipped for every
BFF-originated call. Mock Rule 1b `ChipAuthorization` can never be reached at all:
its only caller (`routes/verticalManifest.js:184`) sends no audience, so Rule 0b
denies `invalid_aud` first.

---

## 6. Best-practice assessment

Reference posture: **PEP does authentication and channel binding; PDP owns all
authorization policy; PEP fails closed; one policy, one place, fully instrumented.**

### 6.1 ❌ Findings — where the split is wrong

**F1. Two PDPs, silently swapped (critical).**
`MCP_GW_P1AZ_ENABLED` defaults to `false` (`demo_mcp_gateway/src/config.ts:227`).
When off, `PingOneAuthorizeClient.ts:203-219` runs a **local scope engine** over
`scope-topology.json` for `tools/call` and calls it a PERMIT. Same config,
`tools/list` hard-denies (`pingAuthorizeGuard.ts:96`). One flag flip changes both
*who decides* and *the deny posture*, with no operator-visible signal in the
decision response. This is the single worst violation: policy is not externalized,
it is *conditionally* externalized.

**F2. The real policy is largely inert (critical).**
Per §5, on the default topology the cloud policy evaluates: audience (tautology),
`UserId != none`, actor allow-list, and a tool-name-only step-up. Amount, tier,
group, MFA state, scope, and A2A depth all no-op. The demo *appears* to be
policy-driven; the mock is what actually enforces.

**F3. Policy evaluated twice with different inputs (high).**
BFF `McpFirstTool` + gateway `McpToolCall` hit the same PDP with **different
parameter sets** (BFF sends `Acr`/`Amount`/tier; gateways don't). Two evaluations
that can legitimately disagree, and the product's own flag help says to turn one
off (`featureFlags.js:657`). Best practice is one PDP call at the enforcement
boundary, with the BFF passing context, not re-deciding.

**F4. Claims minted and never verified (high).**
- **Intent Token**: minted `server.js:1930`, sent `mcpGatewayClient.js:136`,
  verified only in the Node gateway. `grep -rn "Intent" ping-gateway/` returns
  **zero hits**. On the default path the intent binding is decorative.
- **`X-TraT-Context`** (carrying RAR details, `cnf.jkt`, purpose): same — no IG
  consumer. RAR/DPoP-binding facts never reach the PDP by default.
- **`nestedActOk`** and **`audMatches`** are computed at
  `agentMcpTokenService.js:2345-2346` and used only in a log string.

**F5. Fail-open paths that defeat the gate (high).**
- `mcpToolAuthorizationService.js:210-212` — **admin role skips the entire authz gate.**
- `:706-709` — `failoverMode='permit'` returns `{ran:false}`; the gate is skipped
  and the caller cannot tell.
- `mcpToolPipeline.js:206-233` — token-exchange failure falls back to the **local
  tool handler**, bypassing gateway *and* MCP server.
- `tokenValidator.ts:170` — no JWKS configured and `STRICT_AUTH!=='true'` ⇒
  `jwt.decode`, **zero signature verification**.
- `authorizeMcpRequest.ts:161` — `MCP_GW_DEV_BYPASS` forwards the raw bearer.
- `olb-token-exchange.groovy:86` — `X-BFF-Exchanged: true` suppresses Exchange #3
  and **is not behind the internal-secret gate** that guards the sibling headers
  in `p1az-decision.groovy:71`.

Each is individually defensible for a demo; collectively there is no single
"is the gate actually armed" signal.

**F6. Security controls default to advisory (medium).**
`REQUIRE_DPOP_PROOF`, `INTENT_TOKEN_REQUIRED`, `REQUIRE_RAR_INTENT`,
`REQUIRE_ACT_FOR_AGENT_TOOLS` all default false; `MCP_GW_WBA_MODE` defaults
`monitor`. Monitor-first rollout is legitimate practice — but nothing reports the
aggregate posture, so "we implement RFC 9449/9421/9396" is true of the code and
false of the running default.

**F7. Two enforcement paths with different verdicts for the same token (medium).**
The IG JWKS path checks `iss` and `nbf` (`jwks-token-validation.groovy:166`); the
Node gateway checks neither (`tokenValidator.ts:230-248`). Rate limits differ
(20/60s vs 3/10s). Node validates tool args on every route; IG only on 2 of its 6
routes. A token accepted by one gateway can be rejected by the other.

**F8. Deny reasons come from the wrong source (medium).**
`authorizeMcpRequest.ts:794` populates `required_scopes` in every denial body from
the **local** topology even when P1AZ denied for an unrelated reason — the
operator hint can contradict the actual decision. Statement codes
(`mcp-tier-amount-exceeded` etc.) classify to `null` in
`authorizeObligations.js:63-65` and drive no branch; a renamed code degrades
silently because `pingOneAuthorizeService.js:1177-1187` excludes `statements`
from its unknown-type warning.

**F9. Mock and cloud contracts have drifted (medium).**
Mock returns `reason` strings; cloud returns `statements`. Mock enforces 10 rules
cloud doesn't. `import-snapshot.js:68-83` detects consent-tool mismatch but only
**reports** it. `Super_Banking_…FIXED.json` drops 3 tools from the consent list —
importing it silently un-gates `sensitive_holdings`, `sensitive_student_finance`,
`sensitive_supplier_contract`.

**F10. Actor chain asserted, never re-bound (medium).**
Both Exchange #3 implementations (`McpTokenExchangeClient.ts:93-100`,
`olb-token-exchange.groovy:100-106`) send **no `actor_token`**. Whatever `act`
reaches the MCP server is whatever the AS chose to copy, and
`MCPMessageHandler.ts:340-401` never inspects `act`. The delegation chain is
verified at the gateway and then dropped at the last hop.

**F11. Banking scopes are enforced nowhere on the default path (medium).**
The final token carries only `gateway:mcp:invoke`
(`agentMcpTokenService.js:2336`); mock Rule 3 explicitly **skips** the scope check
when that scope is present (`decision.js:484-493`); IG checks only
`gateway:mcp:invoke`; the MCP server's per-tool check sees the re-exchanged token
minted with a static `scope=olbScope`. Least-privilege is asserted in the
topology file and enforced by nobody.

### 6.2 ✅ What is right

- **Authn stays at the PEP.** Signature, introspection, `aud`, `exp` are gateway
  concerns and are handled there. Correct layering.
- **Introspection over pure JWKS by default** (`ff_mcp_gateway_jwks` default
  `false`) — accepts revocation latency of 5s (`GatewayIntrospectionClient.ts:32`)
  instead of the JWKS path's unbounded window. Right call, and the JWKS groovy
  documents the tradeoff at `:22-24`.
- **HITL as a decision input, challenge as a decision output.** Receipt verified
  *before* the call, challenge created only on `INDETERMINATE`. That is the
  correct obligation loop, and the receipt is two-side bound to user, agent,
  tool, and amount (`hitlClient.ts:132-222`).
- **Unknown tools fail closed** at arg validation (`mcpRequestValidation.ts:55`)
  on both paths.
- **PDP errors fail closed by default.** `P1AZ_ALLOW_MOCK_FAILOVER` defaults off;
  `p1az-decision.groovy:411`, `pingAuthorizeGuard.ts:154`,
  `PingOneAuthorizeClient.ts:309` all deny on failure.
- **Deny-overrides + evaluate-all** on the cloud policy set is the right combining
  algorithm for a security policy, and `evaluateAll` preserves full reason detail.
- **Rich decision inputs.** 20–30 parameters per call including act chain,
  token temporal claims, and RAR — the *plumbing* for a real PDP exists; the
  Trust Framework just hasn't been extended to consume it.

### 6.3 Ranked fix list

| # | Fix | Why first |
|---|---|---|
| 1 | Add `McpToolsList` and `McpRequest` to `IsMcpFirstToolRequest`, or send `McpToolCall` for all MCP contexts | F2/§5.1 — restores the entire MCP policy |
| 2 | Add Trust-Framework attributes for what the gateways already send (`TokenAudActual`, `TokenScopes`, `Token{Exp,Iat,Nbf,Iss}`, `ToAccountId`, `Vertical`), and make the gateways send `Amount`/`Acr` | F2/§5.2 — every dead rule traces here |
| 3 | Make `MCP_GW_P1AZ_ENABLED=false` refuse to serve rather than substitute a local PDP | F1 |
| 4 | Pick one policy evaluation point; make the other pass context only | F3 |
| 5 | Add IG groovy verifiers for `X-Intent-Token` and `X-TraT-Context`, or stop minting them on that path | F4 |
| 6 | Expose one "gate armed" health field aggregating F5/F6 defaults | F5, F6 |
| 7 | Make `import-snapshot.js` parity failures blocking, not advisory | F9 |
| 8 | Send `actor_token` on Exchange #3; check `act` at the MCP server | F10 |

---

## 7. One-line summary

The **Agent Gateway** is a competent PEP that also carries a shadow PDP; **P1AZ**
is the nominal PDP whose real-world policy is starved of the attributes it needs
to decide anything. The architecture is right; the wiring between the two is
where it breaks.
