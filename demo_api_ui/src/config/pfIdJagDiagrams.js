// /architecture/pingfederate-id-jag: the two Ping-style figures of PingFederateIdJagPage (StaticFlowDiagram, pingStyle).
//   JAG   the ID-JAG token journey (Side 1 PingFederate issues, Side 2 the MCP authorization server redeems)
//   LOGIN PingFederate OIDC sign-in, then the AI request path
// One arrow per step: STEPS[i].edges = [i]. Per-arrow detail (request form, MOCK tokens, standards) is in pfIdJagStandards.js.
import { JAG_DETAIL, LOGIN_DETAIL } from './pfIdJagStandards';

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const DASHED = { dashed: true }; // a token, a code or a decision coming back (blue dashed under pingStyle)
const DOWN = { vertical: true }; // leave the bottom of the source, enter the top of the target
const DOWN_DASHED = { vertical: true, dashed: true };

export const PF_ID_JAG_GROUPS = {
  user: { label: 'User, browser and agent', bg: '#151a24' },
  bff: { label: 'Demo BFF and its services', bg: '#5a5f69' },
  ping: { label: 'Ping product (PingFederate, PingGateway, PingOne Authorize)', bg: '#b5231a' },
  res: { label: 'MCP authorization server, MCP server and banking API', bg: '#2b3342' },
};

const step = (detail) => (key, i, title, what, why) => ({ key, edges: [i], title, what, why, detail: detail[i] });

// ---- 1. ID-JAG token journey (7 boxes + the assertion, 10 arrows) -----------------------------------------------
export const JAG_NODES = [
  N('user', 'user', 'User + agent', ['UC40 · MCP request', 'browser holds a session cookie only'], 0, 250),
  N('bff', 'bff', 'Demo BFF', ['token custodian · OAuth client', 'holds the PingFederate refresh token', 'server-side, never in the browser'], 480, 250),
  N('pingfed', 'ping', 'PingFederate', ['Side 1 · validates + issues', 'policy aiDemoPfIdJagPolicy'], 960, 0),
  N('jag', 'ping', 'ID-JAG', ['signed JWT assertion', 'typ oauth-id-jag+jwt · about 5 minutes'], 960, 250),
  N('mcpas', 'res', 'MCP Authorization Server', ['Side 2 · validates + redeems', 'oauth-mcp · mints its own access token'], 960, 500),
  N('gateway', 'ping', 'PingGateway', ['access-token enforcement', 'MCP gateway'], 480, 500),
  N('authorize', 'ping', 'PingOne Authorize', ['action policy · PERMIT or DENY'], 0, 500),
  N('invest', 'res', 'MCP server', ['OLB backend · runs the tool', 'get_my_accounts'], 480, 750),
  N('banking', 'res', 'BFF banking API', ['verifies the token · returns data'], 960, 750),
];

export const JAG_EDGES = [
  E('user', 'bff', 'POST /api/agent/run'), // 0
  E('bff', 'pingfed', 'token exchange: refresh token'), // 1
  E('pingfed', 'jag', 'validate, map, sign', DOWN), // 2
  E('jag', 'bff', 'ID-JAG returned', DASHED), // 3
  E('bff', 'mcpas', 'JWT bearer grant: assertion=ID-JAG'), // 4
  E('mcpas', 'bff', 'MCP access token', DASHED), // 5
  E('bff', 'gateway', 'tools/call + Bearer', DOWN), // 6
  E('gateway', 'authorize', 'action policy check'), // 7
  E('gateway', 'invest', 'permitted tool call', DOWN), // 8
  E('invest', 'banking', 'same Bearer'), // 9
];

