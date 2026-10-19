// /privilege-mcp-diagrams: the three AI Agent Gateway (Privilege) figures as StaticFlowDiagram configs
// { GROUPS, NODES, EDGES, STEPS }, drawn in the Ping style. Per-step wire forms, MOCK tokens and standards are in
// privilegeMcpStandards.js. Source: privilege/PRIVILEGE-MCP.md.
// Edge opts: vertical = bottom of source to top of target (stacked cards); lane = bow the arrow beside a column,
// so several arrows between the same two stacked cards each get their own path and badge.
import { ARCH_DETAIL, SEQ_DETAIL, FLOW_DETAIL } from './privilegeMcpStandards';

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const V = { vertical: true };
const D = { dashed: true };

export const PMD_GROUPS = {
  app: { label: 'App, browser or MCP server', bg: '#151a24' },
  ping: { label: 'Ping product (PingOne, AI Agent Gateway, Privilege)', bg: '#b5231a' },
  safety: { label: 'Decision or safety check', bg: '#5a5f69' },
};

const step = (key, edges, title, what, why, detail) => ({ key, edges, title, what, ...(why ? { why } : {}), detail });

// ─── Architecture ─────────────────────────────────────────────────────────────
const ARCH_NODES = [
  N('ui', 'app', 'UI', ['/privilege-mcp-client', 'React, UI only'], 0, 0),
  N('bff', 'app', 'BFF', ['demo-api-server', 'MCP CLIENT'], 0, 150),
  N('gw', 'ping', 'Gateway', ['ping-mcpgw (cyonproxy)', 'MCP CLIENT to mcp-server'], 0, 300),
  N('mcp', 'app', 'mcp-server :8080', ['MCP SERVER, owns the tools', 'aud mcpserver.ping.demo'], 0, 450),
  N('as', 'ping', 'Authorization server', ['auth.pingone.com/{envId}/as'], 520, 150),
  N('cp', 'ping', 'Privilege control plane', ['grpc.privilege.pingone.com:443'], 520, 300),
  N('api', 'ping', 'Privilege cloud API', ['privilege.pingone.com/api/mcp'], 520, 450),
];

const ARCH_EDGES = [
  ['ui', 'bff', 'HTTPS + session cookie (not MCP)', V], // 0
  ['bff', 'ui', 'SSE: live relay events', { dashed: true, lane: 70 }], // 1
  ['bff', 'as', 'OAuth 2.0 code+PKCE (user) / client_credentials (machine)'], // 2
  ['bff', 'gw', 'MCP session 1 (JSON-RPC/HTTP)', V], // 3
  ['gw', 'cp', 'outbound gRPC, enrollment JWT'], // 4
  ['gw', 'mcp', 'MCP session 2: policy applied between them', V], // 5
  ['bff', 'mcp', 'MCP direct: the simple route, works today', { lane: 90 }], // 6
  ['api', 'gw', 'NOT the gateway frontend', D], // 7
];

const ARCH_STEPS = [
  step('browser', [0], 'The page talks to the BFF, never MCP', 'The React page calls the BFF over HTTPS with a session cookie. It never speaks MCP and never holds a token.', 'Keeping MCP and tokens server-side is what lets the BFF and the gateway enforce policy.', ARCH_DETAIL.browser),
  step('sse', [1], 'Live relay events come back over SSE', 'The BFF streams what it sends and receives to the page so the operator can watch the MCP traffic.', null, ARCH_DETAIL.sse),
  step('authz', [2], 'The BFF gets tokens from PingOne', 'Operators sign in with OAuth 2.0 code and PKCE; the machine route uses client_credentials. PingOne is identity and policy here, not MCP.', null, ARCH_DETAIL.authz),
  step('session1', [3], 'MCP session 1: BFF to gateway', 'The BFF is the MCP client. It sends JSON-RPC over HTTP to the gateway with the operator token.', 'The gateway is where the JIT least-privilege policy and session recording apply.', ARCH_DETAIL.session1),
  step('enroll', [4], 'The gateway dials out to the control plane', 'Outbound gRPC with an enrollment JWT. The gateway binds no public port, so nothing reaches it from the control plane side.', null, ARCH_DETAIL.enroll),
  step('session2', [5], 'MCP session 2: gateway to mcp-server', 'The gateway opens its own MCP session to mcp-server. The policy decision sits between session 1 and session 2.', null, ARCH_DETAIL.session2),
  step('direct', [6], 'The simple route skips the gateway', 'The BFF can call mcp-server directly with a machine token: no human, no Privilege policy. It works today.', null, ARCH_DETAIL.direct),
  step('api', [7], 'The cloud API is not a front door', 'The Privilege cloud API is a control-plane endpoint, not an alternate route for MCP traffic, so the line is dashed.', null, ARCH_DETAIL.api),
];

