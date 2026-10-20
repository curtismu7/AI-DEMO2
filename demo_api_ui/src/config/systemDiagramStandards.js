// /architecture/system: for each arrow of architecture.mmd, the request form on the wire, the MOCK tokens in play,
// and the standards behind the step (published RFCs and specs, plus emerging work that could support it).
// Emerging items are drafts: names and status change, verify before quoting. Only items known to exist are listed;
// a hop with no governing standard carries a stated reason instead of a guess.
const RFC = (id, title) => ({ id: `RFC ${id}`, title, kind: 'rfc' });
const SPEC = (id, title) => ({ id, title, kind: 'spec' });
const DRAFT = (id, title) => ({ id, title, kind: 'emerging' });

const HTTP = [RFC(9110, 'HTTP semantics'), RFC(8446, 'TLS 1.3')];
const SESSION = [...HTTP, RFC(6265, 'HTTP cookies (session cookie)')];
const AUTH = [
  RFC(6749, 'OAuth 2.0 Authorization Framework'), RFC(7636, 'PKCE'), RFC(9700, 'OAuth 2.0 Security BCP'),
  SPEC('OIDC Core 1.0', 'OpenID Connect sign-in'), RFC(9126, 'Pushed Authorization Requests (PAR)'),
  DRAFT('OAuth 2.1', 'draft-ietf-oauth-v2-1 consolidates PKCE and drops the implicit flow'),
];
const CREDS = [
  RFC(6749, 'Client credentials grant (section 4.4)'), RFC(7523, 'JWT client authentication'), RFC(8705, 'mTLS client authentication'),
  DRAFT('draft-ietf-wimse-arch', 'WIMSE: workload identity in multi-system environments'),
];
const BEARER = [RFC(6750, 'Bearer token usage'), RFC(9068, 'JWT profile for access tokens'), RFC(9449, 'DPoP: sender-constrained tokens')];
const EXCHANGE = [
  RFC(8693, 'Token Exchange (subject_token, actor_token, act claim)'), RFC(8707, 'Resource Indicators'),
  DRAFT('draft-ietf-oauth-transaction-tokens', 'Transaction Tokens: short-lived tokens carrying call context'),
  DRAFT('draft-ietf-oauth-identity-chaining', 'Identity chaining across trust domains'),
  DRAFT('draft-ietf-oauth-identity-assertion-authz-grant', 'ID-JAG: enterprise-managed cross-app access'),
];
const INTROSPECT = [RFC(7662, 'Token Introspection'), RFC(9701, 'JWT response for token introspection'), RFC(7519, 'JSON Web Token')];
const JWT_CHECK = [RFC(7519, 'JSON Web Token'), RFC(7517, 'JSON Web Key (JWKS)'), RFC(9068, 'JWT profile for access tokens')];
const DISCOVERY = [RFC(8414, 'Authorization Server Metadata'), SPEC('OIDC Discovery 1.0', 'OpenID Provider configuration')];
const REGISTER = [RFC(7591, 'Dynamic Client Registration'), DRAFT('draft-ietf-oauth-client-id-metadata-document', 'Client ID Metadata Documents (no pre-registration)')];
// AuthZEN is the one published-direction standard for a PEP asking a PDP; PingOne Authorize itself uses its own decision API.
const AUTHZ = [DRAFT('OpenID AuthZEN Authorization API', 'Standard PEP to PDP request/response (check current status)')];
const AUTHZ_CHAIN = [...AUTHZ, RFC(8693, 'act claim: the delegation chain the PDP is asked to approve')];
const STEPUP = [SPEC('OpenID CIBA Core 1.0', 'Out-of-band user approval'), RFC(9470, 'Step-up authentication challenge')];
const MCP = [
  SPEC('MCP authorization 2025-11-25', 'Model Context Protocol authorization'), SPEC('JSON-RPC 2.0', 'MCP message format'),
  RFC(9728, 'Protected Resource Metadata'), RFC(8707, 'Resource Indicators'), RFC(6750, 'Bearer token usage'),
];
// WebSocket is not a standard MCP transport (MCP defines stdio and Streamable HTTP), so MCP authorization is not cited here.
const SOCKET = [RFC(6455, 'The WebSocket Protocol'), SPEC('JSON-RPC 2.0', 'Message format carried in the frames')];
const SOCKET_EXCHANGE = [...SOCKET, RFC(8693, 'Token Exchange: how the bearer was obtained')];
const WS_CHAT = [RFC(6455, 'The WebSocket Protocol'), ...HTTP.slice(1)];
const A2A = [SPEC('A2A protocol', 'Agent2Agent: JSON-RPC over HTTP, Agent Card discovery'), SPEC('JSON-RPC 2.0', 'A2A message format')];
const A2A_NESTED = [...A2A, RFC(8693, 'Nested act claims record the delegation chain')];
const SSE = [SPEC('WHATWG Server-Sent Events', 'HTML Living Standard: event streams'), RFC(9110, 'HTTP semantics')];

