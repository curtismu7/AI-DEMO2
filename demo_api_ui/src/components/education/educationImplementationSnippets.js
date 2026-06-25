// banking_api_ui/src/components/education/educationImplementationSnippets.js
/** Short intros above implementation snippets in Learn drawers. */
import React from 'react';

export function EduImplIntro({ repoPath, mock, children }) {
  return (
    <p style={{ fontSize: '0.82rem', color: '#475569', marginTop: 0, marginBottom: '0.65rem', lineHeight: 1.55 }}>
      {mock ? (
        <>
          <strong style={{ color: '#b45309' }}>Illustrative</strong>
          {' — '}
          {children}
        </>
      ) : (
        <>
          <strong style={{ color: '#166534' }}>This repo</strong>
          {repoPath ? (
            <>
              {': '}
              <code style={{ fontSize: '0.85em', wordBreak: 'break-all' }}>{repoPath}</code>
            </>
          ) : null}
          {children ? <> {children}</> : null}
        </>
      )}
    </p>
  );
}

// ─── Snippets (trimmed for teaching; not full files) ─────────────────────────

export const SNIP_USER_LOGIN_EXCHANGE = `// oauthUserService.js — redeem auth code + PKCE (BFF only)
const params = new URLSearchParams({
  grant_type: 'authorization_code',
  code: String(code),
  redirect_uri: redirectUri,
  client_id: this.config.clientId,
  code_verifier: codeVerifier,  // PKCE — proves same client started the flow
});
const response = await axios.post(this.config.tokenEndpoint, params.toString(), {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});
// → access_token stored in req.session (httpOnly cookie to browser)`;

export const SNIP_TOKEN_EXCHANGE_PINGONE = `// oauthService.js — RFC 8693 body to PingOne /as/token
const body = new URLSearchParams({
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
  subject_token: subjectToken,
  subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  actor_token: actorToken,  // optional: agent client-credentials token
  actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  audience: audience,
  scope: scopeStr,
  client_id: this.config.clientId,
  client_secret: this.config.clientSecret,
});
const response = await axios.post(this.config.tokenEndpoint, body.toString(), { ... });
if (!response.data.access_token) throw new Error('Token exchange response missing access_token');`;

export const SNIP_RESOLVE_MCP_TOKEN = `// agentMcpTokenService.js — before each MCP tool (simplified)
async function resolveMcpAccessTokenWithEvents(req, tool) {
  const userToken = getSessionBearerForMcp(req);  // from session, not browser
  if (!userToken) return { token: null, tokenEvents: [], userSub: null };
  // …may_act checks, scope narrowing, then:
  const mcpToken = useActor
    ? await oauthService.performTokenExchangeWithActor(userToken, actorToken, mcpUri, toolScopes)
    : await oauthService.performTokenExchange(userToken, mcpUri, toolScopes);
  return { token: mcpToken, tokenEvents, userSub };
}`;

export const SNIP_MAY_ACT_SANITIZE = `// agentMcpTokenService.js — claims shown in Token Chain (no raw JWT)
function sanitizeClaims(claims) {
  const result = {};
  if (claims.sub) result.sub = claims.sub;
  if (claims.scope) result.scope = claims.scope;
  if (claims.may_act) result.may_act = claims.may_act;
  if (claims.act) result.act = claims.act;
  // …aud, exp, etc.
  return result;
}
// Optional demo: ff_inject_may_act patches claims in memory only before exchange.`;

export const SNIP_INTROSPECT = `// middleware/tokenIntrospection.js — RFC 7662 to PingOne
const response = await axios.post(introspectionEndpoint,
  new URLSearchParams({ token, token_type_hint: 'access_token' }),
  {
    auth: { username: clientId, password: clientSecret },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 5000,
  },
);
// server.js (MCP path): if (!introspectionResult.active) return res.status(401)...`;

