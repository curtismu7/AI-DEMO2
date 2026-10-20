// Ping-style diagram for /a2a-protocol-learning, built from the run's token events (live or recorded replay).
// One arrow per token event, in event order. Boxes, groups and the per-step request/token/standards detail reuse
// the /a2a-architecture config (a2aArchitectureDiagram.js, a2aArchitectureStandards.js) where the hop is the same;
// the actor and bearer hops get their own detail here because the architecture page folds them into larger steps.
import { A2A_GROUPS } from './a2aArchitectureDiagram';
import { DELEGATION_DETAIL, DISCOVERY_DETAIL } from './a2aArchitectureStandards';
import { RFC, BEARER, CREDS } from './pingStyleStandards';

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const DASHED = { dashed: true };
const VERT = { vertical: true };
const VERT_DASHED = { vertical: true, dashed: true };

const [USER_TOKEN, GENERALIST_ACTOR, EXCHANGE1_TOKEN] = DELEGATION_DETAIL[1].tokens;
const [, SPECIALIST_ACTOR] = DELEGATION_DETAIL[3].tokens;
const HTTP = RFC(9110, 'HTTP semantics');
const TOKEN_URL = 'https://auth.pingone.com/MOCK-ENV-ID/as/token';
const CC = (clientId, extra) =>
  `POST ${TOKEN_URL} HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=client_credentials&client_id=${clientId}&client_secret=CLIENT_SECRET${extra}`;

// Node templates (positions are the layout; PingOne sits between the two agents because both run exchanges there).
const ACTOR_NODES = {
  user: N('user', 'app', 'Browser (demo_api_ui)', ['holds only the session cookie'], 0, 0),
  generalist: N('generalist', 'app', 'Generalist Agent 1 (BFF)', ['holds the user token', 'runs Exchange #1'], 400, 0),
  specialist: N('specialist', 'app', 'Specialist Agent 2', ['one narrow sensitive read', 'runs Exchange #2 itself'], 800, 0),
  gateway: N('gateway', 'gw', 'A2A MCP Gateway', ['accepts only the A2A audience', 'forwards the act chain to Authorize'], 1200, 0),
  pingone: N('pingone', 'ping', 'PingOne token endpoint', ['RFC 8693 token exchange', 'client_credentials actor tokens'], 600, 320),
};

