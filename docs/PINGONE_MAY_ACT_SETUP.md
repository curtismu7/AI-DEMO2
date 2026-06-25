# PingOne: 3-Token Delegated Chain — Setup Guide

Step-by-step setup for a **human → agent → MCP → PingOne API** delegated token chain.

**Product scope:** PingOne SaaS (`auth.pingone.com`).
This is NOT PingOne Advanced Identity Cloud (ForgeRock AM) — those are separate products.

---

## ⚠️ Critical: Do NOT include `openid` in any scope for this chain

Adding `openid` anywhere in this flow breaks things in two different ways depending on where it appears:

| Request | If `openid` is included | What breaks |
|---------|------------------------|-------------|
| **Step 1 — `/authorize`** | PingOne returns `invalid_scope`: "May not request scopes for multiple resources" | The `resource=https://ai-agent.pingdemo.com` param is rejected because `openid` belongs to a different implicit resource server (the OIDC UserInfo endpoint) |
| **Step 6 — MCP Service Client Credentials** | PingOne returns `invalid_scope` | Web App type apps cannot request `openid` via client credentials |

**Correct scopes for every step:**

| Postman Step | Scope param | How to set |
|---|---|---|
| **Step 1 — `/authorize`** | `profile email banking:ai:agent:read` | Collection variable `scope` |
| **Step 4 — token exchange for code** | *(same as Step 1 — uses `{{scope}}`)* | Collection variable `scope` |
| **Step 5 — RFC 8693 token exchange** | `banking:accounts:read banking:transactions:read banking:transactions:write` | Hardcoded in Step 5 body |
| **Step 6 — client credentials** | `p1:read:user p1:update:user` | Hardcoded in Step 6 body |

**How to verify in Postman:**
1. Click the collection name → **Variables tab**
2. Find `scope` → current value must be `profile email banking:ai:agent:read` (no `openid`)
3. Open **Step 6** → **Body tab** → find the `scope` row → must be `p1:read:user p1:update:user` (no `openid`)

| **Why no ID token?** The Super Banking User App has `Response Type: Code` only — **ID Token is unchecked** in PingOne OIDC Settings. `openid` is the scope that triggers ID token issuance. Since there is no ID token in this flow and the access token audience is a custom resource server, `openid` must be absent.

---

## How It Works

> **What is Token Exchange (RFC 8693)?** An app POSTs an existing access token to PingOne's token endpoint with `grant_type=token-exchange`. PingOne validates the token, checks delegation permissions, and issues a *new* token scoped to a different audience. The original token is not modified — a fresh, narrower token is returned. Each exchange is a server-to-server call; the user is never redirected.

> **Design rule:** Keep chains to **3 exchanges or fewer**. Each exchange is a synchronous round-trip to PingOne.
>
> This document covers two patterns — choose the one that matches your architecture:
> - **Demo (1 exchange):** Subject Token → MCP Token via one RFC 8693 exchange, then a separate Client Credentials call for the PingOne API token. Simpler to configure; ideal for learning the `may_act` → `act` delegation model. This is what the Super Banking Admin App implements.
> - **Production (2 exchanges):** Subject Token → Agent Exchanged Token → MCP Exchanged Token via two chained RFC 8693 exchanges. Each hop adds a nested `act` layer, producing `act.act.sub` provenance. Required when the AI Agent itself must be an accountable identity in the delegation chain, and when PingOne Authorize (PAZ) must verify every hop as a policy attribute.

### Demo pattern (1 exchange)

```
Human User (Banking App Login)
  │
  │  PKCE Authorization Code login — user authenticates normally
  ▼
Subject Token  [TOKEN 1 — user's session token with banking:ai:agent:read scope + may_act claim]
  { sub: "<user-id>",
    aud: ["https://ai-agent.pingdemo.com"],      ← AI Agent service validates this token
    scope: "profile email banking:ai:agent:read",    ← USER MUST have this scope to delegate
    may_act: { "sub": "<PINGONE_CORE_CLIENT_ID>" } }
              ↑ PingOne user attribute: claiming this client is authorized to act on user's behalf
  │
  │  Token Exchange #1 (RFC 8693)
  │  Banking app server POSTs the Subject Token to PingOne's /token endpoint.
  │  PingOne checks: may_act.sub == actorToken.aud[0]? → issues MCP Token.
  │  Exchanger: Super Banking App (PINGONE_CORE_CLIENT_ID)
  ▼
MCP Token  [TOKEN 2 — delegated tool-call token with narrowed scopes + act claim]
  { sub: "<user-id>",
    aud: ["https://mcp-server.pingdemo.com"],   ← MCP Server validates this token
    scope: "banking:accounts:read banking:transactions:read banking:transactions:write",  ← NARROWED: least privilege
    act: { "sub": "<PINGONE_CORE_CLIENT_ID>" } }  ← Audit trail: BFF delegated on user's behalf
  │
  │  Client Credentials grant (NOT a token exchange)
  │  MCP server POSTs its own client_id + client_secret to PingOne.
  │  PingOne issues a scoped PingOne API token (p1:read:user, p1:update:user).
  │  Caller: Super Banking MCP Service (MCP_CLIENT_ID)
  ▼
PingOne API Token  [TOKEN 3 — scoped PingOne Management API token]
  { aud: ["https://api.pingone.com"],
    scope: "p1:read:user p1:update:user" }
  │
  ▼
PingOne Management API  (/v1/environments/{envId}/users/{userId})
```

> **Every `aud` is different** — each token is scoped to exactly one service. That service's resource server validates the token; all others reject it. This is the core of RFC 8693 audience restriction.