// ─── Sign-in + tool call ──────────────────────────────────────────────────────
// Request/response pairs share one arrow: the label reads "request -> response", the panel shows both.
const SEQ_NODES = [
  N('U', 'app', 'Operator', ['clicks Sign In, Load Tools, Run'], 0, 0),
  N('P', 'app', 'Client page (UI)', ['/privilege-mcp-client'], 0, 150),
  N('B', 'app', 'BFF — MCP CLIENT', ['demo-api-server', 'holds the token'], 0, 300),
  N('G', 'ping', 'Gateway — MCP server+client', ['Privilege decides:', 'JIT policy + session recording'], 0, 450),
  N('M', 'app', 'mcp-server — MCP SERVER', ['owns the tools'], 0, 600),
  N('A', 'ping', 'PingOne AS', ['hosted sign-on, issues the token'], 520, 225),
];

const SEQ_EDGES = [
  ['U', 'P', 'Sign In with Privilege', V], // 0
  ['P', 'B', 'POST /auth/start, returns authUrl', V], // 1
  ['B', 'G', 'GET mcpUrl, returns authorization_uri + token_uri (or 401)', V], // 2
  ['U', 'A', 'hosted sign-on (PKCE S256, state, login_hint)'], // 3
  ['A', 'B', 'callback ?code&state, BFF POSTs the code, gets access_token', D], // 4
  ['B', 'P', 'redirect ?auth=success', { lane: 70 }], // 5
  ['U', 'P', 'Load Tools', { lane: 80 }], // 6
  ['P', 'B', 'POST /tools/list', { lane: -70 }], // 7
  ['B', 'G', 'initialize + notifications/initialized, returns MCP-Session-Id', { lane: 70 }], // 8
  ['B', 'G', 'tools/list (Bearer + session headers)', { lane: -70 }], // 9
  ['G', 'M', 'tools/list, returns tools', V], // 10
  ['U', 'P', 'Run a tool', { lane: -80 }], // 11
  ['P', 'B', 'POST /tools/call', { lane: 140 }], // 12
  ['B', 'G', 'tools/call: Privilege decides', { lane: 140 }], // 13
  ['G', 'M', 'permitted: tools/call, returns result', { lane: 70 }], // 14
  ['G', 'B', 'denied by policy: 4xx relayed with its own status', { dashed: true, lane: -140 }], // 15
];

const SEQ_STEPS = [
  step('signInClick', [0], 'The operator clicks Sign In', 'The click only calls the BFF. The page has no MCP and no token.', null, SEQ_DETAIL.signInClick),
  step('authStart', [1], 'The BFF builds the sign-in URL', 'POST /auth/start returns authUrl with PKCE S256, state and login_hint.', null, SEQ_DETAIL.authStart),
  step('discover', [2], 'The BFF asks the gateway where to sign in', 'It GETs the MCP URL and reads authorization_uri and token_uri from the answer, or falls back to PingOne OIDC discovery on a 401.', null, SEQ_DETAIL.discover),
  step('hostedSignOn', [3], 'The operator signs in at PingOne', 'PingOne hosts the sign-on. The demo never sees the password.', null, SEQ_DETAIL.hostedSignOn),
  step('callback', [4], 'PingOne calls back; the BFF trades the code', 'The BFF verifies state, then POSTs the code with the verifier and client secret and stores access_token and refresh_token.', 'A wrong secret, or an app that is not client_secret_post, stops here with invalid_client.', SEQ_DETAIL.callback),
  step('authSuccess', [5], 'The BFF redirects back to the page', 'The page reloads with ?auth=success and can now load tools.', null, SEQ_DETAIL.authSuccess),
  step('loadClick', [6], 'The operator clicks Load Tools', 'Again only a call to the BFF.', null, SEQ_DETAIL.loadClick),
  step('toolsListPage', [7], 'The page asks the BFF for tools', 'POST /tools/list; the BFF does the MCP work.', null, SEQ_DETAIL.toolsListPage),
  step('handshake', [8], 'MCP handshake with the gateway', 'initialize returns protocolVersion and MCP-Session-Id; notifications/initialized completes it.', null, SEQ_DETAIL.handshake),
  step('toolsListGw', [9], 'tools/list with the Bearer token', 'The BFF sends the token and the session headers; the gateway forwards the call.', null, SEQ_DETAIL.toolsListGw),
  step('toolsListMcp', [10], 'The gateway lists tools on mcp-server', 'mcp-server answers with its tools; the gateway returns them as JSON or SSE frames.', null, SEQ_DETAIL.toolsListMcp),
  step('runClick', [11], 'The operator runs a tool', 'The click calls the BFF.', null, SEQ_DETAIL.runClick),
  step('toolsCallPage', [12], 'The page asks the BFF to call the tool', 'POST /tools/call; the result or the error comes back the same way.', null, SEQ_DETAIL.toolsCallPage),
  step('toolsCallGw', [13], 'The gateway decides', 'Privilege applies the JIT least-privilege policy and records the session before anything reaches mcp-server.', 'This is the gate: the tool only runs if the policy permits it.', SEQ_DETAIL.toolsCallGw),
  step('permitted', [14], 'Permitted: the tool runs', 'The gateway forwards tools/call to mcp-server and relays the result.', null, SEQ_DETAIL.permitted),
  step('denied', [15], 'Denied: a 4xx comes back', 'The gateway answers with its own status and the BFF relays it to the page.', null, SEQ_DETAIL.denied),
];

