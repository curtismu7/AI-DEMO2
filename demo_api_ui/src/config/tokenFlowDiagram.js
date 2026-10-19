// /architecture/token-flow: one pingStyle figure (StaticFlowDiagram) per scenario of the Scenario picker, as { GROUPS, NODES, EDGES, STEPS }.
// The boxes keep one master layout (so a scenario only shows the boxes it uses, in the same places); the arrows are the
// scenario's steps in order, in the same order and count as the page's TOKEN_FLOW_SIMULATE_STEPS / SCENARIO_STEPS_TF so the
// page's step counter, the reel and the diagram stay in step. Per-arrow detail: tokenFlowStandards.js.
import { TOKEN_FLOW_DETAIL } from './tokenFlowStandards';

// Ping palette: red = Ping product, dark = people, apps and agents, grey = model and servers behind the gateway.
export const TOKEN_FLOW_GROUPS = {
  app: { label: 'User, app and agent', bg: '#151a24' },
  ping: { label: 'Ping products', bg: '#b5231a' },
  srv: { label: 'LLM, MCP server and API', bg: '#5a5f69' },
};

// Master layout: a 4 by 4 grid (columns about 300 apart, rows 180 apart) so the figure fits the canvas at a readable size. A box keeps its
// cell in every scenario; a scenario draws only the boxes it uses. Arrows between boxes in different columns run out of the sides;
// boxes in one column are joined straight down (V) or, going back up, by a bowed curve at the left/right sides (lane).
const COLX = [0, 340, 800, 1220]; // the web app / agent gap is wider: three arrows and the PingOne detours share it
const ROW = 270;
const MASTER = [
  { id: 'user', group: 'app', label: 'User', sub: ['signed in, in the browser'], x: COLX[0], y: 1 * ROW },
  { id: 'webapp', group: 'app', label: 'Web App + Chatbot', sub: ['React SPA', 'holds only a session cookie'], x: COLX[1], y: 1 * ROW },
  { id: 'pingone', group: 'ping', label: 'PingOne', sub: ['authorization server', 'RFC 8693 token exchange'], x: COLX[2], y: 0 * ROW },
  { id: 'agent', group: 'app', label: 'Agent (BFF)', sub: ['demo-api-server', 'holds the tokens in its session', 'LangGraph agent + MCP pipeline'], x: COLX[2], y: 1 * ROW },
  { id: 'llm', group: 'srv', label: 'LLM', sub: ['picks the tool to call', 'never sees the tokens'], x: COLX[2], y: 2 * ROW },
  { id: 'authorize', group: 'ping', label: 'PingOne Authorize', sub: ['McpToolsList / McpToolCall', 'PERMIT / DENY / hold'], x: COLX[3], y: 0 * ROW },
  { id: 'gateway', group: 'ping', label: 'PingOne Agent Gateway', sub: ['checks aud, act and scope', 'asks Authorize per tool'], x: COLX[3], y: 1 * ROW },
  { id: 'mcp', group: 'srv', label: 'MCP Server', sub: ['banking tools', 'takes the forwarded token'], x: COLX[3], y: 2 * ROW },
  { id: 'rs', group: 'srv', label: 'Banking API', sub: ['resource server', 'validates the token itself'], x: COLX[3], y: 3 * ROW },
];

