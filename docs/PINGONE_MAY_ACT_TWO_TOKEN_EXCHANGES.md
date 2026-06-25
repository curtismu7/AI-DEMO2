# PingOne: 2-Exchange Delegated Chain — Setup Guide

> **RFC 8693 Terminology (Phase 188):** This document uses RFC 8693 primary terms.
> - **Subject Token** (§2.1) = user's access token or ID token
> - **Actor Token** (§2.2) = agent's client-credentials token  
> - **MCP-Scoped Access Token** (§3.2) = result of token exchange
> See [TOKEN_TERMINOLOGY_GLOSSARY.md](TOKEN_TERMINOLOGY_GLOSSARY.md) for complete definitions.

Step-by-step setup for a **human → AI Agent → MCP → PingOne API** fully-delegated token chain using **two chained RFC 8693 token exchanges**.

**Product scope:** PingOne SaaS (`auth.pingone.com`).

> **See also:** [PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md](PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md) — the simpler 1-exchange demo pattern (what the Super Banking app implements).

## Phase 184 Alignment (PingOne Test Page)

For current demo validation, treat these labels as canonical:

- Exchange 1: subject_token → MCP-scoped access token (single exchange, RFC 8693 §3.1)
- Exchange 2 (Phase 184): subject_token + actor_token → MCP Gateway token (RFC 8693 §2.2 delegation)
- Exchange 3: legacy educational two-step chain retained for comparison/testing

When updating test UX, logs, or runbooks, keep this mapping stable so Phase 184 checks are unambiguous.

## Exchange Patterns Reference

| Pattern | Mode | Location | Purpose |
|---------|------|----------|---------|
| Exchange 1 | `single` | PingOne Test Page, routes | Legacy baseline — user token only, no agent delegation |
| **Exchange 2** | **`dual` (or `double` legacy alias)** | **PingOne Test Page, routes, MCP Gateway** | **Phase 184 canonical — user OAuth + agent CC, act claim** |
| Exchange 3 | `legacy` / two-step | PingOne Test Page, routes | Educational reference — sequential exchanges, not recommended |
| **Exchange 186** | **`dual-id`** | **PingOne Test Page, routes** | **Phase 186 — user ID token + agent CC, act claim (identity-based)** |

**Recommended**: Use Exchange 2 (Phase 184 `dual` mode) for all agent-to-MCP communication. Exchange 1 and 3 retained for comparison testing only.

---

## Important: PingOne Resource-Scope Mental Model

**⚠️ Critical Understanding**: In PingOne, **Resources are created separately** from applications. The correct mental model is:

1. **Resources are pre-created** under `Connections → Resources` with a defined audience URI and scopes
2. **Applications only select scopes** from existing resources on their Resources tab
3. **You do NOT "Add Resource" on an app's Resources tab** - you only enable scopes from resources that already exist

**Correct Language**:
- ✅ "On the app's Resources tab, find `Resource Name` and select the scopes you want to grant"
- ❌ "Add Resource → select Resource Name"

If a resource doesn't appear on an app's Resources tab, it means:
- The resource wasn't created yet in `Connections → Resources`, OR
- The resource wasn't added to the environment's resource list

**Create resources first** (under `Connections → Resources`), then **select scopes on apps**.

---

## When to use this pattern

Use 2 exchanges when:
- The **AI Agent itself must be a named, verifiable identity** in the delegation chain
- **PingOne Authorize (PAZ)** must enforce `act.sub` (MCP) and `act.act.sub` (AI Agent) as policy attributes
- You need a full audit trail: every hop is cryptographically recorded in nested `act` claims
- You are building for regulated or production environments where every actor must be named

Use the [1-exchange pattern](PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md) instead when:
- You are learning `may_act` / `act` delegation basics
- The AI Agent does not need to be a named identity in the `act` chain
- You want minimal PingOne configuration

---

## Coexistence with 1-Exchange — What to Reuse vs Create

> **Running both modes in the same demo?** No duplication of apps or resource servers is needed. The `ff_two_exchange_delegation` feature flag in the BFF toggles the BFF between the two code paths at runtime. The DemoDataPage **Delegation Mode** radio button sets `mayAct.sub` on the user record to the correct client ID for the selected mode.

| Object | 1-Exchange role | 2-Exchange role | Action |
|--------|-----------------|-----------------|--------|
| **Super Banking AI Agent Service** (resource server) | Subject Token audience | Subject Token audience | ✅ Reuse — no config change |
| **Super Banking Agent Gateway** (resource server) | Banking App actor token audience | AI Agent actor token audience | ✅ Reuse — no config change |
| **Super Banking MCP Server** (resource server) | Final MCP Token audience | Exchange #1 output audience | ✅ Reuse — same `act` expression works for both; PingOne checks `may_act.sub == actorToken.aud[0]` regardless of which UUID is in each field |
| **Super Banking User App** (app) | OIDC login | OIDC login | ✅ Reuse — no change |
| **Super Banking Admin App** (app) | Exchange #1 exchanger | Not in the exchange chain (BFF bypasses it when flag is ON) | ✅ Reuse — keep the app; 2-exchange does not break or remove it. See Step 2d if missing. |
| **Super Banking MCP Token Exchanger** (app) | Client Credentials for PingOne API | Exchange #2 exchanger + Client Credentials for PingOne API | ✅ Modify — add `Token Exchange` grant; enable Super Banking MCP Gateway and Super Banking API scopes |
| **PingOne API** (built-in resource server) | CC token audience | CC token audience | ✅ Reuse — no change |
| **`mayAct` user schema attribute** | Holds Banking App UUID | Holds AI Agent App UUID | ✅ Reuse schema — change the **value** on user records |
| **Super Banking AI Agent App** (app) | — | Exchange #1 exchanger | 🆕 Create new |
| **Super Banking MCP Gateway** (resource server) | — | MCP Service actor token audience | 🆕 Create new |
| **Super Banking API** (resource server) | — | Final MCP Exchanged Token audience | 🆕 Create new |

**The only per-user change** is `mayAct.sub` — it must point to `AI_AGENT_CLIENT_ID` for 2-exchange (vs Banking App client ID for 1-exchange). The DemoDataPage **Delegation Mode** radio button and **Enable may_act** button set this automatically.

---

## How It Works

> **What is Token Exchange (RFC 8693)?** An app POSTs an existing access token to PingOne's token endpoint with `grant_type=token-exchange`. PingOne validates the token, checks delegation permissions, and issues a *new* token scoped to a different audience. Each exchange is a synchronous server-to-server call.

### 2-exchange pattern

In this pattern every hop performs a full RFC 8693 exchange. Each exchanger first obtains its own Actor Token via Client Credentials, then presents it alongside the incoming token. The result is a deeply nested `act` claim tracing every delegation hop. PingOne Authorize (PAZ) introspects the final token and enforces `act.sub` and `act.act.sub` as explicit policy attributes before permitting tool access.

