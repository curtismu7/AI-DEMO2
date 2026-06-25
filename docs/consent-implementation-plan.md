# Super Banking — Agent Consent Implementation Plan

_Implements the consent pattern from "Securing AI Agents with PingOne using Delegation and Least Privilege"_
_Last updated: 2026-03-27_

---

## What the PDF requires

When a user first uses the AI agent, PingOne must show them a consent agreement:

> _"I consent to allow digital assistants created by [Company] to act on my behalf"_

After they accept:
- Their user token carries `acr: "Agent-Consent-Login"` — proof that consent occurred in this session
- Their user token carries `may_act: { sub: <AI Agent client_id> }` — grants the agent delegation rights
- Token exchange succeeds and the MCP token carries `act` proving the chain of delegation

If they have NOT consented, the token exchange **must be blocked** before PingOne is even called — the app should tell the user clearly and offer a path to consent.

---

## Current state (gap analysis)

| What the PDF requires | What Super Banking does today | Gap |
|---|---|---|
| `acr` stored in session after login | `acr` extracted in auth middleware (`req.user.acr`) but **never stored in session** | Store in session on callback |
| `acr` returned to frontend | Not in `/api/auth/oauth/user/status` response | Add to status endpoint |
| `may_act` gates token exchange | `may_act` checked but **exchange proceeds regardless** | Block exchange if absent |
| `acr` gates token exchange | Not checked at all | Block exchange if acr ≠ expected policy |
| UI shows consent status | No consent status shown (only `may_act` pill in Token Chain) | Add consent indicator to agent panel |
| UI blocks action buttons if no consent | Blocked only for `consentBlocked` (high-value challenge), not for missing agreement | Add pre-flight consent gate |
| `acr` visible in Token Chain Display | Hidden inside full JWT decode dump | Surface as named pill |
| Re-consent button when consent missing | Not present | Add "Grant agent permission" re-auth button |

---

## PingOne configuration (no code — do first)

These steps unlock the `acr` and `may_act` claims that the code changes below depend on.

### Step 1 — Create the consent agreement

PingOne admin console → **User Experience > Agreements** → **+**

| Field | Value |
|---|---|
| Name | `Agent Consent` |
| Description | Consent for a digital assistant agent |
| Reconsent Every | 180 days (Number of Days) |

Add English language content:
- Language: `English (en)`
- Agreement text: `I consent to allow Super Banking AI agents to act on my behalf`
- **Enable the agreement** (toggle on the Agreements page)

### Step 2 — Create the authentication policy

PingOne admin console → **Authentication > Policies** → **+ Add Policy**

| Field | Value |
|---|---|
| Policy name | `Agent-Consent-Login` |
| Step 1 (Step Type) | **Login** |
| Step 2 (Step Type) | **Agreement Prompt** → select `Agent Consent` |

Save the policy.

### Step 3 — Attach policy to the user OIDC Web App

PingOne admin console → **Applications > Applications** → open your user OIDC Web App → **Policies tab** → **+ Add Policies** → select `Agent-Consent-Login` → Save.

> **Note:** Attaching at the web app level means consent is prompted on every login.
> If you want consent only when the agent scope is requested, create a separate
> Agent login flow instead. For the demo, web app attachment is simpler.

### Step 4 — Verify `may_act` is in the user token

After completing Steps 1–3, log in and inspect the user token in the Token Chain Display.
The user token should contain:

```json
"acr": "Agent-Consent-Login",
"may_act": {
  "sub": "<AI Agent client_id>"
}
```

If `may_act` is absent, the `agent` resource's attribute expression is not configured.
See `docs/pinggateway-agent-plan.md` § A2 for the `may_act` expression setup.

---

## Code changes

Five files. All changes are additive (no existing logic removed).

---

### Change 1 — Store `acr` in session on OAuth callback

**File:** `banking_api_server/routes/oauthUser.js`

Find the session storage block (where `req.session.oauthTokens`, `req.session.user`,
and `req.session.oauthType` are set) and add `acr`:

```js
// Add after the existing session assignments:
req.session.consentAcr = idTokenClaims?.acr || null;
// e.g. "Agent-Consent-Login" when user accepted the agreement
```

Also store `may_act` from the user token claims so the BFF can check delegation rights
without re-decoding the token on every request:

