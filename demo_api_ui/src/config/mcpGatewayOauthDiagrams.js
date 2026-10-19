// /mcp-gateway-oauth-flow: the two figures (architecture, OAuth sequence) as StaticFlowDiagram configs
// { GROUPS, NODES, EDGES, STEPS }, drawn in the Ping style. Per-step wire forms, MOCK tokens and standards are in
// mcpGatewayOauthStandards.js. The sequence has 26 steps (arrow n = step n). The client signs in through the gateway's own
// OAuth broker, which relays to PingOne, so the broker is its own box and the relay has its own arrows (steps 6-9).
// Internal steps (store the token, local pre-filter, the cached re-check, the signature check) are small grey boxes
// below their owner because a box has only one self-arrow shape; the PingOne Authorize policy check is its own Ping box.
// Layout: two rows (U, broker, PingOne above; client, gateway, MCP server below) with wide gaps, so every arrow is a
// straight run or one L. Edge opts: vertical = bottom of source to top of target.
import { SEQ_DETAIL, ARCH_DETAIL } from './mcpGatewayOauthStandards';

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const V = { vertical: true };
const D = { dashed: true };

export const MGOF_GROUPS = {
  app: { label: 'Client, user or MCP server', bg: '#151a24' },
  ping: { label: 'Ping product (Agent Gateway, PingOne, PingOne Authorize)', bg: '#b5231a' },
  internal: { label: 'Step inside one component (no network hop)', bg: '#5a5f69' },
};

const step = (key, edges, title, what, detail, why) => ({ key, edges, title, what, ...(why ? { why } : {}), detail });

const A_SUB = ['MCP client and OAuth client', 'No token on its first call', 'Reads the 401 challenge', 'Fetches the resource metadata', 'Registers with the broker (DCR)', 'Opens the sign-in in the browser', 'Authorization code + PKCE (S256)', 'Redeems the code for a token', 'Sends Bearer on every call', 'Keeps the PKCE verifier secret', 'Never sees the exchanged token'];
const B_SUB = ['Inside demo_mcp_gateway (/oauth/*)', 'Serves RFC 8414 metadata', 'Registers clients (RFC 7591, loopback only)', 'PKCE S256, no CIMD', 'Relays the sign-in to PingOne', 'Returns the access token PingOne issued'];
const G_SUB = ['demo_mcp_gateway', 'Serves the 401 and the RFC 9728 metadata', 'Local JWT pre-filter', 'RFC 7662 introspection', 'PingOne Authorize policy check', 'RFC 8693 token exchange', 'Forwards the exchanged token', 'Re-checks every call (cached)'];
const P_ALL_SUB = ['auth.pingone.com', 'Signs the user in', 'Issues, introspects and exchanges tokens', 'Authorization server behind the broker', 'Runs the sign-in policy', 'Keeps the signing keys (JWKS)'];
const PX_SUB = ['auth.pingone.com', 'Token endpoint', 'RFC 8693 token exchange'];
const M_SUB = ['demo_mcp_server (AI Demo MCP Server)', 'Serves the tools over MCP', 'Accepts only its own audience', 'Re-verifies the signature via JWKS', 'Never sees the client token', 'About 40 static + 193 generated tools', 'Scope filtering left to the gateway'];
const P_SUB = ['auth.pingone.com', 'Signs the user in (authorization endpoint)', 'Answers introspection (RFC 7662)', 'Keeps the signing keys (JWKS)'];

// Positions are written in pixels as drawn (StaticFlowDiagram scales a config x by 1.2 and y by 1.12). They were found by
// routing the figure with the shared router and keeping layouts where no two arrows cross: the router sorts the arrows
// on a box side by where the other end is, so two request/reply pairs to one box cross, which is why PingOne is drawn
// twice (sign-in and introspection, then token exchange) in the sequence.
const px = ([x, y]) => [x / 1.2, y / 1.12];
const SEQ_POS = { U: [0, 0], B: [320, 80], P: [980, 180], Px: [1020, 520], A: [0, 310], G: [650, 350], M: [1370, 340] };
const ARCH_POS = { B: [310, 0], P: [1270, 0], A: [0, 210], G: [690, 240], M: [1290, 230] };
const at = (pos) => (id, group, label, sub) => N(id, group, label, sub, ...px(pos[id]));
const seqAt = at(SEQ_POS);
const archAt = at(ARCH_POS);