```
Human User (Banking App Login)
  |
  |  PKCE Authorization Code login - user authenticates normally
  |
Subject Token  [TOKEN 1 - user's session token]
  { sub: "<user-id>",
    aud: ["https://ai-agent.pingdemo.com"],
    scope: "profile email banking:agent:invoke",
    may_act: { "sub": "<AI_AGENT_CLIENT_ID>" } }
              - permits the AI Agent to exchange this token
  |
  |  Token Exchange #1 (RFC 8693)
  |  AI Agent gets its own Actor Token via Client Credentials (aud: https://agent-gateway.pingdemo.com)
  |  Exchanges: subject_token=Subject Token + actor_token=Agent Actor Token
  |  Exchanger: Super Banking AI Agent App (AI_AGENT_CLIENT_ID)
  |
Agent Exchanged Token  [TOKEN 2 - agent-delegated token]
  { sub: "<user-id>",
    aud: ["https://mcp-server.pingdemo.com"],
    act: { "sub": "<AI_AGENT_CLIENT_ID>" } }
          - records that the AI Agent performed Exchange #1
  |
  |  Token Exchange #2 (RFC 8693)
  |  MCP Server gets its own Actor Token via Client Credentials (aud: https://mcp-gateway.pingdemo.com)
  |  Exchanges: subject_token=Agent Exchanged Token + actor_token=MCP Actor Token
  |  Exchanger: Super Banking MCP Token Exchanger App (MCP_CLIENT_ID)
  |
MCP Exchanged Token  [TOKEN 3 - fully delegated tool-call token]
  { sub: "<user-id>",
    aud: ["https://resource-server.pingdemo.com"],
    scope: "banking:accounts:read banking:transactions:read banking:transactions:write",
    act: {
      "sub": "<MCP_CLIENT_ID>",         - outer act: MCP App performed Exchange #2
      "act": {
        "sub": "<AI_AGENT_CLIENT_ID>"   - inner act: AI Agent performed Exchange #1
      }
    }
  }
  |
  |  PAZ (PingOne Authorize) introspects the MCP Exchanged Token:
  |    - sub is a known user
  |    - aud == resource server URL
  |    - act.sub == MCP_CLIENT_ID
  |    - act.act.sub == AI_AGENT_CLIENT_ID
  |  - DENY if any check fails
  |
PERMIT - Banking Tools - PingOne Management API - Resource
```

### ASCII Flow Diagram - 2-Exchange Token Chain

```
    Human User
        |
        | 1. PKCE Login (Authorization Code)
        v
    Super Banking User App
        |
        | 2. Subject Token (TOKEN 1)
        |    aud: https://ai-agent.pingdemo.com
        |    may_act: { sub: "AI_AGENT_CLIENT_ID" }
        v
    Super Banking AI Agent App
        |
        | 3. Client Credentials (Actor Token)
        |    aud: https://agent-gateway.pingdemo.com
        v
    PingOne Token Endpoint
        |
        | 4. RFC 8693 Exchange #1
        |    subject_token: TOKEN 1
        |    actor_token: AI Agent CC token
        v
    PingOne Token Endpoint
        |
        | 5. Agent Exchanged Token (TOKEN 2)
        |    aud: https://mcp-server.pingdemo.com
        |    act: { sub: "AI_AGENT_CLIENT_ID" }
        v
    Super Banking MCP Token Exchanger
        |
        | 6. Client Credentials (Actor Token)
        |    aud: https://mcp-gateway.pingdemo.com
        v
    PingOne Token Endpoint
        |
        | 7. RFC 8693 Exchange #2
        |    subject_token: TOKEN 2
        |    actor_token: MCP Server CC token
        v
    PingOne Token Endpoint
        |
        | 8. MCP Exchanged Token (TOKEN 3)
        |    aud: https://resource-server.pingdemo.com
        |    act: { 
        |           sub: "MCP_CLIENT_ID",
        |           act: { sub: "AI_AGENT_CLIENT_ID" }
        |         }
        v
    PingOne Authorize (PAZ)
        |
        | 9. Policy Validation
        |    - Validate nested act claims
        |    - Enforce per-actor policies
        v
    Banking Tools (MCP)
        |
        | 10. PingOne Management API Calls
        v
    PingOne Management API
```

### ASCII Flow Diagram - Nested Delegation Chain

```
TOKEN 1: Subject Token (User Session)
=====================================
iss: https://auth.pingone.com/{envId}/as
aud: ["https://ai-agent.pingdemo.com"]
sub: "<user-id>"
scope: "profile email banking:agent:invoke"
may_act: { sub: "<AI_AGENT_CLIENT_ID>" }
          |
          | Validated by: AI Agent Service
          | Purpose: User authentication + AI Agent delegation permission
          v

TOKEN 2: Agent Exchanged Token (AI Agent Delegation)
===================================================
iss: https://auth.pingone.com/{envId}/as
aud: ["https://mcp-server.pingdemo.com"]
sub: "<user-id>"
act: { sub: "<AI_AGENT_CLIENT_ID>" }
          |
          | Validated by: MCP Server
          | Purpose: AI Agent identity delegation proof
          v

TOKEN 3: MCP Exchanged Token (Full Delegation)
=============================================
iss: https://auth.pingone.com/{envId}/as
aud: ["https://resource-server.pingdemo.com"]
sub: "<user-id>"
scope: "banking:accounts:read banking:transactions:read banking:transactions:write"
act: {
  sub: "<MCP_CLIENT_ID>",           - Outer: MCP Server performed Exchange #2
  act: {
    sub: "<AI_AGENT_CLIENT_ID>"     - Inner: AI Agent performed Exchange #1
  }
}
          |
          | Validated by: PingOne Authorize (PAZ)
          | Purpose: Full delegation audit trail + tool access
          v
```

| Token | Audience | How issued | Exchanger |
|-------|----------|------------|-----------|
| **Subject Token** | `https://ai-agent.pingdemo.com` | PKCE login | PingOne (user auth) |
| **Agent Exchanged Token** | `https://mcp-server.pingdemo.com` | RFC 8693 Exchange #1 | Super Banking AI Agent App |
| **MCP Exchanged Token** | `https://resource-server.pingdemo.com` | RFC 8693 Exchange #2 | Super Banking MCP Token Exchanger App |

> **Nested `act` chain:** Each exchange promotes the previous actor inward. `act.sub` = most recent exchanger (MCP App); `act.act.sub` = the one before (AI Agent). PAZ enforces each level as a named policy attribute.

> **`may_act` → `act` transition:** `may_act` in the Subject Token declares who is *allowed* to perform Exchange #1. After exchange, that identity becomes the outer `act`. Exchange #2 nests a second `act` layer inside.

---

## Architecture Diagram

A draw.io diagram of the full 2-exchange token chain is included in this repo:

