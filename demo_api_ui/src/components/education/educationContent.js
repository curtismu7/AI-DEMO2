/**
 * educationContent.js — Shared rich education content components
 *
 * Mostly pure JSX components (no state, no effects, no props). TokenChainPanel
 * is separate (local UI state for expand/copy). Used by CIBAPanel and education
 * drawer panels (LoginFlowPanel, McpProtocolPanel, IntrospectionPanel, AgentGatewayPanel).
 *
 * All code blocks use <pre className="edu-code"> to match EducationDrawer CSS.
 * Prose uses standard <h3>, <p>, <ul> elements.
 */

import React from 'react';
import TokenChainPanel from './TokenChainPanel';
import {
  EduImplIntro,
  SNIP_RESOLVE_MCP_TOKEN,
  SNIP_TOKEN_EXCHANGE_PINGONE,
} from './educationImplementationSnippets';

// ---------------------------------------------------------------------------
// Raw content strings (shared between components)
// ---------------------------------------------------------------------------

const SEQUENCE_DIAGRAM = `
1. App (server) ──POST /bc-authorize──▶ PingOne
   { login_hint: "user@bank.com", scope: "openid write",
     binding_message: "Approve $500 transfer" }

2. PingOne ◀─────────────────────────── auth_req_id returned

3. PingOne ──out-of-band approval────▶ User (channel is your PingOne / DaVinci setup)
   • Email: approval link in inbox  — OR —  • Push: notification on registered device

4. User approves (link in email or tap Approve on device)

5. App polls POST /token (grant=ciba, auth_req_id=...)
   → authorization_pending (repeat every 5s)
   → tokens returned ✓

6. Tokens stored server-side (never sent to browser)
   Tool call / transaction executes with user context
`;

const BC_AUTHORIZE_REQUEST = `POST {issuer}/as/bc-authorize
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(client_id:client_secret)>

scope=openid%20banking%3Awrite
&login_hint=user%40bank.com
&binding_message=Approve%20%24500%20transfer
&acr_values=Multi_factor            (optional step-up)
&client_notification_token=...      (required for ping/push delivery mode)

HTTP/1.1 200 OK
{
  "auth_req_id": "abc123xyz...",
  "expires_in": 300,
  "interval": 5
}`;

const CIBA_POLL_REQUEST = `POST {issuer}/as/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:openid:params:grant-type:ciba
&auth_req_id=abc123xyz...
&client_id=...
&client_secret=...

── If user has not yet approved ──
HTTP/1.1 400 Bad Request
{ "error": "authorization_pending" }

── If poll is too fast ──
HTTP/1.1 400 Bad Request
{ "error": "slow_down" }   → increase interval by 5s

── On approval ──
HTTP/1.1 200 OK
{
  "access_token": "...",
  "token_type": "Bearer",
  "id_token": "...",
  "refresh_token": "...",
  "expires_in": 3600
}

── On denial / timeout ──
HTTP/1.1 400 Bad Request
{ "error": "access_denied" | "expired_token" }`;



const FULL_STACK_DIAGRAM = `
┌──────────────────────────────────────────────────────────────────────────────┐
│ Pattern source: Agent Gateway demo architecture.vsdx (swimlanes + RFC strips) │
└──────────────────────────────────────────────────────────────────────────────┘

  Web Browser SPA
       │
       │  HTTPS (session cookie). No raw OAuth tokens in browser JS.
       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Agent — security strip: OAuth 2.1 · RFC 8707 · RFC 9728 · RFC 7523 · RFC 8693│
│   ┌─────┐    ┌────────┐    ┌────────────────┐                                 │
│   │ LLM │    │ memory │    │ business logic │   (+ Sidecar / SDK where used)  │
│   └─────┘    └────────┘    └────────────────┘                                 │
└──────────────────────────────────────────────────────────────────────────────┘
       │ REST / WebSocket to Backend-for-Frontend (BFF)                         │
       │                                                 │
       ▼                                                 ▼
┌──────────────────────────────┐            ┌──────────────────────────────────┐
│ MCP ingress (gateway role)   │            │ IDP / AS — PingOne              │
│ • Introspection + scope       │            │ /authorize · /token ·           │
│   enforcement for tools       │            │ introspect (RFC 7662) · JWKS    │
│ • MCP authZ RFC 9728          │◀───────────│ Resource indicators RFC 8707   │
│   (client ↔ authorization)    │            │ in authorize + token requests  │
└──────────────┬───────────────┘            └──────────────────────────────────┘
               │
               │ MCP egress (outbound to MCP server / token actuation)
               │ • Full RFC 9728 + RFC 8707 sequence with MCP peer
               │ • Token exchange RFC 8693 with secure binding:
               │   JWT client auth RFC 7523 or DPoP RFC 9449 (best practice)
               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ MCP Server                              Tool                                  │
│   tools/list · tools/call               API Key / Bearer to downstream       │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │
                               │  Bearer access token (audience = Resource Server)
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Resource Server (RS) — Banking API HTTPS                                      │
│ RS validates token + audience (https://…/api) + scopes                        │
└──────────────────────────────────────────────────────────────────────────────┘

  Tool call without acceptable token:
       HTTP/1.1 401 Unauthorized  →  "attempt run tool"
       → OAuth flows (PKCE in browser, or CIBA, or token exchange on Backend-for-Frontend (BFF))
       → "attempt again with bearer token"

  MCP spec: clients MUST support Resource Indicators (RFC 8707) for OAuth —
  https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization

── Phased OAuth with resource indicator (RFC 8707) — same structure as ref diagram ──
  Phase 1  Authorization request  GET /authorize?…&resource=<RS URL>
  Phase 2  Token request          POST /token  grant=authorization_code &resource=<RS>
           AS limits audience to the requested resource
  Phase 3  Resource access       GET …  Authorization: Bearer <AT for RS>

── Optional: ID-JAG / XAA (draft) — identity assertion authorization grant ──
  https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-assertion-authz-grant/

── This banking demo maps: Web SPA → Banking Backend-for-Frontend (BFF) → PingOne AS → MCP server → Banking RS ──
   CIBA: POST /bc-authorize + poll /token  (parallel track; email or push per PingOne)
`;

const OAUTH_API_CHEATSHEET = `
Browser-visible (same origin as app):
  GET  /api/auth/oauth/login              Start admin OAuth (redirect to PingOne)
  GET  /api/auth/oauth/user/login         Start end-user OAuth
  GET  /api/auth/oauth/redirect-info      JSON: exact redirect_uri values for PingOne
Server-only (after login):
  GET  /api/auth/oauth/status             Admin session + userinfo
  GET  /api/auth/oauth/user/status        End-user session
MCP / agent:
  POST /api/mcp/tool                      Backend-for-Frontend (BFF) → optional token exchange → MCP tools/call
  GET  /api/mcp/inspector/tools           Backend-for-Frontend (BFF) MCP inspector: tools/list
  POST /api/mcp/inspector/invoke          Backend-for-Frontend (BFF) MCP inspector: tools/call
Agent identity (optional "on behalf of"):
  GET  /api/agent/identity/status         Actor bootstrap / mapping status
  POST /api/agent/identity/bootstrap      Optional extra checks + PingOne directory mapping (lab; not pi.flow)
CIBA (when enabled):
  GET  /api/auth/ciba/status              CIBA enabled flag + delivery mode
  POST /api/auth/ciba/initiate            Start backchannel auth
  GET  /api/auth/ciba/poll/:authReqId     Poll until approved or denied
  POST /api/auth/ciba/cancel/:authReqId   Cancel pending CIBA request
  POST /api/auth/ciba/notify             Ping-mode callback from PingOne
`;

