# CIBA Implementation Plan for Banking App

## What is CIBA?

**CIBA (Client-Initiated Backchannel Authentication)** is an OpenID Connect extension (OIDC CIBA Core 1.0) that decouples the *consumption device* (where the app runs) from the *authentication device* (where the user approves).

Standard OAuth redirect flows require a browser and a redirect URI. CIBA does not. Instead:

1. The client (your server) sends a backchannel auth request with the user's identifier
2. PingOne (via DaVinci) sends an email to the user with an approval link
3. The user clicks **Approve** in their email — never leaves the chat/app
4. The client polls to retrieve the tokens

No browser redirect. No popup. No "go to this URL" message.

---

## Why This App Needs CIBA

### Problem 1: MCP AI Agent Auth Challenge is Broken UX

Currently, when the AI agent (MCP server) needs tokens on behalf of a user, it:
1. Generates an authorization challenge containing a URL
2. Returns that URL to the user as text in the chat
3. Expects the user to open the URL in a browser, authenticate, then return

**This is fragile, awkward, and blocks the AI agent until the user manually does something.**

With CIBA:
1. The AI agent sends the user's email to PingOne
2. PingOne (via DaVinci) emails the user an approval link
3. User clicks Approve in their email — never leaves the chat
4. Tokens flow back to the MCP session automatically

**File affected:** `banking_mcp_server/src/server/AuthenticationIntegration.ts` — the `generateAuthorizationChallenge()` method gets replaced with a CIBA initiation + poll loop.

### Problem 2: Step-Up Auth for High-Value Transactions Requires a Redirect

The app has `STEP_UP_AMOUNT_THRESHOLD` and `STEP_UP_ACR_VALUE` config — but step-up currently forces a browser redirect. CIBA lets the backend silently request elevated auth via email while the user stays on the page.

### Problem 3: Users Are Already in PingOne's Directory

PingOne supports CIBA natively. Since users are identified by email (`login_hint`), no device registration is required — PingOne looks up the user and sends the approval email via the DaVinci flow.

---

## Architecture After CIBA

```
AI Agent (MCP) or Backend-for-Frontend (BFF) server
    │
    │  1. POST /bc-authorize (login_hint=email)
    ▼
PingOne CIBA endpoint
    │
    │  2. DaVinci flow sends approval email
    ▼
User's Email Inbox
    │
    │  3. User clicks Approve
    ▼
PingOne
    │
    │  4. Token available
    ▼
Server polls POST /token (auth_req_id)
    │
    │  5. Returns access_token, id_token, refresh_token
    ▼
MCP session / Backend-for-Frontend (BFF) session stores tokens
    │
    │  6. Tool call proceeds with user context
    ▼
Banking API
```

---

## PingOne Configuration (Admin Console — No Code)

> **Prerequisites:** Your PingOne environment must have **SSO**, **MFA**, and **DaVinci** services enabled. PingOne CIBA uses DaVinci to orchestrate the authentication flow and sends challenges via email notification templates.

### Step 1: Create CIBA Notification Templates

PingOne delivers CIBA challenges to users via email. Create the templates first.

1. Navigate to **User Experience** → **Notification Templates**
2. Create a template named **"CIBA with binding message"**:
   - **Subject**: e.g. `Authorization request from ${appName}`
   - **Body**: Include the binding message (transaction reference) so users can match the notification to the request
3. Create a second template for generic requests (no binding message):
   - Used when `binding_message` is not supplied in the CIBA request

### Step 2: Configure the DaVinci CIBA Flow

PingOne CIBA authentication is orchestrated by a DaVinci flow — there is no built-in CIBA authenticator without it.