// ---- MOCK tokens (decoded claims, teaching values only; never real secrets) ----
const ISS = 'https://auth.pingone.com/bxf-env/as';
const HUMAN = {
  note: 'Human access token issued by PingOne',
  header: { alg: 'RS256', kid: 'pingone-signing-key-1', typ: 'at+jwt' },
  claims: { iss: ISS, sub: 'user1', aud: ['https://bff.bxf.com'], scope: 'openid profile banking:read', acr: 'urn:ping:acr:pwd', exp: 1788030829 },
};
const EXCHANGED = {
  note: 'Exchanged token (RFC 8693) presented to the gateway',
  claims: { iss: ISS, sub: 'user1', aud: ['https://mcp.bxf.com'], scope: 'mcp:balance:read', act: { sub: 'agent1' }, exp: 1788030829 },
};
const NESTED = {
  note: 'Nested delegation token: the specialist acts for the orchestrator, which acts for the generalist',
  claims: { iss: ISS, sub: 'user1', aud: ['https://mcp.bxf.com'], scope: 'mcp:invest:read', act: { sub: 'specialist-agent', act: { sub: 'a2a-orchestrator' } }, exp: 1788030829 },
};
const AGENT = {
  note: 'Agent token from client credentials',
  claims: { iss: ISS, sub: 'agent1', client_id: 'agent1', aud: ['agentgateway.bxf.com'], scope: 'agent:invoke', exp: 1788030829 },
};
const WORKER = {
  note: 'Worker token used to call the policy decision point (PingOne worker apps get access from assigned roles, so no scope claim is shown)',
  claims: { iss: ISS, sub: 'authorize-worker', client_id: 'authorize-worker', aud: ['https://api.pingone.com'], exp: 1788030829 },
};
const INTROSPECTION = {
  note: 'Introspection response (RFC 7662)',
  claims: { active: true, iss: ISS, sub: 'user1', client_id: 'bxf-bff', scope: 'banking:read', token_type: 'Bearer', exp: 1788030829 },
};
const ID_TOKEN = {
  note: 'ID token forwarded with the access token (dual-token path)',
  header: { alg: 'RS256', kid: 'pingone-signing-key-1', typ: 'JWT' },
  claims: { iss: ISS, sub: 'user1', aud: ['bxf-bff'], nonce: '<nonce>', auth_time: 1788027229, exp: 1788030829 },
};

const PINGONE = 'OIDC_AS';
const GATEWAYS = ['GwProxy', 'PingGW'];
const MCP_SERVERS = ['MCPProtocol', 'MCPInvestSvc', 'WeatherMcp'];

const NO_STD_INTERNAL = 'Internal wiring inside one service (a function or module call): no external standard governs this hop.';
const NO_STD_PROPRIETARY = (what) => `${what}: proprietary or vendor API, no published standard defines it.`;

