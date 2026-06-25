# act and may_act Claim Verification Guide

## Overview

This document explains how to verify that PingOne is correctly issuing `act` and `may_act` delegation claims in the token exchange flow (RFC 8693).

> ## ✅ Verified status (updated 2026-06-19)
>
> - **`may_act` works** via a **resource attribute mapping**. The user record carries a JSON-typed `mayAct` attribute (`{ "sub": "<actor-client-id>" }`) and the resource projects it with `${user.mayAct}`. Confirmed live: user access tokens carry `may_act = { sub: <AI Agent client_id> }`.
> - **`act` works** — PingOne emits a native `act` claim via a resource attribute. The trick is the **`${…}` wrapper around the official SPEL**; earlier failures were a wrapper bug, not a PingOne limitation. The deployed value (type CUSTOM) is the **null-safe** form (guards against no-actor / no-`may_act` exchanges so the token mint never null-derefs):
>   ```
>   ${(#root.context.requestData.actorToken != null and #root.context.requestData.subjectToken.may_act != null and #root.context.requestData.subjectToken.may_act.sub == #root.context.requestData.actorToken.client_id) ? #root.context.requestData.subjectToken.may_act : null}
>   ```
>   Confirmed live (2026-06-19): exchanging a `may_act`-bearing user token with an actor token whose `client_id == may_act.sub` produced `act = { "sub": "<AI Agent client_id>" }` (a real JSON object) on **both** the `mcpgateway` and `agentgateway` resources. When the actor doesn't match (or there's no actor), the expression returns `null` and the claim is omitted.
> - **Rollout:** the null-safe `act` SPEL is now deployed on **all three** downstream resources — `mcpgateway`, `mcpserver`, and `agentgateway` (verified via the Management API). `enduser` carries `may_act`, not `act` (correct — it's the first hop).
> - **Why prior attempts failed (corrected):** `${actor.client_id}` → 400 (wrong reference); `#{…}` wrapper → emitted **literally**; **bare** `(#root…)` (no wrapper) → emitted **literally**; **`${(#root…)}`** → **evaluated** ✅. So the long-standing "act is impossible / SPEL emitted literally" conclusion was a one-character wrapper bug.
> - **Header bridge status (NOT redundant):** the `X-Act-Client-Id` / `X-May-Act-Sub` headers (`mcpActorBridge.buildActorBridgeHeaders()`) remain a **deliberate fallback**. The gateway **prefers a native token `act`** and falls back to the header on hops/flows where native `act` isn't guaranteed (no-actor exchanges, Exchange-#2, platform-connector mode). `X-May-Act-Sub` additionally carries the per-user `may_act.sub` for the `ENFORCE_MAY_ACT` decision gate — that has no native-claim equivalent. **Do not remove the bridge.**

## Background

The banking demo architecture relies on delegation claims to establish a clear chain of custody:

- **`may_act`** (in the **user access token**): Prospectively authorizes a downstream actor to exchange the token
- **`act`** (in the **exchanged MCP token**): Identifies the current actor under RFC 8693 Section 4.1
- **Nested `act.act`** (when PingOne preserves the full 2-exchange chain): Identifies the prior actor in a multi-hop delegation chain

Without these claims, the delegation chain is invisible in audit logs, authorization policy, and token introspection.

## Prerequisites

### PingOne Configuration Required

For the delegation chain you need:

1. **Token Exchange Grant** enabled on the OAuth applications that perform exchanges
2. **`may_act` resource attribute** that projects each user's `mayAct` declaration into their access token
3. **`act` resource attribute** (the null-safe `${(#root…)}` SPEL below) on the audience resource — emits native `act` when the actor matches `may_act`. Deployed on `mcpgateway`, `mcpserver`, and `agentgateway`. The **`X-Act-Client-Id` header bridge** remains as a deliberate fallback (see status callout) — not removed.

### Configuration Steps

#### 1. Enable Token Exchange Grant

In PingOne Admin Console:
1. Navigate to **Applications** → the application that performs the exchange
2. Go to **Configuration** → **Grant Types**
3. Enable **Token Exchange** (`urn:ietf:params:oauth:grant-type:token-exchange`)
4. Save changes

#### 2. Configure the `may_act` resource attribute (this works)

`may_act` is added by a **resource attribute mapping**, not a token policy. This is what the provisioning code does (`pingoneProvisionService._setResourceAttribute`):

- On the user's resource(s) (e.g. `enduser.ping.demo`, the MCP resource), add a CUSTOM attribute named `may_act` with value **`${user.mayAct}`**.
- Store the per-user declaration on the user record as a **JSON-typed** `mayAct` attribute: `{ "sub": "<actor-client-id>" }`.

```http
POST /v1/environments/{envId}/resources/{resourceId}/attributes
{ "name": "may_act", "value": "${user.mayAct}", "type": "CUSTOM" }
```

Result: user access tokens carry `may_act = { "sub": "<actor-client-id>" }`.

> Do **not** use a `#{...}` SpEL literal — PingOne emits it verbatim as a string (the recurring bug). Only `${user.X}` projections work, and the value must be a JSON-typed user attribute to emit a JSON object.

#### 3. Configure the `act` resource attribute (this works)

Add a CUSTOM attribute named `act` on the **audience resource** (the resource the exchanged token targets — e.g. Agent Gateway for the user→agent hop). The value is the official PingOne "Securing AI Agents" SPEL **wrapped in `${…}`** (the wrapper is what makes PingOne evaluate it), in its **null-safe** form (currently deployed on `mcpgateway`, `mcpserver`, and `agentgateway`):

```http
POST /v1/environments/{envId}/resources/{resourceId}/attributes
{
  "name": "act",
  "type": "CUSTOM",
  "value": "${(#root.context.requestData.actorToken != null and #root.context.requestData.subjectToken.may_act != null and #root.context.requestData.subjectToken.may_act.sub == #root.context.requestData.actorToken.client_id) ? #root.context.requestData.subjectToken.may_act : null}"
}
```

Result: when the exchange presents an actor token whose `client_id` equals the subject's `may_act.sub`, the exchanged token carries `act = { "sub": "<actor client_id>" }` (a real JSON object). Otherwise the expression returns `null` and `act` is omitted.

> **Wrapper matters.** `${actor.client_id}` → 400 (invalid reference). `#{…}` or a **bare** `(#root…)` (no `${}`) → emitted as a **literal string** (the long-standing bug). Only the `${(#root…)}` form is evaluated.
>
> **Null-safety.** A *simple* expression (just the `==` comparison, no null guards) null-derefs if an exchange to that resource has **no actor token** (a simple/no-actor exchange) or a subject with **no `may_act`** — which can break the token mint. The deployed value above includes the `actorToken != null and subjectToken.may_act != null` guards, so it is safe on resources whose audiences also see no-actor and Exchange-#2 flows. For native `act` to actually populate on a given hop, that hop must use the AI Agent as the `actor_token` so `client_id == may_act.sub`; where a hop doesn't, the `X-Act-Client-Id` header bridge carries the actor as a fallback.

## Verification Methods

### Method 1: Automated Script

Use the provided verification script:

```bash
# 1. Start the server
cd banking_api_server
npm start

# 2. Log in via browser to obtain a session token
# 3. Extract the access token from the session (check server logs or use debugger)

# 4. Run the verification script
ACCESS_TOKEN=eyJhbGc... node scripts/verify-act-claims.js
```

The script will:
- Decode the user access token and check for `may_act`
- Perform token exchange to get the MCP access token
- Decode the MCP access token and check for `act`
- Report findings with clear success/failure indicators

### Method 2: Manual Token Inspection

1. **Capture user access token**
   - Log in to the application
   - Open browser DevTools → Network tab
   - Find any API request to `/api/accounts` or similar
   - The server has the token in `req.session.oauthTokens.accessToken`

2. **Decode user access token**
   ```bash
   # Use jwt.io or decode manually
   echo "eyJhbGc..." | base64 -d
   ```

3. **Look for may_act claim**
   ```json
   {
     "sub": "user-id",
     "aud": "client-id",
     "scope": "openid profile email",
     "may_act": {
       "sub": "bff-client-id"
     }
   }
   ```

4. **Trigger Token Exchange**
   - Use the Banking Agent to call any MCP tool
   - Check server logs for token exchange events

5. **Decode MCP access token (exchanged)**
   - Extract from MCP server logs or intercept WebSocket traffic
   - Decode and look for `act` claim:
   ```json
   {
     "sub": "user-id",
     "aud": "mcp-server-audience",
     "scope": "banking:read banking:write",
     "act": {
       "sub": "mcp-client-id",
       "act": {
         "sub": "agent-client-id"
       }
     }
   }
   ```

### Method 3: Token Chain UI

The application includes a Token Chain visualization panel:

1. Open the Banking Agent
2. Execute any banking operation (e.g., "Show my accounts")
3. Click the **Token Chain** button in the UI
4. Review the token events:
   - Event 1: User access token — should show `may_act` present/absent
   - Event 2: Token Exchange - should show success/failure
   - Event 3: MCP access token — should show `act` present/absent

## Expected Results

### ✅ Success Scenario

**User access token:**
```json
{
  "sub": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "aud": "12345678-90ab-cdef-1234-567890abcdef",
  "scope": "openid profile email",
  "may_act": {
    "sub": "12345678-90ab-cdef-1234-567890abcdef"
  },
  "iss": "https://auth.pingone.com/...",
  "exp": 1234567890,
  "iat": 1234564290
}
```

**MCP access token (full 2-exchange chain) — RFC 8693 nested shape. The single-hop `act = { sub }` is verified live (see status callout). The null-safe `act` SPEL is now on all three downstream resources; the nested `act.act` for the full chain additionally requires each hop to present the matching `actor_token` so every link populates:**
```json
{
  "sub": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "aud": "https://mcp.banking-demo.com",
  "scope": "banking:accounts:read",
  "act": {
    "sub": "mcp-client-id",
    "act": {
      "sub": "agent-client-id"
    }
  },
  "iss": "https://auth.pingone.com/...",
  "exp": 1234567890,
  "iat": 1234564290
}
```

### ❌ Failure Scenarios

#### Scenario 1: may_act missing from user access token

**Symptom:** Token exchange fails with error
```
{
  "error": "invalid_grant",
  "error_description": "Token exchange not authorized"
}
```

**Cause:** PingOne token policy not configured to add `may_act` claim

**Fix:** Configure may_act token policy (see Configuration Steps above)

#### Scenario 2: Token exchange succeeds but act missing from MCP access token

**Symptom:** MCP access token is issued but contains no `act` claim.

**Most likely causes (in order):**
1. The audience resource has **no `act` attribute** configured — add the `${(#root…)}` SPEL from Configuration Step 3.
2. The `act` value was entered **without the `${…}` wrapper** (or with `#{…}`) — PingOne then emits it as a literal string or omits it. Use exactly the `${(#root…)}` form.
3. The exchange's **actor token's `client_id` ≠ the subject's `may_act.sub`** — the expression correctly returns `null`, so `act` is omitted. Align the actor (use the AI Agent as the `actor_token`) so it matches the user's `may_act`.

**Fallback:** where native `act` doesn't populate on a given hop (e.g. the actor token's `client_id` doesn't match the subject's `may_act.sub`, or a no-actor exchange), the demo carries the actor via the **`X-Act-Client-Id` header** (`mcpActorBridge.buildActorBridgeHeaders()`); the gateway prefers a native token `act` and falls back to the header. This bridge is a deliberate, retained fallback — not redundant.

