# Super Banking — Secure AI Agent: PingGateway + Consent Implementation Plan

_Source: "Securing AI Agents with PingOne using Delegation and Least Privilege"_
_Last updated: 2026-03-27_

---

## Decision: Extend the existing app, not a new one

**Short answer: extend Super Banking.**

The PDF describes the same banking chatbot use case — a digital assistant acting on behalf
of a customer to read balances and make transfers. Super Banking already implements the core
pattern: Authorization Code + PKCE → user token with `may_act` → RFC 8693 token exchange
→ MCP token with `act` claim → MCP server.

The PDF adds **two layers Super Banking is missing**:

1. **User consent** — a PingOne consent agreement that gates agent delegation, enforced
   in the BFF before token exchange and surfaced in the agent panel UI
2. **PingGateway** — a security enforcement proxy in front of the MCP server that
   validates the MCP token, audits every tool call, and blocks unvalidated requests

Everything else — React UI, Express BFF, MCP server, Token Chain Display — stays.
A new app would throw away working infrastructure. These are targeted additions.

---

## Current state vs PDF pattern

### Token chain comparison

```
PDF pattern:
  User → Banking Web App (OIDC/PKCE + Consent Agreement) → User Token (acr, may_act)
  Agent → PingOne Client Credentials → Actor Token
  Agent → Token Exchange (subject=User Token, actor=Agent Token) → MCP Token (act+sub)
  Agent → PingGateway /mcp (Bearer: MCP Token) → MCP Server

Super Banking today:
  User → Banking Web App (OIDC/PKCE, NO consent step)  ⚠️ no acr, may_act unverified
  BFF  → PingOne Client Credentials → Actor Token        ⚠️ disabled (USE_AGENT_ACTOR_FOR_MCP=false)
  BFF  → Token Exchange → MCP Token                     ⚠️ proceeds even without may_act
  BFF  → ws://localhost:8080 (no gateway, no audit)      ❌ no PingGateway
```

### Gap analysis

| PDF Requirement | Super Banking Today | Gap |
|---|---|---|
| OIDC Web App with PKCE | ✅ `user_client_id` | None |
| Consent Agreement ("Agent Consent") | ❌ Not present | New PingOne config + app enforcement |
| Auth Policy with Agreement Prompt | ❌ Not present | New PingOne config |
| `acr` stored in session after login | `acr` extracted in middleware but never stored | Store on callback |
| `acr` returned to frontend | Not in any status endpoint | Add to user status response |
| `may_act` gates token exchange | Checked but exchange proceeds regardless | Hard-block if absent |
| `acr` gates token exchange | Not checked | Block if acr ≠ expected policy |
| UI consent status + re-consent button | No consent gate in agent panel | Add amber banner + "Grant permission" button |
| `acr` pill in Token Chain Display | Hidden inside full JWT dump | Surface as named pill |
| `agent` resource with `may_act` expression | `may_act` works but expression not to PDF spec | PingOne config update |
| `test` resource (aud = PingGateway URL) | Uses `MCP_RESOURCE_URI`, may not match gateway | Config update |
| AI Agent as first-class PingOne identity | Uses generic OAuth client | Already using PingOne AI Agents ✅ |
| Actor token via Client Credentials | Code exists, disabled by default | Enable + point to AI Agent |
| Token exchange with subject + actor token | Code exists, env flag off | Enable by default |
| MCP Token audience = PingGateway URL | `MCP_RESOURCE_URI`, needs to match gateway | Set to `https://ig.example.com:8443/mcp` |
| PingGateway protecting MCP server | BFF talks directly via WebSocket | New: PingGateway in front |
| McpProtectionFilter + McpAuditFilter | ❌ | New PingGateway route config |
| Token introspection via PingOne | ❌ | PingGateway handles this |
| MCP audit log | ❌ | Free with PingGateway |
| Token Chain Display shows full chain | ✅ shows actor + exchange + MCP | Add consent pill + PingGateway hop |

---

## What the consent pattern requires

When a user first uses the AI agent, PingOne must show them a consent agreement:

> _"I consent to allow Super Banking AI agents to act on my behalf"_

After they accept:
- User token carries `acr: "Agent-Consent-Login"` — proof consent occurred this session
- User token carries `may_act: { sub: <AI Agent client_id> }` — grants agent delegation rights
- Token exchange succeeds; MCP token carries `act` proving the full delegation chain