const D = { dashed: true }; // a token or a decision coming back (blue dashed under pingStyle)
const V = { vertical: true };
const R = { lane: -1 }; // back up one column along the right-hand sides
const L = { lane: 1 }; // out of the left side, round over the top to the left side above
// [from, to, label, opts?] per step. Each list matches its step list on the page, one arrow per step.
export const TOKEN_FLOW_ENDPOINTS = {
  'full-flow': [
    ['user', 'webapp', 'User sends request'],
    ['webapp', 'agent', 'Chatbot receives message'],
    ['webapp', 'pingone', 'OAuth 2.0 PKCE login', L],
    ['pingone', 'webapp', 'ID token + access token issued', D],
    ['webapp', 'agent', 'Agent takes over; BFF holds the token'],
    ['agent', 'llm', 'LLM processes intent, selects tool', V],
    ['agent', 'pingone', 'RFC 8693 exchange: user token to delegation token', R],
    ['pingone', 'agent', 'Delegated token returned', { ...D, ...V }],
    ['agent', 'gateway', 'Delegated token arrives at the gateway'],
    ['gateway', 'authorize', 'McpToolsList + McpToolCall checks', R],
    ['authorize', 'gateway', 'PERMIT: tool call allowed', { ...D, ...V }],
    ['gateway', 'mcp', 'Gateway forwards the call to the MCP server', V],
    ['mcp', 'rs', 'Banking API: GET /accounts', V],
    ['mcp', 'rs', 'Investments API: same token', V],
    ['agent', 'webapp', 'Results returned to the user'],
  ],
  'id-token': [
    ['webapp', 'pingone', 'PKCE authorization request', L],
    ['agent', 'pingone', 'Code exchange at the token endpoint', R],
    ['pingone', 'agent', 'ID token issued', { ...D, ...V }],
    ['pingone', 'agent', 'Access token issued', { ...D, ...V }],
    ['agent', 'webapp', 'Session cookie; tokens stay in the BFF'],
  ],
  'user-token': [
    ['webapp', 'agent', 'BFF holds the user access token'],
    ['agent', 'pingone', 'RFC 8693 exchange #1: user token in, delegation out', R],
    ['agent', 'gateway', 'Delegated token arrives at the gateway'],
    ['gateway', 'mcp', 'Gateway forwards the call to the MCP server', V],
    ['mcp', 'rs', 'MCP Server calls the Banking API', V],
  ],
  'get-accounts': [
    ['agent', 'llm', 'LLM decides: get_my_accounts (read)', V],
    ['gateway', 'authorize', 'McpToolsList', R],
    ['authorize', 'gateway', 'PERMIT: tools discovery allowed', { ...D, ...V }],
    ['gateway', 'authorize', 'McpToolCall: get_my_accounts', L],
    ['authorize', 'gateway', 'PERMIT: read is sufficient', { ...D, ...V }],
    ['mcp', 'rs', 'Banking API returns accounts: 200 OK', V],
  ],
  withdrawal: [
    ['agent', 'llm', 'LLM decides: create_transfer (write)', V],
    ['gateway', 'authorize', 'McpToolCall: create_transfer, high risk', R],
    ['gateway', 'agent', 'Hold: 428, human consent required', D],
    ['agent', 'webapp', 'Agent waits for human approval'],
    ['user', 'webapp', 'User approves'],
    ['mcp', 'rs', 'Banking API executes the transfer: 200 OK', V],
  ],
  'bad-scope': [
    ['agent', 'gateway', 'Read-only token tries a write tool'],
    ['gateway', 'authorize', 'McpToolCall: create_transfer', R],
    ['authorize', 'gateway', 'DENY: insufficient scope', { ...D, ...V }],
    ['gateway', 'agent', '403 Forbidden returned to the agent', D],
    ['agent', 'webapp', 'Agent tells the user, no retry'],
  ],
  'api-key-path': [
    ['agent', 'gateway', 'Path A: user bearer arrives'],
    ['gateway', 'rs', 'Scope gate, then swap bearer for API key', V],
    ['agent', 'webapp', 'SPA routed to /path/mortgage'],
  ],
  'dual-token-path': [
    ['agent', 'gateway', 'Path B: user bearer arrives'],
    ['gateway', 'rs', 'Bearer + id_token to /identity', V],
    ['rs', 'gateway', 'Decoded claims returned', { ...D, ...R }],
    ['agent', 'webapp', 'SPA routed to /path/dualtoken-info'],
  ],
  'oauth-bearer-path': [
    ['agent', 'gateway', 'Path C: user bearer arrives'],
    ['gateway', 'authorize', 'McpToolCall: demo_show_accounts', R],
    ['gateway', 'rs', 'Forward the bearer unchanged to the Banking API', V],
  ],
};

// Per-scenario { boxId: { x, y } } overrides of the master layout (filled in where a scenario needs its own spacing).
const TOKEN_FLOW_LAYOUT = {
  // the read-only call goes out and the 403 comes back between the same two boxes: offset them so the two arrows do not share a corridor
  'bad-scope': { gateway: { y: Math.round(1.45 * ROW) } },
};

// The canvas fits the boxes, not the arrows that bow out beside them, so a figure of only two columns would zoom in until its
// right and left detours leave the canvas. Spread such a figure's columns until the boxes span at least MIN_SPAN wide.
const BOX_W = 250;
const MIN_SPAN = 1050;
function spread(nodes) {
  const xs = nodes.map((n) => n.x);
  const lo = Math.min(...xs);
  const span = Math.max(...xs) - lo;
  const k = span > 0 ? Math.min(2.4, Math.max(1, (MIN_SPAN - BOX_W) / span)) : 1;
  return nodes.map((n) => ({ ...n, x: Math.round(lo + (n.x - lo) * k) }));
}

function build(key) {
  const edges = TOKEN_FLOW_ENDPOINTS[key];
  const used = new Set(edges.flatMap((e) => [e[0], e[1]]));
  const detail = TOKEN_FLOW_DETAIL[key];
  const place = (n) => ({ ...n, ...(TOKEN_FLOW_LAYOUT[key] || {})[n.id] });
  return {
    GROUPS: TOKEN_FLOW_GROUPS,
    NODES: spread(MASTER.filter((n) => used.has(n.id)).map(place)),
    EDGES: edges.map(([a, b, label, opts]) => (opts ? [a, b, label, opts] : [a, b, label])),
    STEPS: edges.map((e, i) => ({ key: `${key}-${i + 1}`, edges: [i], title: e[2], what: `${e[0]} to ${e[1]}: ${e[2]}`, detail: detail[i] })),
  };
}

export const TOKEN_FLOW_DIAGRAMS = Object.fromEntries(Object.keys(TOKEN_FLOW_ENDPOINTS).map((k) => [k, build(k)]));