1. Download the **PingOne CIBA sample flow** from the [Ping Identity Marketplace](https://marketplace.pingidentity.com)
2. Import the flow into **DaVinci** (accessible from the PingOne Admin Console sidebar)
3. Configure the flow to:
   - Locate users by `login_hint` (email/username), `id_token_hint`, or `login_hint_token`
   - Send the CIBA notification email using the templates from Step 1
   - Handle user approval/denial
4. Save and enable the flow

### Step 3: Enable CIBA Grant Type on Your Application

1. Navigate to **Applications** → **Applications** → select your application (the one used by the Backend-for-Frontend (BFF) server — the admin/worker client)
2. Go to the **Overview** tab → click **Edit**
3. Under **Grant Types**, enable **CIBA**

   > The UI label is **"CIBA"** — the OAuth protocol identifier `urn:openid:params:oauth:grant-type:ciba` is what the client sends in API requests, not what you select here.

4. Save the application

> **Polling vs. callback:** Standalone PingOne CIBA uses poll mode — the server polls `POST /as/token` with `auth_req_id` until the user approves. PingOne does not expose a "Token Delivery Mode" or "Backchannel Client Notification Endpoint" setting in the application console (those are PingFederate concepts). The `CIBA_TOKEN_DELIVERY_MODE=poll` env var in this app controls the client-side behaviour only.

### Step 4: Azure AD as Upstream IdP (If Not Already Configured)

If users are in Azure AD and PingOne federates to it:

1. **Connections** → **Identity Providers** → Add Azure AD (OIDC)
2. Use `login_hint` = user's email — PingOne resolves this to the federated Azure AD user automatically
3. Alternatively provide `id_token_hint` if you have a previously issued token for the user

> PingOne handles the Azure AD user lookup internally. You do not call Azure AD's CIBA endpoint directly.

---

## Code Implementation

### Files to Create

```
banking_api_server/
  routes/ciba.js              ← new route file
  services/cibaService.js     ← new service
banking_mcp_server/src/
  auth/CIBAAuthenticationManager.ts  ← replaces/extends current auth challenge
```

### Files to Modify

```
banking_api_server/
  server.js                   ← register /api/auth/ciba routes
  config/oauth.js             ← add CIBA endpoint URL
banking_mcp_server/src/
  server/AuthenticationIntegration.ts  ← replace generateAuthorizationChallenge
  storage/BankingSessionManager.ts     ← CIBA auth_req_id tracking
```

---

## New Environment Variables

Add to `.env` and ConfigStore `FIELD_DEFS`:

```
# CIBA
CIBA_ENABLED=true
CIBA_TOKEN_DELIVERY_MODE=poll          # poll | ping
CIBA_NOTIFICATION_ENDPOINT=https://<your-url>/api/auth/ciba/notify  # ping mode only
CIBA_AUTH_REQUEST_EXPIRY=300           # seconds
CIBA_POLL_INTERVAL=5000               # ms between polls
CIBA_BINDING_MESSAGE=Banking App Login # shown on push notification
```

---

## Implementation: `banking_api_server/config/oauth.js`

Add CIBA endpoint getter alongside existing endpoints:

```javascript
// Add to the existing oauthConfig object
get cibaEndpoint() {
  return `${this._base}/bc-authorize`;
}
```

The backchannel authorize endpoint in PingOne follows the same base URL pattern:
`https://auth.pingone.{region}/{envId}/as/bc-authorize`

---

## Implementation: `banking_api_server/services/cibaService.js`

```javascript
const axios = require('axios');
const oauthConfig = require('../config/oauth');
const configStore = require('./configStore');

/**
 * Initiate a CIBA authentication request for a user.
 * Returns auth_req_id, expires_in, interval (seconds between polls).
 */
async function initiateBackchannelAuth(loginHint, bindingMessage, scope = 'openid profile email') {
  const params = new URLSearchParams({
    login_hint: loginHint,                    // user's email or sub
    scope,
    binding_message: bindingMessage || configStore.getEffective('ciba_binding_message') || 'Banking App Login',
  });

  // client_notification_token required for ping mode
  const deliveryMode = configStore.getEffective('ciba_token_delivery_mode') || 'poll';
  if (deliveryMode === 'ping') {
    params.set('client_notification_token', generateNotificationToken());
  }

  const clientId = oauthConfig.clientId;
  const clientSecret = oauthConfig.clientSecret;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await axios.post(oauthConfig.cibaEndpoint, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
  });

  // PingOne returns: { auth_req_id, expires_in, interval }
  return response.data;
}

/**
 * Poll the token endpoint for a CIBA auth_req_id.
 * Returns tokens when the user approves, or throws on denial/expiry.
 */
async function pollForTokens(authReqId) {
  const params = new URLSearchParams({
    grant_type: 'urn:openid:params:grant-type:ciba',
    auth_req_id: authReqId,
  });

  const clientId = oauthConfig.clientId;
  const clientSecret = oauthConfig.clientSecret;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await axios.post(oauthConfig.tokenEndpoint, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
  });

  return response.data; // { access_token, id_token, refresh_token, token_type, expires_in }
}

/**
 * Poll until the user approves or the request expires.
 * Rejects with the error if denied or expired.
 */
async function waitForApproval(authReqId, intervalSeconds = 5, maxAttempts = 60) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(intervalSeconds * 1000);
    try {
      const tokens = await pollForTokens(authReqId);
      return tokens;
    } catch (err) {
      const errorCode = err.response?.data?.error;
      if (errorCode === 'authorization_pending') continue;      // user hasn't tapped yet
      if (errorCode === 'slow_down') {
        intervalSeconds += 5;
        continue;
      }
      // access_denied, expired_token, or other — abort
      throw err;
    }
  }
  throw new Error('CIBA authentication timed out');
}

function generateNotificationToken() {
  return require('crypto').randomBytes(32).toString('hex');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { initiateBackchannelAuth, pollForTokens, waitForApproval };
```

---

## Implementation: `banking_api_server/routes/ciba.js`

```javascript
const express = require('express');
const router = express.Router();
const cibaService = require('../services/cibaService');
const { authenticateToken } = require('../middleware/auth');

/**
 * POST /api/auth/ciba/initiate
 * Initiates a CIBA auth request for the current session user.
 * Used by the Backend-for-Frontend (BFF) when step-up auth is needed without a redirect.
 * Body: { scope: 'banking:write', binding_message: 'Confirm $500 transfer' }
 */
router.post('/initiate', authenticateToken, async (req, res) => {
  const { scope, binding_message } = req.body;
  const loginHint = req.user.email;

  if (!loginHint) {
    return res.status(400).json({ error: 'User email required for CIBA' });
  }

  try {
    const { auth_req_id, expires_in, interval } = await cibaService.initiateBackchannelAuth(
      loginHint,
      binding_message,
      scope || 'openid profile email'
    );

    // Store in session so the poll endpoint can verify ownership
    req.session.cibaRequests = req.session.cibaRequests || {};
    req.session.cibaRequests[auth_req_id] = {
      initiatedAt: Date.now(),
      expiresAt: Date.now() + expires_in * 1000,
      loginHint,
      scope,
    };

    res.json({ auth_req_id, expires_in, interval });
  } catch (err) {
    console.error('CIBA initiation failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to initiate authentication' });
  }
});

/**
 * GET /api/auth/ciba/poll/:authReqId
 * Client polls this to check if the user has approved.
 * Returns { status: 'pending' | 'approved', tokens: {...} }
 */
router.get('/poll/:authReqId', authenticateToken, async (req, res) => {
  const { authReqId } = req.params;

  // Verify this session owns the request
  const pending = req.session.cibaRequests?.[authReqId];
  if (!pending) {
    return res.status(404).json({ error: 'Unknown auth request' });
  }
  if (Date.now() > pending.expiresAt) {
    delete req.session.cibaRequests[authReqId];
    return res.status(410).json({ error: 'Auth request expired' });
  }

  try {
    const tokens = await cibaService.pollForTokens(authReqId);
    // Store tokens in session (Backend-for-Frontend (BFF) pattern — never expose to browser)
    req.session.oauthTokens = {
      accessToken: tokens.access_token,
      idToken: tokens.id_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      tokenType: tokens.token_type,
    };
    delete req.session.cibaRequests[authReqId];
    res.json({ status: 'approved' });
  } catch (err) {
    const errorCode = err.response?.data?.error;
    if (errorCode === 'authorization_pending') {
      return res.json({ status: 'pending' });
    }
    if (errorCode === 'slow_down') {
      return res.json({ status: 'pending', slow_down: true });
    }
    delete req.session.cibaRequests?.[authReqId];
    res.status(403).json({ error: errorCode || 'Authentication denied' });
  }
});

/**
 * POST /api/auth/ciba/notify
 * Ping mode only: PingOne calls this when the user approves.
 * Requires a client_notification_token to verify the ping is genuine.
 */
router.post('/notify', async (req, res) => {
  // TODO: validate client_notification_token from Authorization header
  // Store the auth_req_id as "approved" in a shared cache (Redis)
  // so the frontend poll sees it immediately
  res.sendStatus(204);
});

module.exports = router;
```

---

## Register Routes in `banking_api_server/server.js`

```javascript
// Add after existing auth route registrations
const cibaRoutes = require('./routes/ciba');
app.use('/api/auth/ciba', cibaRoutes);
```

---

## Implementation: MCP Server — Replace Auth Challenge

**File:** `banking_mcp_server/src/server/AuthenticationIntegration.ts`

Replace the current `generateAuthorizationChallenge()` method that returns a URL for the user to manually visit.

```typescript
// NEW: CIBA-based authentication challenge
async initiateCIBAAuth(userEmail: string, requiredScope: string, sessionId: string): Promise<CIBAChallenge> {
  const bindingMessage = `Banking App – AI Assistant access (${requiredScope})`;

  // Call PingOne bc-authorize directly (server-to-server)
  const response = await this.httpClient.post(this.config.cibaEndpoint, {
    login_hint: userEmail,
    scope: `openid profile email ${requiredScope}`,
    binding_message: bindingMessage,
    // client credentials sent as Basic auth header
  }, {
    headers: { Authorization: `Basic ${this.config.clientCredentials}` }
  });

  const { auth_req_id, expires_in, interval } = response.data;

  // Store pending request in session
  await this.sessionManager.storeCIBARequest(sessionId, {
    authReqId: auth_req_id,
    expiresAt: Date.now() + expires_in * 1000,
    interval: interval || 5,
    userEmail,
    requiredScope,
  });

  return {
    type: 'ciba',
    auth_req_id,
    expires_in,
    poll_interval: interval || 5,
    message: `A push notification has been sent to your registered device. Please approve to continue.`,
  };
}

// Poll loop — call this from the tool handler when tokens are needed
async waitForCIBAApproval(sessionId: string, authReqId: string): Promise<TokenSet> {
  const request = await this.sessionManager.getCIBARequest(sessionId, authReqId);
  if (!request) throw new Error('Unknown CIBA request');

  return cibaService.waitForApproval(authReqId, request.interval);
}
```

**In `MCPMessageHandler.ts`**, when a tool call needs user auth:

```typescript
// BEFORE (current): return an authorization URL challenge
// AFTER (CIBA): initiate push notification, poll inline

const userEmail = session.userEmail; // injected from frontend at connection time
if (!userEmail) {
  // Fallback to redirect flow if email not available
  return this.generateAuthorizationChallenge(session, requiredScope);
}

// Initiate CIBA
const cibaChallenge = await this.authIntegration.initiateCIBAAuth(
  userEmail, requiredScope, session.id
);

// Notify the user via the chat UI
await this.sendNotification(connectionId, {
  type: 'auth_required',
  message: cibaChallenge.message,
  auth_req_id: cibaChallenge.auth_req_id,
});

// Poll until approved (blocks this tool call, not the whole server)
const tokens = await this.authIntegration.waitForCIBAApproval(
  session.id, cibaChallenge.auth_req_id
);

// Store tokens and proceed
await this.sessionManager.storeTokens(session.id, tokens);
// Re-execute the tool call now that we have tokens
```

---

## Step-Up Auth with CIBA (Transaction Flow)

For high-value transactions (amount > `STEP_UP_AMOUNT_THRESHOLD`), instead of redirecting to a PingOne authorize URL with `acr_values=Multi_factor`, use CIBA with ACR values:

```javascript
// In banking_api_server/routes/transactions.js (or wherever step-up is triggered)
const params = new URLSearchParams({
  login_hint: req.user.email,
  scope: 'openid profile email banking:write',
  acr_values: process.env.STEP_UP_ACR_VALUE || 'Multi_factor',
  binding_message: `Approve transfer of $${amount}`,
});
```

This sends a push notification that says "Approve transfer of $500" — the user approves on their phone without leaving the web app.

---

## Sequence Diagrams

### CIBA in MCP Tool Call

```
User (Chat UI)         MCP Server           PingOne           User's Phone
     │                    │                    │                    │
     │── tool call ───────▶│                    │                    │
     │                    │── bc-authorize ────▶│                    │
     │                    │◀── auth_req_id ─────│                    │
     │                    │                    │── push notif ──────▶│
     │◀── "Check phone" ──│                    │                    │
     │                    │                    │                    │
     │                    │                    │◀── user approves ──│
     │                    │── poll /token ─────▶│                    │
     │                    │◀── tokens ──────────│                    │
     │                    │                    │                    │
     │                    │── execute tool ─┐   │                    │
     │                    │◀── result ──────┘   │                    │
     │◀── tool result ────│                    │                    │
```

### CIBA Step-Up (High-Value Transaction)

```
User (Browser)         Backend-for-Frontend (BFF) Server           PingOne           User's Phone
     │                    │                    │                    │
     │── POST /transfer ──▶│                    │                    │
     │  (amount=$500)      │── bc-authorize ────▶│                    │
     │                    │  (acr=Multi_factor) │                    │
     │                    │◀── auth_req_id ─────│                    │
     │                    │                    │── push notif ──────▶│
     │◀── { auth_req_id } ─│                    │  "Approve $500"    │
     │                    │                    │                    │
     │── GET /poll ───────▶│── poll /token ─────▶│                    │
     │◀── pending ─────────│◀── pending ─────────│                    │
     │                    │                    │◀── user approves ──│
     │── GET /poll ───────▶│── poll /token ─────▶│                    │
     │◀── approved ────────│◀── tokens ──────────│                    │
     │                    │                    │                    │
     │── POST /transfer ──▶│ (re-execute with   │                    │
     │◀── success ─────────│  elevated tokens)   │                    │
```

---

## What NOT to Change

- The existing OAuth redirect flows (`/api/auth/oauth/login`, `/api/auth/oauth/user/login`) remain as-is. CIBA is additive — use it where redirect is impossible or awkward.
- Session structure (`req.session.oauthTokens`) does not change — CIBA tokens are stored in the same shape.
- JWKS validation (`tokenValidationService.js`) does not change — CIBA tokens are standard JWTs from the same PingOne issuer.
- The Backend-for-Frontend (BFF) pattern does not change — tokens still never reach the browser.

---

## Testing CIBA

### Unit Tests
- Mock PingOne `bc-authorize` endpoint (return `auth_req_id`)
- Mock poll responses: `authorization_pending` → `authorization_pending` → `tokens`
- Test `slow_down` handling (poll interval increases)
- Test `access_denied` (user rejects push)
- Test expiry

### Integration Tests
```bash
# 1. Start server
# 2. Get a valid session token
# 3. POST /api/auth/ciba/initiate with { scope: 'banking:write' }
# 4. Check phone for push notification
# 5. Approve on phone
# 6. GET /api/auth/ciba/poll/:authReqId — should return { status: 'approved' }
```

### Load/Latency
- CIBA adds 2-10 seconds for user to approve
- The poll loop is non-blocking (each poll is a separate HTTP request)
- Use a short poll interval (5s) to feel responsive

---

## Security Considerations

| Concern | Mitigation |
|---------|-----------|
| `auth_req_id` replay | Tied to session; deleted after approval; expires in 5 min |
| CIBA endpoint exposed | Server-to-server only; client credentials required |
| User enumeration via `login_hint` | Error responses are generic; only internal sessions can initiate |
| Token delivery (ping mode) | `client_notification_token` validated; HTTPS only |
| Concurrent CIBA requests | Session tracks all pending `auth_req_id`s; limit to 1 per session |
| Push notification spoofing | Relies on PingOne + device security; `binding_message` provides context |

---

## Implementation Order

1. **Add CIBA endpoint to `config/oauth.js`** — 5 min
2. **Create `services/cibaService.js`** — 30 min
3. **Create `routes/ciba.js`** — 45 min
4. **Register routes in `server.js`** — 5 min
5. **Add env vars to `.env.example` and `configStore.js` FIELD_DEFS** — 15 min
6. **Update `MCPMessageHandler.ts` to use CIBA when email is available** — 1 hour
7. **Update `AuthenticationIntegration.ts` with CIBA method** — 45 min
8. **Update `BankingSessionManager.ts` to track CIBA requests** — 30 min
9. **PingOne admin console configuration** — 20 min (non-code)
10. **Test end-to-end with real push notification** — 1 hour

---

## Summary

| | Current Flow | With CIBA |
|---|---|---|
| MCP agent needs user tokens | Returns URL, user must open browser | Push notification, user taps Approve in chat |
| Step-up for $500 transfer | Redirect user to PingOne login page | Push notification "Approve $500 transfer" |
| User experience | Interrupted, context-switching | Inline, frictionless |
| Security | Same JWT validation | Same + server-to-server token delivery |
| Azure AD users | Federated through PingOne | Same federation path, Microsoft Authenticator as device |
| Code changes | N/A | ~4 new files, minor edits to 4 existing files |

CIBA is the right fit for this app because you already have the user's email in the MCP session (injected from the frontend at connection time — `App.js` lines 27-42), PingOne already supports it, and the current auth challenge pattern in `AuthenticationIntegration.ts` is the exact problem CIBA solves.
