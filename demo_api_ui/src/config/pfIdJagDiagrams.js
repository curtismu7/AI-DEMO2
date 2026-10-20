// /architecture/pingfederate-id-jag: the two Ping-style figures of PingFederateIdJagPage (StaticFlowDiagram, pingStyle).
//   JAG   the ID-JAG token journey (Side 1 PingFederate issues, Side 2 the MCP authorization server redeems)
//   LOGIN   PingFederate OIDC sign-in (4 boxes, 5 arrows)
//   REQUEST the AI request after sign-in: agent, delegation, gateway, policy, tool (7 boxes, 6 arrows)
// Was one figure of 8 boxes and 19 arrows. Split in two, and each request/response pair between the same two boxes is one
// arrow whose label and detail carry both halves (the router cannot keep an A-to-B and a B-to-A arrow from crossing).
// LOGIN_DETAIL is still the per-hop list of the original 19; mergeDetail joins the hops one arrow now stands for.
// One arrow per step: STEPS[i].edges = [i]. Per-arrow detail (request form, MOCK tokens, standards) is in pfIdJagStandards.js.
import { JAG_DETAIL, LOGIN_DETAIL } from './pfIdJagStandards';
import { PARTICIPANT_GROUPS as G } from './useCaseDiagrams/palette';

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const DASHED = { dashed: true }; // a token, a code or a decision coming back (blue dashed under pingStyle)
const DOWN = { vertical: true }; // leave the bottom of the source, enter the top of the target
const LEFT_DASHED = { lane: 1, dashed: true }; // a return arrow between boxes stacked in one column: both left sides

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
  N('jag', 'ping', 'ID-JAG', ['signed JWT assertion', 'typ oauth-id-jag+jwt · short-lived'], 480, 0),
  N('mcpas', 'res', 'MCP Authorization Server', ['Side 2 · validates + redeems', 'oauth-mcp · mints its own access token'], 1060, 500),
  N('gateway', 'ping', 'PingGateway', ['access-token enforcement', 'MCP gateway'], 480, 500),
  N('authorize', 'ping', 'PingOne Authorize', ['action policy · PERMIT or DENY'], 0, 500),
  N('invest', 'res', 'MCP server', ['OLB backend · runs the tool', 'get_my_accounts'], 480, 750),
  N('banking', 'res', 'BFF banking API', ['verifies the token · returns data'], 1060, 750),
];