const HTTP_MCP_FORM = 'POST /mcp\n  Authorization: Bearer <exchanged token>\n  { "jsonrpc": "2.0", "method": "tools/call", "params": { "name": "get_account_balance" } }';
const WS_FORM = 'WebSocket upgrade (GET, Upgrade: websocket)\n  Authorization: Bearer <exchanged token>\nthen one JSON-RPC 2.0 frame per message:\n  { "jsonrpc": "2.0", "method": "tools/call", "params": { "name": "get_account_balance" } }';
const A2A_FORM = 'POST <endpoint from the Agent Card>\n  Authorization: Bearer <token>\n  { "jsonrpc": "2.0", "method": "message/send", "params": { "message": { "role": "user", "parts": [{ "kind": "text", "text": "Review my portfolio" }] } } }';
const PDP_FORM = 'POST /v1/environments/{envId}/decisionEndpoints/{endpointId}\n  Authorization: Bearer <worker token>\n  { "parameters": { "UserId": "user1", "ToolName": "get_account_balance", "McpResourceUri": "https://mcp.bxf.com", "TokenAudience": "https://mcp.bxf.com", "ActClientId": "agent1" } }';
const TX_DECISION = 'POST /v1/environments/{envId}/decisionEndpoints/{endpointId}\n  Authorization: Bearer <worker token>\n  { "parameters": { "UserId": "user1", "TransactionType": "transfer", "Amount": 5000, "Acr": "urn:ping:acr:pwd" } }';

