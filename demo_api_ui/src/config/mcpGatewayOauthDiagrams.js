// /mcp-gateway-oauth-flow: the two figures (architecture, OAuth sequence) as StaticFlowDiagram configs
// { GROUPS, NODES, EDGES, STEPS }, drawn in the Ping style. Per-step wire forms, MOCK tokens and standards are in
// mcpGatewayOauthStandards.js. The sequence keeps the page's 24 step numbers (arrow n = step n); internal steps
// (store the token, local pre-filter, the cached re-check, the signature check) are small grey boxes next to their
// owner because a box has only one self-arrow shape, and the PingOne Authorize policy check is its own Ping box.
// Edge opts: vertical = bottom of source to top of target; lane < 0 = join the right sides (a C beside the column).
import { SEQ_DETAIL, ARCH_DETAIL } from './mcpGatewayOauthStandards';

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const V = { vertical: true };
const D = { dashed: true };
const R = { lane: -1 };
const RD = { lane: -1, dashed: true };

export const MGOF_GROUPS = {
  app: { label: 'Client, user or MCP server', bg: '#151a24' },
  ping: { label: 'Ping product (Agent Gateway, PingOne, PingOne Authorize)', bg: '#b5231a' },
  internal: { label: 'Step inside one component (no network hop)', bg: '#5a5f69' },
};

const step = (key, edges, title, what, detail, why) => ({ key, edges, title, what, ...(why ? { why } : {}), detail });

const A_SUB = ['MCP client and OAuth client', 'No token on its first call', 'Reads the 401 challenge', 'Fetches the resource metadata', 'Registers with the broker (DCR)', 'Authorization code + PKCE (S256)', 'Redeems the code for a token', 'Sends Bearer on every call', 'Never sees the exchanged token'];
const G_SUB = ['demo_mcp_gateway', 'Serves the 401 and the RFC 9728 metadata', 'Brokers the sign-in: register, authorize, token', 'Local JWT pre-filter', 'RFC 7662 introspection', 'PingOne Authorize policy check', 'RFC 8693 token exchange', 'Forwards the exchanged token', 'Re-checks every call (cached)'];
const M_SUB = ['demo_mcp_server (AI Demo MCP Server)', 'Serves the tools over MCP', 'Accepts only its own audience', 'Re-verifies the signature via JWKS', 'Never sees the client token', 'About 40 static + 193 generated tools', 'Scope filtering left to the gateway'];
const P_SUB = ['auth.pingone.com', 'Signs the user in', 'Issues, introspects and exchanges tokens'];

// ─── Architecture ─────────────────────────────────────────────────────────────
const ARCH_NODES = [
  N('P', 'ping', 'PingOne (Authorization Server)', P_SUB, 425, 0),
  N('A', 'app', 'Agent (OAuth Client)', A_SUB, 0, 200),
  N('G', 'ping', 'Agent Gateway (OAuth Resource Server)', G_SUB, 425, 200),
  N('M', 'app', 'MCP Server (Banking, Mock)', M_SUB, 850, 200),
];

const ARCH_EDGES = [
  ['A', 'G', 'Connect, initialize: no token'], // 0
  ['G', 'A', '401 + WWW-Authenticate', D], // 1
  ['A', 'G', 'GET .well-known/oauth-protected-resource'], // 2
  ['A', 'P', 'OAuth2 authorization request (code + PKCE)'], // 3
  ['P', 'A', 'Access token', D], // 4
  ['A', 'G', 'Initialize, Bearer token'], // 5
  ['G', 'P', 'Introspect, RFC 7662: active, scopes', R], // 6
  ['G', 'P', 'Token exchange, RFC 8693', R], // 7
  ['G', 'M', 'Forward initialize, exchanged token'], // 8
  ['M', 'G', 'Capabilities'], // 9
  ['G', 'A', 'Forward capabilities'], // 10
];

