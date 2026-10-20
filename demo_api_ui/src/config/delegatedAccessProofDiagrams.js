// /academy/delegation/guided ("Delegated Access Proof", OAuthTokenExchangeLessonPage): the two figures as StaticFlowDiagram
// configs { GROUPS, NODES, EDGES, STEPS } drawn in the Ping style (pingStyle): the RFC 8693 exchange across three arrows, and
// the gateway authorization proof with its deny / step-up branch. Reel step k = EDGES[k]. Wire forms and tokens are MOCK.
import {
  APP, PING, INFRA, ISS, HTTP, COOKIE, ACT, BEARER, INTROSPECT, MCP, AUTHZ, STEPUP, AUTHZEN, GRANT, JWT_TYPE, TOKEN_URL,
  D, tok, json, USER_TOKEN, EXCHANGE_RFC,
} from './delegationDiagramDetail';

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const DASHED = { dashed: true };
const V = { vertical: true };

export const PROOF_GROUPS = {
  app: { label: 'Browser, BFF and challenge', bg: APP },
  ping: { label: 'Ping product (PingOne, Agent Gateway, PingOne Authorize)', bg: PING },
  infra: { label: 'Resource server and tool', bg: INFRA },
};

const SUBJECT = USER_TOKEN;
const ACTOR = tok('Agent actor token · client_credentials, names the agent as the ACTOR', {
  iss: ISS, client_id: 'banking-agent-client', aud: ['agentgateway.ping.demo'], scope: 'agent:invoke', exp: 1790000300,
});
const SCOPED = tok('Scoped MCP token · narrower audience and scope, act = the agent, sub still the user', {
  iss: ISS, sub: 'user-1aee74ae', aud: ['mcpserver.ping.demo'], scope: 'read', act: { sub: 'banking-agent-client' }, exp: 1790000300,
});

// ---- Figure 1: the exchange ----
export const EXCHANGE_NODES = [
  N('browser', 'app', 'Browser', ['Agent runs here', 'holds only the session cookie'], 0, 0),
  N('bff', 'app', 'BFF', ['Holds the user token', 'never sends it to the model'], 440, 0),
  N('pingone', 'ping', 'PingOne', ['RFC 8693 exchange', 'issues the narrower token'], 880, 0),
  N('mcp', 'infra', 'MCP Server', ['Verifies aud, scope and act', 'before it executes'], 440, 280),
];

export const EXCHANGE_EDGES = [
  E('browser', 'bff', 'user session'), // 0
  E('bff', 'pingone', 'exchange: subject + actor; returns the scoped MCP token'), // 1
  E('bff', 'mcp', 'tool call with MCP token', V), // 2
];

export const EXCHANGE_STEPS = [
  {
    key: 'session', edges: [0], title: 'User session', what: 'PingOne authenticated the person. The BFF keeps the browser session and the user token out of the model.',
    why: 'T1: who is acting for whom is settled before any agent runs.',
    detail: D('GET /api/accounts HTTP/1.1\nHost: api.ping.demo:3001\nCookie: session=<opaque session id>', [COOKIE, HTTP], [],
      'The browser sends only the session cookie. The user access token stays server-side in the BFF.'),
  },
  {
    key: 'exchange', edges: [1], title: 'RFC 8693 exchange: subject and actor in, scoped token out', what: 'The BFF presents the user token as the subject and the agent token as the actor, and asks for only the authority this action needs. PingOne returns a token with a narrower audience, narrower scopes and an act claim the gateway can verify.',
    why: 'T2: shaped for its job. The user token never left the BFF.',
    detail: D(`POST ${TOKEN_URL} HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=${encodeURIComponent(GRANT)}\n&subject_token=<user access token>\n&subject_token_type=${encodeURIComponent(JWT_TYPE)}\n&actor_token=<agent actor token>\n&actor_token_type=${encodeURIComponent(JWT_TYPE)}\n&audience=mcpserver.ping.demo\n&scope=read\n\nResponse:\n${json({ access_token: '<scoped MCP token>', issued_token_type: JWT_TYPE, token_type: 'Bearer', expires_in: 300 })}`,
      [ACT, EXCHANGE_RFC, BEARER[2], INTROSPECT[2], HTTP], [SUBJECT, ACTOR, SCOPED]),
  },
  {
    key: 'call', edges: [2], title: 'Governed tool call', what: 'The BFF calls the tool with the scoped token. The MCP server verifies aud, scope and act before it executes.',
    why: 'Each downstream service gets a token shaped for its job, not the user token.',
    detail: D(`POST /mcp HTTP/1.1\nHost: mcpserver.ping.demo\nAuthorization: Bearer <scoped MCP token>\nContent-Type: application/json\n\n${json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_account_balance', arguments: {} } })}`,
      [MCP[0], MCP[3], BEARER[0], HTTP], [SCOPED]),
  },
];