If they have **not consented**, the token exchange must be blocked before PingOne is
called — the app tells the user clearly and offers a one-click path to consent.

---

## What changes, where

### A. PingOne configuration (no code — do first)

All of these are admin console steps. Complete them before any code or env var changes.

---

**A1. Register the AI Agent** _(Applications > AI Agents — already done ✅)_

Super Banking already uses PingOne AI Agents. Confirm the registered agent has:

| Field | Required value |
|---|---|
| Grant Types | Client Credentials, Refresh Token, **Token Exchange** |
| Redirect URI | `http://localhost:3000/callback` (local) / your Vercel callback URL |
| Resources | `agent` scope + `test` scope (see A2) |
| Policy | `Agent-Consent-Login` (see A4) |

Copy Client ID → `AGENT_OAUTH_CLIENT_ID`, Client Secret → `AGENT_OAUTH_CLIENT_SECRET`.

---

**A2. Configure custom resources**

**`agent` resource** — issues user tokens with `may_act`:

| Field | Value |
|---|---|
| Name | `agent` |
| Audience | `agent` (default) |
| `sub` attribute | Username (PingOne Mappings) |
| `may_act` attribute expression | `(#root.context.requestData.grantType == "client_credentials")?null:({ "sub": #root.context.appConfig.clientId })` |
| Scope | `agent` |

_The `may_act` expression asserts the agent (client_id) may act for the user during
Authorization Code flow only — not when the agent is doing Client Credentials itself._

**`test` resource** — issues MCP tokens scoped to PingGateway:

| Field | Value |
|---|---|
| Name | `test` |
| Audience | `https://ig.example.com:8443/mcp` |
| `sub` attribute expression | `#root.context.requestData.subjectToken.sub` |
| `act` attribute expression | `(#root.context.requestData.subjectToken.may_act.sub == #root.context.requestData.actorToken.client_id)?#root.context.requestData.subjectToken.may_act:null` |
| Scope | `test` |

Copy the Resource ID and Client Secret — needed for PingGateway (section C).

---

**A3. Create the "Agent Consent" agreement**

PingOne admin console → **User Experience > Agreements** → **+**

| Field | Value |
|---|---|
| Name | `Agent Consent` |
| Description | `Consent for a digital assistant agent` |
| Reconsent Every | `180 days` |

Add English language:
- Language: `English (en)`
- Agreement text: `I consent to allow Super Banking AI agents to act on my behalf`

**Enable the agreement** (toggle on the Agreements page after saving).

---

**A4. Create the "Agent-Consent-Login" authentication policy**

PingOne admin console → **Authentication > Policies** → **+ Add Policy**

| Field | Value |
|---|---|
| Policy name | `Agent-Consent-Login` |
| Step 1 | **Login** |
| Step 2 | **Agreement Prompt** → select `Agent Consent` |

---

**A5. Attach policy and `agent` scope to the user OIDC Web App**

PingOne admin console → **Applications > Applications** → open user OIDC Web App:

- **Policies tab** → **+ Add Policies** → select `Agent-Consent-Login` → Save
- **Resources tab** → add `agent` scope

> Attaching the policy at the web app level means consent is prompted on every login.
> For the demo this is the simplest approach.
>
> Without the `agent` scope on the web app, the user token will have no `may_act`
> claim and token exchange cannot produce an `act` claim on the MCP token.

---

**A6. Verify `acr` and `may_act` are in the user token**

After completing A1–A5, log in and open the Token Chain Display.
The User Token row should show:

```json
"acr": "Agent-Consent-Login",
"may_act": { "sub": "<AI Agent client_id>" }
```

If `may_act` is absent → the `agent` resource `may_act` expression is not configured (A2).
If `acr` is absent → the policy is not attached to the web app (A5).

---

### B. BFF environment variables

_No code changes. Update `.env` / Vercel dashboard._

```bash
# Enable two-token (actor + subject) exchange — was disabled by default
USE_AGENT_ACTOR_FOR_MCP=true

# AI Agent client registered in PingOne (Applications > AI Agents)
AGENT_OAUTH_CLIENT_ID=<client id from A1>
AGENT_OAUTH_CLIENT_SECRET=<client secret from A1>
AGENT_OAUTH_CLIENT_SCOPES=agent

# Consent — must match the PingOne policy name exactly
AGENT_CONSENT_ACR=Agent-Consent-Login

# MCP audience = PingGateway URL (was MCP server URL directly)
MCP_RESOURCE_URI=https://ig.example.com:8443/mcp

# MCP requests go through PingGateway (not directly to MCP server)
MCP_SERVER_URL=https://ig.example.com:8443/mcp
```