// Event id -> hop. `detail` is the step detail { form, tokens, refs }; every hop has all three.
const HOPS = {
  'user-token': {
    from: 'user', to: 'generalist', label: 'Subject token held by the BFF', opts: {},
    title: 'The user token is the subject',
    what: 'The browser carries only the session cookie. The BFF holds the user access token and presents it as the subject of Exchange #1.',
    why: 'The user identity stays server-side for the whole chain.',
    detail: {
      form: 'POST /api/a2a/message HTTP/1.1\nCookie: session=SESSION_ID\n\n# No token on the wire: the BFF resolves the session to the user access token server-side.',
      tokens: [USER_TOKEN],
      refs: DELEGATION_DETAIL[0].refs,
    },
  },
  'a2a-agent1-actor': {
    from: 'generalist', to: 'pingone', label: 'client_credentials (actor)', opts: VERT,
    title: 'The generalist authenticates as itself',
    what: 'Agent 1 requests its own client_credentials token. It becomes the actor_token of Exchange #1.',
    why: 'The actor token names who is acting; the subject token names who it acts for.',
    detail: { form: CC('banking-agent-client', '&scope=agent:invoke'), tokens: [GENERALIST_ACTOR], refs: [CREDS[0], HTTP] },
  },
  'a2a-exchange1': {
    from: 'pingone', to: 'generalist', label: 'Exchange #1 (RFC 8693): delegated token', opts: VERT_DASHED,
    title: 'Exchange #1: user to generalist',
    what: 'PingOne exchanges the user token plus the generalist actor token for a delegated token: sub stays the user, act names the generalist.',
    why: 'The act claim records who is acting for the user. This is the token the wire hop will carry.',
    detail: DELEGATION_DETAIL[1],
  },
  'a2a-protocol-bearer': {
    from: 'generalist', to: 'specialist', label: 'Wire bearer (Exchange #1 token)', opts: {},
    title: 'The bearer for the wire hop',
    what: 'The generalist attaches the Exchange #1 token as the bearer of the A2A call, with A2A-Version 1.0.',
    why: 'The bearer proves the user, not just a machine: a client_credentials token would carry no user.',
    detail: {
      form: 'POST /a2a/specialists/:vertical HTTP/1.1\nAuthorization: Bearer <Exchange #1 access token>\nA2A-Version: 1.0',
      tokens: [EXCHANGE1_TOKEN],
      refs: DELEGATION_DETAIL[2].refs,
    },
  },
  'a2a-agent-card': {
    from: 'generalist', to: 'specialist', label: 'Agent Card discovery', opts: DASHED,
    title: 'Agent Card discovery',
    what: 'A plain GET on the well-known path for the vertical. No bearer is needed to read the card.',
    why: 'A card is capability metadata. It grants nothing.',
    detail: DISCOVERY_DETAIL[0],
  },
  'a2a-protocol-message': {
    from: 'generalist', to: 'specialist', label: 'SendMessage (JSON-RPC)', opts: {},
    title: 'The generalist posts SendMessage',
    what: 'A JSON-RPC SendMessage to the specialist endpoint, with the Exchange #1 delegated token as the bearer.',
    why: 'This is the hop that carries the user identity to the specialist.',
    detail: DISCOVERY_DETAIL[2],
  },
  'a2a-agent2-actor': {
    from: 'specialist', to: 'pingone', label: 'client_credentials (actor)', opts: VERT,
    title: 'The specialist authenticates as itself',
    what: 'After the hop arrives, Agent 2 requests its own client_credentials token. It becomes the actor_token of Exchange #2.',
    why: 'The specialist joins the chain with its own credentials, never the generalist\'s.',
    detail: {
      form: CC('<appKey>-specialist-client', '&audience=a2a-intermediate-<appKey>.ping.demo&scope=agent:invoke:<appKey>'),
      tokens: [SPECIALIST_ACTOR],
      refs: [CREDS[0], HTTP],
    },
  },
  'a2a-exchange2': {
    from: 'pingone', to: 'specialist', label: 'Exchange #2 (nested act)', opts: VERT_DASHED,
    title: 'Exchange #2: the specialist joins the chain',
    what: 'PingOne exchanges the delegated token for an MCP token: act becomes {specialist, act: {generalist}}, subject still the user.',
    why: 'The generalist never sees this token. The nested chain shows every agent that acted for the user.',
    detail: DELEGATION_DETAIL[3],
  },
  'a2a-mcp-tool': {
    from: 'specialist', to: 'gateway', label: 'MCP tool call (nested-act token)', opts: {},
    title: 'The specialist calls the MCP tool',
    what: 'The specialist calls the sensitive tool through the A2A MCP Gateway with the nested-act token.',
    why: 'The gateway accepts only tokens whose audience is the A2A gateway resource.',
    detail: DELEGATION_DETAIL[5],
  },
  'a2a-mcp-result': {
    from: 'gateway', to: 'specialist', label: 'Tool result', opts: DASHED,
    title: 'The tool result comes back',
    what: 'The gateway returns the tool result to the specialist.',
    why: 'Only the result returns; no token does.',
    detail: DELEGATION_DETAIL[6],
  },
};

// A captured run with an event id this page does not know still draws: a generic PingOne hop with an honest empty detail.
const FALLBACK = {
  from: 'pingone', to: 'generalist', label: 'Token event', opts: VERT_DASHED,
  title: 'Token event',
  what: 'A token event this page has no teaching text for. Its decoded evidence is in the list under the diagram.',
  why: 'New event types still render instead of vanishing.',
  detail: { form: '# No wire request is modelled for this event.', tokens: [], refs: [HTTP, BEARER[0]] },
};

export const LEARN_EVENT_IDS = Object.keys(HOPS);

export function buildLearnDiagram(tokenEvents, labels = {}) {
  const events = (Array.isArray(tokenEvents) ? tokenEvents : []).filter(Boolean);
  const hops = events.map((ev) => HOPS[ev.id] || FALLBACK);
  const used = new Set();
  hops.forEach((h) => { used.add(h.from); used.add(h.to); });
  const NODES = Object.values(ACTOR_NODES)
    .filter((n) => used.has(n.id))
    .map((n) => (labels[n.id] ? { ...n, label: labels[n.id] } : n));
  const EDGES = hops.map((h) => (Object.keys(h.opts).length ? [h.from, h.to, h.label, h.opts] : [h.from, h.to, h.label]));
  const STEPS = hops.map((h, i) => ({ key: events[i].id || `ev-${i}`, edges: [i], title: h.title, what: h.what, why: h.why, detail: h.detail }));
  return { GROUPS: A2A_GROUPS, NODES, EDGES, STEPS };
}