```js
req.session.mayAct = accessTokenClaims?.may_act || null;
// e.g. { "sub": "<AI Agent client_id>" }
```

**Why `consentAcr` not just `acr`:** Avoids collisions with other session properties
and makes it immediately obvious what the field is for.

---

### Change 2 — Return consent status from the user status endpoint

**File:** `banking_api_server/routes/auth.js` (or `oauthUser.js` — wherever
`/api/auth/oauth/user/status` lives)

Add `consentGiven` and `consentAcr` to the response:

```js
// In the /api/auth/oauth/user/status handler, after checking session:
const expectedAcr = process.env.AGENT_CONSENT_ACR || 'Agent-Consent-Login';
const consentAcr  = req.session.consentAcr || null;
const consentGiven = consentAcr === expectedAcr;

res.json({
  authenticated: true,
  user: req.session.user,
  tokenType: ...,
  expiresAt: ...,
  // New fields:
  consentGiven,
  consentAcr,
  mayAct: req.session.mayAct || null,
});
```

**New environment variable:**

```bash
# Name of the PingOne auth policy that includes the consent step.
# Default matches the PDF exactly.
AGENT_CONSENT_ACR=Agent-Consent-Login
```

---

### Change 3 — Block token exchange when consent is missing

**File:** `banking_api_server/services/agentMcpTokenService.js`

Currently `describeMayAct()` returns a `valid: false` result but the exchange proceeds
anyway. Change the pre-exchange check to hard-block when both `may_act` is absent AND
`acr` doesn't match:

```js
// Near the top of the exchange function, before calling PingOne:
const expectedAcr = process.env.AGENT_CONSENT_ACR || 'Agent-Consent-Login';
const consentAcr  = sessionData.consentAcr;   // populated by Change 1
const mayAct      = t1Claims.may_act;

const consentGiven = consentAcr === expectedAcr;
const delegationReady = !!mayAct;

if (!consentGiven && !delegationReady) {
  // Neither consent proof nor delegation claim — block early, don't call PingOne
  throw Object.assign(
    new Error('Agent consent required. The user must accept the agent consent agreement before the AI agent can act on their behalf.'),
    {
      code: 'AGENT_CONSENT_REQUIRED',
      consentAcr,
      expectedAcr,
      mayActPresent: false,
    }
  );
}

if (!delegationReady) {
  // Consent policy ran but PingOne didn't add may_act — likely missing resource config
  // Warn, but let PingOne make the final call (it will reject the exchange if invalid)
  console.warn('[agentMcpTokenService] may_act absent despite consent ACR. Check agent resource may_act expression in PingOne.');
}
```

**Error surfacing in the MCP route:**

In the Express route that calls `agentMcpTokenService`, catch `AGENT_CONSENT_REQUIRED`
and return a structured response the UI can act on:

```js
if (err.code === 'AGENT_CONSENT_REQUIRED') {
  return res.status(403).json({
    error: 'agent_consent_required',
    message: err.message,
    consentUrl: buildConsentUrl(req),  // see Change 4
  });
}
```

---

### Change 4 — Consent gate in the Banking Agent panel

**File:** `banking_api_ui/src/components/BankingAgent.js`

**A. Fetch consent status on panel open:**

When the agent panel opens and the user status is loaded, check `consentGiven`:

```js
// In the useEffect that loads agent context (on panel open):
const status = await api.get('/api/auth/oauth/user/status');
setConsentGiven(status.data.consentGiven ?? true); // default true for graceful degradation
setConsentAcr(status.data.consentAcr);
```

**B. Consent required banner:**

Add a new state separate from the existing `consentBlocked` (which is for high-value
transaction challenges — keep that as-is):

```jsx
{/* Shown when user has not accepted the Agent Consent agreement */}
{!consentGiven && (
  <div className="ba-consent-required">
    <p>
      <strong>🔒 Agent permission required</strong><br />
      Super Banking AI needs your permission to act on your behalf.
      This is a one-time consent (valid 180 days).
    </p>
    <button
      className="ba-consent-btn"
      onClick={handleGrantConsent}
    >
      Grant agent permission
    </button>
  </div>
)}
```

Add `.ba-consent-required` to `BankingAgent.css`:
- Amber/yellow background to distinguish from the red `consentBlocked` banner
- Positioned at the top of `.ba-right-col` above the message area

