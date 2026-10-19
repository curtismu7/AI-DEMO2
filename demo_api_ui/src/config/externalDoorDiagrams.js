// /external-door-diagrams: the two figures as StaticFlowDiagram configs { GROUPS, NODES, EDGES, STEPS }, drawn in the
// Ping style (EmbeddedFlowDiagram with pingStyle). Per-step wire forms, MOCK tokens and standards are in
// externalDoorStandards.js. Source: docs/EXTERNAL_DOOR_MCP_FLOW.md.
// Layout: boxes sit on a wide grid so the orthogonal router has corridors; arrows are routed by StaticFlowDiagram.
import { TOPO_DETAIL, SEQ_DETAIL } from './externalDoorStandards';

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const V = { vertical: true };
const D = { dashed: true };
const VD = { dashed: true, vertical: true };

export const EXT_DOOR_GROUPS = {
  app: { label: 'Client, oauth-mcp or Banking API', bg: '#151a24' },
  ping: { label: 'Ping product (Agent Gateway, PingOne, PingOne Authorize)', bg: '#b5231a' },
  infra: { label: 'Ingress (cmuir-mcp.ping-devops.com)', bg: '#5a5f69' },
};

const step = (key, edges, title, what, why, detail) => ({ key, edges, title, what, ...(why ? { why } : {}), detail });

// ─── Topology ─────────────────────────────────────────────────────────────────
export const EXT_DOOR_NODES = [
  N('ext', 'app', 'External client', ['LM Studio, MCP Inspector, Claude Desktop', 'never talked to this system before'], 0, 0),
  N('ing', 'infra', 'mcp-public-door-ingress', ['2 routing rules, split by path'], 340, 0),
  N('gw', 'ping', 'ping-gateway :8080', ['PingOne Agent Gateway / ForgeRock IG', 'enforces /mcp only', 'OAuth AS paths pass through unfiltered'], 680, 0),
  N('mcp', 'app', 'mcp-server :8080 (oauth-mcp)', ['dual role: MCP tool server AND', 'embedded OAuth 2.1 AS', '(DCR, /authorize, /token, /jwks, /introspect)'], 1020, 0),
  N('api', 'app', 'Banking API (BFF)', ['same REST API browser sessions use', 'reached here over Bearer', 'aud = enduser.ping.demo'], 1360, 0),
  N('p1az', 'ping', 'PingOne Authorize', ['decision endpoint', 'PERMIT / DENY per MCP call'], 680, 300),
  N('as', 'ping', 'PingOne', ['auth.pingone.com/{envId}/as', 'real IdP: the actual login'], 1020, 300),
];

export const EXT_DOOR_EDGES = [
  ['ext', 'ing', 'every call enters here: discovery, DCR, OAuth, /mcp'], // 0
  ['ing', 'mcp', '.well-known/oauth-protected-resource: direct, bypasses the gateway', D], // 1
  ['ing', 'gw', 'everything else: /register /authorize /token /jwks /mcp'], // 2
  ['gw', 'mcp', 'OAuth AS endpoints: passthrough, unfiltered, NOT P1AZ-gated', D], // 3
  ['gw', 'mcp', '^/mcp only: introspect, P1AZ decision, tools filter, reverse proxy'], // 4
  ['gw', 'p1az', 'P1AZ decision per MCP request', VD], // 5
  ['mcp', 'as', 'federated OAuth: own /authorize redirects here, own /token exchanges the code', VD], // 6
  ['mcp', 'api', 'Bearer: real federated PingOne token or self-issued JWT (fallback)'], // 7
];