const J = step(JAG_DETAIL);
export const JAG_STEPS = [
  J('request', 0, 'Start the UC40 MCP request', 'The BFF receives the user\'s request and keeps OAuth tokens out of the browser. The UC40 PingFederate lane uses its server-held refresh token as the upstream subject.', 'The browser never holds a token, so there is nothing for page script to steal.'),
  J('side1', 1, 'Side 1 · PingFederate validates the upstream token', 'The BFF sends a token-exchange request with the refresh token, its token type, the downstream audience/resource, and requested scopes. PingFederate\'s token-exchange policy validates the refresh token.', 'The exchange runs as the same client that received the refresh token; PingFederate binds refresh tokens to their client.'),
  J('mint', 2, 'PingFederate mints the ID-JAG', 'After validation and attribute mapping, PingFederate builds and signs the ID-JAG. Its audience identifies the downstream authorization server; its resource and scope constrain the MCP access being requested.', 'The assertion is audience-bound: only the named authorization server can use it.'),
  J('return', 3, 'PingFederate issues the ID-JAG', 'PingFederate returns a signed ID-JAG to the BFF in access_token, with issued_token_type naming it an ID-JAG. The BFF refuses the wrong type, issuer, audience or expiry before using it.', 'Checking on receipt means a misconfigured exchange fails here, not three hops later.'),
  J('side2', 4, 'Side 2 · submit ID-JAG for validation', 'The BFF sends the ID-JAG to the configured downstream MCP authorization server as a JWT bearer assertion. The MCP AS checks issuer/signature, audience, expiry, ID-JAG type, its resource allowlist, and the single-use jti.', 'A second server judges a credential the first server signed: that is cross-app access.'),
  J('local', 5, 'Downstream AS issues its local access token', 'A successful JWT bearer grant returns a resource-specific MCP access token. The ID-JAG was the grant assertion; the newly issued access token is what authorizes the protected call.', 'The ID-JAG is spent here and goes no further.'),
  J('call', 6, 'Call the protected MCP tool', 'The BFF sends the MCP request to PingGateway with the downstream access token.', 'PingGateway enforces the token before the MCP server sees the call.'),
  J('policy', 7, 'PingGateway asks PingOne Authorize', 'PingGateway asks PingOne Authorize for the action-policy decision before the MCP server is allowed to run the tool.', 'A valid token is not enough: policy decides the action.'),
  J('tool', 8, 'The permitted call reaches the MCP server', 'After PERMIT, PingGateway forwards the same access token to the MCP server (the OLB backend) that owns get_my_accounts.', 'The token is passed along unchanged because its audience already matches.'),
  J('data', 9, 'The MCP server reads the data', 'The MCP server passes the same access token to the BFF banking API. The banking API verifies the signature and exact issuer, applies audience, scope and role checks, and returns the data. The ID-JAG never reaches this hop.', 'Every hop after Side 2 sees only the access token.'),
];

// The page's guide steps (title + text, the same steps the page always had): each covers one or more arrows, every arrow once.
export const JAG_GUIDE = [
  { title: 'Start the UC40 MCP request', what: JAG_STEPS[0].what, edges: [0] },
  { title: 'Side 1 · PingFederate validates the upstream token', what: JAG_STEPS[1].what, edges: [1] },
  { title: 'PingFederate issues the ID-JAG', what: 'After validation and attribute mapping, PingFederate returns a signed ID-JAG to the BFF. Its audience identifies the downstream authorization server; its resource and scope constrain the MCP access being requested.', edges: [2, 3] },
  { title: 'Side 2 · submit ID-JAG for validation', what: JAG_STEPS[4].what, edges: [4] },
  { title: 'Downstream AS issues its local access token', what: JAG_STEPS[5].what, edges: [5] },
  { title: 'Call the protected MCP tool', what: 'The BFF sends the MCP request to PingGateway with the downstream access token. PingGateway and PingOne Authorize apply the configured access-token and action policy checks before the MCP server is allowed to run the tool.', edges: [6, 7, 8] },
  { title: 'The MCP server reads the data', what: JAG_STEPS[9].what, edges: [9] },
];

export const JAG_DIAGRAM = { GROUPS: PF_ID_JAG_GROUPS, NODES: JAG_NODES, EDGES: JAG_EDGES, STEPS: JAG_STEPS };