**C. Disable action buttons until consent given:**

The 8 action items (`.ba-action-item`) already support a `disabled` prop.
Add `disabled={!consentGiven}` alongside the existing `disabled={consentBlocked}`:

```jsx
disabled={consentBlocked || !consentGiven}
```

**D. `handleGrantConsent` — redirect to re-auth with consent policy:**

```js
const handleGrantConsent = async () => {
  // Get the consent-specific authorize URL from the BFF
  const { data } = await api.get('/api/auth/consent-url');
  window.location.href = data.url;
};
```

**New BFF endpoint** `GET /api/auth/consent-url` (add to `routes/auth.js`):

```js
router.get('/consent-url', (req, res) => {
  // Build a PingOne authorize URL that uses the Agent-Consent-Login policy
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: userOAuthConfig.clientId,
    redirect_uri: userOAuthConfig.redirectUri,
    scope: userOAuthConfig.scopes.join(' '),
    acr_values: process.env.AGENT_CONSENT_ACR || 'Agent-Consent-Login',
    prompt: 'consent',   // force consent screen even if session exists
    state: generateState(),
    nonce: generateNonce(),
  });
  res.json({ url: `${pingOneAuthorizeEndpoint}?${params}` });
});
```

---

### Change 5 — Show `acr` and consent status in Token Chain Display

**File:** `banking_api_server/services/agentMcpTokenService.js`

Add `acr` and `consentGiven` to the User Token event emitted for the Token Chain:

```js
// In the user token event (id: 'user-token'):
{
  id: 'user-token',
  label: 'User Token',
  status: 'active',
  claims: { ...sanitizedClaims },
  // New fields:
  acr: t1Claims.acr || null,
  consentGiven: (t1Claims.acr === (process.env.AGENT_CONSENT_ACR || 'Agent-Consent-Login')),
  consentAcrExpected: process.env.AGENT_CONSENT_ACR || 'Agent-Consent-Login',
  mayActPresent: !!t1Claims.may_act,
  mayActValid: ...,
  mayActDetails: ...,
}
```

**File:** `banking_api_ui/src/components/TokenChainDisplay.js`

Add an `acr` pill immediately after the existing `may_act` pills:

```jsx
{/* After the may_act pills (lines ~101-110): */}
{event.acr && (
  <div className={`tcd-pill ${event.consentGiven ? 'tcd-pill--consent' : 'tcd-pill--warn'}`}>
    {event.consentGiven
      ? `acr ✅ "${event.acr}" — agent consent recorded`
      : `acr ⚠️ "${event.acr}" — expected "${event.consentAcrExpected}"`}
  </div>
)}
{!event.acr && event.id === 'user-token' && (
  <div className="tcd-pill tcd-pill--warn">
    acr absent — user may not have completed the consent agreement
  </div>
)}
```

Add `.tcd-pill--consent` to `TokenChainDisplay.css` (green, same shape as `--may-act`).

Update the legend at the bottom of Token Chain Display:

```jsx
// Add to the legend items:
{ color: 'green',  label: 'Agent consent given (acr matches policy)' },
{ color: 'amber',  label: 'Agent consent missing or policy mismatch' },
```

---

## Complete flow after all changes

```
1. User clicks login on Landing Page
   └─► PingOne shows Login step
   └─► PingOne shows "Agent Consent" agreement prompt
   └─► User accepts
   └─► User token issued with:
         acr: "Agent-Consent-Login"
         may_act: { sub: "<AI Agent client_id>" }

2. BFF stores in session:
     req.session.consentAcr = "Agent-Consent-Login"
     req.session.mayAct = { sub: "<AI Agent client_id>" }

3. User opens Banking Agent panel
   └─► BankingAgent.js calls /api/auth/oauth/user/status
   └─► Response includes: consentGiven: true, mayAct: {...}
   └─► Action buttons are ENABLED

4. User clicks "My Accounts"
   └─► BFF calls agentMcpTokenService
   └─► Pre-flight check: consentGiven ✅, mayAct ✅ — proceed
   └─► Token exchange request to PingOne:
         subject_token: user token (has may_act)
         actor_token: AI Agent credentials token
         audience: <MCP resource URI>
         scope: banking:accounts:read
   └─► PingOne validates may_act.sub == actor_token.client_id ✅
   └─► MCP token issued with:
         sub: demouser
         act: { sub: "<AI Agent client_id>" }
         scope: banking:accounts:read

5. Token Chain Display shows 4 pills on User Token row:
     may_act ✅ present — sub: <AI Agent client_id>
     acr ✅ "Agent-Consent-Login" — agent consent recorded
     act ✅ (on MCP token row)
     scope narrowed: banking:accounts:read

6. No consent → blocked flow:
   └─► User token has no may_act / acr ≠ "Agent-Consent-Login"
   └─► BankingAgent panel shows amber "Grant agent permission" banner
   └─► Action buttons disabled
   └─► User clicks "Grant agent permission"
   └─► Redirected to PingOne with acr_values=Agent-Consent-Login
   └─► Consent shown → accepted → return to dashboard
   └─► Panel reopens with consentGiven: true
```