// ─── Architecture ─────────────────────────────────────────────────────────────
const ARCH_NODES = [
  archAt('B', 'ping', 'Gateway OAuth broker', B_SUB),
  archAt('P', 'ping', 'PingOne (Authorization Server)', P_ALL_SUB),
  archAt('A', 'app', 'Agent (OAuth Client)', A_SUB),
  archAt('G', 'ping', 'Agent Gateway (OAuth Resource Server)', G_SUB),
  archAt('M', 'app', 'MCP Server (Banking, Mock)', M_SUB),
];

const ARCH_EDGES = [
  ['A', 'G', 'Connect, initialize: no token'], // 0
  ['G', 'A', '401 + WWW-Authenticate', D], // 1
  ['A', 'G', 'GET .well-known/oauth-protected-resource'], // 2
  ['A', 'B', 'Register, authorization request (code + PKCE)'], // 3
  ['B', 'P', 'Relay the sign-in to PingOne'], // 4
  ['P', 'B', 'Authorization code'], // 5
  ['B', 'A', 'Access token', D], // 6
  ['A', 'G', 'Initialize, Bearer token'], // 7
  ['G', 'P', 'Introspect, RFC 7662: active, scopes'], // 8
  ['G', 'P', 'Token exchange, RFC 8693'], // 9
  ['G', 'M', 'Forward initialize, exchanged token'], // 10
  ['M', 'G', 'Capabilities'], // 11
  ['G', 'A', 'Forward capabilities'], // 12
];

const ARCH_STEPS = [
  step('connect', [0], 'The agent calls with no token', 'The first request is sent on purpose without a token, to learn how to authenticate (sequence steps 1-2).', ARCH_DETAIL[0]),
  step('challenge', [1], 'The gateway answers 401', 'The WWW-Authenticate header points at the resource metadata URL (step 3).', ARCH_DETAIL[1]),
  step('discover', [2], 'The agent reads the resource metadata', 'RFC 9728 metadata names the authorization server, which is the gateway\'s own OAuth broker (steps 4-5).', ARCH_DETAIL[2]),
  step('authorize', [3], 'The client registers and asks the broker', 'Dynamic registration (RFC 7591), then the authorization code request with PKCE, both at the broker (step 6).', ARCH_DETAIL[3]),
  step('relay', [4], 'The broker sends the user to PingOne', 'The broker redirects the browser to PingOne with its own PKCE pair; the user signs in there (step 7).', ARCH_DETAIL[4]),
  step('code', [5], 'PingOne returns a code to the broker', 'The broker redeems it at PingOne for the access token (step 8).', ARCH_DETAIL[5]),
  step('token', [6], 'The agent gets an access token', 'The broker hands back the token PingOne issued, after checking the client\'s PKCE (step 9).', ARCH_DETAIL[6]),
  step('bearer', [7], 'Initialize again, with the Bearer token', 'The gateway pre-filters the JWT locally and asks PingOne Authorize for a policy decision (steps 11, 12 and 15).', ARCH_DETAIL[7]),
  step('introspect', [8], 'The gateway introspects the token', 'The authoritative check: a remote RFC 7662 call to PingOne (steps 13-14).', ARCH_DETAIL[8]),
  step('exchange', [9], 'The gateway exchanges the token', 'RFC 8693: a new token for the MCP server\'s audience, so the client\'s own token is never forwarded (steps 16-17).', ARCH_DETAIL[9]),
  step('forward', [10], 'The gateway forwards to the MCP server', 'Only the exchanged token goes downstream (step 18).', ARCH_DETAIL[10]),
  step('capabilities', [11], 'The MCP server answers', 'It re-verifies the exchanged token\'s signature through JWKS, then returns its capabilities (steps 19-20).', ARCH_DETAIL[11]),
  step('relayBack', [12], 'The gateway relays the answer', 'The capabilities reach the agent (step 21).', ARCH_DETAIL[12]),
];