// ---- 2. PingFederate login + AI request (8 boxes, 19 arrows) ---------------------------------------------------
export const LOGIN_NODES = [
  N('user', 'user', 'User / browser', ['PF sign-in · AI request', 'session cookie only'], 0, 0),
  N('bff', 'bff', 'Demo BFF', ['OIDC client · token custodian', 'runs the AI request', 'executes the tool call'], 480, 330),
  N('pingfed', 'ping', 'PingFederate', ['sign-in at /as/authorization.oauth2', 'tokens at /as/token.oauth2', 'login code + standard token exchange'], 960, 0),
  N('agent', 'bff', 'Agent Service', ['reasoning · tool proposal', 'holds no tokens'], 0, 330),
  N('authorize', 'ping', 'PingOne Authorize', ['runtime action policy'], 480, 660),
  N('gateway', 'ping', 'PingGateway', ['MCP token enforcement'], 960, 660),
  N('mcp', 'res', 'MCP Server', ['protected tools · resource'], 1320, 990),
];

export const LOGIN_EDGES = [
  E('user', 'bff', 'sign in', DOWN), // 0
  E('bff', 'pingfed', '302 · /authorize + PKCE'), // 1
  E('pingfed', 'user', 'sign-in page'), // 2
  E('user', 'pingfed', 'credentials'), // 3
  E('pingfed', 'bff', 'code + state', DOWN_DASHED), // 4
  E('bff', 'pingfed', 'code + verifier'), // 5
  E('pingfed', 'bff', 'ID / access / refresh', DOWN_DASHED), // 6
  E('bff', 'user', 'HTTP-only cookie', DASHED), // 7
  E('user', 'bff', 'prompt + session', DOWN), // 8
  E('bff', 'agent', 'reason request'), // 9
  E('agent', 'bff', 'tool proposal'), // 10
  E('bff', 'pingfed', '2-exchange delegation'), // 11
  E('pingfed', 'bff', 'scoped access token', DOWN_DASHED), // 12
  E('bff', 'gateway', 'MCP request + token', DOWN), // 13
  E('gateway', 'authorize', 'action policy check'), // 14
  E('gateway', 'mcp', 'permitted MCP tool call', DOWN), // 15
  E('mcp', 'gateway', 'MCP tool result', DASHED), // 16
  E('gateway', 'bff', 'result to BFF', DASHED), // 17
  E('bff', 'user', 'AI response'), // 18
];

const L = step(LOGIN_DETAIL);
export const LOGIN_STEPS = [
  L('start', 0, 'Start sign-in with the BFF', 'The BFF creates state, nonce, and a PKCE verifier for the sign-in.', 'The verifier stays in the BFF; only its S256 hash goes out.'),
  L('authorize', 1, 'The BFF sends the browser to PingFederate', 'The BFF redirects the browser to PingFederate\'s authorization endpoint with the S256 challenge.', 'PKCE ties the code to this BFF, so a stolen code is useless.'),
  L('page', 2, 'PingFederate shows its sign-in page', 'The browser follows the redirect to PingFederate, which shows the sign-in page for the configured authentication policy.', 'The user authenticates at the identity provider, not at the app.'),
  L('credentials', 3, 'User authenticates with PingFederate', 'The user authenticates there under the configured policy; credentials do not pass through the BFF.', 'The BFF never sees the password.'),
  L('code', 4, 'PingFederate returns an authorization code', 'After authentication, PingFederate redirects the browser to the BFF callback with a short-lived code and the original state. The BFF validates state and the callback before redeeming the code.', 'State checks tie the callback to the sign-in this BFF started.'),
  L('exchange', 5, 'BFF exchanges code for tokens', 'The BFF authenticates with its configured PingFederate client-authentication method, then posts the code and original PKCE verifier.', 'Only the BFF can redeem the code: it holds the verifier and the client credentials.'),
  L('tokens', 6, 'PingFederate returns the tokens', 'PingFederate returns the ID, access and refresh tokens. The BFF validates the ID token, including stored nonce, signature, issuer, audience, and expiry.', 'The ID token proves who signed in; it is not an API credential.'),
  L('session', 7, 'BFF establishes the application session', 'The BFF retains the PingFederate tokens server-side and gives the browser an HTTP-only session cookie. OAuth tokens stay out of browser JavaScript.', 'The browser holds a cookie, never a token.'),
  L('prompt', 8, 'User sends an AI request', 'The signed-in browser posts the user\'s prompt to the BFF with its session cookie. PingFederate was the login provider; PingOne Authorize is used later for runtime access policy.', 'Login and runtime policy are two different jobs.'),
  L('reason', 9, 'BFF asks the Agent Service to reason', 'The BFF asks the reasoning-only Agent Service for a tool proposal.', 'The agent gets the question and the tool list, no credentials.'),
  L('proposal', 10, 'Agent Service proposes a tool call', 'The agent does not receive user OAuth tokens or call MCP directly; the BFF remains the tool executor.', 'A model can ask for a tool; only the BFF decides to run it.'),
  L('delegate', 11, 'BFF delegates MCP access through PingFederate', 'The BFF completes the standard two-exchange agent delegation through the PingFederate adapter.', 'The two exchanges build a narrow token for this agent action.'),
  L('scoped', 12, 'PingFederate issues the scoped access token', 'PingFederate returns the scoped MCP access token. These runtime exchanges are separate from the earlier OIDC code exchange and from the ID-JAG flow in the other tab.', 'The token is scoped to the MCP call, not the whole session.'),
  L('call', 13, 'BFF sends the MCP call to PingGateway', 'The BFF sends the scoped token to PingGateway with the MCP request.', 'PingGateway enforces the access token before the MCP resource call.'),
  L('policy', 14, 'PingGateway asks PingOne Authorize', 'PingOne Authorize evaluates the tool action and must permit it before the MCP resource call.', 'The policy decision, not the token alone, allows the action.'),
  L('tool', 15, 'PingGateway forwards the permitted call', 'After PingOne Authorize permits the action, PingGateway forwards the tool call to the MCP server.', 'A DENY here stops the call before the tool runs.'),
  L('mcp-result', 16, 'The MCP server returns its result', 'The MCP server runs the tool and returns the result to PingGateway.', 'The result is data, not a credential.'),
  L('gateway-result', 17, 'PingGateway returns the result to the BFF', 'The MCP result returns through PingGateway to the BFF.', 'Tokens remain server-side the whole way back.'),
  L('answer', 18, 'MCP result returns to the user', 'The BFF returns the AI response to the browser; tokens remain server-side.', 'The user sees the answer, never a token.'),
];

