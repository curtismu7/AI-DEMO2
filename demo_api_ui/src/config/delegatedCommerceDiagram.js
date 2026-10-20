// Delegated-Agent Commerce lifecycle: register -> claim/consent -> protected MCP call
// -> CIBA approval -> revoke. Mirrors DelegatedCommercePage.jsx and
// demo_api_server/routes/delegatedCommerce.js (register/claim/consent/revoke) plus
// the page's /api/auth/ciba/* and callMcpTool calls. Drawn in the Ping style (EmbeddedFlowDiagram with pingStyle):
// one step per arrow, STEPS[i].detail = the MOCK wire form, decoded tokens and standards for the reel.
import {
  APP, PING, INFRA, ISS, HTTP, COOKIE, ACT, JSONRPC, BEARER, MCP, AUTHZEN, STEPUP, GRANT, JWT_TYPE, TOKEN_URL,
  D, tok, json, post, RFC, SPEC,
} from './delegationDiagramDetail';

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const DASHED = { dashed: true };

// Ping palette: dark = people and the shopping agent, red = Ping product, grey = the demo's own routes and records.
export const DELEGATED_COMMERCE_GROUPS = {
  app: { label: 'People and the shopping agent', bg: APP },
  ping: { label: 'Ping product (PingOne, MCP gateway, PingOne Authorize)', bg: PING },
  bff: { label: 'Demo BFF, approval and audit (not Ping products)', bg: INFRA },
};

export const DELEGATED_COMMERCE_NODES = [
  N('admin', 'app', 'Administrator', ['1A: creates the agent', 'receives a one-time claim code'], 0, 0),
  N('customer', 'app', 'Customer', ['1B: claims the agent, picks scopes', 'approves the $600 checkout', 'revokes access'], 0, 360),
  N('bff', 'bff', 'Delegated-commerce routes', ['/api/delegated-commerce/', 'register · claim · consent · revoke', 'secret stays server-side'], 440, 0),
  N('pingone', 'ping', 'PingOne', ['OAuth app for the agent', 'may_act = agent app id', 'delegation grant (read/write)'], 880, 0),
  N('audit', 'bff', 'Audit', ['delegated_agent_revoked', 'event with auditId'], 440, 360),
  N('agent', 'app', 'AF Personal Shopping Agent', ['calls list_orders and checkout', 'with a delegated token'], 440, 720),
  N('mcp', 'ping', 'MCP gateway + PingOne Authorize', ['RFC 8693 exchange: subject + actor', 'list_orders: permit', 'checkout $600: held for approval'], 880, 720),
  N('ciba', 'bff', 'CIBA approval', ['/api/auth/ciba/initiate then poll', '/ciba-approve page', 'engine live or simulated'], 0, 720),
];

export const DELEGATED_COMMERCE_EDGES = [
  E('admin', 'bff', 'register agent (admin only)'), // 0
  E('bff', 'pingone', 'create OAuth/OIDC app; claim code returned'), // 1
  E('admin', 'customer', 'shares the one-time claim code', { vertical: true }), // 2
  E('customer', 'bff', 'claim code, then consent to scopes'), // 3
  E('bff', 'pingone', 'write may_act and grant the delegation'), // 4
  E('agent', 'mcp', 'list_orders with delegated token; orders returned (permit)'), // 5
  E('agent', 'mcp', 'checkout $600 headphones'), // 6
  E('mcp', 'ciba', 'held: step-up / HITL required (428)'), // 7
  E('customer', 'ciba', 'approves out of band', { vertical: true }), // 8
  E('ciba', 'agent', 'poll sees approved; checkout retried', DASHED), // 9
  E('customer', 'bff', 'revoke agent access'), // 10
  E('bff', 'pingone', 'clear may_act, revoke delegations'), // 11
  E('bff', 'audit', 'append delegated_agent_revoked', { vertical: true }), // 12
  E('agent', 'mcp', 'retry list_orders: confirmed denied', DASHED), // 13
];