| File | Download link |
|------|---------------|
| `docs/Super-Banking-2-Exchange-Delegated-Chain.drawio` | [⬇ Download](https://raw.githubusercontent.com/curtismu7/banking-demo/fix/dashboard-fab-positioning/docs/Super-Banking-2-Exchange-Delegated-Chain.drawio) |

> **To download:** Right-click the link above → **Save Link As** → save as `Super-Banking-2-Exchange-Delegated-Chain.drawio`.
> (Clicking opens the raw XML in the browser — right-click is required to save the file.)

### How to open

**Option A — draw.io (recommended):**
1. Save the `.drawio` file using right-click → Save Link As (see above).
2. Go to [app.diagrams.net](https://app.diagrams.net) → **Open from → This device** → select the file.
   Or open it directly in VS Code with the [hediet.vscode-drawio](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio) extension.

**Option B — Import into Lucidchart:**
1. Open the file in draw.io first (Option A above) and re-save it — this normalises the XML.
2. In Lucidchart: **New Document → Import → From File** → select the `.drawio` file.
   Lucidchart accepts draw.io/XML format directly. If shapes are missing, use **Extras → Edit Diagram** in draw.io to export as `.xml` and import that instead.

---

## ⚠️ Critical: Do NOT include `openid` in any scope

| Request | What breaks if `openid` is included |
|---------|-------------------------------------|
| `/authorize` (Subject Token) | `invalid_scope` — `openid` conflicts with custom `resource=` audience |
| Exchange #1 or #2 token requests | `invalid_scope` — token exchange does not support OIDC scopes |
| Client Credentials (actor tokens) | `invalid_scope` — Web App type cannot request `openid` via CC |

**Correct scopes:**

| Step | Scope |
|------|-------|
| `/authorize` | `profile email banking:agent:invoke` |
| Exchange #1 (AI Agent actor CC) | `agent:invoke` ← required to associate Agent Gateway with the AI Agent App in PingOne |
| Exchange #1 result (Agent Exchanged Token) | `banking:accounts:read banking:transactions:read banking:transactions:write` |
| Exchange #2 (MCP actor CC) | `mcp:invoke` ← required to associate MCP Gateway with the MCP Token Exchanger App in PingOne |
| Exchange #2 result (MCP Exchanged Token) | `banking:accounts:read banking:transactions:read banking:transactions:write` |

---

## Reference: Names and Values

| Item | Field | Value |
|------|-------|-------|
| AI Agent Resource Server | Name | `Super Banking AI Agent Service` |
| AI Agent Resource Server | Audience | `https://ai-agent.pingdemo.com` |
| AI Agent Resource Server | Scope | `banking:agent:invoke` |
| Agent Gateway Resource Server | Name | `Super Banking Agent Gateway` |
| Agent Gateway Resource Server | Audience | `https://agent-gateway.pingdemo.com` |
| MCP Resource Server | Name | `Super Banking MCP Server` |
| MCP Resource Server | Audience | `https://mcp-server.pingdemo.com` |
| MCP Resource Server | Scopes | `banking:accounts:read`, `banking:transactions:read`, `banking:transactions:write` |
| AI Agent App | Name | `Super Banking AI Agent App` |
| AI Agent App | Grant Types | `Token Exchange`, `Client Credentials` |
| MCP Service App | Name | `Super Banking MCP Token Exchanger` |
| MCP Service App | Grant Types | `Token Exchange`, `Client Credentials` |
| `may_act.sub` on user records | equals | `AI_AGENT_CLIENT_ID` — the client ID UUID of Super Banking AI Agent App |

---

## Part 1 — Resource Servers

> **PingOne Console → Connections → Resources**

---

### 1a. Super Banking AI Agent Service *(Subject Token audience)*

> **If you have 1-exchange set up:** This resource server already exists. No configuration changes are needed — the `may_act` expression (`user.mayAct`) is identical. The only runtime difference is the value in `mayAct.sub` on user records: for 2-exchange it must be the **AI Agent App client ID** (`AI_AGENT_CLIENT_ID`).

This resource server gives the Subject Token a meaningful audience URL and injects the `may_act` claim that authorizes the AI Agent to perform Exchange #1.

Click **Add Resource** (or open the existing one) and fill in:

**Overview tab:**

| Field | Value |
|-------|-------|
| **Resource name** | `Super Banking AI Agent Service` |
| **Audience** | `https://ai-agent.pingdemo.com` |
| **Description** | `Audience resource server for the Super Banking AI Agent. The Subject Token issued at user login is scoped to this resource and carries the may_act claim that authorizes token exchange.` |
| **Access token time to live (seconds)** | `3600` |
| **Token Introspection Endpoint Authentication Method** | `Client Secret Basic` |

Click **Save**.

**Attribute Mappings tab → Add one attribute:**

| Field | Value |
|-------|-------|
| **Attribute name** | `may_act` |
| **Expression** | `user.mayAct` |
| **Required** | ❌ No |

> **Expression syntax:** Use bare SpEL — no `${}` wrapper, no `#root.` prefix. `user.mayAct` reads the `mayAct` JSON attribute from the user profile. If the attribute is null, PingOne omits the claim (because Required is off).
>
> **How to test in PingOne:**
> 1. Click the pencil icon next to the `may_act` row → **Build and Test Expression** opens.
> 2. Expression field: `user.mayAct`
> 3. Click **Edit JSON** in the Test Data panel and paste — replacing `<AI_AGENT_CLIENT_ID>` with the AI Agent App client ID UUID:
> ```json
> {
>   "user": {
>     "mayAct": { "sub": "<AI_AGENT_CLIENT_ID>" }
>   }
> }
> ```
> 4. Click **Test Expression** — Result panel shows `{ "sub": "<AI_AGENT_CLIENT_ID>" }` — **Verification Successful**.
> 5. Remove `mayAct` from the test data and re-test — result should be `null` (claim omitted, no error).
>
> **Common mistake:** `${user.mayAct}` and `#root.user.mayAct` are both invalid. Use `user.mayAct` with no wrapper.

Click **Save**.

**Scopes tab → Add Scope:**

| Field | Value |
|-------|-------|
| **Scope name** | `banking:agent:invoke` |
| **Description** | `Grants permission to invoke the Super Banking AI Agent on behalf of the authenticated user. Present on the Subject Token.` |

Click **Save**.

---

### 1b. Super Banking Agent Gateway *(AI Agent actor token audience)*

This resource server exists solely to give the AI Agent App a verifiable audience URI for its actor token. When the AI Agent requests a Client Credentials token scoped to `https://agent-gateway.pingdemo.com`, PingOne issues a token whose `aud` is this value. During Exchange #1, PingOne reads `actorToken.aud[0]` and compares it to `may_act.sub` on the Subject Token — they must match for the exchange to succeed.

> **If you have 1-exchange set up:** This resource server already exists (it was the Banking App's actor token audience). No changes needed — the URL and configuration are identical. Both patterns use this same audience for the actor identity check.

Click **Add Resource** (or confirm it exists) and fill in:

**Overview tab:**

| Field | Value |
|-------|-------|
| **Resource name** | `Super Banking Agent Gateway` |
| **Audience** | `https://agent-gateway.pingdemo.com` |
| **Description** | `Audience resource server for the Super Banking AI Agent App actor token. The AI Agent obtains a Client Credentials token scoped to this audience and presents it as actor_token during Exchange #1. PingOne reads this token's aud[0] and compares it to may_act.sub on the user's Subject Token.` |
| **Access token time to live (seconds)** | `3600` |
| **Token Introspection Endpoint Authentication Method** | `Client Secret Basic` |

Click **Save**.

**Attribute Mappings tab:** No mappings needed. Leave this tab unchanged.

**Scopes tab → Add Scope:**

| Scope name | Description |
|---|---|
| `agent:invoke` | Required by PingOne to associate this resource with the Super Banking AI Agent App. The AI Agent App obtains a Client Credentials token carrying this scope and presents it as the actor_token in Exchange #1. PingOne requires at least one scope on a resource before an app can select it on the Resources tab - without this, the resource will not appear on the app's Resources tab at all. |

> The **Super Banking AI Agent App** must select `agent:invoke` from this resource on its Resources tab (Step 2b).

---

### 1c. Super Banking MCP Server *(Agent Exchanged Token audience + Exchange #2 input)*

This resource server serves two roles in the 2-exchange chain:
1. It is the **audience of the Agent Exchanged Token** (Exchange #1 output) — the AI Agent requests tokens scoped to `https://mcp-server.pingdemo.com`
2. Its `act` expression fires during Exchange #1 and injects the `act` claim into the Agent Exchanged Token, recording that the AI Agent performed the exchange

> **If you have 1-exchange set up:** This resource server already exists with the `act` expression and scopes configured. **No changes needed.** The `act` expression is identical — the formula `may_act.sub == actorToken.aud[0]` works for both modes because `may_act.sub` and the actor's client ID UUID are always compared regardless of which app holds those UUIDs at runtime.

Click **Add Resource** (or open the existing one) and fill in:

**Overview tab:**

| Field | Value |
|-------|-------|
| **Resource name** | `Super Banking MCP Server` |
| **Audience** | `https://mcp-server.pingdemo.com` |
| **Description** | `Audience resource server for the Super Banking MCP Model Context Protocol server. Tokens scoped to this audience are issued by Exchange #1 and carry the act claim recording the AI Agent's identity. The MCP Service validates these tokens before performing Exchange #2.` |
| **Access token time to live (seconds)** | `3600` |
| **Token Introspection Endpoint Authentication Method** | `Client Secret Basic` |

Click **Save**.

**Attribute Mappings tab — `act` claim for Exchange #1 output:**

> **`sub` does not need a custom mapping.** PingOne automatically carries `sub` from the subject token into the issued token during RFC 8693 exchange. Do not configure a `sub` expression here — if you try `#root.context.requestData.subjectToken.sub` in the SpEL tester it returns `null` because PingOne only exposes **custom claims** (like `may_act`) on the `subjectToken` context object, not standard JWT claims (`sub`, `iss`, `exp`, `aud`). Leave `sub` unconfigured and PingOne sets it automatically.

Add one attribute:

| Field | Value |
|-------|-------|
| **Attribute name** | `act` |
| **Expression** | `(#root.context.requestData.subjectToken?.may_act?.sub != null && #root.context.requestData.subjectToken?.may_act?.sub == #root.context.requestData.actorToken?.aud?.get(0))?#root.context.requestData.subjectToken?.may_act:null` |
| **Required** | ✅ Yes |

This compares `may_act.sub` in the Subject Token (the AI Agent's client ID UUID) against `aud[0]` of the actor token the AI Agent App presents. If they match, `may_act` is promoted to `act` in the Agent Exchanged Token. If they don't match — wrong app trying to exchange — `act` is `null` and the exchange fails because the attribute is required.

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
> - `?.may_act?.sub` — safe navigation: returns `null` instead of throwing if `may_act` is absent
> - `?.aud?.get(0)` — safe navigation: returns `null` if the actor token has no `aud` array
> - `!= null &&` — explicit guard: prevents `null == null` from evaluating to `true` when `may_act` is absent
> - If checks pass and UUIDs match: returns `may_act` (which becomes `act` in the Agent Exchanged Token)

> **How to test in PingOne:**
> 1. Click the pencil icon next to the `act` mapping → **Build and Test Expression** opens.
> 2. Click **Edit JSON** in the Test Data panel and paste — replacing `<AI_AGENT_CLIENT_ID>` with the AI Agent App's client ID UUID in both places:
> ```json
> {
>   "context": {
>     "requestData": {
>       "subjectToken": {
>         "iss": "https://auth.pingone.com/<PINGONE_ENVIRONMENT_ID>/as",
>         "sub": "425d38ac-adcc-463c-83cb-e9eb88179a79",
>         "aud": ["https://ai-agent.pingdemo.com"],
>         "scope": "profile email banking:agent:invoke",
>         "may_act": {
>           "sub": "<AI_AGENT_CLIENT_ID>"
>         }
>       },
>       "actorToken": {
>         "aud": ["<AI_AGENT_CLIENT_ID>"]
>       }
>     }
>   }
> }
> ```
> 3. Click **Test Expression** — Result panel shows `{ "sub": "<AI_AGENT_CLIENT_ID>" }` — **Verification Successful**.
> 4. Change one UUID so they don't match — result should be `null`. This proves the guard works.
> 5. Click **Save**.
>
> **What SpEL can and cannot read from `subjectToken`:**
> - ✅ Custom claims (`may_act`, and other non-standard claims) — fully accessible
> - ❌ Standard JWT claims (`sub`, `iss`, `aud`, `exp`) — return `null` if referenced; include them in test data for realism but the expression ignores them

**Scopes tab → Add three scopes:**

| Scope name | Description |
|------------|-------------|
| `banking:accounts:read` | Read access to the authenticated user's bank account list and balances |
| `banking:transactions:read` | Read access to the authenticated user's transaction history |
| `banking:transactions:write` | Write access to initiate transactions on behalf of the authenticated user |

Click **Save** after each scope.

---

### 1d. Super Banking MCP Gateway *(MCP Service actor token audience)*

This resource server exists solely to give the MCP Service a verifiable audience URI for its actor token in Exchange #2. The MCP Service requests a Client Credentials token scoped to `https://mcp-gateway.pingdemo.com` and presents it as `actor_token` when performing Exchange #2. PingOne uses this token's `client_id` to identify the MCP Service as the current actor and records it in the final token's `act.sub`.

Click **Add Resource** and fill in:

**Overview tab:**

| Field | Value |
|-------|-------|
| **Resource name** | `Super Banking MCP Gateway` |
| **Audience** | `https://mcp-gateway.pingdemo.com` |
| **Description** | `Audience resource server for the Super Banking MCP Token Exchanger actor token. The MCP Service obtains a Client Credentials token scoped to this audience and presents it as actor_token during Exchange #2. PingOne identifies the MCP Service as the delegating actor via its client_id.` |
| **Access token time to live (seconds)** | `3600` |
| **Token Introspection Endpoint Authentication Method** | `Client Secret Basic` |

Click **Save**.

**Attribute Mappings tab:** No mappings needed. Leave this tab unchanged.

**Scopes tab → Add Scope:**

| Scope name | Description |
|---|---|
| `mcp:invoke` | Required by PingOne to associate this resource with the Super Banking MCP Token Exchanger App. The MCP Token Exchanger obtains a Client Credentials token carrying this scope and presents it as the actor_token in Exchange #2. PingOne requires at least one scope on a resource before an app can select it on the Resources tab - without this, the resource will not appear on the app's Resources tab at all. |

> The **Super Banking MCP Token Exchanger** app must select `mcp:invoke` from this resource on its Resources tab (Step 2c).

---

### 1e. Super Banking API *(final MCP Exchanged Token audience)*

This is the protected resource the MCP Exchanged Token grants access to. The MCP Service performs Exchange #2 requesting this audience — the resulting token is scoped to `https://resource-server.pingdemo.com` and carries the `act` claim proving the full delegation chain. PAZ (PingOne Authorize) introspects this token and enforces `act.sub` (AI Agent) as a named policy attribute before permitting tool access.

> This resource server is **new** — it does not exist in the 1-exchange setup (the 1-exchange final token audience is `Super Banking MCP Server` at `https://mcp-server.pingdemo.com`). Create it fresh.

Click **Add Resource** and fill in:

**Overview tab:**

| Field | Value |
|-------|-------|
| **Resource name** | `Super Banking API` |
| **Audience** | `https://resource-server.pingdemo.com` |
| **Description** | `Protected resource server for the Super Banking banking tools. The MCP Exchanged Token is scoped to this audience and carries act.sub proving the AI Agent delegation chain. PAZ introspects tokens against this audience to enforce actor identity before permitting tool access.` |
| **Access token time to live (seconds)** | `3600` |
| **Token Introspection Endpoint Authentication Method** | `Client Secret Basic` |

Click **Save**.

**Attribute Mappings tab:**

No custom mapping needed. Leave this tab unchanged.

> **Why not here?** PingOne automatically constructs the nested `act` claim during Exchange #2 — no attribute expression is needed. The outer `act.sub` is set to the MCP Service's `client_id` (the exchanger), and the inner `act.act` is promoted from the `act` claim on the Agent Exchanged Token (preserving the AI Agent's identity from Exchange #1). This is standard RFC 8693 §4.4 behavior.
>
> **PingOne SpEL limitation (for reference):** If you try to write a custom `act` expression on this resource server, it will fail. PingOne's SpEL evaluator cannot navigate nested Map entries via `?.` safe navigation (the `act` claim is a JSON object — `subjectToken?.act?.sub` returns null). Additionally, PingOne SpEL does not support inline Map construction (`{'key': value}` syntax), so the RFC 8693 §5.4 nested structure cannot be produced as an expression.
>
> **Where the chain is enforced:** The BFF's `_performTwoExchangeDelegation()` decodes the Final Token and verifies `act.sub` (MCP Service) and `act.act.sub` (AI Agent) are both present. PAZ enforces these as named policy attributes during token introspection.

**Scopes tab → Add three scopes:**

| Scope name | Description |
|------------|-------------|
| `banking:accounts:read` | Read access to the authenticated user's bank account list and balances |
| `banking:transactions:read` | Read access to the authenticated user's transaction history |
| `banking:transactions:write` | Write access to initiate transactions on behalf of the authenticated user |

Click **Save** after each scope.

> These scopes must also be enabled on the **Super Banking MCP Token Exchanger** app's Resources tab (Step 2c) so the MCP Service is authorized to request them in Exchange #2.

> **PingOne Console → Applications → Applications**

---

### 2a. Super Banking User App *(issues Subject Token)*

> **If you have 1-exchange set up:** This app already exists. No grant type or redirect URI changes are needed. Confirm `banking:agent:invoke` is enabled on the Resources tab (it should be from 1-exchange setup). No attribute mapping changes needed.

Open (or create) the end-user OIDC application:

**Overview tab:**

| Field | Value |
|-------|-------|
| **Application name** | `Super Banking User App` |
| **Home Page URL** | `https://banking-demo-puce.vercel.app` |
| **Signon URL** | `https://banking-demo-puce.vercel.app` |

**Configuration tab → Grant Types — check exactly these:**

- ✅ `Authorization Code`
- ✅ `Refresh Token`
- ❌ `Token Exchange` — do NOT enable on this app

| Field | Value |
|-------|-------|
| **PKCE enforcement** | `S256_REQUIRED` |
| **Token endpoint auth method** | `CLIENT_SECRET_POST` |
| **Redirect URIs** | `https://banking-demo-puce.vercel.app/api/auth/oauthuser/callback` (production) |
| | `http://localhost:3000/api/auth/oauthuser/callback` (local dev) |
| | `http://localhost:4000/api/auth/oauthuser/callback` (local dev — `run-demo.sh` port) |

> **Note:** PingOne allows multiple redirect URIs per app. Add all environments you intend to use. The URI sent in the authorize request must exactly match one of the registered values.

**Resources tab → Allowed scopes — enable:**

- ✅ `banking:agent:invoke` from **Super Banking AI Agent Service` *(this is the scope requested at user login — distinct from `agent:invoke` which is the AI Agent's CC actor token scope)*
- ✅ `profile`, `email`, `offline_access` *(standard — already present)*
- ❌ Do **NOT** enable `openid` — it causes `invalid_scope` when `resource=https://ai-agent.pingdemo.com` is present in the authorize request

**Attribute Mappings tab:** Leave unchanged. The `may_act` claim in the access token is produced by the expression on the **Super Banking AI Agent resource server** (Step 1a) — not here. Application attribute mappings only deliver to UserInfo and ID Token, not access tokens.

Click **Save**.

---

### 2b. Create: Super Banking AI Agent App *(performs Exchange #1)*

This is the AI Agent's OAuth identity in PingOne. Its client ID UUID is what you store in `mayAct.sub` on user records — it is the identity PingOne checks has permission to perform Exchange #1. The app performs two calls:
1. Gets its own Actor Token via Client Credentials (audience: `https://agent-gateway.pingdemo.com`) — proves its identity to PingOne during the exchange
2. Performs Exchange #1: `subject_token` = Subject Token + `actor_token` = Agent Actor Token → Agent Exchanged Token scoped to `https://mcp-server.pingdemo.com`

In the PingOne console sidebar, expand **Applications** → select **AI Agents** → click **Add Application**:

**Overview tab:**

| Field | Value |
|-------|-------|
| **Application name** | `Super Banking AI Agent App` |
| **Description** | `OAuth identity for the Super Banking AI Agent. Performs Exchange #1 to obtain a delegation token scoped to the MCP Server. Its client ID UUID is stored as mayAct.sub on user records to authorize it to exchange Subject Tokens.` |
| **Application type** | `Web App` — **do NOT select Worker** |
| **Home Page URL** | *(leave blank — no UI)* |

**Configuration tab → Grant Types — enable exactly these:**

- ✅ `Token Exchange` ← **required** — grants permission to perform RFC 8693 exchanges
- ✅ `Client Credentials` ← **required** — used to obtain the actor token
- ❌ `Authorization Code` — not needed

| Field | Value |
|-------|-------|
| **Token endpoint auth method** | `CLIENT_SECRET_POST` |

**Resources tab → Allowed scopes — enable:**

- ✅ `banking:accounts:read`, `banking:transactions:read`, `banking:transactions:write` from **Super Banking MCP Server** — these flow into the Agent Exchanged Token (Exchange #1 output)
- ✅ `agent:invoke` from **Super Banking Agent Gateway** — CC actor token scope; PingOne issues a token with `aud: https://agent-gateway.pingdemo.com` only when this app has this scope selected. Without it, the audience parameter is ignored and the wrong `aud` is returned.

**Attribute Mappings tab:** No mappings needed. Leave this tab unchanged.

Click **Save**, then:
- Copy the **Client ID** → this is `AI_AGENT_CLIENT_ID` (env var)
- Copy the **Client Secret** → this is `AI_AGENT_CLIENT_SECRET` (env var)
- This UUID is also what you set as `mayAct.sub` on user records (Part 3b) — every user whose Subject Token should be exchangeable by the AI Agent must have `{ "sub": "<AI_AGENT_CLIENT_ID>" }` in their `mayAct` attribute

---

### 2c. Configure: Super Banking MCP Token Exchanger *(performs Exchange #2 + PingOne API calls)*

> **If you have 1-exchange set up:** This app already exists with `Client Credentials` grant and `p1:read:user`/`p1:update:user` scopes. You need to: (1) add `Token Exchange` grant on the Configuration tab, (2) enable scopes from **Super Banking MCP Gateway** and **Super Banking API** on the Resources tab.

This app performs two roles in the 2-exchange chain:
1. Gets its own Actor Token via Client Credentials (audience: `https://mcp-gateway.pingdemo.com`) to use as `actor_token` in Exchange #2
2. Exchanges: `subject_token` = Agent Exchanged Token + `actor_token` = MCP Actor Token → MCP Exchanged Token
3. Gets a separate Client Credentials token for PingOne Management API calls (`p1:read:user`, `p1:update:user`)

**Configuration tab → Grant Types:**
- ✅ `Token Exchange`
- ✅ `Client Credentials`

| Field | Value |
|-------|-------|
| **Token endpoint auth method** | `CLIENT_SECRET_POST` |

**Resources tab → Allowed scopes — enable:**

- ✅ `banking:accounts:read`, `banking:transactions:read`, `banking:transactions:write` from **Super Banking API** — these flow into the final MCP Exchanged Token (Exchange #2 output)
- ✅ `mcp:invoke` from **Super Banking MCP Gateway** — CC actor token scope; PingOne issues a token with `aud: https://mcp-gateway.pingdemo.com` only when this app has this scope selected. Without it, the audience parameter is ignored and the wrong `aud` is returned.
- ✅ `p1:read:user`, `p1:update:user` from **PingOne API** *(for Management API calls to read/update user records)*

Copy the **Client ID** → `AGENT_OAUTH_CLIENT_ID` env var. Copy the **Client Secret** → `AGENT_OAUTH_CLIENT_SECRET` env var.

---

### 2d. Create if missing: Super Banking Admin App *(1-exchange exchanger — not used in 2-exchange chain)*

This app performs Token Exchange #1 in the **1-exchange pattern**. It is **not in the 2-exchange chain** — the BFF bypasses it when `FF_TWO_EXCHANGE_DELEGATION=true`. However it must exist in PingOne for the 1-exchange fallback to work, and its client ID is stored in `PINGONE_ADMIN_CLIENT_ID` in the BFF `.env`.

> **If the app already exists:** Confirm it has `Token Exchange` and `Authorization Code` grant types and `banking:accounts:read/transactions:read/transactions:write` from **Super Banking MCP Server** on its Resources tab. No other changes needed.

If the app is missing, click **Add Application** → **Applications** category and fill in:

**Overview tab:**

| Field | Value |
|-------|-------|
| **Application name** | `Super Banking Admin App` |
| **Description** | `Banking app server. Authenticates users and performs Exchange #1 in the 1-exchange delegation pattern to get an MCP-scoped token on behalf of the authenticated user. The Client ID of this app must be set as mayAct.sub on user records when using 1-exchange mode.` |
| **Home Page URL** | `https://banking-demo-puce.vercel.app` |
| **Signon URL** | `https://banking-demo-puce.vercel.app` |

**Configuration tab → Grant Types — enable all of these:**

- ✅ `Authorization Code`
- ✅ `Refresh Token`
- ✅ `Token Exchange` ← required for 1-exchange delegation
- ✅ `Client Initiated Backchannel Authentication (CIBA)` *(required for step-up auth)*

| Field | Value |
|-------|-------|
| **PKCE enforcement** | `S256_REQUIRED` |
| **Token endpoint auth method** | `CLIENT_SECRET_POST` |
| **Redirect URIs** | `https://banking-demo-puce.vercel.app/api/auth/oauth/callback` |
| | `http://localhost:3000/api/auth/oauth/callback` |
| | `http://localhost:4000/api/auth/oauth/callback` |

**Resources tab → Allowed scopes — enable:**

- ✅ `banking:accounts:read`, `banking:transactions:read`, `banking:transactions:write` from **Super Banking MCP Server**

**Attribute Mappings tab:** No mappings needed. Leave unchanged.

Click **Save**, then:
- Copy the **Client ID** → `PINGONE_ADMIN_CLIENT_ID` env var
- Copy the **Client Secret** → `PINGONE_ADMIN_CLIENT_SECRET` env var

---

## Part 3 — User Schema and mayAct Setup

> **If you have 1-exchange set up:** The `mayAct` schema attribute already exists. Skip Step 3a. For Step 3b, you only need to change the value — replace the Banking App UUID with `AI_AGENT_CLIENT_ID`. The DemoDataPage **Delegation Mode** radio → **Enable may_act** handles this automatically.

---

### 3a. Add `mayAct` to User Schema

> **PingOne Console → Directory → User Schema → Add Attribute**

| Field | Value |
|-------|-------|
| **Attribute name** | `mayAct` |
| **Display name** | `May Act` |
| **Description** | `JSON object identifying the OAuth client authorized to exchange this user's Subject Token. Must match the client ID UUID of the authorized exchanger app.` |
| **Type** | `JSON` |
| **Required** | `No` |
| **Unique** | `No` |
| **Multivalued** | `No` |

Click **Save**.

---

### 3b. Set `mayAct` on the User Record

The value must be the **client ID UUID of Super Banking AI Agent App** (`AI_AGENT_CLIENT_ID`). PingOne compares this against `actorToken.aud[0]` during Exchange #1 — they must match exactly.

**Option A — PingOne Admin Console:**
1. **Directory → Users** → open the user
2. Find **Custom Attributes → mayAct**
3. Enter:
```json
{ "sub": "<AI_AGENT_CLIENT_ID>" }
```

**Option B — PingOne Management API:**
```bash
PATCH https://api.pingone.com/v1/environments/{envId}/users/{userId}
Authorization: Bearer <token with p1:update:user>
Content-Type: application/json

{ "mayAct": { "sub": "<AI_AGENT_CLIENT_ID>" } }
```

**Option C — Super Banking Demo App (recommended):**
Navigate to `/demo-data` → **Token Exchange — may_act demo** section → select **2-Exchange — AI Agent Client ID** radio button → click **Enable may_act**.

> **Common mistake:** Using a URL (e.g. `https://agent.example.com`) as `mayAct.sub` instead of the UUID. PingOne compares against `actorToken.aud[0]` which is the UUID — they will not match. Always use the client ID UUID.

---

### 3c. Verify `may_act` in a Subject Token

After logging in, decode the Subject Token at [PingIdentity JWT Decoder](https://developer.pingidentity.com/en/tools/jwt-decoder.html) and confirm:

```json
{
  "may_act": { "sub": "<AI_AGENT_CLIENT_ID>" }
}
```

`may_act.sub` must be the **UUID** of Super Banking AI Agent App — not a URL.

If `may_act` is absent:
- Confirm `mayAct` attribute was set on the user record (Step 3b)
- Confirm the `may_act` Attribute Mapping is on **Super Banking AI Agent Service** resource server (Step 1a)
- Confirm `banking:agent:invoke` scope is enabled and present in the authorize request

---

## Part 4 — Token Exchange #1 API Reference

**Performed by: Super Banking AI Agent App**

Step 1 — Get Actor Token (Client Credentials):
```
POST https://auth.pingone.com/{envId}/as/token
Content-Type: application/x-www-form-urlencoded

client_id=AI_AGENT_CLIENT_ID
&client_secret=AI_AGENT_CLIENT_SECRET
&grant_type=client_credentials
&audience=https://agent-gateway.pingdemo.com
```

Step 2 — Exchange Subject Token for Agent Exchanged Token:
```
POST https://auth.pingone.com/{envId}/as/token
Content-Type: application/x-www-form-urlencoded

client_id=AI_AGENT_CLIENT_ID
&client_secret=AI_AGENT_CLIENT_SECRET
&grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token=<Subject Token>
&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&actor_token=<Agent Actor Token>
&actor_token_type=urn:ietf:params:oauth:token-type:access_token
&requested_token_type=urn:ietf:params:oauth:token-type:access_token
&audience=https://mcp-server.pingdemo.com
&scope=banking:accounts:read banking:transactions:read banking:transactions:write
```

PingOne validates: `subject_token.may_act.sub == actor_token.aud[0]` — both must equal `AI_AGENT_CLIENT_ID`.

---

## Part 5 — Token Exchange #2 API Reference

**Performed by: Super Banking MCP Token Exchanger**

Step 1 — Get Actor Token (Client Credentials):
```
POST https://auth.pingone.com/{envId}/as/token
Content-Type: application/x-www-form-urlencoded

client_id=MCP_CLIENT_ID
&client_secret=MCP_CLIENT_SECRET
&grant_type=client_credentials
&audience=https://mcp-gateway.pingdemo.com
```

Step 2 — Exchange Agent Exchanged Token for MCP Exchanged Token:
```
POST https://auth.pingone.com/{envId}/as/token
Content-Type: application/x-www-form-urlencoded

client_id=MCP_CLIENT_ID
&client_secret=MCP_CLIENT_SECRET
&grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token=<Agent Exchanged Token>
&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&actor_token=<MCP Actor Token>
&actor_token_type=urn:ietf:params:oauth:token-type:access_token
&requested_token_type=urn:ietf:params:oauth:token-type:access_token
&audience=https://resource-server.pingdemo.com
&scope=banking:accounts:read banking:transactions:read banking:transactions:write
```

---

## Part 6 — Postman Testing

Two ready-to-import files are included in this repo. They cover the full 5-call chain (Steps 1–8) using headless PKCE (pi.flow) — no browser required. Token variables are written automatically between steps; the final User Lookup runs against the live PingOne Management API.

| File | Purpose |
|------|---------|
| [⬇ Download collection](https://raw.githubusercontent.com/curtismu7/banking-demo/fix/dashboard-fab-positioning/docs/BX%20Finance%20%E2%80%94%202-Exchange%20Delegated%20Chain%20%E2%80%94%20pi.flow.postman_collection.json) | Steps 1–8 + Utility A (introspect) + Utility B (set mayAct — AI Agent Client ID) |
| [⬇ Download environment](https://raw.githubusercontent.com/curtismu7/banking-demo/fix/dashboard-fab-positioning/docs/BX%20Finance%20%E2%80%94%202-Exchange%20Delegated%20Chain.postman_environment.json) | Environment file — fill in your credentials here |

> **pi.flow** means the authorize request returns JSON instead of redirecting to a browser. Postman completes the full PKCE login headlessly in Steps 1–4, then runs both exchanges (Steps 5a/5b and 6a/6b), the PingOne API CC call (Step 7), and the final user lookup (Step 8) — all without any browser interaction.

### Import

> **To download the files:** Right-click each link above → **Save Link As** → keep the `.json` extension. (Clicking opens the raw JSON in the browser — right-click is required to save.)

1. In Postman: **Import** → select **both** `.json` files.
2. The collection uses the **environment file** for all credentials. Select `Super Banking — 2-Exchange Delegated Chain` as the active environment before running.

### Fill in variables

Open the **Super Banking — 2-Exchange Delegated Chain** environment → click the eye icon → **Edit** and fill in:

| Variable | Where to find it |
|---|---|
| `env_id` | PingOne Console → Environment → Settings |
| `client_id` | Client ID of **Super Banking User App** |
| `client_secret` | Client Secret of **Super Banking User App** |
| `ai_agent_client_id` | Client ID of **Super Banking AI Agent App** (Step 2b) — also `AI_AGENT_CLIENT_ID` env var |
| `ai_agent_client_secret` | Client Secret of **Super Banking AI Agent App** |
| `mcp_client_id` | Client ID of **Super Banking MCP Token Exchanger** app — also `AGENT_OAUTH_CLIENT_ID` env var |
| `mcp_client_secret` | Client Secret of **Super Banking MCP Token Exchanger** app |
| `username` | Test user login |
| `password` | Test user password |

Pre-filled: `base_url` (`https://auth.pingone.com`), `redirect_uri`. Token variables (`subject_token`, `agent_exchanged_token`, `mcp_exchanged_token`, `pingone_api_token`, `user_sub`) are written automatically by test scripts — do not set them manually.

### One-time PingOne setup

Add `https://oauth.pstmn.io/v1/callback` as a **Redirect URI** on the **Super Banking User App** (Configuration tab). This allows Postman's OAuth2 helper to complete the PKCE flow. Remove it after testing if desired.

### ⚠️ Clear cookies before each full run

PingOne stores a session cookie in Postman after a successful login. On the next run, Step 1 returns `status: COMPLETED` immediately (skipping the login form), and the auth code it returns may be stale — `may_act` can be missing, or `aud` can be wrong.

**Always clear cookies before starting a fresh run:**

1. In Postman, click the 🍪 **Cookies** button (top-right of the request pane, next to Send)
2. Find `auth.pingone.com` → click the trash icon to delete all cookies for that domain
3. Then start from Step 1

| Symptom | Cause |
|---------|-------|
| Step 1 returns `status: COMPLETED` with no login prompt | Stale PingOne session cookie |
| Step 4 test `may_act.sub present` **FAILS** | Token from cached session issued before `may_act` was configured |
| Step 5b returns `invalid_grant` | Subject Token missing `may_act.sub = ai_agent_client_id` — set user's `mayAct` via Utility B, then re-run Steps 1–4 |
| Step 6b returns `invalid_grant` | Agent Exchanged Token missing `act` claim — check `act` expression on Super Banking MCP Server resource server (Step 1c) |

### Run in order

**Steps 1–4 — Subject Token (Authorization Code + PKCE via pi.flow)**
Run 1a → 1b → 1c → 1d in sequence. Step 1d exchanges the auth code for the Subject Token. The test script decodes it, saves `subject_token` and `user_sub`, and validates `aud = https://ai-agent.pingdemo.com` and `may_act.sub = ai_agent_client_id`.

> If the `may_act` test fails: run **Utility B — Set mayAct** to write `{ "sub": "<AI_AGENT_CLIENT_ID>" }` onto the user record (requires `user_sub` from a prior run), then clear cookies and re-run Steps 1–4.

**Step 5a — AI Agent Actor Token (Client Credentials)**
The AI Agent App gets a CC token scoped to `https://agent-gateway.pingdemo.com`. Saved as `agent_actor_token`.

**Step 5b — Exchange #1: Subject Token → Agent Exchanged Token**
The AI Agent App exchanges `subject_token` + `agent_actor_token`. PingOne validates `may_act.sub == actorToken.aud[0]`. The test script saves `agent_exchanged_token` and validates `aud = https://mcp-server.pingdemo.com` and `act.sub = ai_agent_client_id`.

**Step 6a — MCP Actor Token (Client Credentials)**
The MCP Service gets a CC token scoped to `https://mcp-gateway.pingdemo.com`. Saved as `mcp_actor_token`.

**Step 6b — Exchange #2: Agent Exchanged Token → MCP Exchanged Token**
The MCP Service exchanges `agent_exchanged_token` + `mcp_actor_token`. The test script saves `mcp_exchanged_token` and validates `aud = https://resource-server.pingdemo.com` and `act.sub = ai_agent_client_id`.

**Step 7 — PingOne API Token (Client Credentials)**
The MCP Service obtains a scoped token for the PingOne Management API. Saved as `pingone_api_token`.

**Step 8 — User Lookup (PingOne Management API)**
Calls `GET /v1/environments/{envId}/users/{user_sub}` using `pingone_api_token`. Validates response is 200 and checks `mayAct.sub` on the user record.

### Utility requests

| Request | When to use |
|---|---|
| **Utility A — Introspect Token** | Introspects any saved token against PingOne's introspection endpoint. Change the `token` body value to `subject_token`, `agent_exchanged_token`, `mcp_exchanged_token`, or `pingone_api_token`. |
| **Utility B — Set mayAct on User** | PATCHes `mayAct = { "sub": "{{ai_agent_client_id}}" }` onto the test user. Run if Step 4 warns that `may_act` is missing. Requires `user_sub` — run Steps 1–4 first to capture it. |

---

## Part 7 — Verification

Decode any token at [PingIdentity JWT Decoder](https://developer.pingidentity.com/en/tools/jwt-decoder.html) or in terminal:
```bash
echo "<token>" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null | python3 -m json.tool
```

**Subject Token** (Token 1):
```json
{
  "aud": ["https://ai-agent.pingdemo.com"],
  "sub": "<user-id>",
  "scope": "profile email banking:agent:invoke",
  "may_act": { "sub": "<AI_AGENT_CLIENT_ID>" }
}
```

**Agent Exchanged Token** (Token 2 — after Exchange #1):
```json
{
  "aud": ["https://mcp-server.pingdemo.com"],
  "sub": "<user-id>",
  "scope": "banking:accounts:read banking:transactions:read banking:transactions:write",
  "act": { "sub": "<AI_AGENT_CLIENT_ID>" }
}
```

**MCP Exchanged Token** (Token 3 — after Exchange #2):
```json
{
  "aud": ["https://resource-server.pingdemo.com"],
  "sub": "<user-id>",
  "scope": "banking:accounts:read banking:transactions:read banking:transactions:write",
  "act": {
    "sub": "<MCP_CLIENT_ID>",
    "act": {
      "sub": "<AI_AGENT_CLIENT_ID>"
    }
  }
}
```

`act.sub` = MCP Service (performed Exchange #2). `act.act.sub` = AI Agent (performed Exchange #1). PAZ enforces both.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Exchange #1: `invalid_grant` | `may_act.sub` on user ≠ AI Agent client ID | Set `mayAct = { "sub": "<AI_AGENT_CLIENT_ID>" }` on user (not Banking App UUID) |
| Exchange #1: `unauthorized_client` | Token Exchange grant not enabled on AI Agent App | Part 2b — enable Token Exchange grant |
| Exchange #2: `invalid_grant` | Agent Exchanged Token has no `act` claim | Check `act` expression on Super Banking MCP Server resource server (Step 1c) |
| Exchange #2: `unauthorized_client` | Token Exchange grant not enabled on MCP Service App | Part 2c — enable Token Exchange grant |
| Final token missing `act.act.sub` | `act` expression on Super Banking API is wrong | Check Step 1e expression — must nest incoming `act` as `act.act` |
| PAZ denies all requests | `act.sub` or `act.act.sub` not matching policy values | Check PAZ policy — values must be the client ID UUIDs, not URLs |


---

## Phase 186: ID Token + Agent CC Exchange

**Added:** 2026-04-18

### Overview

Phase 186 introduces a variant of the Phase 184 dual-token exchange that uses the user's **ID token** (instead of access token) as the subject token, combined with the agent's client-credentials token as the actor.

| Aspect | Phase 184 (Exchange 2) | Phase 186 (ID Token) |
|--------|----------------------|---------------------|
| **Subject token** | User access token | User ID token |
| **Subject type** | `urn:ietf:params:oauth:token-type:access_token` | `urn:ietf:params:oauth:token-type:id_token` |
| **Actor token** | Agent CC token | Agent CC token (same) |
| **Result** | MCP Gateway token with `act` claim | MCP Gateway token with `act` claim (same) |
| **Use case** | Capability-based delegation | Identity-based delegation |
| **ID token lifetime** | N/A | Short (15-30 min) |

### When to Use Phase 186 Pattern

- **Identity assertion matters more than capability grants** — MCP Gateway needs to verify the user's identity directly from the `sub` claim
- **Minimal token exposure** — agent never touches user's access token; only the ID token (non-capability-granting) is passed
- **Educational value** — demonstrates that RFC 8693 accepts different `subject_token_type` values

### Token Exchange Request

```
POST /as/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token=<user_id_token_jwt>
&subject_token_type=urn:ietf:params:oauth:token-type:id_token
&actor_token=<agent_cc_token_jwt>
&actor_token_type=urn:ietf:params:oauth:token-type:access_token
&requested_token_type=urn:ietf:params:oauth:token-type:access_token
&audience=https://mcp-gateway.pingdemo.com
&scope=banking:read banking:write banking:mcp:invoke
&client_id=<bff_client_id>
```

### Backend Code

```javascript
// oauthService.performTokenExchangeWithActorIdToken(idToken, actorToken, audience, scopes)
const mcpToken = await oauthService.performTokenExchangeWithActorIdToken(
  session.oauthTokens.idToken,   // subject: user identity
  agentCCToken,                   // actor: agent delegation
  'https://mcp-gateway.pingdemo.com',
  ['banking:read', 'banking:write', 'banking:mcp:invoke']
);
// Result: MCP token with { sub: <user>, act: { sub: <agent> }, aud: <mcp-gateway> }
```

### Feature Flag

Phase 186 is gated by `ff_id_token_exchange` (same flag as the simple ID token exchange). Enable in Feature Flags before testing.

### Test Page

Navigate to PingOne Test Page → Token Exchange Tests → **"User ID Token + Agent CC → MCP Gateway Token (Phase 186)"**

Route: `GET /api/pingone-test/exchange-idtoken-agent-to-mcp`

### Security Considerations

1. **ID token lifetime is short** (15-30 min) — each exchange requires a relatively fresh token
2. **ID tokens stored server-side only** — httpOnly session cookie; never exposed to frontend JavaScript
3. **PingOne validates ID token signature** during exchange — forged tokens rejected
4. **Scopes in OIDC request should be minimal** — `openid profile email` (just enough for identity)

### Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `ff_id_token_exchange is OFF` | Feature flag disabled | Enable `ff_id_token_exchange` in Feature Flags page |
| `No ID token found in session` | User not logged in via OIDC | Log in first (Authorization Code + PKCE flow) |
| `invalid_grant` on exchange | ID token expired or invalid audience | Re-authenticate to get fresh ID token |
| Exchange succeeds but no `act` claim | PingOne `act` expression not configured on resource server | Check MCP Gateway resource server `act` expression (same as Phase 184) |


---

*See also: [PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md](PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md)*