---

### C. PingGateway configuration (new infrastructure)

PingGateway runs on a persistent host — not Vercel. See `docs/session-login-plan.md`
§ P3 for why persistent processes are required for this component.

**C1. admin.json — enable SSE streaming**

```json
{
  "adminConnector": { "host": "localhost", "port": 8085 },
  "connectors": [
    { "port": 8080 },
    { "port": 8443, "tls": "ServerTlsOptions-1" }
  ],
  "streamingEnabled": true,
  "heap": [ "... TLS config ..." ]
}
```

`streamingEnabled: true` is required for MCP's Server-Sent Events (SSE) transport.
PingGateway will drop MCP traffic if this is missing.

**C2. Set the resource secret environment variable**

```bash
export RESOURCE_SECRET_ID=$(echo -n "<test resource client secret from A2>" | base64)
# Critical: no trailing newline — add --no-newline to the echo or use printf
printf '%s' "<secret>" | base64
```

**C3. mcp.json route**

File location:
- Linux: `$HOME/.openig/config/routes/mcp.json`
- Windows: `%appdata%\OpenIG\config\routes\mcp.json`

Fill in your PingOne Environment ID and test resource ID from A2:

```json
{
  "name": "mcp",
  "condition": "${find(request.uri.path, '^/mcp')}",
  "properties": {
    "pingOneEnvID": "https://auth.pingone.com/<PingOne Environment ID>",
    "pingOneResourceID": "<PingOne test resource ID>",
    "gatewayUrl": "https://ig.example.com:8443",
    "mcpServerUrl": "http://localhost:8000"
  },
  "baseURI": "&{mcpServerUrl}",
  "heap": [
    { "name": "SystemAndEnvSecretStore-1", "type": "SystemAndEnvSecretStore" },
    {
      "name": "AuditService",
      "type": "AuditService",
      "config": {
        "eventHandlers": [{
          "class": "org.forgerock.audit.handlers.json.JsonAuditEventHandler",
          "config": {
            "name": "json",
            "logDirectory": "&{ig.instance.dir}/audit",
            "topics": ["access", "mcp"]
          }
        }]
      }
    },
    {
      "name": "rsFilter",
      "type": "OAuth2ResourceServerFilter",
      "config": {
        "requireHttps": false,
        "scopes": ["test"],
        "accessTokenResolver": {
          "type": "TokenIntrospectionAccessTokenResolver",
          "config": {
            "endpoint": "&{pingOneEnvID}/as/introspect",
            "providerHandler": {
              "type": "Chain",
              "config": {
                "filters": [{
                  "type": "HttpBasicAuthenticationClientFilter",
                  "config": {
                    "username": "&{pingOneResourceID}",
                    "passwordSecretId": "resource.secret.id",
                    "secretsProvider": "SystemAndEnvSecretStore-1"
                  }
                }],
                "handler": "ForgeRockClientHandler"
              }
            }
          }
        }
      }
    }
  ],
  "handler": {
    "type": "Chain",
    "config": {
      "filters": [
        { "type": "McpAuditFilter", "config": { "auditService": "AuditService" } },
        { "type": "UriPathRewriteFilter", "config": { "mappings": { "/mcp": "/" } } },
        {
          "type": "McpProtectionFilter",
          "config": {
            "resourceId": "&{gatewayUrl}/mcp",
            "authorizationServerUri": "&{pingOneEnvID}/as",
            "resourceServerFilter": "rsFilter",
            "supportedScopes": ["test"],
            "resourceIdPointer": "/aud/0"
          }
        },
        { "type": "McpValidationFilter", "config": { "acceptedOrigins": ".*" } }
      ],
      "handler": {
        "type": "ReverseProxyHandler",
        "config": { "soTimeout": "20 seconds" }
      }
    }
  }
}
```

**Filter pipeline:**

| Filter | Purpose |
|---|---|
| `McpAuditFilter` | Writes every tool call to `audit/mcp.audit.json` |
| `UriPathRewriteFilter` | Strips `/mcp` prefix — MCP server expects requests at `/` |
| `McpProtectionFilter` | Validates token is on-behalf-of with correct `act`/`sub` claims |
| `McpValidationFilter` | Validates MCP JSON-RPC envelope structure |
| `ReverseProxyHandler` | Proxies validated request to `http://localhost:8000` |