// ─── Auth flow ────────────────────────────────────────────────────────────────
const X = 290;
const Y = 110;
const G = (id, group, label, sub, col, row) => N(id, group, label, sub, col * X, row * Y);

const FLOW_NODES = [
  G('A', 'app', 'Browser', ['/privilege-mcp-client'], 0, 0),
  G('B', 'app', 'GET /api/privilege-mcp/state', null, 1, 0),
  G('C', 'safety', 'Token in session?', null, 2, 0),
  G('D', 'app', 'User clicks Sign In', null, 3, 0),
  G('E', 'app', 'POST /auth/start', null, 4, 0),
  G('F', 'safety', 'WWW-Authenticate present?', null, 5, 0),
  G('G', 'app', "Use header's authorization_uri + token_uri", null, 4, 1),
  G('H', 'ping', 'PingOne OIDC fallback', ['.well-known/openid-configuration'], 5, 1),
  G('I', 'app', 'Generate PKCE', ['S256 verifier + state'], 4, 2),
  G('J', 'app', 'Redirect to /authorize', null, 3, 2),
  G('K', 'ping', 'User signs in at PingOne', null, 3, 3),
  G('L', 'app', 'Redirect to /auth/callback', ['?code&state'], 4, 3),
  G('M', 'app', 'BFF verifies state', ['POST token_uri'], 5, 3),
  G('N', 'safety', '200?', null, 5, 4),
  G('O', 'safety', 'Wrong secret / not SECRET_POST', null, 5, 5),
  G('P', 'app', 'Store tokens', ['clientSessions map'], 4, 4),
  G('Q', 'app', 'Redirect ?auth=success', null, 3, 4),
  G('R', 'app', 'POST /tools/list', null, 2, 4),
  G('S', 'safety', 'Token expiring <60s?', null, 1, 4),
  G('T', 'app', 'Refresh token', ['grant_type=refresh_token'], 1, 5),
  G('U', 'ping', 'POST gateway URL', ['Bearer + MCP-Session-Id'], 0, 4),
  G('V', 'ping', 'initialize handshake', null, 0, 5),
  G('W', 'ping', 'tools/list', null, 0, 6),
  G('X', 'app', 'mcp-server:8080', ['MCP_AUTH_DISABLED=true'], 1, 6),
  G('Y', 'app', 'Tools returned to UI', null, 2, 6),
];