const ARCH_STEPS = [
  step('connect', [0], 'The agent calls with no token', 'The first request is sent on purpose without a token, to learn how to authenticate (sequence steps 1-2).', ARCH_DETAIL[0]),
  step('challenge', [1], 'The gateway answers 401', 'The WWW-Authenticate header points at the resource metadata URL (step 3).', ARCH_DETAIL[1]),
  step('discover', [2], 'The agent reads the resource metadata', 'RFC 9728 metadata names the authorization server, which is the gateway\'s own OAuth broker (steps 4-5).', ARCH_DETAIL[2]),
  step('authorize', [3], 'The user signs in at PingOne', 'The client registers, then runs the authorization code flow with PKCE; the broker relays the sign-in to PingOne (step 6).', ARCH_DETAIL[3]),
  step('token', [4], 'The agent gets an access token', 'The broker hands back the token PingOne issued (step 7).', ARCH_DETAIL[4]),
  step('bearer', [5], 'Initialize again, with the Bearer token', 'The gateway pre-filters the JWT locally and asks PingOne Authorize for a policy decision (steps 9, 10 and 13).', ARCH_DETAIL[5]),
  step('introspect', [6], 'The gateway introspects the token', 'The authoritative check: a remote RFC 7662 call to PingOne (steps 11-12).', ARCH_DETAIL[6]),
  step('exchange', [7], 'The gateway exchanges the token', 'RFC 8693: a new token for the MCP server\'s audience, so the client\'s own token is never forwarded (steps 14-15).', ARCH_DETAIL[7]),
  step('forward', [8], 'The gateway forwards to the MCP server', 'Only the exchanged token goes downstream (step 16).', ARCH_DETAIL[8]),
  step('capabilities', [9], 'The MCP server answers', 'It re-verifies the exchanged token\'s signature through JWKS, then returns its capabilities (steps 17-18).', ARCH_DETAIL[9]),
  step('relay', [10], 'The gateway relays the answer', 'The capabilities reach the agent (step 19).', ARCH_DETAIL[10]),
];

// ─── OAuth sequence ───────────────────────────────────────────────────────────
const SEQ_NODES = [
  N('U', 'app', 'User', ['Adds the MCP server', 'Signs in at PingOne'], 0, 0),
  N('P', 'ping', 'PingOne (Authorization Server)', P_SUB, 425, 0),
  N('A', 'app', 'Agent (OAuth Client)', A_SUB, 0, 200),
  N('G', 'ping', 'Agent Gateway (OAuth RS)', G_SUB, 425, 200),
  N('M', 'app', 'MCP Server (Banking, Mock)', M_SUB, 850, 200),
  N('S8', 'internal', 'Store the access token', ['Held by the client'], 0, 560),
  N('S10', 'internal', 'Local JWT pre-filter', ['Decode, aud, exp, claim policy'], 270, 560),
  N('S13', 'ping', 'PingOne Authorize (PDP)', ['Per-call policy decision'], 540, 560),
  N('S21', 'internal', 'Validate, authorize, exchange', ['Cached, 5-30 s TTL'], 810, 560),
  N('S17', 'internal', 'Verify the token signature', ['JWKS, iss, exp, aud'], 1080, 560),
];

const SEQ_EDGES = [
  ['U', 'A', 'Connect', V], // 1
  ['A', 'G', 'POST /mcp initialize: no token'], // 2
  ['G', 'A', '401 Unauthorized + WWW-Authenticate (resource_metadata URI)', D], // 3
  ['A', 'G', 'GET /.well-known/oauth-protected-resource'], // 4
  ['G', 'A', '200 OK: authorization_servers, scopes, resource'], // 5
  ['A', 'P', 'OAuth2 authorization request'], // 6
  ['P', 'A', 'Return access token', D], // 7
  ['A', 'S8', 'Store access token', V], // 8
  ['A', 'G', 'POST /mcp initialize: Bearer token'], // 9
  ['G', 'S10', 'Validate token (local JWT + aud pre-filter)', V], // 10
  ['G', 'P', 'Introspect token, RFC 7662', R], // 11
  ['P', 'G', 'active: true, scopes', RD], // 12
  ['G', 'S13', 'Authorize: PingOne Authorize (PDP) policy check', V], // 13
  ['G', 'P', 'Exchange token for backend audience, RFC 8693', R], // 14
  ['P', 'G', 'Exchanged token', RD], // 15
  ['G', 'M', 'Forward initialize (exchanged token)'], // 16
  ['M', 'S17', 'Verify token signature: JWKS', V], // 17
  ['M', 'G', 'protocolVersion, capabilities, serverInfo'], // 18
  ['G', 'A', 'Forward capabilities'], // 19
  ['A', 'G', 'POST /mcp tools/list: Bearer token'], // 20
  ['G', 'S21', 'Validate + authorize + exchange (cached)', V], // 21
  ['G', 'M', 'Forward tools/list (exchanged token)'], // 22
  ['M', 'G', 'Tool definitions: unfiltered, scope check deferred'], // 23
  ['G', 'A', 'Forward tool list'], // 24
];