---

### D. Consent enforcement — BFF code changes

Five files. All changes are additive.

---

**D1. Store `acr` and `may_act` in session on OAuth callback**

File: `banking_api_server/routes/oauthUser.js`

In the session storage block (where `req.session.oauthTokens` and `req.session.user`
are set), add:

```js
req.session.consentAcr = idTokenClaims?.acr || null;
// e.g. "Agent-Consent-Login" when user accepted the agreement

req.session.mayAct = accessTokenClaims?.may_act || null;
// e.g. { "sub": "<AI Agent client_id>" }
```

`consentAcr` (not `acr`) avoids collisions with other session fields.

---

**D2. Return consent status from the user status endpoint**

File: `banking_api_server/routes/auth.js` (wherever `/api/auth/oauth/user/status` lives)

```js
const expectedAcr  = process.env.AGENT_CONSENT_ACR || 'Agent-Consent-Login';
const consentAcr   = req.session.consentAcr || null;
const consentGiven = consentAcr === expectedAcr;

res.json({
  authenticated: true,
  user: req.session.user,
  tokenType: ...,
  expiresAt: ...,
  // New:
  consentGiven,
  consentAcr,
  mayAct: req.session.mayAct || null,
});
```

Also add `GET /api/auth/consent-url` — builds the re-auth URL for the consent flow:

```js
router.get('/consent-url', (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     userOAuthConfig.clientId,
    redirect_uri:  userOAuthConfig.redirectUri,
    scope:         userOAuthConfig.scopes.join(' '),
    acr_values:    process.env.AGENT_CONSENT_ACR || 'Agent-Consent-Login',
    prompt:        'consent',   // force consent screen even if PingOne session exists
    state:         generateState(),
    nonce:         generateNonce(),
  });
  res.json({ url: `${pingOneAuthorizeEndpoint}?${params}` });
});
```

---

**D3. Hard-block token exchange when consent is missing**

File: `banking_api_server/services/agentMcpTokenService.js`

Currently `describeMayAct()` flags a missing `may_act` but the exchange proceeds
anyway. Replace with an early throw:

```js
// Before calling PingOne:
const expectedAcr    = process.env.AGENT_CONSENT_ACR || 'Agent-Consent-Login';
const consentAcr     = sessionData.consentAcr;
const mayAct         = t1Claims.may_act;
const consentGiven   = consentAcr === expectedAcr;
const delegationReady = !!mayAct;

if (!consentGiven && !delegationReady) {
  throw Object.assign(
    new Error('Agent consent required. The user must accept the agent consent agreement before the AI agent can act on their behalf.'),
    { code: 'AGENT_CONSENT_REQUIRED', consentAcr, expectedAcr, mayActPresent: false }
  );
}

if (!delegationReady) {
  // Consent ACR present but PingOne didn't add may_act — likely missing resource config (A2)
  console.warn('[agentMcpTokenService] may_act absent despite consent ACR. Check agent resource expression in PingOne.');
}
```

In the Express route that calls this service, catch and return a structured response:

```js
if (err.code === 'AGENT_CONSENT_REQUIRED') {
  return res.status(403).json({
    error: 'agent_consent_required',
    message: err.message,
    consentUrl: buildConsentUrl(req),
  });
}
```

Also handle PingOne rejecting the exchange when `may_act` is absent:

```js
if (error.response?.data?.error === 'access_denied') {
  throw new Error('Agent consent required. Ask the user to re-authenticate and accept the agent consent agreement.');
}
```

---

**D4. Add `acr` and `consentGiven` to the User Token chain event**

File: `banking_api_server/services/agentMcpTokenService.js`

In the `id: 'user-token'` event object:

```js
{
  id: 'user-token',
  label: 'User Token',
  status: 'active',
  claims: { ...sanitizedClaims },
  // Existing:
  mayActPresent: !!t1Claims.may_act,
  mayActValid: ...,
  mayActDetails: ...,
  // New:
  acr: t1Claims.acr || null,
  consentGiven: (t1Claims.acr === (process.env.AGENT_CONSENT_ACR || 'Agent-Consent-Login')),
  consentAcrExpected: process.env.AGENT_CONSENT_ACR || 'Agent-Consent-Login',
}
```

---

### E. Consent gate — UI changes

---

**E1. BankingAgent panel — consent status and re-auth**

File: `banking_api_ui/src/components/BankingAgent.js`

