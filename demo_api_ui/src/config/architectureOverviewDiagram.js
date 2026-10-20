// /architecture/overview: the whole-system diagram as a StaticFlowDiagram config { GROUPS, NODES, EDGES }, drawn in the
// Ping style (pingStyle + a page-owned walk, like the use-case diagrams). The scenarios themselves stay in
// architecture-sim-scenarios.js (node and arrow ids are unchanged); buildOverviewWalk() turns one into walk beats.
//
// Layout: the BFF (left) and PingGateway (right) face each other with the three services they both call stacked between
// them (PingOne, PingOne Authorize, HITL), so no arrow has to cross another. PingGateway's own downstream calls fan out to
// the right. Columns are 520 apart and rows 200 apart (the diagram spreads them further).
import { PARTICIPANT_GROUPS as G } from './useCaseDiagrams/palette';

// One group per kind of box the old legend named; every colour is a palette token.
export const OVERVIEW_GROUPS = {
  user: { ...G.user, label: 'Client' },
  external: { ...G.external, label: 'BFF / Vault / HITL' },
  pingone: { ...G.pingone, label: 'Ping Identity' },
  gateway: { ...G.gateway, label: 'Gateway' },
  resource: { ...G.resource, label: 'Resources' },
  agent: { ...G.agent, label: 'Agent / AI' },
};

const COL = 520;
const ROW = 200;
const N = (id, group, label, sub, col, row, detail) => ({ id, group, label, sub, x: col * COL, y: row * ROW, detail });

export const OVERVIEW_NODES = [
  N('n-browser', 'user', 'Browser', ['port 4000'], 0, -1,
    "User's browser. Holds only an httpOnly session cookie; no tokens are ever stored client-side."),
  N('n-bff', 'external', 'BFF', ['demo_api_server :3001', 'sole token custodian', 'cookie to access token'], 0, 0,
    'Backend For Frontend. Sole OAuth token custodian; resolves the session cookie to an access token and never exposes tokens to the browser.'),
  N('n-vault', 'external', 'Vault / Secrets', ['BFF, encrypted, AEAD'], 0, 1,
    'The BFF loads its encrypted secrets vault at startup. It is distinct from PingGateway’s dotenvx-managed environment configuration; secrets are not fetched from the vault for each request.'),
  N('n-agent', 'agent', 'Agent Service', [':3006 / :8888'], 0, 3,
    'Agent Service. LangChain (:8888) / LM Studio (:3006); translates natural language to MCP tool calls.'),
  N('n-llm', 'agent', 'LLM Provider', ['local or configured API'], 1, 3,
    'The agent runtime calls the configured language-model provider through the LLM proxy. Provider selection depends on local configuration; it is not an identity or authorization service.'),
  N('n-pingone', 'pingone', 'PingOne', ['OAuth AS'], 1, -1,
    'PingOne. OAuth 2.0 Authorization Server and Identity Provider; issues tokens, validates may_act for RFC 8693 token exchange, enforces PKCE.'),
  N('n-pingauthorize', 'pingone', 'PingOne Authorize', ['Policy decision point'], 1, 1,
    'PingOne Authorize is the policy decision point (PDP); it returns PERMIT, DENY, or INDETERMINATE for protected tool calls. The real cloud service is the default; configured outages fail closed.'),
  N('n-hitl', 'external', 'HITL Service', [':3009'], 1, 2,
    'HITL Service (:3009). Human-In-The-Loop consent; creates time-limited challenges after PingOne Authorization Server INDETERMINATE signals; binds each challenge to userId + agentId + tool.'),
  N('n-mcp-gw', 'gateway', 'PingGateway', ['Ping Identity :3036', 'enforces tool policy', 'routes MCP and API calls'], 2, 0,
    'PingGateway (Ping Identity) is the default gateway at :3036. The optional Node gateway at :3005 is an alternative. The BFF performs RFC 8693 token exchange with PingOne; PingGateway enforces the downstream policy and routes tool requests.'),
  N('n-mcp-resource-server', 'resource', 'MCP Resource Server', [':8081'], 3, -2,
    'MCP Resource Server (:8081). Dedicated MCP resource server for investment and portfolio tools; separate instance for financial data.'),
  N('n-mcp-server', 'resource', 'MCP Server', [':8080'], 3, -1,
    'MCP Server (:8080). Executes banking tools; validates token aud and scopes per tool; checks the act claim for delegated agent authority.'),
  N('n-resource-server', 'resource', 'Banking Resource Server', ['/api/resource-server'], 3, 0,
    'Resource Server (/api/resource-server). Validates access tokens independently; serves banking data; used in Path B (dual-token) and Path C (oauth_bearer) dispositions.'),
  N('n-banking-data', 'resource', 'Banking Data Store', ['accounts + transactions'], 3, 1,
    'Protected banking data. Accounts, transactions, and audit records returned only after Resource Server validation.'),
  N('n-mortgage', 'resource', 'API Resource Server', [':8082'], 3, 2,
    'API Resource Server (:8082). REST API resource server using API key auth; reached via PingGateway Path A (api_key disposition).'),
];

