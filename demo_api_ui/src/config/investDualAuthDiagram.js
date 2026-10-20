// /invest-dual-auth: the two credential paths to demo_mcp_resource_server as one StaticFlowDiagram config
// { GROUPS, NODES, EDGES, STEPS } in the Ping style (EmbeddedFlowDiagram with pingStyle). Top row: the Resource Server
// path (RFC 8693 exchange, WebSocket MCP). Bottom row: the Backend App path (vault API key, HTTP). A request and its plain
// reply stay separate arrows so each can carry its own wire form. The Mermaid text stays on the page for .mmd export.
// Wire forms and tokens are MOCK teaching values; no real key or secret appears.
import {
  APP, PING, INFRA, ISS, HTTP, ACT, BEARER, INTROSPECT, MCP, GRANT, JWT_TYPE, TOKEN_URL, JSONRPC,
  D, tok, json, USER_TOKEN, EXCHANGE_RFC, RFC, SPEC,
} from './delegationDiagramDetail';

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);

export const INVEST_GROUPS = {
  app: { label: 'Agent and invest service', bg: APP },
  ping: { label: 'Ping product (Agent Gateway, PingOne)', bg: PING },
  infra: { label: 'Vault', bg: INFRA },
};

export const INVEST_NODES = [
  // Resource Server path (OAuth token exchange, WebSocket MCP)
  N('agent', 'app', 'Agent', ['Resource Server path', 'holds the user token'], 0, 0),
  N('gw', 'ping', 'Agent Gateway', ['authorizes the call', 'exchanges the token for the invest audience'], 440, 0),
  N('p1', 'ping', 'PingOne AS', ['RFC 8693 token exchange', 'audience = mcp-invest.ping.demo'], 880, 0),
  N('rs', 'app', 'Invest Service :8081', ['WebSocket MCP', 'verifies signature, aud, scope, exp'], 880, 210),
  // Backend App path (vault API key, HTTP)
  N('agent2', 'app', 'Agent', ['Backend App path', 'same agent, show_investment'], 0, 480),
  N('gw2', 'ping', 'Agent Gateway', ['drops the OAuth bearer', 'swaps in the vault-held API key'], 440, 480),
  N('vault', 'infra', 'Vault', ['holds DEMO_MCP_RESOURCE_SERVER_KEY', 'key never reaches the agent'], 440, 690),
  N('app', 'app', 'Invest Service :8081/invest', ['HTTP REST', 'constant-time key compare'], 880, 480),
];

export const INVEST_EDGES = [
  E('agent', 'gw', 'tools/call get_investment_balance (Bearer: user token); the portfolio data returns as the result'), // 0
  E('gw', 'p1', 'RFC 8693 token exchange; returns a scoped access_token (aud = RS)'), // 1
  E('gw', 'rs', 'WebSocket MCP message (Bearer: exchanged token); the service verifies, then answers'), // 2
  E('agent2', 'gw2', 'tools/call show_investment (Bearer: user token); the result returns with _meta'), // 3
  E('gw2', 'vault', 'fetch DEMO_MCP_RESOURCE_SERVER_KEY; returns the shared secret'), // 4
  E('gw2', 'app', 'GET /invest (X-API-Key + X-User-Sub); the service compares the key, then answers'), // 5
];

const RS_TOKEN = tok('Exchanged token · scoped to the invest service, act names the agent', {
  iss: ISS, sub: 'user-1aee74ae', aud: ['mcp-invest.ping.demo'], scope: 'invest:read', act: { sub: 'banking-agent-client' }, exp: 1790000300,
});
const MCP_CALL = (tool, bearer) => `POST /mcp HTTP/1.1\nAuthorization: Bearer ${bearer}\nContent-Type: application/json\n\n${json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: {} } })}`;
const API_KEY = SPEC('API key in a header', 'A shared secret the vault holds; the gateway attaches it per call');
const TIMING = SPEC('Node crypto.timingSafeEqual', 'Constant-time comparison of SHA-256 digests, so the check leaks nothing through timing');
const WS = RFC(6455, 'The WebSocket Protocol (MCP over a persistent connection, per-message auth)');

