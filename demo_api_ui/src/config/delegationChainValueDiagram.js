// The two runs on DelegationChainValuePage: UC2 "hand off to a specialist" and UC2.6
// "simulate an agent identity mismatch", drawn in the Ping style (EmbeddedFlowDiagram with pingStyle). Token-chain ids are
// from the catalog evidence in demo_api_server/config/useCases.js (a2a-delegation, a2a-generalist-mismatch).
// One step per arrow; STEPS[i].detail holds the MOCK wire form, decoded tokens and standards for the reel.
import {
  APP, PING, INFRA, ISS, HTTP, ACT, JSONRPC, BEARER, MCP, AUTHZEN, AUTHZ, GRANT, JWT_TYPE, TOKEN_URL,
  D, tok, json, USER_TOKEN, SPEC,
} from './delegationDiagramDetail';

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const DASHED = { dashed: true };

// Ping palette: dark = page and agents, red = Ping product, grey = evidence the demo keeps.
export const DELEGATION_CHAIN_GROUPS = {
  agent: { label: 'This page and the agents', bg: APP },
  ping: { label: 'Ping product (PingOne, Gateway, PingOne Authorize)', bg: PING },
  evidence: { label: 'Evidence the demo keeps', bg: INFRA },
};

export const DELEGATION_CHAIN_NODES = [
  N('page', 'agent', 'This page (Run button)', ['/api/agent/invoke via', 'sendAgentMessage', 'sporting-goods vertical'], 0, 260),
  N('generalist', 'agent', 'Generalist agent', ['hop 1: actor token', 'a2a-agent1-actor'], 440, 260),
  N('specialist', 'agent', 'Specialist agent', ['hop 2: actor token', 'a2a-agent2-actor'], 880, 260),
  N('idp', 'ping', 'PingOne token exchange', ['a2a-exchange1, a2a-exchange2', 'nested act claim, scope narrowed'], 770, 0),
  N('gw', 'ping', 'Gateway + PingOne Authorize', ['sensitive_holdings tool call', 'checks act chain and actor identity'], 880, 520),
  N('rogue', 'agent', 'Unregistered agent identity', ['fabricated for the probe;', 'no real token minted'], 440, 520),
  N('rail', 'evidence', 'Token-chain rail', ['each hop, claims, nested act', 'shown after a run'], 880, 780),
];

export const DELEGATION_CHAIN_EDGES = [
  E('page', 'generalist', 'prompt: hand off to a specialist'), // 0
  E('generalist', 'idp', 'exchange 1: user token to delegated token'), // 1
  E('generalist', 'specialist', 'hands off the task'), // 2
  E('specialist', 'idp', 'exchange 2: nested act, narrower scope'), // 3
  E('specialist', 'gw', 'tool dispatched with the delegated token'), // 4
  E('page', 'rogue', 'prompt: simulate an agent identity mismatch'), // 5
  E('rogue', 'gw', 'same decision call, unregistered actor', DASHED), // 6
  E('gw', 'rail', 'every hop recorded', DASHED), // 7
];

const EX1 = tok('Exchange 1 token · delegated: sub is the user, act is the generalist', {
  iss: ISS, sub: 'user-1aee74ae', aud: ['a2a-intermediate-<appKey>.ping.demo'], scope: 'agent:invoke:<appKey>', act: { sub: 'banking-agent-client' }, exp: 1790000300,
});
const EX2 = tok('Exchange 2 token · nested act chain, sub still the user', {
  iss: ISS, sub: 'user-1aee74ae', aud: ['mcpgateway-a2a.ping.demo'], scope: 'purchase:read', act: { sub: '<appKey>-specialist-client', act: { sub: 'banking-agent-client' } }, exp: 1790000300,
});
const EXCHANGE_FORM = (subject, actor, audience, scope) =>
  `POST ${TOKEN_URL} HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=${encodeURIComponent(GRANT)}\n&subject_token=<${subject}>\n&subject_token_type=${encodeURIComponent(JWT_TYPE)}\n&actor_token=<${actor}>\n&actor_token_type=${encodeURIComponent(JWT_TYPE)}\n&audience=${audience}\n&scope=${scope}`;
const DECISION = (actor, depth) =>
  `POST https://api.pingone.com/v1/environments/MOCK-ENV-ID/decisionEndpoints/MOCK-ID HTTP/1.1\nContent-Type: application/json\n\n${json({ UserId: 'user-1aee74ae', CallerType: 'agent_a2a', ActChainDepth: depth, ActorId: actor, Action: 'sensitive_holdings' })}`;