On panel open, fetch `consentGiven` from the user status endpoint:

```js
// In the useEffect that loads agent context:
const status = await api.get('/api/auth/oauth/user/status');
setConsentGiven(status.data.consentGiven ?? true); // default true — graceful degradation
```

Add an amber consent-required banner (separate from the existing red `consentBlocked`
banner which handles high-value transaction challenges):

```jsx
{!consentGiven && (
  <div className="ba-consent-required">
    <p>
      <strong>🔒 Agent permission required</strong><br />
      Super Banking AI needs your permission to act on your behalf.
      This is a one-time consent (valid 180 days).
    </p>
    <button className="ba-consent-btn" onClick={handleGrantConsent}>
      Grant agent permission
    </button>
  </div>
)}
```

Disable the 8 action buttons when consent is missing:

```jsx
disabled={consentBlocked || !consentGiven}
```

Re-auth handler:

```js
const handleGrantConsent = async () => {
  const { data } = await api.get('/api/auth/consent-url');
  window.location.href = data.url;
};
```

File: `banking_api_ui/src/components/BankingAgent.css`

Add `.ba-consent-required` — amber/yellow background, positioned at top of `.ba-right-col`.

---

**E2. Token Chain Display — `acr` pill**

File: `banking_api_ui/src/components/TokenChainDisplay.js`

After the existing `may_act` pills, add:

```jsx
{event.acr && (
  <div className={`tcd-pill ${event.consentGiven ? 'tcd-pill--consent' : 'tcd-pill--warn'}`}>
    {event.consentGiven
      ? `acr ✅ "${event.acr}" — agent consent recorded`
      : `acr ⚠️ "${event.acr}" — expected "${event.consentAcrExpected}"`}
  </div>
)}
{!event.acr && event.id === 'user-token' && (
  <div className="tcd-pill tcd-pill--warn">
    acr absent — user has not completed the consent agreement
  </div>
)}
```

Update the "MCP Token → MCP Server" label to "MCP Token → PingGateway → MCP Server"
when `MCP_SERVER_URL` contains the gateway host.

Update the legend:

```jsx
{ color: 'green', label: 'Agent consent given (acr matches policy)' },
{ color: 'amber', label: 'Agent consent missing or policy mismatch'  },
```

File: `banking_api_ui/src/components/TokenChainDisplay.css` — add `.tcd-pill--consent` (green).

---

### F. MCP server — accept Bearer header from PingGateway

File: `banking_mcp_server/src/server/MCPMessageHandler.ts`

```typescript
// Accept token from Authorization header (PingGateway path)
// OR from agentToken in WS initialize handshake (direct/local path)
const agentToken =
  request.headers['authorization']?.replace('Bearer ', '') ||
  params.agentToken;
```

PingGateway has already validated the token via introspection before forwarding.
Skip re-introspection when the request arrives via the gateway path (detectable via
a `X-ForgeRock-TransactionId` header that PingGateway adds automatically).

---

### G. BFF — switch MCP transport from WebSocket to HTTPS+SSE

File: `banking_api_server/services/mcpWebSocketClient.js`

```js
const mcpUrl   = getMcpServerUrl();
const transport = mcpUrl.startsWith('https://') || mcpUrl.startsWith('http://')
  ? 'sse'   // PingGateway path — HTTP POST + SSE streaming
  : 'ws';   // Direct path — WebSocket (local dev without PingGateway)
```

For SSE transport, pass the MCP token as an `Authorization: Bearer` header rather
than in the WebSocket `initialize` handshake params. The existing WebSocket path is
unchanged, so local development without PingGateway continues to work.

---

## Complete end-to-end flow

