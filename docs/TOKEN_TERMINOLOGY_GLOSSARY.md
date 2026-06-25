# RFC 8693 Token Exchange Terminology Glossary

> **Purpose:** Map RFC 8693 normative terms to common alternate names used in the Super Banking AI Banking Demo. All code, documentation, and education panels use these RFC terms as primary vocabulary.

---

## Token Roles

### Subject Token (RFC 8693 §2.1)

**Definition:** The security token that represents the identity of the party on behalf of whom the request is being made. In delegation scenarios, this is the user whose authority is being delegated.

| Context | Term Used |
|---------|-----------|
| **RFC 8693 (primary)** | `subject_token` |
| **Common alternates** | User Token, Bearer Token, Authorization Subject, User Access Token |
| **Code variable** | `subjectToken` (method parameter) |
| **HTTP request field** | `subject_token` (in token exchange POST body) |
| **Token type URI** | `urn:ietf:params:oauth:token-type:access_token` or `urn:ietf:params:oauth:token-type:id_token` |
| **Result JWT claim** | `sub` (subject claim) — user's unique identifier |

**In this demo:** The user logs in via PingOne (Authorization Code + PKCE). The resulting access token is the `subject_token` in RFC 8693 exchanges. It represents the banking customer whose accounts the agent will access.

---

### Actor Token (RFC 8693 §2.2)

**Definition:** The security token that represents the identity of the acting party. In delegation scenarios, this is the entity (typically an AI agent or service) that will perform actions on behalf of the subject.

| Context | Term Used |
|---------|-----------|
| **RFC 8693 (primary)** | `actor_token` |
| **Common alternates** | Agent Token, Service Account Token, Client Credentials Token, Client Assertion, Delegation Token |
| **Code variable** | `actorToken` (method parameter) |
| **HTTP request field** | `actor_token` (in token exchange POST body) |
| **Token type URI** | `urn:ietf:params:oauth:token-type:access_token` |
| **Result JWT claim** | `act` (actor claim) — agent's unique identifier |

**In this demo:** The AI agent obtains a client credentials token from PingOne. This token is the `actor_token` in dual-exchange (2-exchange) flows. It identifies which agent is acting on the user's behalf.

---

### MCP-Scoped Access Token (RFC 8693 §3.2)

**Definition:** The output of a successful token exchange — a new access token scoped to the target resource (audience) with delegated authority from both subject and actor.

| Context | Term Used |
|---------|-----------|
| **RFC 8693 (primary)** | Result `access_token` (with `sub` + `act` claims) |
| **Demo term** | MCP-Scoped Access Token |
| **Common alternates** | MCP Token, Delegated Token, Exchanged Token, Transaction Token |
| **Code variable** | `mcpScopedAccessToken` |
| **HTTP response field** | `access_token` (in token exchange response) |
| **Key claims** | `sub` (user), `act` (agent), `aud` (MCP audience), `scope` (permissions), `exp` (expiry) |

**In this demo:** After exchange, this token is sent to the MCP server in `Authorization: Bearer <token>` headers. The MCP server validates `aud`, checks `scope` for required permissions, and uses `sub`/`act` for audit logging.

---

## JWT Claims

### Subject Claim — `sub` (RFC 7519 §4.1.2)

| Context | Term Used |
|---------|-----------|
| **RFC 7519 (primary)** | `sub` |
| **Common alternates** | User ID, Subject ID, Principal, User Identifier |
| **In subject_token** | Identifies the user |
| **In MCP-scoped token** | Identifies the user on whose behalf the agent acts |

---

### Actor Claim — `act` (RFC 8693 §4.1)

| Context | Term Used |
|---------|-----------|
| **RFC 8693 (primary)** | `act` |
| **Common alternates** | Agent ID, Service ID, Actor ID, Delegate |
| **Presence** | Required in dual-exchange (2-exchange) flows; absent in single-exchange (1-exchange) |
| **Structure** | `{ "sub": "<agent-client-id>" }` — nested object per RFC 8693 §4.1 |

---

### Audience Claim — `aud` (RFC 7519 §4.1.3, RFC 8693 §2.3)

| Context | Term Used |
|---------|-----------|
| **RFC 7519 / 8693 (primary)** | `aud` |
| **Common alternates** | Resource URI, Target API, Audience URI |
| **In exchange request** | Specifies the target resource the token will access |
| **In result token** | Must match the requested audience |
| **Demo values** | `https://mcp-server.pingdemo.com`, `https://ai-agent.pingdemo.com` |

---

### May-Act Claim — `may_act` (RFC 8693 §4.2)

| Context | Term Used |
|---------|-----------|
| **RFC 8693 (primary)** | `may_act` |
| **Common alternates** | Delegation Permission, Allowed Actors, Authorization Grant |
| **Presence** | Optional — indicates which actors are permitted to act on behalf of the subject |
| **Structure** | `{ "sub": "<allowed-actor-id>" }` |

---

## Exchange Patterns

### Single Exchange (1-Exchange)
- **Input:** Subject Token (user's access token)
- **Output:** MCP-Scoped Access Token (with `sub` but no `act`)
- **RFC 8693 fields:** `subject_token`, `audience`, `scope`
- **Use case:** User directly authorizes MCP access without agent delegation

### Dual Exchange (2-Exchange)
- **Input:** Subject Token (user) + Actor Token (agent)
- **Output:** MCP-Scoped Access Token (with `sub` + `act`)
- **RFC 8693 fields:** `subject_token`, `actor_token`, `audience`, `scope`
- **Use case:** Agent acts on behalf of user; both identities represented in result

### ID Token Exchange (Phase 186 variant)
- **Input:** User's ID Token (as subject) + Actor Token (agent CC)
- **Token type:** `urn:ietf:params:oauth:token-type:id_token`
- **Output:** MCP-Scoped Access Token
- **Use case:** After 401, app authenticates user, uses ID token in exchange

---

## Scope Terms

| Scope | Purpose |
|-------|---------|
| `banking:read` | Read account balances, transaction history |
| `banking:write` | Initiate transfers, update account settings |
| `banking:admin` | Administrative operations |
| `banking:sensitive` | Access sensitive PII |
| `banking:ai:agent` | AI agent operations |
| `banking:mcp:invoke` | MCP tool invocation |

---

## Environment Variable Mapping

| Current Name | RFC-Aligned Name | Purpose |
|-------------|-----------------|---------|
| `PINGONE_USER_CLIENT_ID` | `PINGONE_SUBJECT_CLIENT_ID` | Subject (user) OAuth client |
| `PINGONE_AI_AGENT_CLIENT_ID` | `PINGONE_ACTOR_CLIENT_ID` | Actor (agent) OAuth client |
| `AI_AGENT_AUDIENCE` | `ACTOR_TOKEN_AUDIENCE` | Audience for actor token |
| `ENDUSER_AUDIENCE` | `SUBJECT_TOKEN_AUDIENCE` | Audience for subject token |
| `AGENT_GATEWAY_AUDIENCE` | `ACTOR_GATEWAY_AUDIENCE` | Agent gateway audience |

> **Migration note:** Old names remain as backward-compatible aliases. New RFC-aligned names take precedence when both exist.

---

*Last updated: 2026-04-18 | Phase 188: Token Exchange Taxonomy*