export const JAG_EDGES = [
  E('user', 'bff', 'POST /api/agent/run'), // 0
  E('bff', 'pingfed', 'token exchange: refresh token'), // 1
  E('pingfed', 'jag', 'validate, map, sign'), // 2
  E('jag', 'bff', 'ID-JAG returned', { dashed: true, vertical: true }), // 3
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

// Join the detail of the hops one arrow stands for: request first, then response; tokens and standards of both.
const mergeDetail = (hops) => {
  const parts = hops.map((i) => LOGIN_DETAIL[i]);
  if (parts.length === 1) return parts[0];
  const seen = new Set();
  const refs = parts.flatMap((d) => d.refs).filter((r) => !seen.has(r.id) && seen.add(r.id));
  const tokens = parts.flatMap((d) => d.tokens || []);
  return { form: parts.map((d, k) => `# ${k === 0 ? 'Request' : 'Response'}\n${d.form}`).join('\n\n'), ...(tokens.length ? { tokens } : {}), refs };
};
const stepOf = (hops) => (key, i, title, what, why) => ({ key, edges: [i], title, what, why, detail: mergeDetail(hops) });

// ---- 2. PingFederate login and 3. AI request: one flow drawn as two figures --------------------------------------
// Shared G palette tokens only (light/dark aware); the group keys match the node groups below.
export const LOGIN_GROUPS = {
  user: { label: 'User and browser', bg: G.user.bg },
  bff: { label: 'Demo BFF and Agent Service', bg: G.agent.bg },
  ping: { label: 'Ping product (PingFederate, PingGateway, PingOne Authorize)', bg: G.pingone.bg },
  res: { label: 'MCP server', bg: G.resource.bg },
};

// Sign-in half: 4 boxes, 6 arrows.
export const LOGIN_NODES = [
  N('user', 'user', 'User / browser', ['PF sign-in', 'session cookie only', 'never sees a token', 'never hands credentials to the BFF'], 0, 0),
  N('pfauth', 'ping', 'PingFederate · sign-in', ['browser-facing endpoint', '/as/authorization.oauth2', 'authentication policy · login page'], 1150, 330),
  N('bff', 'bff', 'Demo BFF', ['OIDC client · token custodian', 'starts the PKCE sign-in', 'keeps tokens in its session'], 575, 660),
  N('pftoken', 'ping', 'PingFederate · token endpoint', ['back-channel endpoint', '/as/token.oauth2 · client ai-demo-pf-user', 'code exchange + standard token exchange'], 1150, 660),
];

const LOGIN_HOPS = [[0], [1, 4], [2, 3], [5, 6], [7]];
export const LOGIN_EDGES = [
  E('user', 'bff', 'sign in'), // 0
  E('bff', 'pfauth', '302 · /authorize + PKCE (code + state back)'), // 1  authorize + code, around the user's sign-in
  E('user', 'pfauth', 'credentials (sign-in page shown first)'), // 2  sign-in page + credentials
  E('bff', 'pftoken', 'code + verifier (ID / access / refresh back)'), // 3  code exchange + tokens
  E('bff', 'user', 'HTTP-only cookie', DASHED), // 4
];

const L = (key, i, ...rest) => stepOf(LOGIN_HOPS[i])(key, i, ...rest);
export const LOGIN_STEPS = [
  L('start', 0, 'Start sign-in with the BFF', 'The BFF creates state, nonce, and a PKCE verifier for the sign-in.', 'The verifier stays in the BFF; only its S256 hash goes out.'),
  L('authorize', 1, 'The BFF sends the browser to PingFederate and gets a code back', 'The BFF redirects the browser to PingFederate\'s authorization endpoint with the S256 challenge. The user signs in at PingFederate (next arrow); PingFederate then redirects the browser to the BFF callback with a short-lived code and the original state, which the BFF validates before redeeming the code.', 'PKCE ties the code to this BFF, so a stolen code is useless; state ties the callback to the sign-in this BFF started.'),
  L('credentials', 2, 'User authenticates with PingFederate', 'The browser follows the redirect and PingFederate shows its sign-in page for the configured authentication policy. The user authenticates there; credentials do not pass through the BFF.', 'The user authenticates at the identity provider, not at the app; the BFF never sees the password.'),
  L('exchange', 3, 'BFF exchanges the code for tokens', 'The BFF authenticates with its configured PingFederate client-authentication method, then posts the code and original PKCE verifier. PingFederate returns the ID, access and refresh tokens; the BFF validates the ID token, including stored nonce, signature, issuer, audience, and expiry.', 'Only the BFF can redeem the code: it holds the verifier and the client credentials. The ID token proves who signed in; it is not an API credential.'),
  L('session', 4, 'BFF establishes the application session', 'The BFF retains the PingFederate tokens server-side and gives the browser an HTTP-only session cookie. OAuth tokens stay out of browser JavaScript.', 'The browser holds a cookie, never a token.'),
];

export const LOGIN_GUIDE = LOGIN_STEPS.map(({ title, what, edges }) => ({ title, what, edges }));
export const LOGIN_DIAGRAM = { GROUPS: LOGIN_GROUPS, NODES: LOGIN_NODES, EDGES: LOGIN_EDGES, STEPS: LOGIN_STEPS };

// AI-request half: starts from the signed-in session.
export const REQUEST_NODES = [
  N('user', 'user', 'User / browser', ['signed in · session cookie only', 'never sees a token'], 0, 330),
  N('bff', 'bff', 'Demo BFF', ['token custodian', 'runs the AI request', 'executes the tool call'], 575, 0),
  N('agent', 'bff', 'Agent Service', ['reasoning · tool proposal', 'holds no tokens'], 1150, 330),
  N('pftoken', 'ping', 'PingFederate · token endpoint', ['/as/token.oauth2', 'standard token exchange'], 1150, 0),
  N('gateway', 'ping', 'PingGateway', ['MCP token enforcement'], 575, 660),
  N('authorize', 'ping', 'PingOne Authorize', ['runtime action policy'], 1150, 660),
  N('mcp', 'res', 'MCP Server', ['protected tools · resource'], 575, 960),
];

const REQUEST_HOPS = [[8, 18], [9, 10], [11, 12], [13, 17], [14], [15, 16]];
export const REQUEST_EDGES = [
  E('user', 'bff', 'prompt + session (AI response back)'), // 0  prompt + answer
  E('bff', 'agent', 'reason request (tool proposal back)'), // 1
  E('bff', 'pftoken', '2-exchange delegation (scoped token back)'), // 2
  E('bff', 'gateway', 'MCP request + token (result back)', DOWN), // 3
  E('gateway', 'authorize', 'action policy check'), // 4
  E('gateway', 'mcp', 'permitted tool call (result back)', DOWN), // 5
];

const R = (key, i, ...rest) => stepOf(REQUEST_HOPS[i])(key, i, ...rest);
export const REQUEST_STEPS = [
  R('prompt', 0, 'User sends an AI request, gets the answer', 'The signed-in browser posts the user\'s prompt to the BFF with its session cookie. PingFederate was the login provider; PingOne Authorize is used later for runtime access policy. The BFF returns the AI response to the browser; tokens remain server-side.', 'Login and runtime policy are two different jobs. The user sees the answer, never a token.'),
  R('reason', 1, 'BFF asks the Agent Service to reason', 'The BFF asks the reasoning-only Agent Service for a tool proposal. The agent does not receive user OAuth tokens or call MCP directly; the BFF remains the tool executor.', 'A model can ask for a tool; only the BFF decides to run it.'),
  R('delegate', 2, 'BFF delegates MCP access through PingFederate', 'The BFF completes the standard two-exchange agent delegation through the PingFederate adapter, and PingFederate returns the scoped MCP access token. These runtime exchanges are separate from the earlier OIDC code exchange and from the ID-JAG flow in the other tab.', 'The two exchanges build a narrow token for this agent action, scoped to the MCP call, not the whole session.'),
  R('call', 3, 'BFF sends the MCP call to PingGateway', 'The BFF sends the scoped token to PingGateway with the MCP request. The MCP result returns through PingGateway to the BFF.', 'PingGateway enforces the access token before the MCP resource call. Tokens remain server-side the whole way back.'),
  R('policy', 4, 'PingGateway asks PingOne Authorize', 'PingOne Authorize evaluates the tool action and must permit it before the MCP resource call.', 'The policy decision, not the token alone, allows the action.'),
  R('tool', 5, 'PingGateway forwards the permitted call', 'After PingOne Authorize permits the action, PingGateway forwards the tool call to the MCP server, which runs the tool and returns the result to PingGateway.', 'A DENY here stops the call before the tool runs. The result is data, not a credential.'),
];

export const REQUEST_GUIDE = REQUEST_STEPS.map(({ title, what, edges }) => ({ title, what, edges }));
export const REQUEST_DIAGRAM = { GROUPS: LOGIN_GROUPS, NODES: REQUEST_NODES, EDGES: REQUEST_EDGES, STEPS: REQUEST_STEPS };