export const SNIP_MCP_BROWSER = `// bankingAgentService.js — browser calls BFF only
const response = await fetch('/api/mcp/tool', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tool, params, flowTraceId }),
});
const data = await response.json();
// data.result, data.tokenEvents — OAuth tokens never in this JSON`;

export const SNIP_MCP_BFF = `// server.js — after token + optional Authorize + introspection
const result = await mcpCallTool(tool, params || {}, agentToken, userSub, req.correlationId);
return res.json({ result, tokenEvents, mcpAuthorizeEvaluation? });`;

export const SNIP_AUTHORIZE_GATE = `// mcpToolAuthorizationService.js — first MCP tool per session (flag-gated)
async function evaluateMcpFirstToolGate({ req, tool, agentToken, userSub, userAcr }) {
  if (!ffAuthorizeMcpFirstTool) return { ran: false };
  if (req.session?.mcpFirstToolAuthorizeDone) return { ran: false };
  // …simulated or PingOne decision API → permit | block | step-up
}`;

export const SNIP_CIBA_INITIATE = `// routes/ciba.js
router.post('/initiate', authenticateToken, async (req, res) => {
  const loginHint = req.body.login_hint || req.user?.email;
  // …cibaService → PingOne bc-authorize
  res.json({ auth_req_id, expires_in, interval });
});
// Browser polls GET /api/auth/ciba/poll/:authReqId until approved → session tokens updated`;

export const SNIP_HITL_CONSENT = `// Phase 2: Unified HITL response shape
return {
  error: 'hitl_required',
  hitl: { type: 'consent' },
  hitl_threshold_usd: 250,
};
// After user approves consent modal, BankingAgent retries with consentChallengeId on REST or MCP path.`;

export const SNIP_CIMD_WELL_KNOWN = `// routes/clientRegistration.js — hosted CIMD document
function wellKnownHandler(req, res) {
  const doc = cimdStore.get(req.params.clientId);
  if (!doc) return res.status(404).json({ error: 'client_not_found' });
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.json(doc);
}
// Mounted in server.js: GET /.well-known/oauth-client/:clientId`;

export const SNIP_PAR_MOCK = `// Example only — this demo’s login uses Authorization Code + PKCE without PAR.
POST https://auth.pingone.com/{env}/as/par
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded

response_type=code&client_id=...&code_challenge=...&code_challenge_method=S256&state=...
→ 201 { "request_uri": "urn:ietf:params:oauth:request_uri:...", "expires_in": 90 }

GET /as/authorize?client_id=...&request_uri=...  // browser sees only the reference`;

export const SNIP_RAR_MOCK = `// Example only — Super Banking does not send authorization_details today.
{
  "authorization_details": [
    { "type": "payment_initiation", "instructedAmount": { "currency": "USD", "amount": "250.00" } }
  ]
}
// Would travel on /authorize or PAR body when your AS supports RFC 9396.`;

export const SNIP_JWT_CLIENT_AUTH_MOCK = `// Example only — this BFF uses client_secret on token endpoints.
POST /as/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=...
&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
&client_assertion=eyJhbGciOi...  // signed JWT: iss/sub = client_id, aud = token endpoint`;

export const SNIP_STEP_UP_MOCK = `// Pattern: transaction routes read config (e.g. step_up_method, thresholds).
// When PingOne Authorize returns step-up, BFF responds 428; UI may call CIBA initiate
// with acr_values matching your PingOne policy name (e.g. Multi_factor).`;

export const SNIP_AGENT_GATEWAY = `// mcpWebSocketClient.js — per-tool scopes for narrowed exchange
const MCP_TOOL_SCOPES = {
  get_my_accounts: ['accounts:read', 'read'],
  create_transfer: ['transactions:write', 'write'],
  // …
};
// mcp_resource_uri (config) = MCP audience for RFC 8693; aligns with RFC 8707 resource binding.`;

export const SNIP_RFC_INDEX = `// This drawer is an index only — it opens other Learn panels via EducationUIContext.
// No separate “RFC engine” in code; each linked area (login, MCP, exchange, …) owns its logic.`;