// ---------------------------------------------------------------------------
// CibaWhatContent — What is CIBA + sequence diagram + key concepts
// ---------------------------------------------------------------------------

export function CibaWhatContent() {
  return (
    <>
      <p>
        CIBA (Client-Initiated Backchannel Authentication, OpenID CIBA Core 1.0) decouples the{' '}
        <strong>consumption device</strong> (where the app runs) from where the user{' '}
        <strong>approves</strong> — often another device or their email inbox. No browser redirect,
        no popup. PingOne delivers the approval step by <strong>email</strong> or{' '}
        <strong>push</strong> depending on your DaVinci configuration.
      </p>

      <h3>The flow (6 steps)</h3>
      <pre className="edu-code">{SEQUENCE_DIAGRAM}</pre>

      <h3>Real HTTP: bc-authorize request &amp; response</h3>
      <pre className="edu-code">{BC_AUTHORIZE_REQUEST}</pre>

      <h3>Real HTTP: polling for tokens</h3>
      <pre className="edu-code">{CIBA_POLL_REQUEST}</pre>

      <h3>Key concepts</h3>
      <ul>
        <li>
          <strong>auth_req_id</strong> — a short-lived opaque ID returned by PingOne when{' '}
          <code>POST /bc-authorize</code> succeeds. The server uses it to poll{' '}
          <code>POST /token</code> until the user approves or the request expires.
        </li>
        <li>
          <strong>binding_message</strong> — the text shown in the approval email or push
          notification, e.g. <em>"Approve $500 transfer to Savings"</em>. Helps the user
          confirm exactly what they are authorising.
        </li>
        <li>
          <strong>login_hint</strong> — the user's email address. PingOne resolves this to the
          target account and sends the approval to the right inbox or device.
        </li>
        <li>
          <strong>Poll vs Ping delivery mode</strong> — <em>Poll</em>: server calls{' '}
          <code>POST /token</code> every 5 s (or <code>interval</code> seconds). <em>Ping</em>:
          PingOne calls a <code>client_notification_endpoint</code> when the user approves
          (requires a publicly reachable callback URL). This demo uses Poll mode.
        </li>
        <li>
          <strong>Backend-for-Frontend (BFF) pattern — tokens never reach the browser</strong> — tokens are stored in
          the server-side session. The browser only receives approval status updates via the Backend-for-Frontend (BFF)
          poll API. XSS cannot steal them.
        </li>
        <li>
          <strong>Email vs push</strong> — controlled by your PingOne / DaVinci flow, not by
          this app. Email-only CIBA requires no push-capable MFA device.
        </li>
      </ul>

      <h3>When to use CIBA (vs Authorization Code)</h3>
      <ul>
        <li>LLM / agent contexts where a browser redirect would break the flow.</li>
        <li>Step-up authentication mid-session (high-value transaction) without a page reload.</li>
        <li>IoT / headless devices that cannot host a redirect URI.</li>
        <li>Delegated approval — approve on phone while viewing dashboard on desktop.</li>
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
// CibaFullStackContent — full platform architecture diagram + RFC callouts
// ---------------------------------------------------------------------------

export function CibaFullStackContent() {
  return (
    <>
      <p>
        The diagram below uses the <strong>same swimlane pattern and RFC callouts</strong> as{' '}
        <strong>Agent Gateway demo architecture.vsdx</strong> in this repo: Web Browser SPA →
        Agent (security strip: OAuth 2.1, RFC 8707, 9728, 7523, 8693) → MCP ingress / egress →
        MCP Server / Tool → Resource Server; 401 → OAuth flows → Bearer retry; phased OAuth with{' '}
        <strong>resource</strong> indicator (RFC 8707). This app maps that pattern onto{' '}
        <strong>PingOne</strong>, the <strong>Banking Backend-for-Frontend (BFF)</strong>, and{' '}
        <strong>demo_mcp_server</strong>.
      </p>

      <h3>Agent Gateway-style architecture map</h3>
      <pre className="edu-code">{FULL_STACK_DIAGRAM}</pre>

      <h3>How this demo maps to the diagram</h3>
      <ul>
        <li><strong>Web Browser SPA</strong> — React UI; session cookie only (no raw AT/RT in JavaScript).</li>
        <li><strong>Agent / LLM</strong> — demo_agent_service reasoning service (port 3006); BFF calls runReasonLoop() against the external TypeScript agent.</li>
        <li><strong>MCP gateway</strong> — demo_mcp_gateway (port 3005): RFC 7662 introspection, GatewayTokenPolicy scope/audience check, PingOne Authorize decision (PERMIT/DENY/INDETERMINATE). The BFF (demo_api_server, port 3001) routes tool calls to this gateway via callToolViaGateway.</li>
        <li><strong>MCP egress</strong> — BFF performs single RFC 8693 exchange per tool call (mcpToolPipeline.js), then routes to demo_mcp_gateway. On PERMIT, gateway forwards original bearer token unchanged to demo_mcp_server.</li>
        <li><strong>IDP / AS</strong> — PingOne (<code>/authorize</code>, <code>/token</code>, introspection).</li>
        <li><strong>MCP Server + Tool</strong> — <code>demo_mcp_server</code> (port 8080); tools call the Banking API with Bearer + scopes.</li>
        <li><strong>Resource Server (RS)</strong> — Banking REST API (same host as Backend-for-Frontend (BFF) in this deployment).</li>
      </ul>

      <h3>Phased OAuth — resource indicator (RFC 8707)</h3>
      <pre className="edu-code">{`Phase 1 — Authorization request
  GET /as/authorize
    ?response_type=code
    &client_id=...
    &redirect_uri=...
    &scope=openid%20banking%3Aread
    &resource=https%3A%2F%2Fapi.example.com%2F   ← binds audience at issuance

Phase 2 — Token request
  POST /as/token
  grant_type=authorization_code
  &code=...
  &resource=https%3A%2F%2Fapi.example.com%2F     ← same resource; AS limits aud

Phase 3 — Resource access
  GET https://api.example.com/accounts
  Authorization: Bearer <AT whose aud = https://api.example.com/>

  RS verifies: aud == its own URL; scope includes required permission.`}</pre>

      <h3>Key API endpoints (this deployment)</h3>
      <pre className="edu-code">{OAUTH_API_CHEATSHEET}</pre>

      <p style={{ fontSize: '0.85rem', color: '#374151' }}>
        <strong>Agent path:</strong> POST /api/agent/invoke routes to the BFF, which calls runReasonLoop() at demo_agent_service (port 3006). Tool execution is BFF-side:{' '}
        BFF → demo_mcp_gateway (port 3005) → demo_mcp_server (port 8080) → Banking API.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// CibaVsLoginContent — CIBA vs Authorization Code + PKCE comparison
// ---------------------------------------------------------------------------

export function CibaVsLoginContent() {
  return (
    <>
      <h3>CIBA vs Authorization Code + PKCE</h3>
      <p>
        Both are OAuth 2.0 / OIDC flows at PingOne. The key difference is{' '}
        <strong>where the user interaction happens</strong>.
      </p>

      <h3>Authorization Code + PKCE (this app's login)</h3>
      <pre className="edu-code">{`1. Backend-for-Frontend (BFF) generates code_verifier + code_challenge (S256)
2. Browser → GET /as/authorize?response_type=code&code_challenge=...
   ↳ PingOne shows login UI in the BROWSER
3. User enters credentials, MFA if required
4. PingOne → 302 to redirect_uri?code=ABC&state=XYZ
5. Backend-for-Frontend (BFF) validates state, POST /as/token with code + code_verifier
6. Tokens → Backend-for-Frontend (BFF) session; browser gets httpOnly cookie
7. Page loads at /admin or /dashboard`}</pre>
      <p><strong>Key property:</strong> the user <em>must</em> be at a browser to click through the redirect. The page navigates away and back — disruptive in agent/chat contexts.</p>

      <h3>CIBA (backchannel)</h3>
      <pre className="edu-code">{`1. Backend-for-Frontend (BFF) → POST /as/bc-authorize (login_hint, binding_message)
2. PingOne → { auth_req_id, expires_in, interval }
   ↳ PingOne delivers approval OUT-OF-BAND (email or push per your DaVinci config)
3. Backend-for-Frontend (BFF) polls POST /as/token every ~5s
   → authorization_pending until user acts
4. User approves in email inbox OR on registered device
5. Next poll returns tokens; Backend-for-Frontend (BFF) stores them server-side
6. Chat / agent / dashboard continues with no page load`}</pre>
      <p><strong>Key property:</strong> the user does <em>not</em> navigate away. No <code>redirect_uri</code> is needed for the approval step — user stays on the same page or chat the whole time.</p>

      <h3>Side-by-side comparison</h3>
      <pre className="edu-code">{`Feature                  Auth Code + PKCE          CIBA
─────────────────────────────────────────────────────────────────
Browser redirect         YES (to PingOne)           NO
User interaction device  Same browser               Any (email, phone, push)
Suitable for agents      No (needs browser)         Yes (out-of-band)
Suitable for step-up     Disruptive (page reload)   Non-disruptive overlay
redirect_uri required    YES                        NO (for approval step)
PingOne setup            Standard PKCE app          CIBA grant + DaVinci flow
Session established      Immediately on callback    After poll succeeds
binding_message          N/A                        Shown to user on approval
Token location           Backend-for-Frontend (BFF) session (httpOnly)     Backend-for-Frontend (BFF) session (httpOnly)`}</pre>

      <h3>Email vs push — who decides?</h3>
      <p>
        The delivery channel is controlled by your <strong>PingOne / DaVinci flow</strong>, not
        by this app. The Backend-for-Frontend (BFF) sends <code>login_hint</code> and <code>binding_message</code>;
        PingOne decides whether to send an email link or a push notification based on your
        DaVinci configuration and the user's registered authenticators.
      </p>
      <ul>
        <li>
          <strong>Email-only</strong> — approval link in inbox; no push-capable MFA device or
          app required.
        </li>
        <li>
          <strong>Push</strong> — PingOne MFA policy + registered device (PingID, Microsoft
          Authenticator, etc.) required.
        </li>
      </ul>

      <p>
        For sequence diagrams and a live demo, open the floating{' '}
        <strong>CIBA guide</strong> (bottom-right of the screen, "Try It" tab).
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// CibaMcpFlowContent — CIBA in MCP / agent + step-up flows
// ---------------------------------------------------------------------------

export function CibaMcpFlowContent() {
  return (
    <>
      <h3>Why CIBA matters for MCP / AI agents</h3>
      <p>
        When an AI agent needs user tokens to call the Banking API, a browser redirect breaks
        the conversational flow. CIBA is the standard solution: the server initiates the auth
        request directly and the user approves out-of-band while the chat continues.
      </p>

      <h3>MCP agent flow comparison</h3>
      <p><strong>Without CIBA</strong> (no auth configured, current dev default):</p>
      <ul>
        <li>Chat UI → MCP server needs tokens</li>
        <li>Server returns a login URL in chat text</li>
        <li>User must open URL in browser, authenticate, then return to chat</li>
        <li>⚠ Breaks conversational flow — awkward redirect</li>
      </ul>
      <p><strong>With CIBA:</strong></p>
      <ul>
        <li>Chat UI → MCP server needs tokens</li>
        <li>Server sends <code>bc-authorize</code> to PingOne</li>
        <li>PingOne delivers approval out-of-band (email link or push — your DaVinci config)</li>
        <li>User approves — never leaves the chat</li>
        <li>Tokens arrive at server silently; tool call continues</li>
        <li>✅ Fluid, in-context, no redirect needed</li>
      </ul>

      <h3>Step-up auth for high-value transactions</h3>
      <p>
        When a high-risk action requires re-authentication, the Backend-for-Frontend (BFF) triggers step-up by calling{' '}
        <code>POST /api/auth/oauth/user/stepup</code> with <code>acr_values=<strong>STEP_UP_ACR_VALUE</strong></code>{' '}
        (env var, default <code>Multi_factor</code> — must match a PingOne Sign-On Policy name).
        CIBA makes this seamless — no page reload required.
      </p>
      <p><strong>Without CIBA:</strong></p>
      <ul>
        <li>User clicks Transfer $500</li>
        <li>Server redirects browser to PingOne for re-authentication</li>
        <li>User authenticates, PingOne redirects back</li>
        <li>⚠ Page reload — in-progress context lost</li>
      </ul>
      <p><strong>With CIBA:</strong></p>
      <ul>
        <li>User clicks Transfer $500</li>
        <li>UI shows a non-blocking overlay: "Check your email or device"</li>
        <li>PingOne sends approval notification (email or push per your DaVinci setup)</li>
        <li>User approves out-of-band</li>
        <li>Transfer executes immediately on next poll</li>
        <li>✅ No redirect, no page reload, no context loss</li>
      </ul>

      <h3>CIBA + token exchange together</h3>
      <pre className="edu-code">{`Agent needs to call Banking API:

1. Agent → Backend-for-Frontend (BFF): "create_transfer $500"
2. Backend-for-Frontend (BFF) checks session tokens — insufficient scope or step-up needed
3. Backend-for-Frontend (BFF) → POST /as/bc-authorize  (login_hint, binding_message="Approve $500 transfer")
4. Backend-for-Frontend (BFF) polls /as/token every 5s
5. User approves in email / push (out-of-band)
6. Backend-for-Frontend (BFF) receives CIBA tokens (subject=user, scopes updated)
7. Backend-for-Frontend (BFF) → POST /as/token  grant_type=token-exchange (RFC 8693)
       subject_token=<CIBA access token>
       audience=<MCP resource>
       scope=write
8. Backend-for-Frontend (BFF) receives MCP token (MCP-audience)
9. Backend-for-Frontend (BFF) → MCP server tools/call create_transfer with MCP token as Bearer (transaction scope → often called Transaction token for transfers)
10. MCP server → Banking API → confirms transfer
11. Agent receives success; chat continues uninterrupted`}</pre>

      <h3>Sequence diagram: step-up with CIBA + MCP</h3>
      <pre className="edu-code">{`Browser      Backend-for-Frontend (BFF)          PingOne       MCP Server    Banking API
   │            │               │              │              │
   │──POST tx──▶│               │              │              │
   │            │──bc-authorize▶│              │              │
   │            │◀──auth_req_id─│              │              │
   │◀──pending──│               │              │              │
   │            │──poll /token─▶│              │              │
   │            │◀─pending──────│              │              │
   │   [User approves in email/push — out of band]           │
   │            │──poll /token─▶│              │              │
   │            │◀──200 tokens──│              │              │
   │            │──token-exch──▶│              │              │
   │            │◀──MCP token──│              │              │
   │            │──tools/call──────────────────▶│             │
   │            │                              │──GET /tx────▶│
   │            │                              │◀──200─────────│
   │            │◀──tool result────────────────│              │
   │◀──success──│               │              │              │`}</pre>
    </>
  );
}

// ---------------------------------------------------------------------------
// TokenExchangeContent — RFC 8693 token exchange (full HTTP examples)
// ---------------------------------------------------------------------------

export function TokenExchangeContent() {
  return (
    <>
      <div
        style={{
          marginBottom: 14,
          padding: '12px 14px',
          background: '#f0fdf4',
          borderRadius: 8,
          border: '1px solid #86efac',
        }}
      >
        <h4 style={{ margin: '0 0 8px', fontSize: '0.95rem' }}>Implementation in this monorepo</h4>
        <EduImplIntro repoPath="demo_api_server/services/agentMcpTokenService.js">
          Runs when the banking agent calls <code>POST /api/mcp/tool</code> with a session bearer token.
        </EduImplIntro>
        <pre className="edu-code" style={{ marginBottom: 10 }}>{SNIP_RESOLVE_MCP_TOKEN}</pre>
        <EduImplIntro repoPath="demo_api_server/services/oauthService.js">
          Form body for PingOne <code>POST …/as/token</code> (optional <code>actor_token</code> for delegation).
        </EduImplIntro>
        <pre className="edu-code" style={{ marginBottom: 0 }}>{SNIP_TOKEN_EXCHANGE_PINGONE}</pre>
      </div>
      <TokenChainPanel />
      <h3>Token exchange for MCP (RFC 8693)</h3>
      <p>
        This demo keeps OAuth tokens on the <strong>server</strong>. When the MCP layer needs an
        access token with the right <strong>audience</strong> for tools or delegation, the Banking
        Backend-for-Frontend (BFF) calls PingOne's <code>POST …/as/token</code> with{' '}
        <code>grant_type=token-exchange</code>. Below: what happens{' '}
        <em>before</em> and <em>after</em> that call, typical HTTP status codes, and
        success/error JSON shapes.
      </p>

      <h3>Where this runs</h3>
      <p>
        The browser <strong>never</strong> calls PingOne <code>/token</code> for MCP. The Banking
        API server holds the user's OAuth tokens in the session and, when a tool needs an
        MCP-scoped access token, performs RFC 8693 Token Exchange (
        <code>grant_type=urn:ietf:params:oauth:grant-type:token-exchange</code>) against
        PingOne's <code>POST …/as/token</code> endpoint (same host as your issuer).
      </p>

      <h3>Before the exchange — inputs the Backend-for-Frontend (BFF) already has</h3>
      <ul>
        <li>
          <strong>Session cookie</strong> — identifies the signed-in user (admin or customer).
        </li>
        <li>
          <strong>req.session (server)</strong> — <code>access_token</code> /{' '}
          <code>refresh_token</code> / user from the initial OAuth code flow.
        </li>
        <li>
          <strong>Optional "on behalf of" path</strong> — <code>USE_AGENT_ACTOR_FOR_MCP=true</code>{' '}
          and MCP resource URI set → the Backend-for-Frontend (BFF) may use <code>subject_token</code> (user) +{' '}
          <code>actor_token</code> (agent client-credentials token) so PingOne can mint a
          delegated token (JWT may include an <code>act</code> claim per your AS policy).
        </li>
      </ul>

      <h3>The token request (Backend-for-Frontend (BFF) → PingOne, not visible in browser DevTools)</h3>
      <pre className="edu-code">{`POST {issuer}/as/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
client_id=…  &  client_secret=…          (or other client auth per your app)
subject_token=<user access token from session>
subject_token_type=urn:ietf:params:oauth:token-type:access_token
audience=<MCP resource / API audience PingOne expects>
scope=<space-separated scopes for the MCP layer>

# Optional actor path (delegation):
actor_token=<token from agent client credentials>
actor_token_type=urn:ietf:params:oauth:token-type:access_token
# (PingOne policy must allow this exchange.)`}</pre>

      <h3>After a successful exchange — what the Backend-for-Frontend (BFF) receives</h3>
      <pre className="edu-code">{`HTTP/1.1 200 OK
Content-Type: application/json

{
  "access_token": "<JWT or opaque string — MCP/WebSocket uses this as Bearer>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "…",
  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token"
}`}</pre>
      <p>
        The Backend-for-Frontend (BFF) then opens or reuses the WebSocket to <code>demo_mcp_server</code> and sends
        MCP messages that carry this token. Downstream Banking REST calls still use RS
        audience/scopes as configured.
      </p>

      <h3>HTTP status codes</h3>
      <ul>
        <li><strong>200</strong> — body is JSON with <code>access_token</code> (and usually <code>expires_in</code>).</li>
        <li><strong>400</strong> — invalid grant, wrong token type, audience not allowed, malformed request. Body often: <code>{`{"error":"invalid_grant","error_description":"…"}`}</code></li>
        <li><strong>401</strong> — client authentication failed (wrong <code>client_id</code>/secret or auth method).</li>
        <li><strong>403</strong> — policy or consent blocks the exchange.</li>
        <li><strong>502/503</strong> — Backend-for-Frontend (BFF) could not reach PingOne (network/DNS).</li>
      </ul>

      <h3>Backend-for-Frontend (BFF) API responses you may see in the browser</h3>
      <ul>
        <li><code>POST /api/mcp/tool</code> — 200 with MCP tool result JSON; 401 if no session or no usable token; 5xx if MCP server or PingOne is unreachable.</li>
        <li><code>GET /api/mcp/inspector/tools</code> — 200 with tools list; 401 if not authenticated.</li>
        <li><code>POST /api/mcp/inspector/invoke</code> — same pattern as tool calls.</li>
      </ul>

      <h3>Error JSON shape (OAuth-style, from PingOne through Backend-for-Frontend (BFF))</h3>
      <pre className="edu-code">{`{ "error": "invalid_grant" | "invalid_client" | …, "error_description": "human-readable" }`}</pre>

      <h3>Mental model</h3>
      <ol>
        <li>User completes OAuth (authorization code) → session has subject token.</li>
        <li>User invokes MCP tool → Backend-for-Frontend (BFF) may exchange subject token for MCP-audience token (RFC 8693).</li>
        <li>Only after step 2 does the MCP layer see a Bearer suited to the tool/RS chain.</li>
      </ol>
      <p style={{ fontSize: '0.85rem', color: '#374151' }}>
        Open the Config page → "MCP Inspector setup" for env snippets that match your URL.
      </p>

      <h3>Delegation (actor_token path) — "on behalf of"</h3>
      <pre className="edu-code">{`── Delegation request (USE_AGENT_ACTOR_FOR_MCP=true) ──
POST {issuer}/as/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
client_id=<agent-client-id>
client_secret=<agent-client-secret>
subject_token=<user access token>           ← who is acting (human)
subject_token_type=urn:ietf:params:oauth:token-type:access_token
actor_token=<agent client_credentials token> ← who is acting on behalf (agent)
actor_token_type=urn:ietf:params:oauth:token-type:access_token
audience=<MCP resource URI>
scope=read write

── Success — delegated token ──
HTTP/1.1 200 OK
{
  "access_token": "eyJ...",    ← issued for agent acting as user
  "token_type": "Bearer",
  "expires_in": 3600,
  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token"
}
// JWT may contain: { "sub": "<user>", "act": { "sub": "<agent-client-id>" } }

── PingOne policy note ──
  The exchange is only allowed if your PingOne token exchange policy
  permits this client + grant combination. If not configured:
  HTTP/1.1 400 { "error": "invalid_grant", "error_description": "..." }`}</pre>

      <p style={{ fontSize: '0.85rem', color: '#374151' }}>
        <strong>Related:</strong> the <strong>Sign-in &amp; roles</strong> tab in the CIBA Guide
        explains "on behalf of" and <code>/api/agent/identity/bootstrap</code>.{' '}
        <strong>Application Configuration</strong> includes an MCP Inspector setup wizard that
        generates env snippets and commands for your URLs.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// LoginFlowPkceContent — Rich PKCE deep dive with real HTTP examples
// ---------------------------------------------------------------------------

export function LoginFlowPkceContent() {
  return (
    <>
      <h3>Why PKCE? (RFC 7636)</h3>
      <p>
        PKCE (Proof Key for Code Exchange) prevents authorization code interception attacks.
        An attacker who intercepts the authorization code from the redirect cannot exchange it
        without the original <code>code_verifier</code> — which is only known to the server that
        started the flow.
      </p>
      <p>
        PKCE also makes <em>public clients</em> (apps that cannot store a client secret) safe to
        use with the authorization code flow. Even for confidential clients (like this Backend-for-Frontend (BFF)), PKCE
        is required by OAuth 2.1.
      </p>

      <h3>How the verifier/challenge pair works</h3>
      <pre className="edu-code">{`Server generates:
  code_verifier = base64url(random 32 bytes)   e.g. "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW..."
  code_challenge = base64url(SHA-256(code_verifier))

  The verifier is stored server-side (session).
  Only the challenge is sent to PingOne in step 1.
  The verifier is revealed only in step 2 (server-to-server).

Attack scenario:
  Attacker intercepts redirect: ?code=STOLEN&state=...
  Tries to POST /token with code=STOLEN  ← but has NO verifier
  PingOne: SHA256(nothing) ≠ stored challenge → 400 invalid_grant ✓`}</pre>

      <h3>Step 1 — Authorization request (browser redirect)</h3>
      <pre className="edu-code">{`GET /as/authorize
  ?response_type=code
  &client_id=<your-client-id>
  &redirect_uri=https%3A%2F%2Fapp.example.com%2Fapi%2Fauth%2Foauth%2Fcallback
  &scope=openid%20profile%20email%20banking%3Aread
  &state=<random-csrf-token>               ← CSRF protection; echoed back
  &code_challenge=<BASE64URL(SHA256(verifier))>
  &code_challenge_method=S256
  &resource=https%3A%2F%2Fapi.example.com%2F  ← RFC 8707 audience binding (optional)
  HTTP/1.1 302 Found
  Location: https://auth.pingone.com/.../as/authorize?... (PingOne login UI)`}</pre>

      <h3>Step 2 — Authorization callback (PingOne → Backend-for-Frontend (BFF))</h3>
      <pre className="edu-code">{`GET /api/auth/oauth/callback
  ?code=<authorization-code>               ← short-lived, one-use
  &state=<same-random-token-from-step-1>   ← Backend-for-Frontend (BFF) validates: must match session
  &iss=https://auth.pingone.com/...        ← issuer identifier (RFC 9207)

  Backend-for-Frontend (BFF) validation:
    1. state matches → CSRF check passes
    2. code is present
    3. Proceed to token exchange`}</pre>

      <h3>Step 3 — Token request (server-to-server, never in browser)</h3>
      <pre className="edu-code">{`POST /as/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(client_id:client_secret)>

grant_type=authorization_code
&code=<authorization-code>
&redirect_uri=https%3A%2F%2Fapp.example.com%2Fapi%2Fauth%2Foauth%2Fcallback
&code_verifier=<original-code-verifier>    ← PingOne hashes this; must match challenge
&resource=https%3A%2F%2Fapi.example.com%2F  ← RFC 8707 (if used in step 1)

HTTP/1.1 200 OK
Content-Type: application/json

{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email read",
  "id_token": "eyJ...",
  "refresh_token": "...",
  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token"
}`}</pre>

      <h3>Error responses</h3>
      <pre className="edu-code">{`── Bad code_verifier ──
HTTP/1.1 400 Bad Request
{ "error": "invalid_grant", "error_description": "PKCE verification failed" }

── Code already used ──
HTTP/1.1 400 Bad Request
{ "error": "invalid_grant", "error_description": "Authorization code already used" }

── State mismatch (Backend-for-Frontend (BFF)-side check, never reaches PingOne) ──
HTTP/1.1 400 Bad Request (from Backend-for-Frontend (BFF))
{ "error": "invalid_state", "message": "OAuth state mismatch" }

── Client auth failure ──
HTTP/1.1 401 Unauthorized
{ "error": "invalid_client", "error_description": "Client authentication failed" }`}</pre>

      <h3>What PingOne validates</h3>
      <ul>
        <li><code>code</code> — exists, belongs to this client, not expired (usually 60s).</li>
        <li><code>redirect_uri</code> — exactly matches the registered URI (no trailing slash differences).</li>
        <li><code>code_verifier</code> — <code>BASE64URL(SHA256(verifier))</code> must equal the stored challenge.</li>
        <li><code>client_id</code> / client auth — correct credentials.</li>
      </ul>

      <h3>Why the tokens are stored server-side</h3>
      <p>
        After step 3, the Backend-for-Frontend (BFF) stores <code>access_token</code> and <code>refresh_token</code>{' '}
        in the <strong>server session</strong> and issues an <strong>httpOnly cookie</strong> to
        the browser. This means:
      </p>
      <ul>
        <li>XSS in the SPA cannot read the access token from JavaScript.</li>
        <li>The token is never in <code>localStorage</code>, <code>sessionStorage</code>, or any JS variable.</li>
        <li>Subsequent API calls use the session cookie; the Backend-for-Frontend (BFF) attaches the Bearer token server-side.</li>
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
// LoginFlowSecurityContent — security notes: httpOnly, fixation, state, PKCE
// ---------------------------------------------------------------------------

export function LoginFlowSecurityContent() {
  return (
    <>
      <h3>Why the User token never touches the browser</h3>
      <p>
        Access tokens are stored in the Backend-for-Frontend (BFF) session (server memory / Redis / LMDB).
        The browser only holds an <strong>httpOnly, Secure</strong> session cookie. httpOnly
        means JavaScript cannot read it — <code>document.cookie</code> does not include it.
        This defeats a large class of XSS-based token theft.
      </p>
      <pre className="edu-code">{`Set-Cookie: sessionId=abc123; HttpOnly; Secure; SameSite=Lax; Path=/

// JavaScript in the browser:
document.cookie  // → does NOT contain sessionId
fetch('/api/auth/oauth/status', { credentials: 'include' })
  // ↑ cookie is sent automatically by the browser
  // ↓ server reads session, returns user info without exposing token`}</pre>

      <h3>Session fixation defence</h3>
      <p>
        On successful login, the server calls <code>session.regenerate()</code> to issue a new
        session ID. This prevents an attacker from pre-seeding a session ID (e.g. via a link)
        and then waiting for the victim to log in.
      </p>
      <pre className="edu-code">{`// Express session-based pattern:
req.session.regenerate((err) => {
  // new session ID issued — old cookie invalid
  req.session.user = userFromPingOne;
  req.session.access_token = tokens.access_token;
  res.redirect('/admin');
});`}</pre>

      <h3>State parameter (CSRF / mix-up defence)</h3>
      <p>
        A random <code>state</code> value is generated per authorize request, stored in the
        session, and compared on callback. If the returned <code>state</code> does not match,
        the callback is rejected with 400. This prevents:
      </p>
      <ul>
        <li><strong>CSRF</strong> — attacker cannot force your session to link their OAuth code to your account.</li>
        <li><strong>Mix-up attacks</strong> — malicious IDP cannot inject a code from a different provider.</li>
      </ul>
      <pre className="edu-code">{`// Generating state:
const state = crypto.randomBytes(16).toString('hex');
req.session.oauthState = state;

// Validating on callback:
if (req.query.state !== req.session.oauthState) {
  return res.status(400).json({ error: 'invalid_state' });
}
delete req.session.oauthState;`}</pre>

      <h3>PKCE vs implicit flow</h3>
      <pre className="edu-code">{`Implicit flow (deprecated, OAuth 2.1 removed):
  GET /authorize?response_type=token  ← returns access_token in URL fragment
  → Token visible in browser history, referrer headers, server logs
  → No code exchange, no code_verifier
  → Vulnerable to token leakage

Authorization Code + PKCE (current best practice):
  GET /authorize?response_type=code   ← returns short-lived code, not token
  → Token never appears in URL
  → PKCE prevents code interception
  → Code is one-use and expires quickly (typically 60s)`}</pre>

      <h3>Scope minimisation</h3>
      <p>
        Request only the scopes needed for the current flow. The Backend-for-Frontend (BFF) requests{' '}
        <code>openid profile email</code> for login, and adds <code>read</code> or{' '}
        <code>write</code> only when the session requires it. Wider scopes increase
        blast radius if tokens are ever compromised.
      </p>

      <h3>Token lifetime and refresh</h3>
      <pre className="edu-code">{`Access token:  typically 1h (expires_in=3600)
Refresh token: 24h or longer (depends on PingOne policy)

Backend-for-Frontend (BFF) refresh flow:
  access_token expired → Backend-for-Frontend (BFF) calls POST /as/token
    grant_type=refresh_token
    &refresh_token=<stored RT>
    &client_id=...
    &client_secret=...
  → new access_token (+ possibly new refresh_token)
  → silently; browser session cookie unchanged`}</pre>
    </>
  );
}

// ---------------------------------------------------------------------------
// OAuthApiCheatsheet — formatted API endpoint reference
// ---------------------------------------------------------------------------

export function OAuthApiCheatsheet() {
  return (
    <>
      <h3>OAuth / MCP / CIBA API endpoints (this deployment)</h3>
      <pre className="edu-code">{OAUTH_API_CHEATSHEET}</pre>

      <h3>Admin vs customer OAuth routes</h3>
      <pre className="edu-code">{`Admin login:    GET /api/auth/oauth/login
  → uses admin PingOne app (admin redirect URI)
  → after callback: redirect to /admin
  → new users get role=admin in demo store

Customer login: GET /api/auth/oauth/user/login
  → uses end-user PingOne app (customer redirect URI)
  → after callback: redirect to /dashboard
  → new users get role=customer + sample accounts`}</pre>

      <h3>How to read the session status</h3>
      <pre className="edu-code">{`GET /api/auth/oauth/status
Authorization: (session cookie)

200 OK — logged in as admin
{
  "authenticated": true,
  "user": { "id": "...", "email": "...", "role": "admin" },
  "oauthId": "pingone-sub-value",
  "cibaEnabled": true
}

401 Unauthorized — not logged in
{ "authenticated": false }`}</pre>

      <h3>CIBA-specific endpoints</h3>
      <pre className="edu-code">{`POST /api/auth/ciba/initiate
  Body: { login_hint, scope, binding_message, acr_values }
  Response: { auth_req_id, expires_in, login_hint_display }

GET /api/auth/ciba/poll/:authReqId
  Response (pending):  { status: "pending" }
  Response (approved): { status: "approved" }
  Response (denied):   HTTP 400 { status: "denied", message: "..." }
  Response (expired):  HTTP 410 { status: "expired" }

POST /api/auth/ciba/cancel/:authReqId
  → Discards the pending request server-side`}</pre>
    </>
  );
}

// ---------------------------------------------------------------------------
// McpProtocolContent — What MCP is, tool calls, authorization, WebSocket format
// ---------------------------------------------------------------------------

export function McpProtocolContent() {
  return (
    <>
      <h3>What powers the AI assistant?</h3>
      <p>
        The AI assistant in this app doesn&apos;t just generate text — it <strong>connects to the banking system</strong> to fetch
        real data and perform real actions. The technology that makes this possible is called{' '}
        <strong>MCP (Model Context Protocol)</strong>.
      </p>
      <p>
        Think of MCP like a <strong>universal remote control</strong>. Just as one remote can control your TV, sound bar,
        and streaming box using a standard set of buttons, MCP gives any AI assistant a standard way to &quot;press the buttons&quot;
        on any connected service — whether that&apos;s a bank, a calendar, or a database.
      </p>
      <p>
        This means the AI doesn&apos;t need custom code for every banking feature. Instead, the banking system
        publishes a <strong>tool catalog</strong> (a menu of things it can do), and the AI picks from that menu
        when responding to your requests.
      </p>

      <h3>How a tool call works</h3>
      <p>
        When you ask the AI &quot;what&apos;s my balance?&quot; here&apos;s what happens under the hood:
      </p>
      <pre className="edu-code">{`1. You type a question
2. The AI understands you want "get_account_balance"
3. The app sends a secure, signed request to the Banking Service:
     → "call get_account_balance for account acc_001"
4. The Banking Service checks your identity and permissions
5. It returns the result to the AI
6. The AI formats a friendly response for you`}</pre>
      <p>
        The AI never has direct access to your account data. Every single tool call goes through the same
        security checks as if you had clicked a button in the app.
      </p>

      <h3>What tools are available?</h3>
      <p>
        The Banking Service currently provides these AI-callable tools:
      </p>
      <ul>
        <li><strong>Get my accounts</strong> — lists all your accounts</li>
        <li><strong>Check balance</strong> — balance for a specific account</li>
        <li><strong>Recent transactions</strong> — your latest activity</li>
        <li><strong>Transfer funds</strong> — move money between accounts</li>
        <li><strong>Deposit</strong> — add funds to an account</li>
        <li><strong>Withdraw</strong> — take funds from an account</li>
      </ul>

      <h3>How the AI knows what tools exist</h3>
      <p>
        When the AI assistant starts up, it asks the Banking Service: <em>&quot;What can you do?&quot;</em> The service
        responds with a tool catalog — each tool has a name, a description, and the parameters it needs.
        The AI reads this catalog and figures out which tool to call when you make a request.
      </p>
      <pre className="edu-code">{`AI → Banking Service: "What tools do you have?"
Banking Service → AI:
  {
    "tools": [
      { "name": "get_my_accounts", "description": "List all accounts for the authenticated user" },
      { "name": "create_transfer",  "description": "Transfer funds between accounts" },
      ...
    ]
  }`}</pre>

      <h3>Security: every tool call is verified</h3>
      <p>
        The AI cannot just call any tool it wants. Every call is accompanied by a security pass
        (an OAuth access token) that proves: ✅ who you are, ✅ what you&apos;re allowed to do,
        and ✅ that the AI is acting on your behalf. The Banking Service checks this pass before
        executing anything.
      </p>
    </>
  );
}
// ---------------------------------------------------------------------------
// IntrospectionContent — RFC 7662 introspection (why, request, response)
// ---------------------------------------------------------------------------

export function IntrospectionContent() {
  return (
    <>
      <h3>What is token introspection? (RFC 7662)</h3>
      <p>
        Token introspection is a server-to-server call where a resource server or MCP server
        asks the authorization server: <em>"Is this token active, and what are its claims?"</em>{' '}
        PingOne returns <code>active: true/false</code> and the token's claim set.
      </p>
      <p>
        Unlike JWKS-based local validation, introspection always reflects the current state
        at the AS — including revoked tokens, updated scopes, or <code>act</code> claims that
        may not be in the token's JWT body.
      </p>

      <h3>POST /as/introspect — request</h3>
      <pre className="edu-code">{`POST {issuer}/as/introspect
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(client_id:client_secret)>

token=<access-token-to-check>
&token_type_hint=access_token`}</pre>

      <h3>Response — active token</h3>
      <pre className="edu-code">{`HTTP/1.1 200 OK
Content-Type: application/json

{
  "active": true,
  "sub": "user-pingone-id",
  "aud": "https://api.example.com/",      ← resource server audience
  "iss": "https://auth.pingone.com/.../as",
  "client_id": "banking-bff-client-id",
  "scope": "openid read",
  "exp": 1712345678,
  "iat": 1712342078,
  "jti": "unique-token-id",
  "act": {                                 ← delegation claim (if token exchange used)
    "sub": "agent-client-id"
  }
}`}</pre>

      <h3>Response — inactive / revoked / expired token</h3>
      <pre className="edu-code">{`HTTP/1.1 200 OK
Content-Type: application/json

{
  "active": false
}
// No other claims are returned for inactive tokens.
// Treat this as: reject the request with 401.`}</pre>

      <h3>Error responses</h3>
      <pre className="edu-code">{`── Bad client credentials ──
HTTP/1.1 401 Unauthorized
{ "error": "invalid_client", "error_description": "Client authentication failed" }

── Malformed request ──
HTTP/1.1 400 Bad Request
{ "error": "invalid_request", "error_description": "Missing token parameter" }`}</pre>

      <h3>Introspection vs JWKS local validation</h3>
      <pre className="edu-code">{`Feature                  Introspection (RFC 7662)   JWKS local (JWT signature)
─────────────────────────────────────────────────────────────────────────────
Network call per request YES                        NO (cache public keys)
Reflects revocation      YES (always current)       NO (only until exp)
Works with opaque tokens YES                        NO (needs JWT structure)
act / delegation claims  YES (AS adds them)         Only if in JWT body
Latency                  ~50-200ms round trip       <1ms (local verify)
Best for                 MCP / proxy validation,    High-throughput RS,
                         opaque tokens, act claims  JWT access tokens

In this demo:
  Introspection — user access token at login + every MCP tool call
  JWKS verify   — agent CC tokens + all exchanged/delegated tokens`}</pre>

      <h3>When to use introspection</h3>
      <ul>
        <li>The token is <strong>opaque</strong> (not a JWT) — you cannot decode it locally.</li>
        <li>You need <strong>delegation claims</strong> (<code>act</code>) that may not be in the JWT body.</li>
        <li>You need to check <strong>revocation in real time</strong> (e.g. after a user's session is terminated).</li>
        <li>The resource server does not want to cache JWKS or manage key rotation.</li>
      </ul>

      <h3>Where introspection fits in this demo</h3>
      <p>
        Introspection is used in two places in the token chain:
      </p>
      <ul>
        <li>
          <strong>At login</strong> — the BFF calls PingOne's RFC 7662 endpoint immediately after the
          OAuth callback to confirm the user's access token is active. The result appears as
          {' '}<code>user-token-introspection</code> in the Token Chain panel and shows the live{' '}
          <code>sub</code>, <code>scope</code>, <code>exp</code>, and <code>aud</code> from PingOne.
        </li>
        <li>
          <strong>At every MCP tool call</strong> — demo_mcp_gateway (port 3005) performs RFC 7662
          introspection (Step 1 of its inline authorization pipeline) before forwarding the call.
          The BFF performs the RFC 8693 exchange to produce the bearer token; the gateway then
          introspects that token against PingOne before executing the tool.
        </li>
      </ul>
      <p>
        All other tokens in the chain (agent CC token, exchanged MCP token — and, when the optional
        two-exchange path is enabled, intermediate actor tokens) use <strong>RFC 7515 JWKS</strong>{' '}
        cryptographic signature verification instead — faster because no network round-trip is needed,
        and appropriate because these tokens were just issued by PingOne moments ago and cannot have
        been revoked in that window.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// AgentGatewayContent — Agent gateway pattern, RFC 8707, RFC 9728
// ---------------------------------------------------------------------------

export function AgentGatewayContent() {
  return (
    <>
      <h3>Agent Gateway pattern</h3>
      <p>
        An <strong>Agent Gateway</strong> is a security boundary between the LLM / agent and
        resource servers. It enforces OAuth token validation, scope checks, and token exchange
        so individual tools stay thin and security policy is centralised. This matches the{' '}
        <strong>Agent Gateway demo architecture.vsdx</strong> reference design in this repo.
      </p>

      <h3>Full architecture (swimlanes)</h3>
      <pre className="edu-code">{`
  Web Browser SPA
       │ HTTPS (session cookie only — no OAuth tokens in JS)
       ▼
┌──────────────────────────────────────────────────────────────┐
│ BFF (demo_api_server :3001) — security strip                  │
│  OAuth 2.1 · RFC 8707 · RFC 9728 · RFC 8693 · RFC 7523       │
│  POST /api/agent/invoke → runReasonLoop() → demo_agent_service│
│  Single RFC 8693 exchange per tool call (mcpToolPipeline.js)  │
└────────────────────────┬─────────────────────────────────────┘
                         │ callToolViaGateway
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ demo_mcp_gateway (:3005) — inline per-tool security pipeline  │
│  Step 1: RFC 7662 introspection vs PingOne AS (:9001, 5s cache│
│  Step 2: GatewayTokenPolicy.validate (scope, audience)        │
│  Step 3: PingOneAuthorizeClient.evaluate                      │
│    PERMIT       → forward original bearer token unchanged     │
│    DENY         → HTTP 403 { error: 'insufficient_scope' }    │
│    INDETERMINATE → HTTP 403 { error: 'hitl_required' }        │
│                    or JSON-RPC -32002 (WebSocket)             │
└────────────────────────┬─────────────────────────────────────┘
                         │ Bearer (original token, forwarded unchanged)
          ┌──────────────┴──────────────────┐
          ▼                                 ▼
┌──────────────────┐          ┌─────────────────────────────────┐
│ IDP / AS         │          │ demo_mcp_server (:8080)         │
│ PingOne (:9001)  │          │ tools/list  ·  tools/call       │
│ /authorize       │          │ Validates Bearer (aud = MCP RS) │
│ /token           │          └─────────────────┬───────────────┘
│ /introspect      │                            │ Bearer (aud = Banking RS)
│ JWKS             │                            ▼
└──────────────────┘          ┌─────────────────────────────────┐
                              │ Resource Server — Banking API   │
                              │ Validates aud, scope, signature │
                              └─────────────────────────────────┘
`}</pre>

      <h3>Ingress — validating every inbound tool call</h3>
      <p>
        Every tool call enters the gateway. The demo_mcp_gateway pipeline:
      </p>
      <pre className="edu-code">{`1. RFC 7662 token introspection against PingOne AS (:9001)
   — fail-closed, 5 second cache in production
2. GatewayTokenPolicy.validate — scope and audience check
3. PingOneAuthorizeClient.evaluate → PERMIT / DENY / INDETERMINATE
   PERMIT       → forward original bearer token unchanged to upstream MCP server
   DENY         → HTTP 403 { "error": "insufficient_scope", "decision": "DENY" }
   INDETERMINATE → HTTP 403 { "error": "hitl_required", "hitl": true, "challengeId": "…" }
                   or JSON-RPC error -32002 (WebSocket path)`}</pre>

      <h3>Egress — forwarding to the MCP server</h3>
      <p>
        The BFF (demo_api_server) performs the single canonical RFC 8693 exchange per tool call
        before the request reaches the gateway. On PERMIT, the gateway forwards the
        already-exchanged bearer token to the upstream MCP server unchanged — the gateway does
        not perform a second RFC 8693 exchange.
      </p>
      <pre className="edu-code">{`// BFF performs single RFC 8693 exchange (mcpToolPipeline.js)
POST {issuer}/as/token
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<user-access-token>
actor_token=<agent-cc-token>                ← USE_AGENT_ACTOR_FOR_MCP=true
audience=<PINGONE_RESOURCE_MCP_GATEWAY_URI> ← RFC 8707 resource
← 200 { "access_token": "<exchanged-token>", ... }

// BFF then routes through demo_mcp_gateway (:3005)
// On PERMIT, gateway forwards the exchanged token unchanged
HTTP POST demo_mcp_gateway:3005/mcp
  Authorization: Bearer <exchanged-token>
  tools/call { ... }`}</pre>

      <h3>RFC 8707 — resource indicators</h3>
      <p>
        The <code>resource</code> parameter in <code>/authorize</code> and <code>/token</code>{' '}
        requests binds the issued access token's <code>aud</code> claim to a specific resource
        server URL. This prevents tokens from being replayed against unrelated APIs.
      </p>
      <pre className="edu-code">{`Without RFC 8707:
  Token issued with aud="client-id" or generic audience
  → Could be sent to ANY API that trusts this AS
  → Confused deputy risk

With RFC 8707:
  Phase 1: GET /authorize?...&resource=https://mcp.example.com/
  Phase 2: POST /token        ...&resource=https://mcp.example.com/
  Token:   { "aud": "https://mcp.example.com/" }
  → MCP server accepts; Banking API rejects (wrong aud) ✓
  → Token is bound to its intended audience at issuance`}</pre>

      <h3>RFC 9728 — OAuth 2.0 for MCP (AS metadata discovery)</h3>
      <p>
        MCP clients use RFC 9728 to discover the authorization server that protects an MCP
        server without prior configuration.
      </p>
      <pre className="edu-code">{`Step 1 — Client probes MCP server for AS metadata:
  GET {mcp-server}/.well-known/oauth-authorization-server
  ← {
      "issuer": "https://auth.pingone.com/.../as",
      "authorization_endpoint": ".../as/authorize",
      "token_endpoint": ".../as/token",
      "introspection_endpoint": ".../as/introspect",
      "response_types_supported": ["code"],
      "grant_types_supported": ["authorization_code", "token-exchange"],
      "code_challenge_methods_supported": ["S256"],
      "resource": "https://mcp.example.com/"   ← RFC 8707 resource URI
    }

Step 2 — Client performs PKCE or token exchange using discovered endpoints
Step 3 — Client connects with Bearer whose aud = discovered resource

MCP spec reference:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization`}</pre>

      <h3>Security strip — defence in depth</h3>
      <p>
        The "security strip" in the swimlane diagram represents the set of RFC-enforced checks
        that every request passes through before reaching business logic:
      </p>
      <ul>
        <li><strong>OAuth 2.1</strong> — no implicit flow, PKCE required, no fragment tokens.</li>
        <li><strong>RFC 8707</strong> — audience binding prevents token reuse across APIs.</li>
        <li><strong>RFC 9728</strong> — standardised AS discovery; no hardcoded endpoints.</li>
        <li><strong>RFC 8693</strong> — safe token narrowing for downstream calls.</li>
        <li><strong>RFC 7523</strong> — JWT client authentication (vs shared secret) for machine-to-machine.</li>
        <li><strong>RFC 9449 DPoP</strong> (best practice) — sender-constrained tokens; stolen Bearer unusable.</li>
      </ul>

      <p style={{ fontSize: '0.85rem', color: '#374151' }}>
        See the <strong>Full stack</strong> tab in the CIBA Guide for how this demo maps
        these RFCs to PingOne, the Banking Backend-for-Frontend (BFF), and <code>demo_mcp_server</code>.
      </p>
    </>
  );
}

// ── RFC9728Content ─────────────────────────────────────────────────────────────
export function RFC9728Content() {
  const [metadata, setMetadata]     = React.useState(null);
  const [fetchError, setFetchError] = React.useState(null);

  React.useEffect(() => {
    fetch('/api/rfc9728/metadata')
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then(setMetadata)
      .catch((e) => setFetchError(e.message));
  }, []);

  return (
    <>
      <h3>What is RFC 9728?</h3>
      <p>
        <strong>RFC 9728 — OAuth 2.0 Protected Resource Metadata</strong> (published April 2025,
        IETF Standards Track) defines a discovery document that a resource server publishes at a
        well-known URL so OAuth clients and authorization servers can find out:
      </p>
      <ul>
        <li>Which <strong>authorization server(s)</strong> the RS accepts tokens from</li>
        <li>Which <strong>scopes</strong> the RS is willing to disclose</li>
        <li>Which <strong>bearer token methods</strong> the RS supports (header, body, query)</li>
        <li>
          Human-readable metadata such as <code>resource_name</code> and{' '}
          <code>resource_documentation</code>
        </li>
      </ul>

      <h3>Well-known URL</h3>
      <pre className="edu-code">{`GET /.well-known/oauth-protected-resource HTTP/1.1\nHost: api.your-domain.com`}</pre>
      <p>
        The URL is deterministically derived from the resource identifier by inserting{' '}
        <code>/.well-known/oauth-protected-resource</code> between the host and path. This makes
        the endpoint discoverable without any out-of-band configuration.
      </p>

      <h3>Why it matters for AI agents and MCP</h3>
      <p>
        The MCP specification references RFC 9728 for resource server discovery. An AI agent or
        MCP client that encounters a{' '}
        <code>{'401 WWW-Authenticate: Bearer resource_metadata=\u2026'}</code>{' '}
        response can fetch the metadata URL, discover which authorization server to use, and
        bootstrap the OAuth flow without hard-coded configuration. This is critical for
        agentic workflows where the agent may encounter resource servers it has never seen before.
      </p>

      <h3>Response shape (RFC 9728 §3.2)</h3>
      <pre className="edu-code">{`{\n  "resource":                 REQUIRED  -- this RS's canonical URL\n  "authorization_servers":    OPTIONAL  -- [PingOne issuer URI, ...]\n  "scopes_supported":         RECOMMENDED -- ["read", ...]\n  "bearer_methods_supported": OPTIONAL  -- ["header"]\n  "resource_name":            OPTIONAL  -- human-readable display name\n}`}</pre>

      <h3>Security: resource identifier validation (RFC 9728 §3.3)</h3>
      <p>
        Clients MUST check that the <code>resource</code> value in the response exactly matches the
        URL they queried. This prevents impersonation: an attacker cannot publish a fraudulent
        metadata document for a legitimate RS, because the <code>resource</code> field would reveal
        the mismatch.
      </p>

      <h3>Live metadata from this BFF</h3>
      {metadata ? (
        <>
          <p>Fetched from <code>/api/rfc9728/metadata</code>:</p>
          <pre className="edu-code">{JSON.stringify(metadata, null, 2)}</pre>
        </>
      ) : fetchError ? (
        <p style={{ color: '#b91c1c', fontSize: '0.875rem' }}>
          Could not load live metadata: {fetchError}. Is the BFF running?
        </p>
      ) : (
        <p style={{ fontSize: '0.875rem', color: '#374151' }}>Loading live metadata\u2026</p>
      )}
    </>
  );
}