export const EXT_DOOR_STEPS = [
  step('enter', [0], 'A self-registering client knocks on the public door', 'DCR creates the client\'s credentials on first contact. Every call, discovery, registration, OAuth and /mcp, enters through the ingress.', 'The client has never talked to this system before, so nothing is pre-registered.', TOPO_DETAIL.enter),
  step('well-known', [1], 'The resource metadata goes straight to mcp-server', 'The ingress sends the well-known resource metadata path directly to oauth-mcp, bypassing the gateway entirely.', 'authorization_servers names oauth-mcp\'s own issuer, not PingOne: that is what lets the client self-register.', TOPO_DETAIL.wellKnown),
  step('rest', [2], 'Everything else goes through ping-gateway', 'The second routing rule sends every other path to ping-gateway first: the OAuth endpoints and /mcp.', null, TOPO_DETAIL.everythingElse),
  step('passthrough', [3], 'OAuth AS endpoints pass through unfiltered', 'ping-gateway only enforces ^/mcp. /register, /authorize, /token and /jwks reach mcp-server untouched.', 'A client cannot hold a token yet at DCR or authorize time, so these endpoints are not P1AZ-gated or audited, by design.', TOPO_DETAIL.asPassthrough),
  step('enforced', [4], 'The /mcp path is enforced', 'ping-gateway introspects the bearer at oauth-mcp, runs the PingOne Authorize decision, trims tools/list, then reverse-proxies to mcp-server.', 'The gateway authorizes, the MCP server authenticates, and neither trusts the other\'s word for it.', TOPO_DETAIL.enforced),
  step('decision', [5], 'PingOne Authorize decides every MCP call', 'PERMIT or DENY per request, attributed to the real PingOne sub (or the client_id when no user federated).', null, TOPO_DETAIL.decision),
  step('federate', [6], 'oauth-mcp federates the login to PingOne', 'One process, two hats: its own /authorize redirects the browser to PingOne, and its own /token exchanges PingOne\'s code. The login is real.', 'PingOne has no dynamic client registration; oauth-mcp does, and still ends in a real PingOne sign-in.', TOPO_DETAIL.federate),
  step('banking', [7], 'oauth-mcp calls the Banking API over Bearer', 'The same REST API a browser session uses, reached with a real federated PingOne token, or the self-issued JWT as the fallback.', 'The token must carry aud enduser.ping.demo or the call 401s even though every earlier step worked.', TOPO_DETAIL.bankingApi),
];

export const EXT_DOOR_TOPO_DIAGRAM = { GROUPS: EXT_DOOR_GROUPS, NODES: EXT_DOOR_NODES, EDGES: EXT_DOOR_EDGES, STEPS: EXT_DOOR_STEPS };

// ─── Dual credential path ─────────────────────────────────────────────────────
// One figure for both paths, as the sequence diagram showed them: the authorization_code path on top, the
// client_credentials path below. A request and its answer share one arrow where the answer is just the reply.
export const EXT_SEQ_NODES = [
  N('C', 'app', 'Client', ['authorization_code path', 'a real user federated', 'own PKCE pair, loopback redirect', 'no PingOne token ever seen'], 0, 0),
  N('OM', 'app', 'oauth-mcp (mcp-server)', ['MCP tool server and embedded AS', 'serves /authorize, /token, /mcp', 'TokenResolver picks the bearer', 'for the Banking API call', 'stashes the PingOne token by jti'], 440, 0),
  N('P1', 'ping', 'PingOne AS', ['auth.pingone.com/{envId}/as', 'real login, real access token'], 880, 0),
  N('API', 'app', 'Banking API', ['audience-gated', 'aud = enduser.ping.demo'], 440, 220),
  N('C2', 'app', 'Client', ['client_credentials path', 'no user federated', 'own client_id and client_secret'], 0, 430),
  N('OM2', 'app', 'oauth-mcp (mcp-server)', ['TokenResolver: jti not found', 'forwards the raw self-issued JWT', 'nothing was stashed'], 440, 430),
  N('API2', 'app', 'Banking API', ['gets the self-issued JWT', 'iss = the public door host'], 880, 430),
];

export const EXT_SEQ_EDGES = [
  // authorization_code, real user federated
  ['C', 'OM', 'GET /authorize (client\'s own PKCE)'], // 0
  ['OM', 'P1', '302 to PingOne /authorize (oauth-mcp\'s own PKCE + relayState)'], // 1
  ['P1', 'OM', 'real login, then GET /authorize/callback ?code&state=relayState', D], // 2
  ['OM', 'P1', 'POST /token (PingOne code + verifier), returns the real access token'], // 3
  ['OM', 'C', 'mint self-signed JWT (jti), stash the PingOne token; return the JWT', D], // 4
  ['C', 'OM', 'POST /mcp tools/call (Bearer self-signed JWT)'], // 5
  ['OM', 'API', 'TokenResolver: jti found; Bearer real PingOne token (aud enduser.ping.demo), returns account data', V], // 6
  ['OM', 'C', 'tools/call result', D], // 7
  // client_credentials, no user federated
  ['C2', 'OM2', 'POST /token (grant_type=client_credentials)'], // 8
  ['OM2', 'C2', 'mint self-signed JWT, nothing to stash; return the JWT', D], // 9
  ['C2', 'OM2', 'POST /mcp tools/call (Bearer self-signed JWT)'], // 10
  ['OM2', 'API2', 'TokenResolver: jti not found; Bearer raw self-issued JWT (iss = the public door host)'], // 11
  ['OM2', 'C2', 'tools/call result', D], // 12
];