// Ordered rules, first match wins. from/to are node ids (or group ids) in architecture.mmd.
const RULES = [
  { from: ['AdminBrowser', 'CustomerBrowser'], refs: HTTP, form: 'GET / HTTP/1.1\n  Host: app.bxf.com\n  (over TLS 1.3)' },
  { from: ['Login'], to: [PINGONE], refs: AUTH, form: 'GET /as/authorize?response_type=code\n  &client_id=bxf-ui&redirect_uri=https://app.bxf.com/callback\n  &scope=openid profile banking:read\n  &code_challenge=<S256 hash>&code_challenge_method=S256&state=<nonce>' },
  { from: ['AuthRoutes'], to: [PINGONE], refs: AUTH, tokens: [HUMAN], form: 'POST /as/token\n  grant_type=authorization_code&code=<one-time code>\n  &redirect_uri=https://app.bxf.com/callback&code_verifier=<PKCE secret>' },
  // PingOne rejects a binding_message over 8 characters, so the demo shows a short match code, not the amount.
  { from: ['CibaRoutes'], to: [PINGONE], refs: STEPUP, form: 'POST /as/bc-authorize\n  login_hint=user1&scope=openid&acr_values=urn:ping:acr:mfa\n  &binding_message=A7F3C2D1' },
  { from: ['McpInspectorRoutes'], to: [PINGONE], refs: EXCHANGE, tokens: [EXCHANGED], form: 'POST /as/token\n  grant_type=urn:ietf:params:oauth:grant-type:token-exchange\n  &subject_token=<user token>&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n  &audience=https://mcp.bxf.com' },
  { from: ['AgentTokenSvc'], to: [PINGONE], refs: CREDS, tokens: [AGENT], form: 'POST /as/token\n  grant_type=client_credentials&client_id=agent1\n  &client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer\n  &client_assertion=<signed JWT>&scope=agent:invoke' },
  { from: ['OAuthMonitor'], to: [PINGONE], refs: DISCOVERY, form: 'GET /as/.well-known/openid-configuration' },
  { from: ['IntrospectionHealth', 'AuthMW'], to: [PINGONE], refs: INTROSPECT, tokens: [INTROSPECTION], form: 'POST /as/introspect\n  token=<access token>&token_type_hint=access_token' },
  { from: ['MCPAuth'], to: ['AuthMW'], refs: INTROSPECT },
  { from: ['AuthMW', 'BankingRS'], to: ['JWKS'], refs: JWT_CHECK, form: 'GET /as/jwks' },
  { from: ['AuthRoutes'], to: ['AppRegistration'], refs: REGISTER },
  { from: ['AdminRoutes'], to: ['UserMgmt'], reason: NO_STD_PROPRIETARY('PingOne User Management API') },
  { from: ['AuthorizeService'], to: ['PingOneAuthorize'], refs: [...CREDS.slice(0, 1), ...AUTHZ], tokens: [WORKER], form: TX_DECISION },
  { from: ['A2AOrch'], to: ['PDP'], refs: AUTHZ_CHAIN, tokens: [WORKER], form: PDP_FORM },
  { from: ['GwAuthorize', 'PingGW'], to: ['PDP'], refs: AUTHZ, tokens: [WORKER], form: PDP_FORM },
  { from: ['PingGW'], to: ['AuthzMock'], refs: AUTHZ, form: PDP_FORM.replace('  Authorization: Bearer <worker token>\n', '  (the mock needs no worker token)\n') },
  { from: ['A2AOrch'], to: ['Specialist'], refs: A2A_NESTED, tokens: [NESTED], form: A2A_FORM },
  // The diagram does not name the transport for this hop, so the form shows the JSON-RPC message and the bearer only.
  { from: ['Specialist'], to: GATEWAYS, refs: [...EXCHANGE, ...MCP.slice(0, 2)], tokens: [NESTED], form: 'tools/call (JSON-RPC 2.0 message, transport per the gateway door)\n  Authorization: Bearer <nested act token>\n  { "jsonrpc": "2.0", "method": "tools/call", "params": { "name": "get_portfolio" } }' },
  { from: ['AgentService'], to: ['A2AOrch'], refs: A2A, form: A2A_FORM },
  // "WS exchanged Bearer" in the diagram: a WebSocket, not HTTP.
  { from: ['AgentService'], to: GATEWAYS, refs: SOCKET_EXCHANGE, tokens: [EXCHANGED], form: WS_FORM },
  { from: ['AuthRoutes'], to: GATEWAYS, refs: [...EXCHANGE, ...MCP.slice(0, 2)], tokens: [EXCHANGED], form: HTTP_MCP_FORM },
  { from: ['AuthRoutes'], to: ['AgentService'], refs: BEARER, tokens: [HUMAN], form: 'POST /agent/prompt\n  Authorization: Bearer <user token>\n  { "prompt": "What is my balance?" }' },
  // Diagram: GwProxy uses "WS MCP"; PingGW uses "WS/HTTP MCP" to the protocol server and "HTTP MCP" to Weather.
  { from: ['GwProxy'], to: ['MCPProtocol', 'MCPInvestSvc'], refs: SOCKET_EXCHANGE, tokens: [EXCHANGED], form: WS_FORM },
  { from: ['PingGW'], to: MCP_SERVERS, refs: MCP, tokens: [EXCHANGED], form: HTTP_MCP_FORM },
  { from: ['McpInspectorRoutes', 'MCPClientPy'], to: ['MCPProtocol'], refs: SOCKET, tokens: [EXCHANGED], form: WS_FORM },
  { from: ['GwProxy'], to: ['MortgageSvc'], reason: NO_STD_PROPRIETARY('X-API-Key header (the OAuth bearer is deliberately dropped on this path)') },
  { from: ['GwProxy'], to: ['VaultBridge'], reason: NO_STD_PROPRIETARY('Internal vault bridge') },
  { from: ['GwProxy'], to: ['BankingRS'], refs: [...EXCHANGE.slice(0, 2), ...BEARER.slice(0, 1), SPEC('OIDC Core 1.0', 'ID token sent beside the access token')], tokens: [EXCHANGED, ID_TOKEN], form: 'GET /identity\n  Authorization: Bearer <access token>\n  X-ID-Token: <id token>' },
  { from: ['MCPTools', 'MCPInvestSvc'], to: ['TxRoutes'], refs: BEARER, tokens: [EXCHANGED], form: 'POST /api/transactions\n  Authorization: Bearer <exchanged token>\n  { "type": "transfer", "amount": 5000, "toAccountId": "acct-2002" }' },
  // Gates and the HITL service are the demo's own code. CIBA and RFC 9470 appear on the outbound PingOne call (CibaRoutes), not here.
  { from: ['TxRoutes'], to: ['StepUpGate'], reason: NO_STD_INTERNAL },
  { from: ['StepUpGate'], to: ['AuthorizeGate'], reason: NO_STD_INTERNAL },
  { from: ['AuthorizeGate'], to: ['AuthorizeService'], reason: NO_STD_INTERNAL },
  { from: ['AuthRoutes'], to: ['HITLSvc'], reason: NO_STD_PROPRIETARY('HITL consent challenge, the demo\'s own API') },
  { from: ['HITLSvc'], to: ['AuthRoutes'], reason: NO_STD_INTERNAL },
  { from: ['ChatWidget'], to: ['FastAPI'], refs: WS_CHAT, form: 'WebSocket upgrade (GET, Upgrade: websocket)\n  text frame: the user\'s chat message as JSON\n  reply frames: stream_event messages' },
  { from: ['Login'], to: ['AuthRoutes'], refs: SESSION, form: 'GET /api/auth/oauth/status\n  Cookie: session=<opaque id>' },
  { from: ['Dashboard'], to: ['AdminRoutes'], refs: SESSION, form: 'GET /api/admin/settings\n  Cookie: session=<opaque id>' },
  { from: ['SecuritySettings'], to: ['AdminRoutes'], refs: SESSION, form: 'GET /api/admin/settings   (read)\nPUT /api/admin/settings   (save)\n  Cookie: session=<opaque id>' },
  { from: ['UserDash'], to: ['TxRoutes'], refs: SESSION, form: 'GET /api/transactions/my\n  Cookie: session=<opaque id>' },
  { from: ['McpInspector'], to: ['McpInspectorRoutes'], refs: SESSION, form: 'Cookie: session=<opaque id>   (the browser never holds the access token)' },
  { from: ['McpInspector'], to: ['HealthInsp'], refs: HTTP, form: 'GET /inspector/mcp-host' },
  { from: ['ConfigPage'], to: ['ValidationRoutes'], refs: SESSION, form: 'GET /api/config/validation-mode\nPOST /api/config/validation-mode\n  Cookie: session=<opaque id>' },
  { from: ['Login', 'Dashboard', 'SecuritySettings', 'UserDash', 'McpInspector', 'ConfigPage'], refs: SESSION },
  { from: ['AuthRoutes', 'AGUIRoutes'], to: ['AGUIRoutes', 'MastraAgent'], refs: SSE, form: 'GET /api/agent-run   (Accept: text/event-stream)\n  data: { agent-run event as JSON, decoded token-chain events only, never raw JWTs }' },
  { from: ['LangChain'], to: ['LLM'], reason: NO_STD_PROPRIETARY('LLM provider API (API key over HTTPS)') },
  { from: ['AuthRoutes'], to: ['Vault'], reason: NO_STD_PROPRIETARY('Local encrypted secrets vault (startup load)') },
  // Everything else in architecture.mmd is a call between modules of one service or a data-store access.
  { from: ['TxRoutes', 'UserRoutes', 'AccountRoutes', 'AdminRoutes', 'RuntimeSettings', 'Health', 'ValidationRoutes', 'GwProxy', 'LangChain', 'FastAPI', 'BankingRS', 'OAuthMonitor'], reason: NO_STD_INTERNAL },
];