const MOCK_SECRET = SPEC('Secrets stay server-side', 'The client secret is held by the BFF and never returned to the browser');
const AGENT_ACTOR = tok('Shopping agent actor token · client_credentials, names the agent as the ACTOR', {
  iss: ISS, client_id: '<registered agent app id>', aud: ['agentgateway.ping.demo'], scope: 'agent:invoke', exp: 1790000300,
});
const USER_SUBJECT = tok('Customer access token · the SUBJECT; may_act names the agent after consent', {
  iss: ISS, sub: 'user-1aee74ae', aud: ['enduser.ping.demo'], scope: 'read write', may_act: { sub: '<registered agent app id>' }, exp: 1790003600,
});
const DELEGATED = tok('Delegated token · sub is the customer, act is the shopping agent, scope is what was consented', {
  iss: ISS, sub: 'user-1aee74ae', aud: ['mcpserver.ping.demo'], scope: 'read', act: { sub: '<registered agent app id>' }, exp: 1790000300,
});
const MCP_CALL = (tool, args) =>
  `POST /mcp HTTP/1.1\nAuthorization: Bearer <delegated token>\nContent-Type: application/json\n\n${json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } })}`;
const DECISION = (action, extra = {}) =>
  `Decision asked by the gateway:\n${json({ UserId: 'user-1aee74ae', ActorId: '<registered agent app id>', ActChainDepth: 1, Action: action, ...extra })}`;
const CIBA = SPEC('OpenID CIBA Core 1.0', 'Backchannel authentication: initiate, then poll until the user approves out of band');