const V = { vertical: true };

// [source, target, label?, opts?]; the scenario file names an arrow by id, so each one carries its old id below.
const EDGE_DEFS = [
  ['e-browser-bff', 'n-browser', 'n-bff', 'session cookie', V],
  ['e-bff-mcpgw', 'n-bff', 'n-mcp-gw', 'tool request'],
  ['e-bff-vault', 'n-bff', 'n-vault', 'secrets', V],
  ['e-bff-pingone', 'n-bff', 'n-pingone', 'OAuth / token exchange'],
  ['e-mcpgw-pingone', 'n-mcp-gw', 'n-pingone', 'token check'],
  ['e-bff-hitl', 'n-bff', 'n-hitl', 'consent challenge'],
  ['e-bff-pingauth', 'n-bff', 'n-pingauthorize', 'policy decision'],
  ['e-mcpgw-pingauth', 'n-mcp-gw', 'n-pingauthorize', 'policy decision'],
  ['e-mcpgw-hitl', 'n-mcp-gw', 'n-hitl', 'consent check'],
  ['e-mcpgw-mcpserver', 'n-mcp-gw', 'n-mcp-server', 'tools/call'],
  ['e-mcpgw-mortgage', 'n-mcp-gw', 'n-mortgage', 'API key'],
  ['e-mcpgw-resourceserver', 'n-mcp-gw', 'n-resource-server', 'API call'],
  ['e-mcpserver-resource-server', 'n-mcp-server', 'n-resource-server', 'bearer token', V],
  ['e-resource-server-banking-data', 'n-resource-server', 'n-banking-data', 'read', V],
  ['e-agent-llm', 'n-agent', 'n-llm', 'model call'],
];

export const OVERVIEW_EDGE_IDS = EDGE_DEFS.map((e) => e[0]);
export const OVERVIEW_EDGES = EDGE_DEFS.map(([, s, t, label, opts]) => (opts ? [s, t, label, opts] : [s, t, label]));
const EDGE_INDEX = Object.fromEntries(OVERVIEW_EDGE_IDS.map((id, i) => [id, i]));

/** Arrow ids (as scenarios and live trace events name them) to indexes into OVERVIEW_EDGES; unknown ids are dropped. */
export const edgeIndexes = (ids = []) => ids.map((id) => EDGE_INDEX[id]).filter((i) => i !== undefined);

/**
 * One scenario as StaticFlowDiagram `walk` beats. The step text is the reel card's title, the "why" its detail line, and
 * a blocking step is labelled BLOCKED (its stop point is ringed with the rest of the step's boxes).
 */
export function buildOverviewWalk(scenario) {
  return (scenario?.steps || []).map((s) => ({
    title: s.desc || '',
    label: s.isBlock ? 'BLOCKED' : '',
    nodes: [...(s.nodes || []), ...(s.blocked || [])],
    edges: edgeIndexes(s.edges),
    lines: s.why ? [{ who: 'Why', text: s.why }] : [],
  }));
}

/** A live-trace event ({ nodeId, edgeId } from /api/arch-events) as one walk beat. */
export function liveOverviewBeat({ nodeId, edgeId }) {
  const node = OVERVIEW_NODES.find((n) => n.id === nodeId);
  return {
    title: node ? `${node.label}` : 'System event',
    label: 'live',
    nodes: node ? [node.id] : [],
    edges: edgeIndexes(edgeId ? [edgeId] : []),
    lines: [],
  };
}
