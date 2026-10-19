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

// Master layout. Columns 330-420 apart, arrows only run between different columns (or straight down for mcp to rs), so the
// orthogonal router has a free gap on both sides of every box.
const MASTER = [
  { id: 'user', group: 'app', label: 'User', sub: ['signed in, in the browser'], x: 0, y: 200 },
  { id: 'webapp', group: 'app', label: 'Web App + Chatbot', sub: ['React SPA', 'holds only a session cookie'], x: 330, y: 200 },
  { id: 'agent', group: 'app', label: 'Agent (BFF)', sub: ['demo-api-server', 'holds the tokens in its session', 'LangGraph agent + MCP pipeline'], x: 750, y: 200 },
  { id: 'llm', group: 'srv', label: 'LLM', sub: ['picks the tool to call', 'never sees the tokens'], x: 1080, y: 200 },
  { id: 'gateway', group: 'ping', label: 'PingOne Agent Gateway', sub: ['checks aud, act and scope', 'asks Authorize per tool'], x: 1080, y: 430 },
  { id: 'pingone', group: 'ping', label: 'PingOne', sub: ['authorization server', 'RFC 8693 token exchange'], x: 1410, y: -60 },
  { id: 'authorize', group: 'ping', label: 'PingOne Authorize', sub: ['McpToolsList / McpToolCall', 'PERMIT / DENY / hold'], x: 1410, y: 280 },
  { id: 'mcp', group: 'srv', label: 'MCP Server', sub: ['banking tools', 'takes the forwarded token'], x: 1410, y: 510 },
  { id: 'rs', group: 'srv', label: 'Banking API', sub: ['resource server', 'validates the token itself'], x: 1410, y: 730 },
];

const D = { dashed: true }; // a token or a decision coming back (blue dashed under pingStyle)
const V = { vertical: true };
// [from, to, label, opts?] per step. Each list matches its step list on the page, one arrow per step.
export const TOKEN_FLOW_ENDPOINTS = {
  'full-flow': [
    ['user', 'webapp', 'User sends request'],
    ['webapp', 'agent', 'Chatbot receives message'],
    ['webapp', 'pingone', 'OAuth 2.0 PKCE login'],
    ['pingone', 'webapp', 'ID token + access token issued', D],
    ['webapp', 'agent', 'Agent takes over; BFF holds the token'],
    ['agent', 'llm', 'LLM processes intent, selects tool'],
    ['agent', 'pingone', 'RFC 8693 exchange: user token to delegation token'],
    ['pingone', 'agent', 'Delegated token returned', D],
    ['agent', 'gateway', 'Delegated token arrives at the gateway'],
    ['gateway', 'authorize', 'McpToolsList + McpToolCall checks'],
    ['authorize', 'gateway', 'PERMIT: tool call allowed', D],
    ['gateway', 'mcp', 'Forward the token unchanged'],
    ['mcp', 'rs', 'Banking API: GET /accounts', V],
    ['mcp', 'rs', 'Investments API: same token', V],
    ['agent', 'webapp', 'Results returned to the user'],
  ],
  'id-token': [
    ['webapp', 'pingone', 'PKCE authorization request'],
    ['agent', 'pingone', 'Code exchange at the token endpoint'],
    ['pingone', 'agent', 'ID token issued', D],
    ['pingone', 'agent', 'Access token issued', D],
    ['agent', 'webapp', 'Session cookie; tokens stay in the BFF'],
  ],
  'user-token': [
    ['webapp', 'agent', 'BFF holds the user access token'],
    ['agent', 'pingone', 'RFC 8693 exchange #1: user token in, delegation out'],
    ['agent', 'gateway', 'Delegated token arrives at the gateway'],
    ['gateway', 'mcp', 'Forward the token unchanged'],
    ['mcp', 'rs', 'MCP Server calls the Banking API', V],
  ],
  'get-accounts': [
    ['agent', 'llm', 'LLM decides: get_my_accounts (read)'],
    ['gateway', 'authorize', 'McpToolsList'],
    ['authorize', 'gateway', 'PERMIT: tools discovery allowed', D],
    ['gateway', 'authorize', 'McpToolCall: get_my_accounts'],
    ['authorize', 'gateway', 'PERMIT: read is sufficient', D],
    ['mcp', 'rs', 'Banking API returns accounts: 200 OK', V],
  ],
  withdrawal: [
    ['agent', 'llm', 'LLM decides: create_transfer (write)'],
    ['gateway', 'authorize', 'McpToolCall: create_transfer, high risk'],
    ['authorize', 'gateway', 'Hold: human consent required', D],
    ['agent', 'webapp', 'Agent waits for human approval'],
    ['user', 'webapp', 'User approves'],
    ['mcp', 'rs', 'Banking API executes the transfer: 200 OK', V],
  ],
  'bad-scope': [
    ['agent', 'gateway', 'Read-only token tries a write tool'],
    ['gateway', 'authorize', 'McpToolCall: create_transfer'],
    ['authorize', 'gateway', 'DENY: insufficient scope', D],
    ['gateway', 'agent', '403 Forbidden returned to the agent', D],
    ['agent', 'webapp', 'Agent tells the user, no retry'],
  ],
  'api-key-path': [
    ['agent', 'gateway', 'Path A: user bearer arrives'],
    ['gateway', 'rs', 'Scope gate, then swap bearer for API key'],
    ['agent', 'webapp', 'SPA routed to /path/mortgage'],
  ],
  'dual-token-path': [
    ['agent', 'gateway', 'Path B: user bearer arrives'],
    ['gateway', 'rs', 'Bearer + id_token to /identity'],
    ['rs', 'gateway', 'Decoded claims returned', D],
    ['agent', 'webapp', 'SPA routed to /path/dualtoken-info'],
  ],
  'oauth-bearer-path': [
    ['agent', 'gateway', 'Path C: user bearer arrives'],
    ['gateway', 'pingone', 'RFC 8693 exchange to a backend-scoped bearer'],
    ['gateway', 'rs', 'Call the Banking API with the new bearer'],
  ],
};

function build(key) {
  const edges = TOKEN_FLOW_ENDPOINTS[key];
  const used = new Set(edges.flatMap((e) => [e[0], e[1]]));
  const detail = TOKEN_FLOW_DETAIL[key];
  return {
    GROUPS: TOKEN_FLOW_GROUPS,
    NODES: MASTER.filter((n) => used.has(n.id)),
    EDGES: edges.map(([a, b, label, opts]) => (opts ? [a, b, label, opts] : [a, b, label])),
    STEPS: edges.map((e, i) => ({ key: `${key}-${i + 1}`, edges: [i], title: e[2], what: `${e[0]} to ${e[1]}: ${e[2]}`, detail: detail[i] })),
  };
}

export const TOKEN_FLOW_DIAGRAMS = Object.fromEntries(Object.keys(TOKEN_FLOW_ENDPOINTS).map((k) => [k, build(k)]));