#### Scenario 3: REQUIRE_MAY_ACT=true Blocks Exchange

**Symptom:** Token exchange rejected before reaching PingOne
```
{
  "error": "may_act_required",
  "message": "REQUIRE_MAY_ACT=true but the user token has no may_act claim"
}
```

**Cause:** Pre-flight validation in `agentMcpTokenService.js` enforcing may_act presence

**Fix:** Either:
1. Add may_act to user tokens via PingOne policy, OR
2. Set `REQUIRE_MAY_ACT=false` for local testing (not recommended for production)

## Environment Variables

| Variable | Purpose | Required | Example |
|----------|---------|----------|---------|
| `MCP_RESOURCE_URI` | Audience for exchanged token | Yes (for exchange) | `https://mcp.banking-demo.com` |
| `USE_AGENT_ACTOR_FOR_MCP` | Include actor token in exchange | No | `true` |
| `REQUIRE_MAY_ACT` | Enforce may_act pre-flight check | No | `true` |
| `AGENT_OAUTH_CLIENT_ID` | Agent client ID for actor token | Only if `USE_AGENT_ACTOR_FOR_MCP=true` | `agent-client-id` |

## Troubleshooting

### Token Exchange Fails with "invalid_grant"

1. Check PingOne application has Token Exchange grant enabled
2. Verify `may_act` claim is present in the user access token
3. Check PingOne logs for detailed error message
4. Ensure Backend-for-Frontend (BFF) client credentials are correct