// ─── OAuth sequence ───────────────────────────────────────────────────────────
const SEQ_NODES = [
  seqAt('U', 'app', 'User', ['Adds the MCP server', 'Signs in at PingOne']),
  seqAt('B', 'ping', 'Gateway OAuth broker', B_SUB),
  seqAt('P', 'ping', 'PingOne (sign-in and introspection)', P_SUB),
  seqAt('Px', 'ping', 'PingOne (token exchange)', PX_SUB),
  seqAt('A', 'app', 'Agent (OAuth Client)', A_SUB),
  seqAt('G', 'ping', 'Agent Gateway (OAuth RS)', G_SUB),
  seqAt('M', 'app', 'MCP Server (Banking, Mock)', M_SUB),
  N('S10', 'internal', 'Store the access token', ['Held by the client'], ...px([0, 900])),
  N('S12', 'internal', 'Local JWT pre-filter', ['Decode, aud, exp, claim policy'], ...px([360, 900])),
  N('S15', 'ping', 'PingOne Authorize (PDP)', ['Per-call policy decision'], ...px([650, 900])),
  N('S23', 'internal', 'Validate, authorize, exchange', ['Cached, 5-30 s TTL'], ...px([990, 900])),
  N('S19', 'internal', 'Verify the token signature', ['JWKS, iss, exp, aud'], ...px([1370, 900])),
];

const SEQ_EDGES = [
  ['U', 'A', 'Connect', V], // 1
  ['A', 'G', 'POST /mcp initialize: no token'], // 2
  ['G', 'A', '401 Unauthorized + WWW-Authenticate (resource_metadata URI)', D], // 3
  ['A', 'G', 'GET /.well-known/oauth-protected-resource'], // 4
  ['G', 'A', '200 OK: authorization_servers, scopes, resource'], // 5
  ['A', 'B', 'Register, then the authorization request (code + PKCE)'], // 6
  ['B', 'P', 'Relay the sign-in: redirect to PingOne'], // 7
  ['P', 'B', 'Authorization code, redeemed for PingOne\'s token'], // 8
  ['B', 'A', 'Return access token', D], // 9
  ['A', 'S10', 'Store access token', V], // 10
  ['A', 'G', 'POST /mcp initialize: Bearer token'], // 11
  ['G', 'S12', 'Validate token (local JWT + aud pre-filter)', V], // 12
  ['G', 'P', 'Introspect token, RFC 7662'], // 13
  ['P', 'G', 'active: true, scopes', D], // 14
  ['G', 'S15', 'Authorize: PingOne Authorize (PDP) policy check', V], // 15
  ['G', 'Px', 'Exchange token for backend audience, RFC 8693'], // 16
  ['Px', 'G', 'Exchanged token', D], // 17
  ['G', 'M', 'Forward initialize (exchanged token)'], // 18
  ['M', 'S19', 'Verify token signature: JWKS', V], // 19
  ['M', 'G', 'protocolVersion, capabilities, serverInfo'], // 20
  ['G', 'A', 'Forward capabilities'], // 21
  ['A', 'G', 'POST /mcp tools/list: Bearer token'], // 22
  ['G', 'S23', 'Validate + authorize + exchange (cached)', V], // 23
  ['G', 'M', 'Forward tools/list (exchanged token)'], // 24
  ['M', 'G', 'Tool definitions: unfiltered, scope check deferred'], // 25
  ['G', 'A', 'Forward tool list'], // 26
];