```
1. User clicks "Customer sign in" on Landing Page
   └─► PingOne: Login step
   └─► PingOne: "Agent Consent" Agreement Prompt
         "I consent to allow Super Banking AI agents to act on my behalf"
   └─► User accepts ✅
   └─► User token issued:
         acr:     "Agent-Consent-Login"
         may_act: { sub: "<AI Agent client_id>" }

2. BFF OAuth callback (oauthUser.js)
   └─► req.session.consentAcr = "Agent-Consent-Login"
   └─► req.session.mayAct     = { sub: "<AI Agent client_id>" }

3. User opens Banking Agent panel
   └─► BankingAgent fetches /api/auth/oauth/user/status
         { consentGiven: true, mayAct: {...} }
   └─► All 8 action buttons ENABLED

4. User clicks "My Accounts"
   └─► BFF agentMcpTokenService pre-flight:
         consentGiven ✅  mayAct ✅  → proceed
   └─► Actor token via Client Credentials (AI Agent)
   └─► Token Exchange (RFC 8693):
         subject_token: User Token (has may_act)
         actor_token:   Actor Token
         audience:      https://ig.example.com:8443/mcp
         scope:         banking:accounts:read
   └─► PingOne validates may_act.sub == actor_token.client_id ✅
   └─► MCP Token issued:
         sub:  demouser
         act:  { sub: "<AI Agent client_id>" }
         aud:  https://ig.example.com:8443/mcp
         scope: banking:accounts:read

5. BFF → HTTPS POST to PingGateway /mcp
   Authorization: Bearer <MCP Token>
   └─► McpAuditFilter: writes to audit/mcp.audit.json
   └─► McpProtectionFilter: introspects token → PingOne /as/introspect ✅
   └─► McpValidationFilter: validates JSON-RPC envelope ✅
   └─► UriPathRewriteFilter: /mcp → /
   └─► ReverseProxyHandler → MCP Server

6. MCP Server executes tool, returns account list via SSE

7. Token Chain Display shows:
     User Token row:
       may_act ✅ present — sub: <AI Agent client_id>
       acr ✅ "Agent-Consent-Login" — agent consent recorded
     Actor Token row: Client Credentials ✅
     Exchange row: RFC 8693 on-behalf-of ✅
     MCP Token row:
       act ✅ — delegation chain preserved
       aud narrowed to PingGateway URL ✅
     [NEW] PingGateway hop: Gateway Validated ✅

No consent → blocked:
   └─► User token missing acr / may_act
   └─► BankingAgent: amber banner "🔒 Agent permission required"
   └─► All 8 action buttons disabled
   └─► User clicks "Grant agent permission"
   └─► Redirected to PingOne (acr_values=Agent-Consent-Login, prompt=consent)
   └─► Consent accepted → callback → panel reopens with consentGiven: true
```

---

## Token chain — claims at each hop

```
1. User Token  (Authorization Code + PKCE + Consent)
   aud:      agent
   acr:      Agent-Consent-Login          ← consent proof
   may_act:  { sub: <AI Agent client_id> } ← delegation grant
   scope:    agent banking:accounts:read ...

2. Actor Token  (Client Credentials — AI Agent)
   aud:       agent
   client_id: <AI Agent client_id>
   scope:     agent

3. Token Exchange  (RFC 8693 on-behalf-of)
   subject_token: User Token
   actor_token:   Actor Token
   audience:      https://ig.example.com:8443/mcp
   scope:         test  (or per-tool scope)

4. MCP Token  (exchanged, on-behalf-of)
   aud:  https://ig.example.com:8443/mcp  ← scoped to PingGateway
   sub:  demouser                          ← user identity preserved
   act:  { sub: <AI Agent client_id> }     ← delegation chain
   scope: test

5. PingGateway validates:
   introspect → PingOne ✅  scope=test ✅  act claim ✅
   writes audit/mcp.audit.json
   forwards to MCP server

6. MCP Server receives validated tool call
```

---

## Deployment architecture

```
┌──────────────────────────────────────────────┐
│  Vercel (existing)                            │
│  ┌──────────┐    ┌──────────────────────┐    │
│  │ React SPA│───►│ Express BFF          │    │
│  │ (UI)     │    │ banking_api_server   │    │
│  └──────────┘    └──────────┬───────────┘    │
└─────────────────────────────┼────────────────┘
                              │ HTTPS  Authorization: Bearer <MCP Token>
                              ▼
┌──────────────────────────────────────────────┐
│  PingGateway host  (NEW — persistent process) │
│  ig.example.com:8443                          │
│  ┌────────────────────────────────────────┐  │
│  │  mcp.json route                        │  │
│  │  McpAuditFilter                        │  │
│  │  McpProtectionFilter ──────────────────┼──┼──► PingOne /as/introspect
│  │  McpValidationFilter                   │  │
│  │  ReverseProxyHandler                   │  │
│  └──────────────────┬─────────────────────┘  │
└─────────────────────┼────────────────────────┘
                      │ HTTP  (internal network)
                      ▼
┌──────────────────────────────────────────────┐
│  MCP Server (existing — Railway / Render)     │
│  banking_mcp_server  http://localhost:8000    │
└──────────────────────────────────────────────┘
```

---

## Implementation checklist