export const EXT_SEQ_STEPS = [
  step('authorize', [0], 'The client starts the authorization_code flow', 'GET /authorize with the client\'s own PKCE challenge, state, scope and resource.', 'oauth-mcp requires code_challenge: there is no non-PKCE flow.', SEQ_DETAIL.authorize),
  step('redirect-p1', [1], 'oauth-mcp federates to PingOne', 'It makes its own, separate PKCE pair and a relayState, then sends the browser to PingOne\'s real /authorize.', 'Two PKCE pairs, two verifiers: the client never sees the PingOne hop, and its state is not sent to PingOne.', SEQ_DETAIL.redirectP1),
  step('callback', [2], 'The user signs in; PingOne calls back', 'A real PingOne login (username and password), then a redirect to /authorize/callback with the PingOne code and the relayState.', null, SEQ_DETAIL.callback),
  step('pingone-token', [3], 'oauth-mcp trades the PingOne code for a real token', 'It POSTs the code and its own verifier to PingOne\'s token endpoint and verifies the returned access token against PingOne\'s JWKS.', 'The sub of this token is the real user id.', SEQ_DETAIL.pingoneToken),
  step('mint', [4], 'oauth-mcp mints its own JWT and stashes the real one', 'It signs a JWT with its own key and keeps the PingOne token server-side, keyed by the JWT\'s jti. The client gets only the JWT.', 'This JWT, not the PingOne token, is the Bearer for every MCP call from here on.', SEQ_DETAIL.mintJwt),
  step('mcp-call', [5], 'The client calls /mcp with the self-signed JWT', 'POST /mcp tools/call through the gateway, which introspects the bearer and asks PingOne Authorize before mcp-server runs the tool.', null, SEQ_DETAIL.mcpCall),
  step('resolve', [6], 'TokenResolver finds the stashed PingOne token', 'The jti is found, so the real PingOne token is forwarded to the Banking API (source: agent-federated-passthrough).', 'P1AZ saw the real PingOne sub as UserId, so every tool call is attributed to a person.', SEQ_DETAIL.resolveFederated),
  step('result', [7], 'The tool result returns to the client', 'The Banking API\'s account data comes back as the MCP tools/call result.', null, SEQ_DETAIL.resultFederated),
  step('cc-token', [8], 'The client asks for a token with client_credentials', 'No browser redirect and no PingOne login: it authenticates with its own client_id and client_secret from registration.', null, SEQ_DETAIL.ccToken),
  step('cc-jwt', [9], 'oauth-mcp mints a JWT with nothing to stash', 'The JWT is signed by oauth-mcp and its sub is the client_id. No PingOne login happened, so there is no PingOne token to keep.', null, SEQ_DETAIL.ccJwt),
  step('cc-mcp-call', [10], 'The client calls /mcp with the self-signed JWT', 'The same method and the same endpoint as the other path.', null, SEQ_DETAIL.ccMcpCall),
  step('passthrough', [11], 'TokenResolver forwards the raw self-issued JWT', 'The jti has no PingOne token behind it, so the JWT itself goes downstream (source: agent-passthrough).', 'P1AZ saw the client_id as UserId: there is no person to attribute the call to.', SEQ_DETAIL.resolvePassthrough),
  step('cc-result', [12], 'The tool result returns to the client', 'The response is whatever the raw self-issued JWT is entitled to.', null, SEQ_DETAIL.resultPassthrough),
];

export const EXT_DOOR_SEQ_DIAGRAM = { GROUPS: EXT_DOOR_GROUPS, NODES: EXT_SEQ_NODES, EDGES: EXT_SEQ_EDGES, STEPS: EXT_SEQ_STEPS };