### act claim not present in MCP access token

`act` **is** emittable via a resource attribute — see the status callout and Failure Scenario 2 for the three checks (attribute present? `${(#root…)}` wrapper exact? actor `client_id` == subject `may_act.sub`?). Where native `act` doesn't populate on a hop, the `X-Act-Client-Id` header carries the actor as a deliberate fallback.

### Script Reports "ACCESS_TOKEN not set"

1. Start the server: `npm start`
2. Log in via browser
3. Extract token from session (use debugger or server logs)
4. Set environment variable: `ACCESS_TOKEN=eyJ... node scripts/verify-act-claims.js`

## References

- [RFC 8693 - OAuth 2.0 Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693)
- [PingOne Token Exchange Documentation](https://docs.pingidentity.com/r/en-us/pingone/p1_t_configure_token_exchange)
- [PingOne Token Policies](https://docs.pingidentity.com/r/en-us/pingone/p1_c_token_policies)
- [may_act Specification](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-token-exchange-19#section-4.2)

## Next Steps

After verifying `act` and `may_act` claims:

1. **Document PingOne Configuration**: Save screenshots and policy JSON for reference
2. **Update Architecture Docs**: Confirm delegation chain is functional
3. **Implement Audit Logging**: Extract the full `act` chain in middleware and log delegation events
4. **Add Monitoring**: Alert on token exchange failures or missing delegation claims
5. **Update Tests**: Add test cases that validate `act` claim presence in exchanged tokens