export const INVEST_STEPS = [
  { key: 'rs-call', edges: [0], title: 'The agent calls an invest tool', what: 'tools/call get_investment_balance reaches the gateway with the user token as the bearer; once the service answers, the gateway returns the portfolio data as the tools/call result.',
    why: 'Same invest service, two credential paths; this is the OAuth one.',
    detail: D(`${MCP_CALL('get_investment_balance', '<user access token>')}\n\nResult returned to the agent:\n${json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '<portfolio data>' }] } })}`, [MCP[0], JSONRPC, BEARER[0], HTTP], [USER_TOKEN]) },
  { key: 'rs-exchange', edges: [1], title: 'The gateway exchanges the token', what: 'RFC 8693 narrows the token to the invest audience; PingOne returns a scoped token that carries invest:read only.',
    detail: D(`POST ${TOKEN_URL} HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=${encodeURIComponent(GRANT)}\n&subject_token=<user access token>\n&subject_token_type=${encodeURIComponent(JWT_TYPE)}\n&audience=mcp-invest.ping.demo\n&scope=invest:read\n\nResponse:\n${json({ access_token: '<exchanged token>', issued_token_type: JWT_TYPE, token_type: 'Bearer', expires_in: 300 })}`, [ACT, EXCHANGE_RFC, BEARER[2], INTROSPECT[2], HTTP], [USER_TOKEN, RS_TOKEN]) },
  { key: 'rs-ws', edges: [2], title: 'The service verifies the token, then answers', what: 'The exchanged token travels as the bearer on the persistent WebSocket; each message is authenticated. The service checks the JWT signature against the JWKS, then audience, scope and expiry, before it returns portfolio data.',
    why: 'The service trusts the token, not the network path.',
    detail: D(`GET /mcp HTTP/1.1  (Upgrade: websocket)\nAuthorization: Bearer <exchanged token>\n\nframe: ${json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_investment_balance', arguments: {} } })}\n\nReply frame:\n${json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '<portfolio data>' }] } })}`, [WS, MCP[0], BEARER[0], BEARER[2], INTROSPECT[3], JSONRPC], [RS_TOKEN]) },
  { key: 'key-call', edges: [3], title: 'The agent calls the backend-app tool', what: 'tools/call show_investment carries the same kind of user token, gated by the same invest:read scope at the gateway; the result returns with _meta so the credential path stays visible.',
    why: 'Same scope gate, different downstream credential.',
    detail: D(`${MCP_CALL('show_investment', '<user access token>')}\n\nResult returned to the agent:\n${json({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '<portfolio data>' }], _meta: { authMechanism: 'X-API-Key (shared secret)' } } })}`, [MCP[0], JSONRPC, BEARER[0], HTTP], [USER_TOKEN]) },
  { key: 'key-fetch', edges: [4], title: 'The gateway fetches the API key', what: 'It drops the OAuth bearer entirely, with no token forwarding, and asks the vault for the service key. The key is fetched per call, so it never reaches the agent.',
    detail: D(`GET /v1/secret/DEMO_MCP_RESOURCE_SERVER_KEY HTTP/1.1\nX-Vault-Token: <gateway vault credential>\n\nResponse:\n${json({ data: { value: '<MOCK API key>' } })}`, [API_KEY, HTTP], [], 'A shared secret is not a token; it has no claims to decode, and the vault is read with the gateway\'s own credential.') },
  { key: 'key-http', edges: [5], title: 'The service compares the key, then answers', what: 'GET /invest carries the key in X-API-Key and the user id in X-User-Sub. A constant-time comparison (SHA-256 digest plus timingSafeEqual) accepts the key; the response names the mechanism it used.',
    detail: D(`GET /invest HTTP/1.1\nHost: mcp-invest.ping.demo:8081\nX-API-Key: <MOCK API key>\nX-User-Sub: user-1aee74ae\n\nResponse:\n${json({ invest: { accounts: '<portfolio data>' }, authMechanism: 'X-API-Key (shared secret)' })}`, [TIMING, API_KEY, HTTP], [], 'The call carries a shared secret and a subject header, not an OAuth token.') },
];

export const INVEST_DIAGRAM = { GROUPS: INVEST_GROUPS, NODES: INVEST_NODES, EDGES: INVEST_EDGES, STEPS: INVEST_STEPS };