| Token | Audience URL | How issued | Issuer | Scope |
|-------|-------------|------------|--------|-------|
| **Subject Token** | `https://ai-agent.pingdemo.com` | PKCE login | PingOne (user auth) | `profile email banking:ai:agent:read` |
| **MCP Token** | `https://mcp-server.pingdemo.com` | RFC 8693 Token Exchange #1 | Super Banking Admin App | `banking:accounts:read banking:transactions:read banking:transactions:write` (narrowed) |
| **PingOne API Token** | `https://api.pingone.com` | Client Credentials | Super Banking MCP Token Exchanger | `p1:read:user p1:update:user` |
| *(actor token)* | `https://agent-gateway.pingdemo.com` | *(internal — proves BFF identity for Exchange #1)* | (N/A) | `banking:ai:agent:read` |

>  **Two Key Requirements for 2-Exchange Delegation:**
>
> 1. **Scope Permission:** User token MUST have `banking:ai:agent:read` scope (grants permission to invoke agent)
> 2. **Claim Authorization:** User MUST have PingOne `may_act` user attribute: `{ "client_id": "<bff-admin-client-id>" }` (proves authorization to delegate)
>    
> **Both are required.** Scope alone (without `may_act` claim) is insufficient. Claim alone (without scope) is also insufficient. The combination proves the user both intends and is authorized to delegate.

---

### Production pattern (2 exchanges)

In this pattern every hop performs a full RFC 8693 exchange. Each exchanger first obtains its own Actor Token via Client Credentials, then presents it alongside the incoming token. The result is a deeply nested `act` claim. PingOne Authorize (PAZ) introspects the final token and enforces `act.sub` and `act.act.sub` as explicit policy attributes before permitting tool access.

```
Human User (Banking App Login)
  │
  │  PKCE Authorization Code login — user authenticates normally
  ▼
Subject Token  [TOKEN 1 — user's session token]
  { sub: "<user-id>",
    aud: ["https://ai-agent.example.com"],
    may_act: { "sub": "<AI_AGENT_CLIENT_ID>" } }
              ↑ permits the AI Agent to exchange this token
  │
  │  Token Exchange #1 (RFC 8693)
  │  AI Agent gets its own Actor Token (Client Credentials, aud: agent-gateway).
  │  Exchanges: subject_token=Subject Token + actor_token=Agent Actor Token
  │  Exchanger: AI IAM Core Agent (AI_AGENT_CLIENT_ID)
  ▼
Agent Exchanged Token  [TOKEN 2 — agent-delegated token]
  { sub: "<user-id>",
    aud: ["https://mcp-server.example.com"],
    act: { "sub": "<AI_AGENT_CLIENT_ID>" } }
          ↑ records that the AI Agent performed Exchange #1
  │
  │  Token Exchange #2 (RFC 8693)
  │  MCP Server gets its own Actor Token (Client Credentials, aud: mcp-gateway).
  │  Exchanges: subject_token=Agent Exchanged Token + actor_token=MCP Actor Token
  │  Exchanger: MCP App (MCP_CLIENT_ID)
  ▼
MCP Exchanged Token  [TOKEN 3 — fully delegated tool-call token]
  { sub: "<user-id>",
    aud: ["https://resource-server.example.com"],
    act: {
      "sub": "<MCP_CLIENT_ID>",         ← outer act: MCP App performed Exchange #2
      "act": {
        "sub": "<AI_AGENT_CLIENT_ID>"   ← inner act: AI Agent performed Exchange #1
      }
    }
  }
  │
  │  PAZ (PingOne Authorize) introspects the MCP Exchanged Token:
  │    ✓ sub is a known user in IDP data store (PingOne)
  │    ✓ aud == resource server URL
  │    ✓ act.sub == MCP server URL
  │    ✓ act.act.sub == AI Agent URL
  │  → DENY if any check fails
  ▼
PERMIT → Tools (Device AuthN, Lookup Profile) → PingOne Users API → Resource
```

| Token | Audience | How issued | Exchanger |
|-------|----------|------------|-----------|
| **Subject Token** | `https://ai-agent.example.com` | PKCE login | PingOne (user auth) |
| **Agent Exchanged Token** | `https://mcp-server.example.com` | RFC 8693 Exchange #1 | AI IAM Core Agent |
| **MCP Exchanged Token** | `https://resource-server.example.com` | RFC 8693 Exchange #2 | MCP App |

> **Nested `act` chain:** Each exchange promotes the previous actor inward. `act.sub` = the most recent exchanger (MCP App); `act.act.sub` = the one before it (AI Agent). PAZ policy enforces each level to verify the full delegation path end-to-end.

---

## Real Delegation Claims (RFC 8693 — As Implemented)

This section shows the **actual `may_act` and `act` claim structures** used by the Super Banking code.

### `may_act` Claim (User Token)

**Where:** User Access Token, issued by PingOne at login (Subject Token)  
**When:** Present when user logs in with their credentials  
**Required:** YES — token exchange will fail if missing  

**Real Structure (from `banking_api_server/services/delegationClaimsService.js`):**

```json
{
  "client_id": "14cefa5b-d9d6-4e51-8749-e938d4edd1c0",  // REQUIRED: Super Banking Admin App (BFF) client UUID authorized to act
  "sub": "https://banking-agent.pingdemo.com/agent/banka-agent-01"  // OPTIONAL: The agent identifier (for reverse lookups)
}
```

**Real Example** (full user token from Super Banking User app):

```json
{
  "sub": "5C9A2E8F-B3D1-42A8-8637-C2A9F7B5D8E3",  // User ID (PingOne GUID from Super Banking User App population)
  "aud": ["https://ai-agent.pingdemo.com"],
  "iss": "https://auth.pingone.com/c249f73b-cdc8-45ff-a651-e4a55b456f3f/as",  // Real-looking PingOne environment
  "scope": "profile email banking:ai:agent:read banking:accounts:read banking:transactions:read",
  "exp": 1712595600,
  "iat": 1712594000,
  "may_act": {
    "client_id": "14cefa5b-d9d6-4e51-8749-e938d4edd1c0",  // Super Banking Admin App (BFF) client ID in PingOne (must match actor)
    "sub": "https://banking-agent.pingdemo.com/agent/banka-agent-01"  // Optional: which agent
  }
}
```

**How it's Validated (Code Path):**
1. User logs into Super Banking User App via `/api/auth/oauth/authorize`
2. PingOne (issuer: `https://auth.pingone.com/c249f73b-cdc8-45ff-a651-e4a55b456f3f/as`) issues Subject Token with `may_act` from user's `myAct` attribute
3. BFF (Super Banking Admin App, client ID: `14cefa5b-d9d6-4e51-8749-e938d4edd1c0`) receives token, decodes it
4. `delegationClaimsService.validateMayActStructure()` (line 143–230) checks:
   - ✅ `client_id` field is present and equals `14cefa5b-d9d6-4e51-8749-e938d4edd1c0` (required)
   - ✅ `client_id` is a non-empty string
   - ✅ `sub` field format is valid (optional field)
5. If valid: BFF can use this token for token exchange
6. If invalid: `DELEGATION_ERROR_CODES.INVALID_MAY_ACT_STRUCTURE` (403 Forbidden)

**Setting `may_act` in PingOne (Part 3c):**

On the Super Banking User App, when a user logs in, PingOne reads their `mayAct` attribute and includes it in the access token.

Set user attribute (`myAct`) to:
```json
{
  "mayAct": {
    "client_id": "14cefa5b-d9d6-4e51-8749-e938d4edd1c0",  // Super Banking Admin App Client ID (PINGONE_CORE_CLIENT_ID)
    "sub": "https://banking-agent.pingdemo.com/agent/banka-agent-01"  // Optional: agent identifier
  }
}
```

Or simpler (PingOne will infer agent from context):
```json
{
  "mayAct": {
    "client_id": "14cefa5b-d9d6-4e51-8749-e938d4edd1c0"
  }
}
```

In the Resource Server attribute expression (Part 1a), reference it as:
```
user.mayAct
```

---

### `act` Claim (Exchanged Tokens)

**Where:** Token issued by PingOne after RFC 8693 token exchange  
**When:** Present on every token after the first exchange  
**Required:** YES — MCP and other services validate this claim  

**Real Structure #1 — 1-Exchange Output:**

```json
{
  "sub": "5C9A2E8F-B3D1-42A8-8637-C2A9F7B5D8E3",  // Original user (preserved through exchange)
  "aud": ["https://mcp-server.pingdemo.com"],
  "scope": "banking:accounts:read banking:transactions:read",  // Narrowed from original
  "exp": 1712595600,
  "iat": 1712594000,
  "act": {
    "sub": "14cefa5b-d9d6-4e51-8749-e938d4edd1c0"  // Super Banking Admin App that performed the exchange (PINGONE_CORE_CLIENT_ID)
  }
}
```

**Real Structure #2 — 2-Exchange Output (Nested per RFC 8693 §4.4):**

```json
{
  "sub": "5C9A2E8F-B3D1-42A8-8637-C2A9F7B5D8E3",  // Original user (preserved through full chain)
  "aud": ["https://mcp-server.pingdemo.com"],
  "scope": "banking:accounts:read banking:transactions:read",  // Narrowed
  "exp": 1712595600,
  "iat": 1712594000,
  "act": {
    "sub": "630b065f-0c28-41c2-81ed-1daee811285",  // Super Banking MCP Token Exchanger (outermost actor, Exchange #2)
    "act": {
      "sub": "2533a611-fcb6-4ab9-82cc-9ab407f1dbda"  // Super Banking AI Agent App (intermediate actor, Exchange #1)
    }
  }
}
```

**How it's Created (RFC 8693 Token Exchange):**

**BFF (Super Banking Admin App) performs Exchange #1** (1-exchange or start of 2-exchange):
```bash
curl -X POST https://auth.pingone.com/c249f73b-cdc8-45ff-a651-e4a55b456f3f/as/token \
  -H "Authorization: Basic $(echo -n '14cefa5b-d9d6-4e51-8749-e938d4edd1c0:your-bff-client-secret' | base64)" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "subject_token=<user-access-token-with-may_act>" \
  -d "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "requested_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "audience=https://mcp-server.pingdemo.com" \
  -d "scope=banking:accounts:read banking:transactions:read"
```

**Environment values:**
- `c249f73b-cdc8-45ff-a651-e4a55b456f3f` = PINGONE_ENVIRONMENT_ID
- `14cefa5b-d9d6-4e51-8749-e938d4edd1c0` = PINGONE_CORE_CLIENT_ID (Super Banking Admin App)
- `your-bff-client-secret` = PINGONE_CORE_CLIENT_SECRET

PingOne (issuer: `https://auth.pingone.com/c249f73b-cdc8-45ff-a651-e4a55b456f3f/as`):
1. Decodes subject token from Super Banking User App
2. Finds `may_act.client_id` = `14cefa5b-d9d6-4e51-8749-e938d4edd1c0` → validates it matches the requesting BFF client
3. Checks the MCP Resource Server's attribute mapping expression (Part 1b—the `act` expression)
4. Evaluates: `may_act.client_id == actor_token.client_id`?  (is the permitted actor the one asking?)
5. If YES: promotes `may_act` to `act` in output token
6. If NO: returns `act = null` and exchange fails (because `act` is required)
7. Returns MCP Token with: `act: { sub: "14cefa5b-d9d6-4e51-8749-e938d4edd1c0" }`

**How it's Validated in Code (Code Path):**
- `banking_api_server/services/delegationClaimsService.js` lines 247–290: `validateExchangedTokenAct()`
- Checks: `act.sub` is a valid UUID or URL format
- Checks: nested `act` structures (for 2-exchange chains)
- Returns validation error if `act` is malformed

---

### PingOne Configuration Checklist

- ☑️ **User Attribute:** `myAct` (JSON type) on Super Banking User population with value `{ "client_id": "14cefa5b-d9d6-4e51-8749-e938d4edd1c0" }`
- ☑️ **Resource Server Attribute (1a):** Super Banking AI Agent — map `may_act` expression to `user.mayAct`
- ☑️ **Resource Server Attribute (1b):** Super Banking MCP Server — map `act` expression with the ternary logic shown in Part 1b
- ☑️ **Subject Token contains:** `may_act` with the user's PingOne `myAct` attribute (client_id = `14cefa5b-d9d6-4e51-8749-e938d4edd1c0`)
- ☑️ **MCP/Exchanged Token contains:** `act` with BFF client ID `14cefa5b-d9d6-4e51-8749-e938d4edd1c0` (1-exchange) or nested chain with MCP client `630b065f-0c28-41c2-81ed-1daee811285` (2-exchange)

---

## Token Exchange Architecture

Three implementation options exist. **This demo implements Option 1.**

### Option 1: Banking App Server — 1 exchange (demo)
The banking app's server-side component holds the `PINGONE_CORE_CLIENT_ID` secret and exchanges the Subject Token for the MCP Token in one step. The MCP service then independently calls PingOne with Client Credentials for a scoped PingOne API token.

- **Pros:** Secrets never leave the server; tokens never touch the browser. Single exchange round-trip; minimal PingOne app configuration.
- **Cons:** Requires a deployed server-side app. The AI Agent layer is not a named identity in the `act` chain.

### Option 2: Two-exchange chain — server-side (production)
The AI Agent and MCP layers each perform their own RFC 8693 exchange. Each exchanger first obtains an Actor Token via Client Credentials, then presents it alongside the incoming subject token. The result is a deeply nested `act` claim tracing every delegation hop. PAZ introspects the final token and enforces `act.sub` and `act.act.sub` as policy attributes.

- **Pros:** Full delegation provenance — `act.act.sub` identifies every exchanger. PAZ can enforce each actor URL as a named policy attribute. Suitable for regulated or audited environments.
- **Cons:** Two synchronous exchange round-trips to PingOne per request. Requires two additional resource servers (one actor token audience per exchanger) and two apps each with `Token Exchange` grant enabled.

### Option 3: Client-side / direct
The browser (or agent) performs token exchange directly using a public client. Not used here.

- **Pros:** No server required; works in fully client-side apps.
- **Cons:** Client secrets cannot be safely stored in a browser; higher exposure risk.

---

## Reference: All Names and Values

Use this table as your single source of truth when filling in PingOne forms and your `.env` file.

| Item | Field | Exact value |
|------|-------|-------------|
| Agent Resource Server | Name | `Super Banking AI Agent` |
| Agent Resource Server | Audience | `https://ai-agent.pingdemo.com` |
| Agent Resource Server | Scope | `banking:agent:invoke` |
| MCP Resource Server | Name | `Super Banking MCP Server` |
| MCP Resource Server | Audience | `https://mcp-server.pingdemo.com` |
| MCP Resource Server | Scope 1 | `banking:accounts:read` |
| MCP Resource Server | Scope 2 | `banking:transactions:read` |
| MCP Resource Server | Scope 3 | `banking:transactions:write` |
| Agent Gateway Resource Server | Name | `Super Banking Agent Gateway` |
| Agent Gateway Resource Server | Audience | `https://agent-gateway.pingdemo.com` |
| User OIDC App | Name | `Super Banking User App` |
| Banking App (exchanger app) | Name | `Super Banking Admin App` |
| MCP Service App | Name | `Super Banking MCP Token Exchanger` |
| `mayAct.sub` value on user records | equals | `PINGONE_CORE_CLIENT_ID` — the client ID UUID of Super Banking Admin App |
| User Schema Attribute | Attribute name | `mayAct` |
| User Schema Attribute | Type | `JSON` |
| Token Claim — `act` on MCP Token | Where configured | **Super Banking MCP Server resource Attributes tab** (Step 1b) — NOT the application |
| Token Claim — `act` expression | Expression | `(#root.context.requestData.subjectToken?.may_act?.sub != null && #root.context.requestData.subjectToken?.may_act?.sub == #root.context.requestData.actorToken?.aud?.get(0))?#root.context.requestData.subjectToken?.may_act:null` |
| Token Claim — `may_act` on Subject Token | Where configured | **Super Banking AI Agent resource Attributes tab** (Step 1a) — NOT the application |
| Token Claim — `may_act` expression | Expression | `user.mayAct` |
| Env var — Subject Token audience | `ENDUSER_AUDIENCE` | `https://ai-agent.pingdemo.com` |
| Env var — MCP Token audience | `MCP_RESOURCE_URI` | `https://mcp-server.pingdemo.com` |
| Env var — PingOne API Token audience | `PINGONE_API_AUDIENCE` | `https://api.pingone.com` |
| Env var — Agent Gateway audience | `BFF_RESOURCE_URI` | `https://agent-gateway.pingdemo.com` |

---

## Part 1 — Resource Servers

> **PingOne Console → Applications → Resources**

---

### 1a. Create: Super Banking AI Agent  *(Subject Token audience)*

This resource server gives the Subject Token a meaningful audience URL. The AI Agent service checks that incoming tokens have `aud = https://ai-agent.pingdemo.com` before allowing tool invocations.

Click **Add Resource** and fill in exactly:

**Overview tab:**

| Field | Type in |
|-------|---------|
| **Resource name** | `Super Banking AI Agent` |
| **Audience** | `https://ai-agent.pingdemo.com` |
| **Description** | `Audience resource server for the Super Banking AI Agent The Subject Token issued at user login is scoped to this resource and carries the may act claim that authorizes token exchange` |
| **Access token time to live (seconds)** | `3600` |
| **Token Introspection Endpoint Authentication Method** | `Client Secret Basic` |

Click **Save**.

**Attribute Mappings tab → Add one attribute:**

This is where PingOne injects `may_act` into the **access token** when the Subject Token is issued to this resource server audience.

> **Why here, not on the app?** OIDC application attribute mappings only deliver to UserInfo and ID Token. Access token claims for a specific audience must be defined on the **resource server** itself.

| Field | Type in |
|-------|--------|
| **Attribute name** | `may_act` |
| **Expression** | `user.mayAct` |
| **Required** | ❌ No |

> **Expression syntax:** Resource server attribute expressions use bare SpEL — no `${}` wrapper, no `#root.` prefix. `user.mayAct` reads the `mayAct` JSON attribute directly from the user profile. If the user's `mayAct` attribute is null, PingOne omits the claim from the token (because Required is off).
>
> **How to test in PingOne:**
> 1. Click the pencil icon next to the `may_act` row → **Build and Test Expression** opens.
> 2. Expression field should contain exactly: `user.mayAct`
> 3. Click **Edit JSON** in the Test Data panel and paste — replacing `<PINGONE_CORE_CLIENT_ID>` with the Banking App client ID UUID:
> ```json
> {
>   "user": {
>     "mayAct": { "sub": "<PINGONE_CORE_CLIENT_ID>" }
>   }
> }
> ```
> 4. Click **Test Expression**. The Result panel should show:
> ```json
> { "sub": "<PINGONE_CORE_CLIENT_ID>" }
> ```
> **Verification Successful** in green.
> 5. To confirm null-safety works: remove the `mayAct` key from the test data entirely, click **Test Expression** again — Result should show `null` (not an error). This proves PingOne omits the claim when the attribute is absent.
> 6. Click **Save**.
>
> **Common mistake:** Using `${user.mayAct}` or `#root.user.mayAct` — both are invalid here and show "Expression is invalid". Use `user.mayAct` with no wrapper.

Click **Save**.

**Scopes tab → Add Scope:**

| Field | Type in |
|-------|---------|
| **Scope name** | `banking:agent:invoke` |
| **Description** | `Grants the bearer permission to invoke the Super Banking AI Agent on behalf of the authenticated user Present on the Subject Token validated by the banking app before token exchange` |

Click **Save**.

---

### 1b. Create: Super Banking MCP Server  *(MCP Token audience)*

Click **Add Resource** and fill in exactly:

**Overview tab:**

| Field | Type in |
|-------|---------|
| **Resource name** | `Super Banking MCP Server` |
| **Audience** | `https://mcp-server.pingdemo.com` |
| **Description** | `Audience resource server for the Super Banking MCP Model Context Protocol server MCP Tokens scoped to this resource are used for delegated banking tool calls` |
| **Access token time to live (seconds)** | `3600` |
| **Token Introspection Endpoint Authentication Method** | `Client Secret Basic` |

Click **Save**.

**Attribute Mappings tab → Add one attribute:**

This is where PingOne gets the `act` claim for the MCP Token during Token Exchange #1.

> **`sub` does not need a custom mapping.** PingOne automatically carries `sub` from the subject token into the issued token during RFC 8693 exchange — it is a standard claim handled internally. Do not configure a `sub` expression here. If you try `#root.context.requestData.subjectToken.sub` in the SpEL tester it will return `null`, because PingOne only exposes **custom claims** (like `may_act`) on the `subjectToken` context object, not standard JWT claims (`sub`, `iss`, `exp`, `aud`). Leave `sub` unconfigured and PingOne will set it automatically.

**Attribute 1 — record the delegation (act claim):**

| Field | Type in |
|-------|---------|
| **Attribute name** | `act` |
| **Expression** | `(#root.context.requestData.subjectToken?.may_act?.sub != null && #root.context.requestData.subjectToken?.may_act?.sub == #root.context.requestData.actorToken?.aud?.get(0))?#root.context.requestData.subjectToken?.may_act:null` |
| **Required** | ✅ Yes |

This compares `may_act.sub` in the Subject Token (the permitted actor's UUID) against `aud[0]` of the actor token the Banking App presents. If they match, `may_act` is promoted to `act` in the new MCP Token. If they don't match — meaning the wrong app is trying to exchange the token — `act` is `null` and the exchange fails because the attribute is required.

> **Expression explained — null-safe SpEL:**
> ```
> (
>   #root.context.requestData.subjectToken?.may_act?.sub != null
>   && #root.context.requestData.subjectToken?.may_act?.sub
>      == #root.context.requestData.actorToken?.aud?.get(0)
> )
>   ? #root.context.requestData.subjectToken?.may_act
>   : null
> ```
> - `?.may_act?.sub` — safe navigation: returns `null` instead of throwing if `may_act` is absent from the Subject Token
> - `?.aud?.get(0)` — safe navigation: returns `null` instead of throwing if the actor token has no `aud` array
> - `!= null &&` — explicit guard: prevents `null == null` from evaluating to `true` when `may_act` is absent entirely
> - If all checks pass and the UUIDs match: returns `may_act` (which becomes `act` in the MCP Token)
>
> **How to test in PingOne:**
> 1. Click the pencil icon next to the `act` mapping → **Build and Test Expression** opens.
> 2. Click **Edit JSON** in the Test Data panel and paste. The `subjectToken` value is the decoded payload of the actual Subject Token — paste the real claims. Replace `<PINGONE_CORE_CLIENT_ID>` with the Banking App client ID UUID in both places; they must match for the expression to return non-null.
> ```json
> {
>   "context": {
>     "requestData": {
>       "subjectToken": {
>         "client_id": "<PINGONE_CORE_CLIENT_ID>",
>         "iss": "https://auth.pingone.com/<PINGONE_ENVIRONMENT_ID>/as",
>         "sub": "425d38ac-adcc-463c-83cb-e9eb88179a79",
>         "aud": ["https://ai-agent.pingdemo.com"],
>         "scope": "profile email banking:agent:invoke",
>         "may_act": {
>           "sub": "<PINGONE_CORE_CLIENT_ID>"
>         }
>       },
>       "actorToken": {
>         "aud": ["<PINGONE_CORE_CLIENT_ID>"]
>       }
>     }
>   }
> }
> ```
> `actorToken.aud[0]` is the value PingOne exposes for the actor in the SpEL context. It must equal `may_act.sub` — both are the Banking App client ID UUID (`PINGONE_CORE_CLIENT_ID`).
> **What SpEL can and cannot read from `subjectToken`:**
> - ✅ **Custom claims** (`may_act`, and any other non-standard claims) — fully accessible
> - ❌ **Standard JWT claims** (`sub`, `iss`, `aud`, `exp`, `iat`) — NOT accessible via SpEL; the expression cannot read them and they return `null` if referenced. They are safe to include in test data for realism but the expression ignores them.
>
> So `#root.context.requestData.subjectToken.may_act.sub` works. `#root.context.requestData.subjectToken.sub` returns `null`.
>
> **`may_act.sub` must be the Banking App UUID, not a URL.** If your Subject Token has `may_act.sub` set to a URL (e.g. `https://agent1.example.com`) instead of the Banking App's client ID UUID, the comparison against `actorToken.aud[0]` will always fail and `act` will be `null`. Fix: set `mayAct = { "sub": "<UUID-of-Super-Banking-Banking-App>" }` on the user record (Part 3c).
>
> 3. Click **Test Expression** — the Result panel should show:
> ```json
> {
>   "sub": "<PINGONE_CORE_CLIENT_ID>"
> }
> ```
> and **Verification Successful** in green.
> 4. To confirm the guard works, change one UUID so they **don't** match — Result should show `null`.
> 5. Click **Save**.
> These variables (`#root.context.requestData.subjectToken`, `actorToken`) are only available in **resource server attribute expressions** during token exchange. They do **not** work in application attribute mappings.

**Scopes tab → Add three scopes:**

**Scope 1:**

| Field | Type in |
|-------|---------|
| **Scope name** | `banking:accounts:read` |
| **Description** | `Read access to the authenticated users bank account list and balances` |

**Scope 2:**

| Field | Type in |
|-------|---------|
| **Scope name** | `banking:transactions:read` |
| **Description** | `Read access to the authenticated users transaction history` |

**Scope 3:**

| Field | Type in |
|-------|---------|
| **Scope name** | `banking:transactions:write` |
| **Description** | `Write access to initiate transactions on behalf of the authenticated user Requires step up MFA for amounts above the configured threshold` |

Click **Save** after each scope.

---

### 1c. PingOne API  *(Resource Token audience — already exists, do not create)*

In **Applications → Resources** locate the built-in resource named **"PingOne API"**.

- **Audience**: `https://api.pingone.com` *(set by PingOne — do not modify)*
- Scopes `p1:read:user` and `p1:update:user` already exist — you will enable them on the MCP Worker app in Step 2c.
- **Attribute Mappings tab:** Leave unchanged. PingOne manages claims on this built-in resource.

---

### 1d. Create: Super Banking Agent Gateway  *(banking app actor token audience)*

This resource server exists solely to give the banking app server an audience URI that PingOne can verify during token exchange. When the banking app requests an actor token scoped to `https://agent-gateway.pingdemo.com`, PingOne can confirm the actor is really this app — not an impersonator.

Click **Add Resource** and fill in exactly:

**Overview tab:**

| Field | Type in |
|-------|---------|
| **Resource name** | `Super Banking Agent Gateway` |
| **Audience** | `https://agent-gateway.pingdemo.com` |
| **Description** | `Audience resource server for the Super Banking banking app server The banking app obtains a token scoped to this audience to use as its actor token during RFC 8693 token exchange PingOne reads the actor tokens client_id UUID and compares it to may_act sub on the users Subject Token` |
| **Access token time to live (seconds)** | `3600` |
| **Token Introspection Endpoint Authentication Method** | `Client Secret Basic` |

Click **Save**.

**Attribute Mappings tab:**

No mappings needed. Leave this tab unchanged.

**Scopes tab:**

No scopes needed. This resource server is used purely for audience identity, not for granting capabilities.

> The Banking App application must be allowed to request tokens scoped to this audience. Enable **Super Banking Agent Gateway** on the Banking App's Resources tab in Step 2b.

---

## Part 2 — Applications

> **PingOne Console → Applications → Applications**

---

### 2a. Configure: Super Banking User  *(issues Subject Token)*

Open the existing end-user OIDC application. Verify or update:

**Overview tab:**

| Field | Type in |
|-------|---------|
| **Application name** | `Super Banking User App` |
| **Description** | `End user web application for Super Banking banking customers Issues Subject Tokens via Authorization Code and PKCE The Subject Token carries may_act authorizing the Banking App to perform token exchange` |
| **Icon** | *(optional — leave blank or upload a logo)* |
| **Home Page URL** | `https://banking-demo-puce.vercel.app` |
| **Signon URL** | `https://banking-demo-puce.vercel.app` |

**Configuration tab → Grant Types** — check exactly these:

- ✅ `Authorization Code`
- ✅ `Refresh Token`
- ❌ `Token Exchange` — do NOT enable on this app

**Configuration tab — other fields:**

| Field | Value |
|-------|-------|
| **PKCE enforcement** | `S256_REQUIRED` |
| **Token endpoint auth method** | `CLIENT_SECRET_POST` |
| **Redirect URIs** | `https://banking-demo-puce.vercel.app/api/auth/oauthuser/callback` |

**Resources tab → Allowed scopes — enable:**

- ✅ `banking:agent:invoke` from **Super Banking AI Agent**
- ✅ `profile`, `email`, `offline_access` *(standard — already present)*
- ❌ Do **NOT** enable or request `openid` — it causes PingOne to reject the authorize request when `resource=https://ai-agent.pingdemo.com` is present

**Attribute Mappings tab:**

No custom mapping needed here for `may_act`. The `may_act` claim in the access token is produced by the expression configured on the **Super Banking AI Agent resource server** (Step 1a, Attribute Mappings tab).

> **Why not here?** Application OIDC attribute mappings only deliver claims to **UserInfo** and **ID Token** — they cannot inject claims into an access token. Access token claims must be defined on the resource server the token is scoped to (Step 1a).

Leave this tab unchanged.

Click **Save**.

---

### 2b. Configure: Super Banking App  *(exchanges Subject Token → MCP Token)*

This is the banking app's server-side component. It holds user sessions and performs Token Exchange #1: trading the user's Subject Token for a narrower MCP-scoped token. Its Client ID is what you store in `mayAct` on each user record.

Open the existing application. Verify or update:

**Overview tab:**

| Field | Type in |
|-------|---------|
| **Application name** | `Super Banking Admin App` |
| **Description** | `Banking app server Authenticates users and performs Token Exchange 1 to get an MCP-scoped token on behalf of the authenticated user The Client ID of this app must be set as the mayAct sub value on all user profiles that use the AI agent` |
| **Icon** | *(optional — leave blank or upload a logo)* |
| **Home Page URL** | `https://banking-demo-puce.vercel.app` |
| **Signon URL** | `https://banking-demo-puce.vercel.app` |

**Configuration tab → Grant Types — enable all of these:**

- ✅ `Authorization Code`
- ✅ `Refresh Token`
- ✅ `Token Exchange` ← **required — this grants permission to exchange Subject Tokens**
- ✅ `Client Initiated Backchannel Authentication (CIBA)` *(required for step-up auth)*

**Configuration tab — other fields:**

| Field | Value |
|-------|-------|
| **PKCE enforcement** | `S256_REQUIRED` |
| **Token endpoint auth method** | `CLIENT_SECRET_POST` |
| **Redirect URIs** | `https://banking-demo-puce.vercel.app/api/auth/oauth/callback` |

**Resources tab:**

1. Click the **+** (Add) icon.
2. A list of resources appears. Expand **Super Banking MCP Server** and enable:

   - ✅ `banking:accounts:read`
   - ✅ `banking:transactions:read`
   - ✅ `banking:transactions:write`

3. Click **Save**.

> **Super Banking Agent Gateway is not needed here.** The Banking App authenticates the token exchange with its own `client_id` and `client_secret` (standard client authentication). PingOne identifies it as the actor via that `client_id` — no special audience-scoped token is needed. Adding Super Banking Agent Gateway to this app's Resources would only be required if the Banking App were separately acquiring a token scoped to `https://agent-gateway.pingdemo.com` to forward as an explicit `actor_token` parameter — which is not the default flow.

**Attribute Mappings tab:**

No custom mapping needed here for the token exchange. The `act` claim in the MCP Token is produced by the expression configured on the **Super Banking MCP Server resource server** (Step 1b, Attribute Mappings tab). Application attribute mappings apply to tokens issued directly *for* the app (e.g. authorization code, client credentials) — not to tokens the app receives as an exchanger. Leave this tab unchanged.

---

### 2c. Create: Super Banking MCP Worker  *(exchanges MCP Token → Resource Token)*

Click **Add Application**:

**Overview tab:**

| Field | Type in |
|-------|---------|
| **Application name** | `Super Banking MCP Token Exchanger` |
| **Description** | `Machine to machine application for the Super Banking MCP server Uses Client Credentials to obtain a scoped PingOne API token for user lookup The MCP Token carrying the delegation context is validated separately` |
| **Icon** | *(optional — leave blank)* |
| **Home Page URL** | *(leave blank — no UI)* |
| **Signon URL** | *(leave blank — no UI)* |
| **Application type** | `Native` or `Web App` — **do NOT select Worker** (Worker apps are role-based and cannot have PingOne API resource scopes assigned) |

**Configuration tab → Grant Types:**

- ✅ `Client Credentials`

**Configuration tab:**

| Field | Value |
|-------|-------|
| **Token endpoint auth method** | `CLIENT_SECRET_POST` |

**Resources tab → Allowed scopes — enable:**

- ✅ `p1:read:user` from **PingOne API**
- ✅ `p1:update:user` from **PingOne API**

> These scopes are available on non-Worker apps because you confirmed PingOne API exposes them as OAuth resource scopes. The MCP server requests these scopes in its Client Credentials call to obtain Token 3.

**Attribute Mappings tab:**

No mappings needed. Leave this tab unchanged.

Click **Save**, then copy the **Client ID** and **Client Secret** — these become `MCP_CLIENT_ID` and `MCP_CLIENT_SECRET` on the MCP server.

---

## Part 3 — User Schema and Token Claim

---

### 3a. Add `mayAct` to User Schema

> **Directory → User Schema → Add Attribute**

| Field | Type in |
|-------|---------|
| **Attribute name** | `mayAct` |
| **Display name** | `May Act` |
| **Description** | `JSON object identifying the OAuth client authorized to exchange this users Subject Token Must match the client ID UUID of Super Banking Admin App PingOne validates this on every token exchange request` |
| **Type** | `JSON` |
| **Required** | `No` |
| **Unique** | `No` |
| **Multivalued** | `No` |

Click **Save**.

---

### 3b. Verify `may_act` in a Subject Token

After completing Steps 1–3a, log in as the test user from a browser and inspect the Subject Token. Decode it at [PingIdentity JWT Decoder](https://developer.pingidentity.com/en/tools/jwt-decoder.html) and confirm the payload contains:

```json
{
  "may_act": { "sub": "<PINGONE_CORE_CLIENT_ID>" }
}
```
`may_act.sub` is the **client ID UUID** of Super Banking Admin App, not a URL.

If `may_act` is absent:
- Confirm the `mayAct` attribute was set on the user record (Step 3c)
- Confirm the Attribute Mapping was added to `Super Banking User` (Step 2a)
- Confirm `banking:agent:invoke` scope is in the authorize request (`ENDUSER_AUDIENCE` is set)

---

### 3c. Set `mayAct` on the User Record

The value must be the **client ID UUID of Super Banking App** (`PINGONE_CORE_CLIENT_ID`). This is what PingOne compares against `actorToken.aud[0]` during Token Exchange #1.

**Option A — PingOne Admin Console:**
1. **Directory → Users** → open the user
2. Find **Custom Attributes → mayAct**
3. Enter the UUID of Super Banking Admin App:
```json
{ "sub": "<client-id-uuid-of-Super-Banking-Banking-App>" }
```

**Option B — PingOne Management API:**
```bash
PATCH https://api.pingone.com/v1/environments/{envId}/users/{userId}
Authorization: Bearer <token with p1:update:user>
Content-Type: application/json

{ "mayAct": { "sub": "<client-id-uuid-of-Super-Banking-Admin-App>" } }
```

**Option C — Super Banking Demo App (recommended):**

Navigate to `/demo-data` and scroll to the **Token Exchange — may_act demo** section. Every logged-in user sees this section. What is displayed depends on role:

**What every user sees (admin and non-admin):**

- **ℹ️ Static mapping active** (blue notice) — informs you that `may_act` is always present in the token regardless of the `mayAct` attribute because the PingOne attribute mapping for `bankingAdmin` uses a hardcoded expression. The Enable / Clear buttons write to the PingOne user record for conceptual exploration but do not change what appears in the token while static mapping is active.
- **✅ Enable may_act** button — writes `{ "sub": "<PINGONE_CORE_CLIENT_ID>" }` to the user's `mayAct` attribute. After clicking, the status badge changes to "✅ may_act present in token".
- **❌ Clear may_act** button — clears the `mayAct` attribute on the user record. Status badge changes to "❌ may_act absent from token".
- **"Why can't the Enable / Clear buttons control the token?"** accordion — explains the static-mapping constraint and how to use the BFF injection flags for the failed-path demo.

**What every user also sees — BFF injection toggles:**

Two inline toggles appear above the static-mapping notice, visible to **all logged-in users**:

- **Auto-inject may_act (BFF synthetic)** — when enabled, the BFF adds a synthetic `may_act` claim in memory before RFC 8693 exchange. Use this to demo a successful token exchange even when the PingOne token lacks `may_act`. The Token Chain view shows an "injected" badge.
- **Auto-inject audience (BFF synthetic)** — when enabled, the BFF adds `mcp_resource_uri` to the `aud` snapshot before exchange.

These toggles map to the `ff_inject_may_act` and `ff_inject_audience` feature flags configured in **Feature Flags → Token Exchange**. Each toggle shows its current state (ON / OFF) and has **Enable** / **Disable** buttons.

> **Summary:** Click **Enable may_act** as any logged-in user. The banking app server reads its own `PINGONE_CORE_CLIENT_ID` and writes that UUID to the user's `mayAct` attribute automatically. This is the easiest and least error-prone method for setting the attribute.

---

## Part 4 — Environment Variables

### `banking_api_server/.env`  (or Vercel environment variables)

```env
# ── PingOne Environment ────────────────────────────────────────────────────────
PINGONE_ENVIRONMENT_ID=<your-pingone-environment-id>
PINGONE_REGION=com

# ── Super Banking User App (issues Subject Token) ────────────────────────────────
PINGONE_CORE_USER_CLIENT_ID=<Client ID of "Super Banking User App">
PINGONE_CORE_USER_CLIENT_SECRET=<Client Secret of "Super Banking User App">

# ── Super Banking Admin App (exchanges Subject Token → MCP Token) ──────────────
PINGONE_CORE_CLIENT_ID=<Client ID of "Super Banking Admin App">
PINGONE_CORE_CLIENT_SECRET=<Client Secret of "Super Banking Admin App">

# ── Subject Token audience  (must exactly match "Super Banking AI Agent" Audience)
ENDUSER_AUDIENCE=https://ai-agent.pingdemo.com

# ── MCP Token audience  (must exactly match "Super Banking MCP Server" Audience) ─
MCP_RESOURCE_URI=https://mcp-server.pingdemo.com

# ── Feature flag: keep false so banking:agent:invoke scope is included in /authorize ─────────
# ff_oidc_only_authorize=false
```

### `banking_mcp_server/.env`  (on the MCP server)

```env
# ── Super Banking MCP Token Exchanger (Client Credentials → PingOne API Token) ───────
MCP_CLIENT_ID=<Client ID of "Super Banking MCP Token Exchanger">
MCP_CLIENT_SECRET=<Client Secret of "Super Banking MCP Token Exchanger">

# ── PingOne API Token audience ─────────────────────────────────────────────────
PINGONE_API_AUDIENCE=https://api.pingone.com

# ── PingOne token endpoint ────────────────────────────────────────────────────
PINGONE_ENVIRONMENT_ID=<your-pingone-environment-id>
PINGONE_REGION=com
```

---

## Part 5 — Token Exchange API Reference

### Subject Token → MCP Token  (Token Exchange #1)

Performed by: **Super Banking Admin App** using `PINGONE_CORE_CLIENT_ID` / `PINGONE_CORE_CLIENT_SECRET`

The banking app server calls PingOne's token endpoint, presenting the user's Subject Token as the `subject_token` and its own access token (audience `https://agent-gateway.pingdemo.com`) as the `actor_token`. PingOne checks that `subject_token.may_act.sub` matches `actor_token.aud[0]` before issuing the MCP Token.

```
POST https://auth.pingone.com/{PINGONE_ENVIRONMENT_ID}/as/token
Content-Type: application/x-www-form-urlencoded

client_id=PINGONE_CORE_CLIENT_ID
&client_secret=PINGONE_CORE_CLIENT_SECRET
&grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token=<Subject Token access_token>
&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&requested_token_type=urn:ietf:params:oauth:token-type:access_token
&audience=https://mcp-server.pingdemo.com
&scope=banking:accounts:read banking:transactions:read banking:transactions:write
```

> **Note:** Do not include `openid` in the subject token authorize request. The **Super Banking User** app has `Response Type: Code` only (no ID Token checked). Adding `openid` causes PingOne to reject the authorize request when `resource=` is also present, because `openid` triggers the OIDC contract which conflicts with a custom resource audience in the same request.

PingOne validates: `subject_token.may_act.sub` === `actor_token.aud[0]` — both must equal the Banking App's client ID UUID (`PINGONE_CORE_CLIENT_ID`). If they match, PingOne issues the MCP Token with `act.sub = <PINGONE_CORE_CLIENT_ID>`.

### MCP Service → PingOne API Token  (Client Credentials — Token 3)

Performed by: **Super Banking MCP Token Exchanger** using `MCP_CLIENT_ID` / `MCP_CLIENT_SECRET`

The MCP server requests a scoped PingOne API token using Client Credentials. This is **not** a token exchange — it is a separate, independent credential grant that gives the MCP server permission to call the PingOne Management API.

```
POST https://auth.pingone.com/{PINGONE_ENVIRONMENT_ID}/as/token
Content-Type: application/x-www-form-urlencoded

client_id=MCP_CLIENT_ID
&client_secret=MCP_CLIENT_SECRET
&grant_type=client_credentials
&scope=p1:read:user p1:update:user
```

> **Note:** Do not include `openid` in client credentials scope for the MCP Service app. The app type is **Web App** (not Worker) and `openid` is not a valid scope for client credentials to the PingOne API resource — PingOne returns `invalid_scope` if it is present.

> The MCP server uses the **MCP Token** (Token 2) to verify who the user is and what they authorized, and the **PingOne API Token** (Token 3) to actually call the Management API. These are two separate tokens used together — the delegation proof and the access credential.

---

## Part 6 — Postman Testing

A ready-to-import Postman collection is included in this repo. It covers the full 3-token chain using headless PKCE (pi.flow) — no browser required. Includes automatic token capture, claim validation at every step, and utility requests for `mayAct` patching and token introspection.

| File | Purpose |
|------|--------|
| [⬇ Download collection](https://raw.githubusercontent.com/curtismu7/banking-demo/main/docs/PingOne%20Authorization%20Code%20%E2%80%94%20pi.flow.postman_collection.json) | Steps 1–7 + Utility A (introspect) + Utility B (set mayAct) |

> **pi.flow** means the authorize request returns JSON instead of redirecting to a browser. Postman can complete the full PKCE flow headlessly in 4 steps, then exchange, then call the PingOne API — all without any browser interaction.

### Import

1. In Postman: **Import** → select the `.json` file.
2. The collection uses **Collection Variables** — no separate environment file needed.

### Fill in variables

Open the collection → **Variables tab** and fill in:

| Variable | Where to find it |
|---|---|
| `env_id` | PingOne Console → Environment → Settings |
| `client_id` | Client ID of **Super Banking User** app |
| `client_secret` | Client Secret of **Super Banking User** app |
| `banking_app_client_id` | Client ID of **Super Banking App** |
| `banking_app_client_secret` | Client Secret of **Super Banking App** |
| `mcp_client_id` | Client ID of **Super Banking MCP Service** app |
| `mcp_client_secret` | Client Secret of **Super Banking MCP Service** app |
| `username` | Test user login |
| `password` | Test user password |

Pre-filled: `base_url`, `resource` (`https://ai-agent.pingdemo.com`), `redirect_uri`, `scope` (`profile email banking:agent:invoke`). Token variables are written automatically by test scripts.

### One-time PingOne setup

Add `https://oauth.pstmn.io/v1/callback` as a **Redirect URI** on the **Super Banking User** app (Configuration tab). This allows Postman's OAuth2 helper to complete the PKCE flow. Remove it after testing if desired.

### ⚠️ Clear cookies before each full run

PingOne stores a session cookie in Postman after a successful login. On the next run, Step 1 returns `status: COMPLETED` immediately (skipping the login form), and the auth code it returns may be **stale or scoped differently** than you expect — `may_act` can be missing, or `aud` can be wrong.

**Always clear cookies before starting a fresh run:**

1. In Postman, click the 🍪 **Cookies** button (top-right of the request pane, next to Send)
2. Find `auth.pingone.com` → click the trash icon to delete all cookies for that domain
3. Then start from Step 1

**Errors you will see if you skip this:**

| Symptom | Cause |
|---------|-------|
| Step 1 returns `status: COMPLETED` with no login prompt | Stale PingOne session cookie — Postman reuses the old session |
| Step 4 test: `Subject Token aud is AI Agent` **FAILS** | Old session token has wrong `aud` (e.g. the app client ID instead of `https://ai-agent.pingdemo.com`) — issued before `resource=` was set correctly |
| Step 4 test: `may_act.sub present` **FAILS** | Token from cached session was issued before `may_act` was configured on the resource server |
| Step 5 returns `invalid_grant` | Subject Token expired or was issued without `may_act` — re-run Steps 1–4 with fresh cookies |
| Step 1 console: `*** SKIP steps 2 and 3 — go straight to step 4 ***` | Normal when session is still valid — only safe to skip if you've already confirmed `may_act` is in the token from this session |

> **Quick check:** After Step 4, open the Postman Console (`View → Show Postman Console`) and look for `[Step 4] may_act:`. If that line is missing, the token came from a cached session. Clear cookies and re-run from Step 1.

---

### Run in order

**Step 1 — Subject Token (Authorization Code + PKCE)**
1. Open Step 1 → **Authorization** tab → scroll to bottom → **Get New Access Token**.
2. A browser opens — log in as the test user.
3. Postman captures the callback → click **Use Token**.
4. Send the request. The test script decodes the access token, saves `subject_token` and `user_sub`, and validates `aud` and `may_act.sub`.

> If the `may_act` test fails: the user's `mayAct` attribute is not set. Run **Utility — Set mayAct** first (requires Steps 1–3 to have been run at least once to obtain Token 3), then re-run Step 1 to get a fresh Subject Token.

**Step 2 — MCP Token (Token Exchange #1)**
Send without any changes. The Banking App (`PINGONE_CORE_CLIENT_ID`) exchanges the Subject Token for an MCP-scoped token. The test script saves `mcp_token` and validates `aud`, `act.sub === PINGONE_CORE_CLIENT_ID`, and that `sub` is preserved.

**Step 3 — PingOne API Token (Client Credentials)**
Send without any changes. The MCP Service obtains a scoped token for the PingOne Management API. The test script saves `pingone_api_token` and validates `aud` and `scope`.

**Step 4 — User Lookup (PingOne Management API)**
Send without any changes. Calls `GET /v1/environments/{envId}/users/{user_sub}` using Token 3. Validates the response is 200 and checks that `mayAct.sub` on the user record matches `PINGONE_CORE_CLIENT_ID`.

### Utility requests

| Request | When to use |
|---|---|
| **Utility — Decode Token** | Introspects any saved token against PingOne's introspection endpoint. Change the `token` body value to `subject_token`, `mcp_token`, or `pingone_api_token`. |
| **Utility — Set mayAct on User** | PATCHes `mayAct = { "sub": "{{PINGONE_CORE_CLIENT_ID}}" }` onto the test user. Run if Step 1 warns that `may_act` is missing. Requires Token 3 — run Steps 1–3 first. |

---

## Part 7 — Verification

Decode any token at [PingIdentity JWT Decoder](https://developer.pingidentity.com/en/tools/jwt-decoder.html) or in terminal:
```bash
echo "<token>" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null | python3 -m json.tool
```

**Subject Token** — issued at login (Token 1 of 3):
```json
{
  "iss": "https://auth.pingone.com/{envId}/as",
  "aud": ["https://ai-agent.pingdemo.com"],
  "sub": "<user-pingone-id>",
  "scope": "profile email banking:agent:invoke",
  "may_act": { "sub": "<PINGONE_CORE_CLIENT_ID>" }
}
```
`may_act.sub` = the **client ID UUID** of Super Banking App. PingOne compares this to the actor token’s `client_id` during Exchange #1.

**MCP Token** — after Token Exchange #1 (Token 2):
```json
{
  "aud": ["https://mcp-server.pingdemo.com"],
  "sub": "<user-pingone-id>",
  "scope": "banking:accounts:read banking:transactions:read banking:transactions:write",
  "act": { "sub": "<PINGONE_CORE_CLIENT_ID>" }
}
```
`act.sub` = **client ID UUID** of Super Banking App — verifiable proof it performed Exchange #1.

**PingOne API Token** — from Client Credentials (Token 3):
```json
{
  "aud": ["https://api.pingone.com"],
  "scope": "p1:read:user p1:update:user"
}
```
The MCP server holds both Token 2 (proves who the user is + delegation) and Token 3 (proves it has permission to call the Management API). Token 3 has no `sub` — it represents the service, not the user.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Subject Token `aud` is the app client ID, not `https://ai-agent.pingdemo.com` | `ENDUSER_AUDIENCE` not set, or `resource=` missing from `/authorize` | Set `ENDUSER_AUDIENCE=https://ai-agent.pingdemo.com`; ensure `ff_oidc_only_authorize=false` |
| `invalid_scope: banking:agent:invoke` on login | Scope not allowed on `Super Banking User` app | Part 2a — enable `banking:agent:invoke` scope on the Resources tab |
| `may_act` missing from Subject Token | Token claim mapping missing, or user's `mayAct` attribute is null | Part 3b (add claim map) and Part 3c (set attribute on user) |
| `may_act` is a plain string, not an object | `mayAct` schema attribute type is `STRING` | Delete and re-create as type `JSON`; re-set the value on the user |
| Subject Token → MCP Token: `invalid_grant` | `may_act.sub` doesn’t match the Banking App’s client ID | Set `mayAct` = `{ "sub": "<PINGONE_CORE_CLIENT_ID-UUID>" }` on the user — use Option C (demo app) to set it automatically |
| Subject Token → MCP Token: `unauthorized_client` | `Super Banking App` missing Token Exchange grant type | Part 2b — enable Token Exchange grant |
| MCP Service client credentials failing (`invalid_scope: p1:read:user`) | `p1:read:user`/`p1:update:user` not enabled on app Resources tab | Enable both scopes on the **Resources tab** of **Super Banking MCP Service** (Part 2c). Do **not** add `openid` to the CC scope — it causes `invalid_scope` for Web App type client credentials |
| MCP Service client credentials failing (`unauthorized_client`) | App type is Worker (role-based, can't use resource scopes) | Part 2c — create as Native or Web App type, not Worker |
| `May not request scopes for multiple resources` on login | `banking:agent:invoke` and `banking:*` scopes mixed in the same `/authorize` | Keep only `banking:agent:invoke` as a non-OIDC scope on the user app; `banking:*` scopes come via exchange, not direct login |

---

*See also: [ACT_CLAIM_VERIFICATION.md](ACT_CLAIM_VERIFICATION.md)*