export const LOGIN_GUIDE = [
  { title: 'Start sign-in with the BFF', what: 'The BFF creates state, nonce, and a PKCE verifier, then redirects the browser to PingFederate\'s authorization endpoint with the S256 challenge.', edges: [0, 1] },
  { title: 'User authenticates with PingFederate', what: 'The browser follows the redirect to PingFederate. The user authenticates there under the configured policy; credentials do not pass through the BFF.', edges: [2, 3] },
  { title: 'PingFederate returns an authorization code', what: LOGIN_STEPS[4].what, edges: [4] },
  { title: 'BFF exchanges code for tokens', what: 'The BFF authenticates with its configured PingFederate client-authentication method, then posts the code and original PKCE verifier. It validates the returned ID token, including stored nonce, signature, issuer, audience, and expiry.', edges: [5, 6] },
  { title: 'BFF establishes the application session', what: LOGIN_STEPS[7].what, edges: [7] },
  { title: 'User sends an AI request', what: LOGIN_STEPS[8].what, edges: [8] },
  { title: 'Agent Service proposes a tool call', what: 'The BFF asks the reasoning-only Agent Service for a tool proposal. The agent does not receive user OAuth tokens or call MCP directly; the BFF remains the tool executor.', edges: [9, 10] },
  { title: 'BFF authorizes and routes the MCP call', what: 'The BFF completes the standard two-exchange agent delegation through the PingFederate adapter, then sends the scoped token to PingGateway. PingOne Authorize evaluates the tool action and must permit it before the MCP resource call.', edges: [11, 12, 13, 14] },
  { title: 'MCP result returns to the user', what: 'After PingOne Authorize permits the action, PingGateway forwards the tool call to the MCP server. The MCP result returns through PingGateway and the BFF to the browser; tokens remain server-side.', edges: [15, 16, 17, 18] },
];

export const LOGIN_DIAGRAM = { GROUPS: PF_ID_JAG_GROUPS, NODES: LOGIN_NODES, EDGES: LOGIN_EDGES, STEPS: LOGIN_STEPS };