const A2A_WIRE = SPEC('A2A Protocol 1.0', 'SendMessage over JSON-RPC, the delegated token as the bearer');
const NO_TOKEN_RECORD = 'The rail stores decoded claims for display; it never keeps a raw token.';

export const DELEGATION_CHAIN_STEPS = [
  { key: 'prompt', edges: [0], title: 'Run: hand off to a specialist', what: 'The page sends the prompt through /api/agent/invoke, the same path a chip click uses.',
    evidence: 'Catalog evidence chain starts at user-token.',
    detail: D('POST /api/agent/invoke HTTP/1.1\nHost: api.ping.demo:3001\nCookie: session=<opaque session id>\nContent-Type: application/json\n\n{ "message": "hand off to a specialist" }', [HTTP, BEARER[0]], [USER_TOKEN]) },
  { key: 'exchange1', edges: [1], title: 'Exchange 1: user to generalist', what: 'The generalist gets its actor token (a2a-agent1-actor), then exchanges the user token for a delegated one: sub stays the user, act names the generalist.',
    evidence: 'a2a-agent1-actor, a2a-exchange1.',
    detail: D(EXCHANGE_FORM('user access token', 'generalist actor token', 'a2a-intermediate-<appKey>.ping.demo', 'agent:invoke:<appKey>'), [ACT, HTTP], [USER_TOKEN, EX1]) },
  { key: 'handoff', edges: [2], title: 'The generalist hands off the task', what: 'SendMessage to the specialist with the Exchange 1 token as the bearer, so the specialist knows which user it acts for.',
    detail: D(`POST /a2a/specialists/:vertical HTTP/1.1\nAuthorization: Bearer <Exchange 1 token>\nA2A-Version: 1.0\nContent-Type: application/json\n\n${json({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { role: 'ROLE_USER', parts: [{ text: '<subtask>' }] } } })}`, [A2A_WIRE, JSONRPC, BEARER[0]], [EX1]) },
  { key: 'exchange2', edges: [3], title: 'Exchange 2: the specialist joins the chain', what: 'The specialist authenticates as itself (a2a-agent2-actor) and exchanges the delegated token: act becomes {specialist, act: {generalist}}, scope narrower.',
    evidence: 'a2a-agent2-actor, a2a-exchange2.',
    detail: D(EXCHANGE_FORM('Exchange 1 token', 'specialist actor token', 'mcpgateway-a2a.ping.demo', 'purchase:read'), [ACT, HTTP], [EX1, EX2]) },
  { key: 'dispatch', edges: [4], title: 'The governed tool call', what: 'sensitive_holdings is dispatched with the nested-act token; the gateway asks PingOne Authorize, which reads the act chain.',
    evidence: 'tool-dispatched.',
    detail: D(`POST /mcp HTTP/1.1\nAuthorization: Bearer <Exchange 2 token>\nContent-Type: application/json\n\n${json({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'sensitive_holdings', arguments: {} } })}\n\nDecision asked by the gateway:\n${DECISION('<appKey>-specialist-client', 2)}`, [MCP[0], AUTHZEN, AUTHZ[3], ACT], [EX2]) },
  { key: 'probe', edges: [5], title: 'Run: simulate an agent identity mismatch', what: 'Repeats the real delegation, then probes the same Authorize decision with an unregistered actor identity.',
    evidence: 'Evidence adds a2a-mismatch-probe.',
    detail: D('POST /api/agent/invoke HTTP/1.1\nHost: api.ping.demo:3001\nCookie: session=<opaque session id>\nContent-Type: application/json\n\n{ "message": "simulate an agent identity mismatch" }', [HTTP], [], 'The probe mints no token: the unregistered identity is fabricated for the decision call only.') },
  { key: 'mismatch', edges: [6], title: 'The same decision, an unregistered actor', what: 'The decision call carries an actor that is not the registered generalist; policy denies with invalid_a2a_generalist (PERMIT_THEN_DENY).',
    evidence: 'Policy denies with invalid_a2a_generalist.',
    detail: D(`${DECISION('<unregistered agent id>', 1)}\n\nResponse:\n${json({ decision: 'DENY', statements: [{ code: 'invalid_a2a_generalist' }] })}`, [AUTHZEN, AUTHZ[3]], [], 'No token is minted for the probe, so there is nothing to decode.') },
  { key: 'rail', edges: [7], title: 'Evidence on the rail', what: 'After a run the page renders the token-chain rail with subject, audience, scopes and the nested act chain.',
    evidence: 'Shown in the "The chain from that run" section once either Run completes.',
    detail: D('No request: the page reads the token-chain events the run already produced\n(tokenChainTraceStore, in the browser) and renders them as the rail.', [AUTHZ[3]], [], NO_TOKEN_RECORD) },
];