```
─── PingOne (admin console — no code, do first) ────────────────────────────────

[ ] A1. Confirm AI Agent registration has: Token Exchange grant type,
        correct redirect URI, agent + test scopes, Agent-Consent-Login policy
        Copy Client ID → AGENT_OAUTH_CLIENT_ID
        Copy Client Secret → AGENT_OAUTH_CLIENT_SECRET

[ ] A2. Create/update "agent" resource
        may_act expression = (grantType=="client_credentials")
                             ?null:{ "sub": #root.context.appConfig.clientId }

[ ] A2. Create/update "test" resource
        Audience = https://ig.example.com:8443/mcp
        sub expression  = #root.context.requestData.subjectToken.sub
        act expression  = (may_act.sub == actor.client_id)?may_act:null
        Copy Resource ID + Client Secret → PingGateway RESOURCE_SECRET_ID

[ ] A3. Create "Agent Consent" agreement
        English text: "I consent to allow Super Banking AI agents to act on my behalf"
        Enable the agreement toggle

[ ] A4. Create "Agent-Consent-Login" auth policy
        Step 1: Login  |  Step 2: Agreement Prompt → Agent Consent

[ ] A5. User OIDC Web App → Policies tab → add Agent-Consent-Login
        User OIDC Web App → Resources tab → add agent scope

[ ] A6. Verify: log in → Token Chain → User Token has acr + may_act ✅

─── BFF environment variables (Vercel dashboard) ───────────────────────────────

[ ] B1. USE_AGENT_ACTOR_FOR_MCP=true
[ ] B2. AGENT_OAUTH_CLIENT_ID=<from A1>
[ ] B3. AGENT_OAUTH_CLIENT_SECRET=<from A1>
[ ] B4. AGENT_OAUTH_CLIENT_SCOPES=agent
[ ] B5. AGENT_CONSENT_ACR=Agent-Consent-Login
[ ] B6. MCP_RESOURCE_URI=https://ig.example.com:8443/mcp
[ ] B7. MCP_SERVER_URL=https://ig.example.com:8443/mcp

─── PingGateway (new persistent host) ──────────────────────────────────────────

[ ] C1. Install PingGateway, configure TLS
[ ] C2. export RESOURCE_SECRET_ID=$(printf '%s' "<secret>" | base64)
[ ] C3. Write mcp.json route (fill in pingOneEnvID + pingOneResourceID)
[ ] C4. Restart PingGateway — verify route loads in log
[ ] C5. Smoke test: curl https://ig.example.com:8443/mcp → 401 (no token) ✅
[ ] C6. Smoke test: curl with valid MCP token → 200 from MCP server ✅

─── Consent enforcement — BFF code ─────────────────────────────────────────────

[ ] D1. oauthUser.js — store consentAcr + mayAct in session on callback
[ ] D2. routes/auth.js — add consentGiven, consentAcr, mayAct to user status response
[ ] D2. routes/auth.js — add GET /api/auth/consent-url endpoint
[ ] D3. agentMcpTokenService.js — throw AGENT_CONSENT_REQUIRED when
          consentGiven=false AND delegationReady=false
[ ] D3. MCP route — catch AGENT_CONSENT_REQUIRED → 403 + consentUrl
[ ] D3. agentMcpTokenService.js — catch PingOne access_denied → friendly message
[ ] D4. agentMcpTokenService.js — add acr + consentGiven to User Token chain event

─── Consent gate — UI ──────────────────────────────────────────────────────────

[ ] E1. BankingAgent.js — fetch consentGiven on panel open
[ ] E1. BankingAgent.js — amber ba-consent-required banner
[ ] E1. BankingAgent.js — disable action buttons: consentBlocked || !consentGiven
[ ] E1. BankingAgent.js — handleGrantConsent → /api/auth/consent-url redirect
[ ] E1. BankingAgent.css — .ba-consent-required styles (amber, top of ba-right-col)
[ ] E2. TokenChainDisplay.js — acr pill (green if consentGiven, amber if not)
[ ] E2. TokenChainDisplay.js — "MCP Token → PingGateway → MCP Server" label
[ ] E2. TokenChainDisplay.js — update legend
[ ] E2. TokenChainDisplay.css — .tcd-pill--consent (green)

─── MCP server ──────────────────────────────────────────────────────────────────

[ ] F1. MCPMessageHandler.ts — accept Authorization: Bearer header
          (alongside existing agentToken in WS handshake for local dev)
[ ] F2. TokenIntrospector.ts — skip re-introspection when
          X-ForgeRock-TransactionId header is present (PingGateway already validated)

─── BFF transport ───────────────────────────────────────────────────────────────

[ ] G1. mcpWebSocketClient.js — detect https:// → use SSE transport
[ ] G2. mcpWebSocketClient.js — pass MCP token as Authorization: Bearer for SSE

─── Testing ─────────────────────────────────────────────────────────────────────

[ ] H1. npm run test:e2e:score  — score must not drop below 77/110
[ ] H2. npm run test:e2e:quality — all checks pass
[ ] H3. Manual: login → Token Chain → User Token shows acr ✅ + may_act ✅ pills
[ ] H4. Manual: login WITHOUT consent policy → amber banner shown, buttons disabled
[ ] H5. Manual: "Grant agent permission" → PingOne shows consent → accept → unlocks
[ ] H6. Manual: "My Accounts" → Token Chain shows 5 hops including PingGateway
[ ] H7. Manual: check PingGateway audit/mcp.audit.json after tool call
[ ] H8. Manual: tamper MCP token → PingGateway returns 401
[ ] H9. Manual: tamper acr in session → exchange blocked server-side (403)
```

