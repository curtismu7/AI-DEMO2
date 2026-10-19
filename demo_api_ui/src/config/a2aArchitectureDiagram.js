// Config for the two figures on /a2a-architecture, in the shared pingStyle shape { GROUPS, NODES, EDGES, STEPS }.
// Delegation flow = docs/a2a-delegation-sequence.mmd (same nine messages, same order); card discovery =
// docs/a2a-card-discovery.mmd (the capabilities return is its own arrow). The mmd's PingOne Authorize participant is split into
// the token endpoint (exchanges) and Authorize (the decision): the specialist's tool gate is what asks Authorize. Reel step k = EDGES[k].
// STEPS[i].detail comes from a2aArchitectureStandards.js.
import { DELEGATION_DETAIL, DISCOVERY_DETAIL } from './a2aArchitectureStandards';

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const DASHED = { dashed: true }; // answers and decisions (blue dashed under pingStyle)

// Ping palette: red = Ping product, dark = apps and agents, grey = the demo's own Node gateway (not a Ping product).
export const A2A_GROUPS = {
  app: { label: 'Browser and agents', bg: '#151a24' },
  gw: { label: 'Demo MCP gateway (Node, not a Ping product)', bg: '#5a5f69' },
  ping: { label: 'Ping product: PingOne', bg: '#b5231a' },
};

const S = (detail, key, i, title, what, why) => ({ key, edges: [i], title, what, why, detail: detail[i] });

// ---- Delegation flow ----
export const DELEGATION_NODES = [
  N('u', 'app', 'Browser (demo_api_ui)', ['holds only the session cookie'], 0, 0),
  N('g', 'app', 'Generalist Agent 1 (BFF)', ['holds the user token', 'runs Exchange #1'], 400, 0),
  N('s', 'app', 'Specialist Agent 2', ['one narrow sensitive read', 'runs Exchange #2 itself'], 800, 0),
  N('m', 'gw', 'A2A MCP Gateway', ['accepts only the A2A audience', 'forwards the act chain to Authorize'], 1200, 0),
  N('p', 'ping', 'PingOne token endpoint', ['RFC 8693 token exchange', 'issues both delegated tokens'], 800, 320),
  N('az', 'ping', 'PingOne Authorize', ['PERMIT or DENY', 'over the act chain'], 1200, 320),
];

export const DELEGATION_EDGES = [
  E('u', 'g', 'UC2 request (session cookie)'), // 0
  E('g', 'p', 'Exchange #1 (RFC 8693)'), // 1
  E('g', 's', 'A2A wire hop: SendMessage, Bearer = Exchange #1 token'), // 2
  E('s', 'p', 'Exchange #2 (nested act)', { vertical: true }), // 3
  E('s', 'az', 'Authorize approves the nested act chain', DASHED), // 4
  E('s', 'm', 'MCP tool call (nested-act token)'), // 5
  E('m', 's', 'Tool result', DASHED), // 6
  E('s', 'g', 'JSON-RPC response', DASHED), // 7
  E('g', 'u', 'Result and token-chain events', DASHED), // 8
];

const DS = (...a) => S(DELEGATION_DETAIL, ...a);
export const DELEGATION_STEPS = [
  DS('request', 0, 'The browser asks the generalist', 'The browser posts the UC2 request with its session cookie. The BFF holds the user access token; the browser never sees it.', 'The user identity stays server-side for the whole chain.'),
  DS('exchange1', 1, 'Exchange #1: user to generalist', 'The generalist gets its own actor token, then exchanges the user token for a delegated token: sub stays the user, act names the generalist.', 'The act claim records who is acting for the user. This is the token the wire hop will carry.'),
  DS('wire-hop', 2, 'A2A wire hop to the specialist', 'The generalist calls SendMessage on the specialist with the Exchange #1 token as the bearer. The specialist checks signature, issuer, expiry, audience, the scope agent:invoke:<appKey>, an act chain exactly one deep, and that the actor is the generalist.', 'The bearer proves the user, not just a machine: a client_credentials token would carry no user.'),
  DS('exchange2', 3, 'Exchange #2: the specialist joins the chain', 'After the hop arrives the specialist authenticates as itself and exchanges the delegated token for an MCP token: act becomes {specialist, act: {generalist}}, subject still the user.', 'The generalist never sees this token. The nested chain shows every agent that acted for the user.'),
  DS('authorize', 4, 'PingOne Authorize decides on the act chain', 'The specialist asks PingOne Authorize before the tool runs. The decision reads the chain off the token: ActChainDepth 2, CallerType agent_a2a, the specialist and the generalist ids. It answers PERMIT or DENY.', 'Whether a delegation is allowed is a policy decision, not an accident of token claims.'),
  DS('tool-call', 5, 'The specialist calls the MCP tool', 'The specialist calls the sensitive tool through the A2A MCP Gateway with the nested-act token.', 'The gateway accepts only tokens whose audience is the A2A gateway resource; the PingOne Authorize decision it relies on reads the act chain.'),
  DS('tool-result', 6, 'The tool result comes back', 'The gateway returns the tool result to the specialist.', 'Only the result returns; no token does.'),
  DS('rpc-response', 7, 'The specialist answers the generalist', 'The specialist replies with one Message: a text part carrying the result and the chain facts in the message metadata.', 'No access token crosses back over the A2A response boundary.'),
  DS('result', 8, 'The generalist answers the browser', 'The BFF returns the reply and the token-chain events (a2a-protocol-bearer, a2a-agent-card, a2a-protocol-message) for the teaching view.', 'The events show decoded claims, never raw tokens.'),
];

// ---- Card discovery ----
export const DISCOVERY_NODES = [
  N('gen', 'app', 'Generalist (Agent 1)', [], 0, 0),
  N('card', 'app', 'Agent Card', ['capabilities'], 580, 0),
  N('spec', 'app', 'Specialist (Agent 2)', [], 0, 200),
];

export const DISCOVERY_EDGES = [
  E('gen', 'card', 'GET /a2a/specialists/:vertical/.well-known/agent-card.json'), // 0
  E('card', 'gen', 'capabilities', DASHED), // 1
  E('gen', 'spec', 'POST /a2a/specialists/:vertical (JSON-RPC SendMessage)', { vertical: true }), // 2
];

const XS = (...a) => S(DISCOVERY_DETAIL, ...a);
export const DISCOVERY_STEPS = [
  XS('get-card', 0, 'The generalist fetches the Agent Card', 'A plain GET on the well-known path for the vertical. No bearer is needed to read a card.', 'A card is capability metadata. It grants nothing.'),
  XS('capabilities', 1, 'The card returns the capabilities', 'The signed card lists the skills, the JSON-RPC interface and the pingoneBearer security scheme the specialist expects.', 'The generalist learns what to send and which credential to attach before it calls.'),
  XS('send-message', 2, 'The generalist posts SendMessage', 'A JSON-RPC SendMessage to the specialist endpoint, with the Exchange #1 delegated token as the bearer and A2A-Version 1.0.', 'This is the hop that carries the user identity to the specialist.'),
];

export const DELEGATION_DIAGRAM = { GROUPS: A2A_GROUPS, NODES: DELEGATION_NODES, EDGES: DELEGATION_EDGES, STEPS: DELEGATION_STEPS };
export const DISCOVERY_DIAGRAM = { GROUPS: A2A_GROUPS, NODES: DISCOVERY_NODES, EDGES: DISCOVERY_EDGES, STEPS: DISCOVERY_STEPS };