const SEQ_STEPS = [
  step('connect', [0], 'Connect', 'The user points the client at the MCP server URL.', SEQ_DETAIL[0]),
  step('initNoToken', [1], 'Initialize with no token', 'POST /mcp initialize, sent without a token on purpose.', SEQ_DETAIL[1]),
  step('challenge', [2], 'The 401 challenge', 'The gateway refuses and names its resource metadata URL in WWW-Authenticate.', SEQ_DETAIL[2], 'This is how a client with no prior setup finds out how to authenticate.'),
  step('discoverGet', [3], 'Fetch the resource metadata', 'GET /.well-known/oauth-protected-resource (RFC 9728).', SEQ_DETAIL[3]),
  step('discoverResp', [4], 'Read the metadata', 'authorization_servers, scopes and resource. The authorization server is the gateway\'s own OAuth broker.', SEQ_DETAIL[4]),
  step('authorize', [5], 'Register and ask the broker', 'The client registers (RFC 7591), then starts the authorization code flow with PKCE, both at the gateway\'s OAuth broker.', SEQ_DETAIL[5]),
  step('relay', [6], 'The broker relays the sign-in to PingOne', 'The browser is redirected to PingOne with the broker\'s own PKCE pair, and the user signs in.', SEQ_DETAIL[6]),
  step('code', [7], 'PingOne returns a code', 'The broker redeems the code at PingOne and holds PingOne\'s access token.', SEQ_DETAIL[7]),
  step('token', [8], 'Return the access token', 'The client redeems the broker\'s own code (checking its PKCE) and receives the token PingOne issued.', SEQ_DETAIL[8]),
  step('store', [9], 'Store the access token', 'The client keeps it and sends it only to this gateway.', SEQ_DETAIL[9]),
  step('initBearer', [10], 'Initialize with the Bearer token', 'The same call again, now authenticated.', SEQ_DETAIL[10]),
  step('prefilter', [11], 'Local pre-filter', 'Decode the JWT and check audience, expiry and claim policy. Cheap, and not the authoritative gate.', SEQ_DETAIL[11]),
  step('introspectReq', [12], 'Introspect the token', 'RFC 7662 against PingOne: the real check that the token is still active.', SEQ_DETAIL[12]),
  step('introspectResp', [13], 'The token is active', 'PingOne answers active: true with the scopes; the answer is cached for a few seconds.', SEQ_DETAIL[13]),
  step('authorizePdp', [14], 'Policy check with PingOne Authorize', 'The gateway asks the PDP for a decision on this call and fails closed on DENY.', SEQ_DETAIL[14], 'The reference diagram has no per-call policy decision; this build adds one.'),
  step('exchangeReq', [15], 'Exchange the token', 'RFC 8693: swap the client\'s token for one whose audience is the MCP server.', SEQ_DETAIL[15], 'The MCP server never sees the client\'s original token.'),
  step('exchangeResp', [16], 'The exchanged token', 'A short-lived token for the backend audience, carrying an act claim for the gateway.', SEQ_DETAIL[16]),
  step('forwardInit', [17], 'Forward initialize', 'The gateway calls the MCP server with the exchanged token.', SEQ_DETAIL[17]),
  step('verifySig', [18], 'The MCP server verifies the signature', 'It checks the token against PingOne\'s JWKS instead of trusting the gateway\'s decision.', SEQ_DETAIL[18]),
  step('capabilities', [19], 'Capabilities come back', 'protocolVersion, capabilities and serverInfo from the MCP server.', SEQ_DETAIL[19]),
  step('forwardCaps', [20], 'Forward the capabilities', 'The gateway relays the answer to the client.', SEQ_DETAIL[20]),
  step('toolsList', [21], 'List tools', 'POST /mcp tools/list with the same Bearer token.', SEQ_DETAIL[21]),
  step('recheck', [22], 'Check again, from cache', 'Validate, authorize and exchange run again on every call; only caches make it cheap.', SEQ_DETAIL[22]),
  step('forwardTools', [23], 'Forward tools/list', 'The exchanged token goes to the MCP server.', SEQ_DETAIL[23]),
  step('toolDefs', [24], 'Tool definitions', 'The full catalog, unfiltered; scope filtering is left to the gateway and the policy decision.', SEQ_DETAIL[24]),
  step('forwardList', [25], 'Forward the tool list', 'The client receives the list.', SEQ_DETAIL[25]),
];

export const MGOF_ARCH_DIAGRAM = { GROUPS: MGOF_GROUPS, NODES: ARCH_NODES, EDGES: ARCH_EDGES, STEPS: ARCH_STEPS };
export const MGOF_SEQ_DIAGRAM = { GROUPS: MGOF_GROUPS, NODES: SEQ_NODES, EDGES: SEQ_EDGES, STEPS: SEQ_STEPS };