---

## Files changed

| File | Change |
|---|---|
| `banking_api_server/routes/oauthUser.js` | Store `consentAcr` + `mayAct` in session on OAuth callback |
| `banking_api_server/routes/auth.js` | Add `consentGiven`/`consentAcr`/`mayAct` to user status; add `/consent-url` endpoint |
| `banking_api_server/services/agentMcpTokenService.js` | Hard-block on `AGENT_CONSENT_REQUIRED`; add `acr`/`consentGiven` to token event |
| `banking_api_server/services/mcpWebSocketClient.js` | Detect HTTPS → SSE transport; Bearer header for PingGateway path |
| `banking_api_ui/src/components/BankingAgent.js` | Fetch consent status; amber banner; disable buttons; re-auth button |
| `banking_api_ui/src/components/BankingAgent.css` | `.ba-consent-required` styles |
| `banking_api_ui/src/components/TokenChainDisplay.js` | `acr` consent pill; PingGateway hop label; legend update |
| `banking_api_ui/src/components/TokenChainDisplay.css` | `.tcd-pill--consent` styles |
| `banking_mcp_server/src/server/MCPMessageHandler.ts` | Accept `Authorization: Bearer` header; skip introspection on PingGateway path |

**No changes to:** TokenChainContext, UserDashboard, LandingPage, App.js, session handling

---

## Effort estimate

| Area | Effort | Critical path blocker |
|---|---|---|
| PingOne config A1–A6 | 1–2 hrs | PingOne admin access |
| BFF env vars B1–B7 | 15 min | PingGateway deployed first |
| PingGateway deploy + config C1–C6 | 2–4 hrs | Persistent host + TLS cert |
| Consent BFF code D1–D4 | 2–3 hrs | — |
| Consent UI E1–E2 | 2–3 hrs | — |
| MCP server F1–F2 | 1–2 hrs | — |
| BFF transport G1–G2 | 2–3 hrs | — |
| Testing H1–H9 | 1–2 hrs | Everything above |
| **Total** | **~2 days** | PingGateway host is the critical path |

Consent work (D + E) can be done and shipped independently before PingGateway is
deployed — it only requires the PingOne config steps A3–A5 and the BFF env var B5.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| `acr` absent from user token | Policy not attached to web app (A5) |
| `may_act` absent from user token | `agent` resource `may_act` expression not configured (A2); or `agent` scope not on web app (A5) |
| `act` claim null in MCP token | Attribute expressions in `test` resource don't match your client IDs exactly (A2) |
| Token exchange fails with `access_denied` | `may_act.sub` doesn't match actor token `client_id` — check AI Agent client ID in PingOne |
| Amber consent banner stuck after accepting | Session not updated — re-check D1 (consentAcr stored on callback) |
| PingGateway drops MCP traffic | `streamingEnabled: true` must be set in admin.json (C1) |
| PingGateway 404 from MCP server | `UriPathRewriteFilter` must strip `/mcp` → `/` (C3) |
| PingGateway 401 on valid token | `RESOURCE_SECRET_ID` has trailing newline — use `printf` not `echo` (C2) |
| Consent agreement not shown at login | Policy must be attached AND enabled; agreement must be enabled in PingOne |