const VD = { dashed: true, vertical: true };
const FLOW_EDGES = [
  ['A', 'B', 'load the page'], // 0
  ['B', 'C', 'does the session hold oauth.accessToken?'], // 1
  ['C', 'D', 'No', D], // 2
  ['D', 'E', 'sign-in click'], // 3
  ['E', 'F', 'probe the MCP URL'], // 4
  ['F', 'G', 'Yes: header present', D], // 5
  ['G', 'I', 'endpoints taken from the header', V], // 6
  ['F', 'H', 'No header', VD], // 7
  ['H', 'I', 'endpoints from discovery'], // 8
  ['I', 'J', 'build the authorize URL'], // 9
  ['J', 'K', 'browser follows the redirect', V], // 10
  ['K', 'L', 'PingOne redirects back'], // 11
  ['L', 'M', 'GET /auth/callback?code&state'], // 12
  ['M', 'N', 'POST token_uri', V], // 13
  ['N', 'O', '401 invalid_client', VD], // 14
  ['N', 'P', '200: tokens issued', D], // 15
  ['P', 'Q', 'redirect to the page'], // 16
  ['Q', 'R', 'tools/list request'], // 17
  ['C', 'R', 'Yes: token already stored', { dashed: true, lane: 80 }], // 18
  ['R', 'S', 'check the expiry'], // 19
  ['S', 'T', 'Yes: expiring', VD], // 20
  ['T', 'R', 'retry with the fresh token', D], // 21
  ['S', 'U', 'No: still valid', D], // 22
  ['U', 'V', 'MCP handshake', V], // 23
  ['V', 'W', 'then tools/list', V], // 24
  ['W', 'X', 'forwarded to mcp-server'], // 25
  ['X', 'Y', 'tools returned'], // 26
];

const FLOW_STEPS = [
  step('state', [0, 1], 'Load the page and check the session', 'The page asks the BFF for its state; the BFF checks whether the session already holds an access token.', null, FLOW_DETAIL.state),
  step('start', [2, 3], 'No token: Sign In calls /auth/start', 'The sign-in click posts to the BFF.', null, FLOW_DETAIL.start),
  step('probe', [4], 'Probe the MCP URL', 'The BFF asks the gateway for the MCP URL to see whether it answers with WWW-Authenticate.', null, FLOW_DETAIL.probe),
  step('headerYes', [5, 6], 'Header present: use its endpoints', 'authorization_uri and token_uri come straight from the header.', null, FLOW_DETAIL.headerYes),
  step('headerNo', [7, 8], 'No header: PingOne OIDC fallback', 'The BFF reads PingOne discovery for the environment in PRIVILEGE_SSO_ENV_ID.', null, FLOW_DETAIL.headerNo),
  step('pkce', [9, 10], 'PKCE, then the authorize redirect', 'The BFF makes a verifier, an S256 challenge and a state, and sends the browser to PingOne.', null, FLOW_DETAIL.pkce),
  step('callback', [11, 12], 'PingOne redirects to the callback', 'The browser lands on /auth/callback with code and state.', null, FLOW_DETAIL.callback),
  step('token', [13], 'The BFF trades the code for tokens', 'It verifies state, then POSTs token_uri with the client secret and code_verifier.', null, FLOW_DETAIL.token),
  step('invalidClient', [14], '401 invalid_client', 'A wrong secret, or an app that is not client_secret_post, ends here.', null, FLOW_DETAIL.invalidClient),
  step('store', [15, 16], '200: store the tokens', 'access_token, refresh_token and expiresAt go into the server-side clientSessions map; the browser is redirected with ?auth=success.', null, FLOW_DETAIL.store),
  step('toolsPage', [17, 18], 'Load tools with a token in hand', 'Either path reaches POST /tools/list: straight from the session, or after sign-in.', null, FLOW_DETAIL.toolsPage),
  step('refresh', [19, 20, 21], 'Refresh when expiring within 60 seconds', 'The BFF swaps the refresh token for a new access token, then retries.', null, FLOW_DETAIL.refresh),
  step('gateway', [22, 23], 'Call the gateway with Bearer and session headers', 'initialize runs first if the MCP session does not exist yet.', null, FLOW_DETAIL.gateway),
  step('forward', [24, 25], 'tools/list is forwarded to mcp-server', 'In this demo mcp-server runs with MCP_AUTH_DISABLED=true and skips its own auth checks.', null, FLOW_DETAIL.forward),
  step('returned', [26], 'Tools return to the UI', 'The BFF hands the tool list to the page.', null, FLOW_DETAIL.returned),
];

export const PMD_ARCH_DIAGRAM = { GROUPS: PMD_GROUPS, NODES: ARCH_NODES, EDGES: ARCH_EDGES, STEPS: ARCH_STEPS };
export const PMD_SEQ_DIAGRAM = { GROUPS: PMD_GROUPS, NODES: SEQ_NODES, EDGES: SEQ_EDGES, STEPS: SEQ_STEPS };
export const PMD_FLOW_DIAGRAM = { GROUPS: PMD_GROUPS, NODES: FLOW_NODES, EDGES: FLOW_EDGES, STEPS: FLOW_STEPS };