// ---- Figure 2: the proof ----
export const PROOF_NODES = [
  N('gateway', 'ping', 'Agent Gateway', ['Checks aud, scope and act', 'before the request moves on'], 0, 0),
  N('authorize', 'ping', 'PingOne Authorize', ['PERMIT, DENY, or STEP-UP', 'for this user, agent and action'], 440, 0),
  N('tool', 'infra', 'MCP tool', ['Runs only on PERMIT', 'records the result as evidence'], 880, 0),
  N('challenge', 'app', 'Challenge', ['returned instead of the tool', 'a new decision comes first'], 440, 280),
];

export const PROOF_EDGES = [
  E('gateway', 'authorize', 'decision request'), // 0
  E('authorize', 'tool', 'PERMIT', DASHED), // 1
  E('authorize', 'challenge', 'DENY / STEP-UP', { dashed: true, vertical: true }), // 2
];

const DECISION_REQ = `POST https://api.pingone.com/v1/environments/MOCK-ENV-ID/decisionEndpoints/MOCK-ID HTTP/1.1\nContent-Type: application/json\n\n${json({
  UserId: 'user-1aee74ae', ActorId: 'banking-agent-client', ActChainDepth: 1, Audience: 'mcpserver.ping.demo', Action: 'get_account_balance',
})}`;

export const PROOF_STEPS = [
  {
    key: 'decide', edges: [0], title: 'Gateway authorization', what: 'The Agent Gateway validates aud, scope and act, then asks PingOne Authorize for a decision before the request can move downstream.',
    why: 'The token proves delegation; the policy decision proves whether this action is allowed.',
    detail: D(DECISION_REQ, [AUTHZEN, AUTHZ[3], ACT, MCP[0]], [SCOPED]),
  },
  {
    key: 'permit', edges: [1], title: 'Policy decision: PERMIT', what: 'PERMIT lets the tool execute with the narrowed token; the result is recorded as evidence.',
    detail: D(`HTTP/1.1 200 OK\n\n${json({ decision: 'PERMIT', statements: [] })}`, [AUTHZEN, AUTHZ[1]], [], 'A decision response carries no token.'),
  },
  {
    key: 'deny', edges: [2], title: 'Challenge instead of the tool', what: 'Stop before tool execution, return the challenge, and require a new decision before retrying.',
    why: 'Neither outcome reaches the tool.',
    detail: D(`HTTP/1.1 200 OK\n\n${json({ decision: 'DENY', statements: [{ code: 'step_up_required', payload: 'acr=Agent-Consent-Login' }] })}`, [AUTHZEN, STEPUP[1], STEPUP[0]], [], 'A decision response carries no token.'),
  },
];

export const EXCHANGE_DIAGRAM = { GROUPS: PROOF_GROUPS, NODES: EXCHANGE_NODES, EDGES: EXCHANGE_EDGES, STEPS: EXCHANGE_STEPS };
export const PROOF_DIAGRAM = { GROUPS: PROOF_GROUPS, NODES: PROOF_NODES, EDGES: PROOF_EDGES, STEPS: PROOF_STEPS };