export const DELEGATED_COMMERCE_STEPS = [
  { key: 'register', edges: [0], title: 'Admin registers the agent', what: 'POST /register creates a standard PingOne OAuth app for the agent and returns a one-time claim code; the client secret is never sent to the browser.',
    evidence: 'Page shows client_id, claim code, and "Held server-side; never returned".',
    detail: D(post('/api/delegated-commerce/register', { name: 'AF Personal Shopping Agent' }), [HTTP, COOKIE, MOCK_SECRET], [], 'The admin acts through the session cookie; no agent token exists yet.') },
  { key: 'create-app', edges: [1], title: 'The routes create the PingOne app', what: 'The BFF creates the OAuth/OIDC application through the PingOne management API and keeps its secret; the response carries the app id and the claim code.',
    detail: D(`POST https://api.pingone.com/v1/environments/MOCK-ENV-ID/applications HTTP/1.1\nAuthorization: Bearer <worker token>\nContent-Type: application/json\n\n${json({ name: 'AF Personal Shopping Agent', protocol: 'OPENID_CONNECT', type: 'WORKER' })}`, [HTTP, RFC(7591, 'Dynamic Client Registration: registering a client programmatically'), BEARER[0]], [], 'The BFF calls the management API with its own worker token, not a user token.') },
  { key: 'share-code', edges: [2], title: 'The admin shares the claim code', what: 'The one-time code travels between the two people out of band; it is not a credential for PingOne.',
    detail: D('(out of band) claim code: MOCK-CLAIM-1234', [HTTP], [], 'A claim code is a one-time handle, not a token.') },
  { key: 'claim', edges: [3], title: 'Customer claims, then consents', what: 'The customer enters the claim code, picks read and/or write, and consent starts with the claim.',
    evidence: 'Consent panel shows the delegationId and selected scopes; registration becomes active.',
    detail: D(`${post('/api/delegated-commerce/claim', { claimCode: 'MOCK-CLAIM-1234' })}\n\nthen POST /api/delegated-commerce/consent  ${json({ scopes: ['read'] })}`, [HTTP, COOKIE], [], 'The customer acts through the session cookie.') },
  { key: 'grant', edges: [4], title: 'may_act and the delegation grant', what: 'Consent writes may_act for the agent app on the customer\'s PingOne account and a scoped delegation grant; a failed consent restores the prior value.',
    why: 'may_act is what lets PingOne accept this agent as an actor for this user.',
    detail: D(`PATCH https://api.pingone.com/v1/environments/MOCK-ENV-ID/users/user-1aee74ae HTTP/1.1\nAuthorization: Bearer <worker token>\nContent-Type: application/json\n\n${json({ mayAct: { sub: '<registered agent app id>' } })}`, [ACT, HTTP], [USER_SUBJECT]) },
  { key: 'list-orders', edges: [5], title: 'Protected MCP call', what: 'list_orders runs with the delegated token through the RFC 8693 exchange and PingOne Authorize; PERMIT returns the orders.',
    evidence: 'The exchange token event (two-ex-final-token or mcp-access-token) fills the proof rail.',
    detail: D(`${MCP_CALL('list_orders', {})}\n\nExchange behind the token:\nPOST ${TOKEN_URL}\ngrant_type=${encodeURIComponent(GRANT)}&subject_token=<customer token>&actor_token=<agent actor token>&actor_token_type=${encodeURIComponent(JWT_TYPE)}\n\nReply on permit:\n${json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '<orders>' }] } })}`, [MCP[0], JSONRPC, AUTHZEN, ACT, BEARER[0]], [USER_SUBJECT, AGENT_ACTOR, DELEGATED]) },
  { key: 'checkout', edges: [6], title: 'The agent tries to check out', what: 'A $600 checkout is held by policy before it executes.',
    detail: D(`${MCP_CALL('checkout', { product: 'Headphones', amount: 600 })}\n\n${DECISION('checkout', { Amount: 600 })}`, [MCP[0], JSONRPC, AUTHZEN, ACT], [DELEGATED]) },
  { key: 'held', edges: [7], title: 'Held for human approval', what: 'Policy answers with a step-up requirement; the call returns 428 and the page starts CIBA.',
    evidence: 'Approval panel shows engine and auth_req_id.',
    detail: D(`HTTP/1.1 428 Precondition Required\n\n${json({ error: 'step_up_required', message: 'Human approval required for this checkout' })}\n\nPOST /api/auth/ciba/initiate  ${json({ binding_message: 'Approve your $600 headphones purchase', amount: 600, tool: 'checkout' })}`, [STEPUP[0], STEPUP[1], CIBA], [], 'The held call returns an error body, not a token.') },
  { key: 'approve', edges: [8], title: 'The customer approves out of band', what: 'The customer approves on the /ciba-approve page, the way an approval on a phone would arrive.',
    detail: D('POST /api/auth/ciba/approve-now/<auth_req_id> HTTP/1.1\n(sent when the customer approves on the /ciba-approve page)', [CIBA, STEPUP[2]], [], 'An approval is a decision, not a token.') },
  { key: 'poll', edges: [9], title: 'Poll sees approved; checkout retried', what: 'The poll sees the approval and the page retries the checkout, which now completes.',
    evidence: '"Checkout completed after human approval."',
    detail: D(`GET /api/auth/ciba/poll/<auth_req_id> HTTP/1.1\nCookie: session=<opaque session id>\n\n${json({ status: 'approved' })}`, [CIBA, HTTP], [], 'The poll answers with a status, not a token.') },
  { key: 'revoke', edges: [10], title: 'The customer revokes access', what: 'Self-service revoke: the customer takes the agent\'s authority away.',
    evidence: 'Revocation proof shows "Confirmed denied" and a link to the audit evidence.',
    detail: D(post('/api/delegated-commerce/revoke', { reason: 'Customer ended shopping-agent access' }), [HTTP, COOKIE], [], 'The customer acts through the session cookie.') },
  { key: 'clear', edges: [11], title: 'may_act cleared, delegations revoked', what: 'The routes clear may_act on the customer\'s account and revoke the active delegation grants.',
    detail: D(`PATCH https://api.pingone.com/v1/environments/MOCK-ENV-ID/users/user-1aee74ae HTTP/1.1\nAuthorization: Bearer <worker token>\nContent-Type: application/json\n\n${json({ mayAct: null })}`, [ACT, HTTP], [], 'Revocation changes the account; no new token is issued.') },
  { key: 'audit', edges: [12], title: 'An audit event is written', what: 'delegated_agent_revoked is appended with an auditId the page links to.',
    detail: D(`audit event: ${json({ type: 'delegated_agent_revoked', auditId: '<auditId>', userId: 'user-1aee74ae', registrationId: '<registration id>' })}`, [HTTP], [], 'An audit event records who did what; it is not a token.') },
  { key: 'denied', edges: [13], title: 'The retried read is denied', what: 'The page retries list_orders and expects a denial: the delegation no longer exists.',
    detail: D(`${MCP_CALL('list_orders', {})}\n\n${json({ result: { error: '<denial code from the gateway>' } })}`, [MCP[0], JSONRPC, AUTHZEN, ACT], [DELEGATED]) },
];