---

## Environment variables summary

```bash
# BFF (.env / Vercel environment)
AGENT_CONSENT_ACR=Agent-Consent-Login     # must match PingOne policy name exactly
```

---

## Checklist

```
PingOne (admin console — do first)
[ ] Create "Agent Consent" agreement with English consent text
[ ] Enable the agreement (toggle on Agreements page)
[ ] Create "Agent-Consent-Login" auth policy (Login + Agreement Prompt)
[ ] Attach policy to user OIDC Web App (Policies tab)
[ ] Verify: log in → check user token in Token Chain Display → acr present?
[ ] Verify: log in → check user token → may_act present?

BFF code
[x] oauthUser.js — store consentAcr + mayAct in session on callback
[x] routes/auth.js — add consentGiven + consentAcr + mayAct to user status response
[x] routes/auth.js — add GET /api/auth/consent-url endpoint
[x] agentMcpTokenService.js — block exchange with AGENT_CONSENT_REQUIRED when
      consentGiven=false AND may_act absent
[x] MCP route — catch AGENT_CONSENT_REQUIRED, return 403 with consentUrl
[ ] Set AGENT_CONSENT_ACR env var

UI code
[x] BankingAgent.js — fetch consentGiven from user status on panel open
[x] BankingAgent.js — add ba-consent-required banner (amber, distinct from red consent challenge)
[x] BankingAgent.js — disable action buttons when !consentGiven
[x] BankingAgent.js — add handleGrantConsent → redirect to /api/auth/consent-url
[x] BankingAgent.css — add .ba-consent-required styles
[x] agentMcpTokenService.js — add acr + consentGiven to User Token event
[x] TokenChainDisplay.js — add acr pill (green when given, amber when missing)
[x] TokenChainDisplay.css — add .tcd-pill--consent styles
[x] TokenChainDisplay.js — update legend

Testing
[ ] npm run test:e2e:score — score must not drop below 77/110
[ ] npm run test:e2e:quality — all checks pass
[ ] Manual: login without consent → verify amber banner + buttons disabled
[ ] Manual: click "Grant agent permission" → verify PingOne shows consent screen
[ ] Manual: accept consent → verify panel unlocks + Token Chain shows acr ✅ pill
[ ] Manual: decline consent → verify panel stays locked
[ ] Manual: token exchange → verify MCP token has act claim
[ ] Manual: tamper acr in session → verify exchange blocked server-side
```

---

## Files changed

| File | Change |
|---|---|
| `banking_api_server/routes/oauthUser.js` | Store `consentAcr` + `mayAct` in session on callback |
| `banking_api_server/routes/auth.js` | Add `consentGiven`, `consentAcr`, `mayAct` to user status; add `/consent-url` endpoint |
| `banking_api_server/services/agentMcpTokenService.js` | Block exchange on `AGENT_CONSENT_REQUIRED`; add `acr`/`consentGiven` to token event |
| `banking_api_ui/src/components/BankingAgent.js` | Consent gate: fetch status, banner, disable buttons, re-auth button |
| `banking_api_ui/src/components/BankingAgent.css` | `.ba-consent-required` styles |
| `banking_api_ui/src/components/TokenChainDisplay.js` | `acr` pill on User Token row + legend entry |
| `banking_api_ui/src/components/TokenChainDisplay.css` | `.tcd-pill--consent` styles |

**No changes to:** TokenChainContext, UserDashboard, LandingPage, MCP server
(consent is entirely a login-time and BFF-time concern).