const SEQ_STEPS = [
  step('connect', [0], 'Connect', 'The user points the client at the MCP server URL.', SEQ_DETAIL[0]),
  step('initNoToken', [1], 'Initialize with no token', 'POST /mcp initialize, sent without a token on purpose.', SEQ_DETAIL[1]),
  step('challenge', [2], 'The 401 challenge', 'The gateway refuses and names its resource metadata URL in WWW-Authenticate.', SEQ_DETAIL[2], 'This is how a client with no prior setup finds out how to authenticate.'),
  step('discoverGet', [3], 'Fetch the resource metadata', 'GET /.well-known/oauth-protected-resource (RFC 9728).', SEQ_DETAIL[3]),
  step('discoverResp', [4], 'Read the metadata', 'authorization_servers, scopes and resource. The authorization server is the gateway\'s own OAuth broker.', SEQ_DETAIL[4]),
  step('authorize', [5], 'OAuth2 authorization request', 'The client registers (RFC 7591), then starts the authorization code flow with PKCE; the broker relays the sign-in to PingOne. Drawn as one hop to PingOne.', SEQ_DETAIL[5]),
  step('token', [6], 'Return the access token', 'After the user signs in, the client redeems its code at the broker and receives the token PingOne issued.', SEQ_DETAIL[6]),
  step('store', [7], 'Store the access token', 'The client keeps it and sends it only to this gateway.', SEQ_DETAIL[7]),
  step('initBearer', [8], 'Initialize with the Bearer token', 'The same call again, now authenticated.', SEQ_DETAIL[8]),
  step('prefilter', [9], 'Local pre-filter', 'Decode the JWT and check audience, expiry and claim policy. Cheap, and not the authoritative gate.', SEQ_DETAIL[9]),
  step('introspectReq', [10], 'Introspect the token', 'RFC 7662 against PingOne: the real check that the token is still active.', SEQ_DETAIL[10]),
  step('introspectResp', [11], 'The token is active', 'PingOne answers active: true with the scopes; the answer is cached for a few seconds.', SEQ_DETAIL[11]),
  step('authorizePdp', [12], 'Policy check with PingOne Authorize', 'The gateway asks the PDP for a decision on this call and fails closed on DENY.', SEQ_DETAIL[12], 'The reference diagram has no per-call policy decision; this build adds one.'),
  step('exchangeReq', [13], 'Exchange the token', 'RFC 8693: swap the client\'s token for one whose audience is the MCP server.', SEQ_DETAIL[13], 'The MCP server never sees the client\'s original token.'),
  step('exchangeResp', [14], 'The exchanged token', 'A short-lived token for the backend audience, carrying an act claim for the gateway.', SEQ_DETAIL[14]),
  step('forwardInit', [15], 'Forward initialize', 'The gateway calls the MCP server with the exchanged token.', SEQ_DETAIL[15]),
  step('verifySig', [16], 'The MCP server verifies the signature', 'It checks the token against PingOne\'s JWKS instead of trusting the gateway\'s decision.', SEQ_DETAIL[16]),
  step('capabilities', [17], 'Capabilities come back', 'protocolVersion, capabilities and serverInfo from the MCP server.', SEQ_DETAIL[17]),
  step('forwardCaps', [18], 'Forward the capabilities', 'The gateway relays the answer to the client.', SEQ_DETAIL[18]),
  step('toolsList', [19], 'List tools', 'POST /mcp tools/list with the same Bearer token.', SEQ_DETAIL[19]),
  step('recheck', [20], 'Check again, from cache', 'Validate, authorize and exchange run again on every call; only caches make it cheap.', SEQ_DETAIL[20]),
  step('forwardTools', [21], 'Forward tools/list', 'The exchanged token goes to the MCP server.', SEQ_DETAIL[21]),
  step('toolDefs', [22], 'Tool definitions', 'The full catalog, unfiltered; scope filtering is left to the gateway and the policy decision.', SEQ_DETAIL[22]),
  step('forwardList', [23], 'Forward the tool list', 'The client receives the list.', SEQ_DETAIL[23]),
];

export const MGOF_ARCH_DIAGRAM = { GROUPS: MGOF_GROUPS, NODES: ARCH_NODES, EDGES: ARCH_EDGES, STEPS: ARCH_STEPS };
export const MGOF_SEQ_DIAGRAM = { GROUPS: MGOF_GROUPS, NODES: SEQ_NODES, EDGES: SEQ_EDGES, STEPS: SEQ_STEPS };