const matches = (rule, from, to) => (!rule.from || rule.from.includes(from)) && (!rule.to || rule.to.includes(to));
const ruleFor = (from, to) => RULES.find((r) => matches(r, from, to)) || null;

/** Standards behind the arrow from -> to (RFCs, specs, emerging). Empty when none applies; see whyNoRefs. */
export const refsFor = (from, to) => ruleFor(from, to)?.refs || [];
/** The stated reason an arrow has no standard behind it, or null when it has refs (or is not classified yet). */
export const whyNoRefs = (from, to) => {
  const r = ruleFor(from, to);
  return r && !r.refs?.length ? r.reason || null : null;
};
/** The request on the wire for arrows that are an HTTP or protocol call (teaching values). */
export const formFor = (from, to) => ruleFor(from, to)?.form || null;
/** MOCK tokens in play on the arrow (two for a hop that carries two), each { note, header?, claims }. */
export const tokensFor = (from, to) => ruleFor(from, to)?.tokens || [];

export const STANDARDS_CAVEAT = 'Emerging items are drafts or in-progress work; their status can change.';
export const RULE_NODE_IDS = [...new Set(RULES.flatMap((r) => [...(r.from || []), ...(r.to || [])]))];

/** Adds the request form, MOCK tokens and standards to one movie-reel step ({ from, to, lines }). */
export function enrichReelStep(step) {
  const lines = [...step.lines];
  const form = formFor(step.from, step.to);
  if (form) lines.push({ who: 'Request on the wire', code: form });
  for (const t of tokensFor(step.from, step.to)) {
    const decoded = { ...(t.header ? { header: t.header } : {}), claims: t.claims };
    lines.push({ who: 'Token in play', code: `${t.note} (MOCK, teaching values only)\n${JSON.stringify(decoded, null, 2)}` });
  }
  const refs = refsFor(step.from, step.to);
  const why = whyNoRefs(step.from, step.to);
  if (!refs.length && why) lines.push({ who: 'Standards', text: why });
  return { ...step, lines, refs };
}
