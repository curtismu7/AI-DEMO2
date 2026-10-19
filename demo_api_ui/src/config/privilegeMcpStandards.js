// /privilege-mcp-diagrams (AI Agent Gateway / Privilege): for each step of the three diagrams, the request form on the
// wire, the MOCK token in play, and the standards behind it (published RFCs/specs plus emerging work).
// Shape per key: { form?, tokens?: [{ note, header?, claims }], refs }. The vocabulary lives in pingStyleStandards.js.
// All hosts, ids and secrets are placeholders; token values are teaching values only.
import { AUTH, BEARER, MCP, RFC, SPEC, DRAFT } from './pingStyleStandards';

const uniq = (refs) => refs.filter((r, i) => refs.findIndex((x) => x.id === r.id) === i);
const refs = (...lists) => uniq(lists.flat());

const HTTP = [RFC(9110, 'HTTP semantics'), RFC(6265, 'HTTP state management (the session cookie)')];
const JSONRPC = [SPEC('JSON-RPC 2.0', 'Message framing MCP uses'), SPEC('MCP transports 2025-11-25', 'Streamable HTTP: a JSON body or an SSE stream in reply')];
const SSE = SPEC('WHATWG HTML: Server-Sent Events', 'text/event-stream relay to the browser');
const DISCOVERY = [RFC(9728, 'Protected Resource Metadata (WWW-Authenticate resource_metadata)'), RFC(8414, 'Authorization Server Metadata'), SPEC('OIDC Discovery 1.0', '.well-known/openid-configuration (the PingOne fallback)')];
const DCR = RFC(7591, 'Dynamic Client Registration: the BFF registers itself with the gateway authorization server');
const CIMD = MCP[4]; // Client ID Metadata Documents: the gateway can take a client document URL as client_id
const OAUTH21 = AUTH[6];
// Emerging or newer work specific to this page (status can change; verify before quoting).
const BROWSER_BFF = DRAFT('draft-ietf-oauth-browser-based-apps', 'OAuth 2.0 for Browser-Based Applications: the BFF keeps tokens off the browser, as this page does');
const MCP_NEXT = DRAFT('MCP 2026-07-28', 'The newer MCP protocol version the BFF tries first (server/discover); older gateways fall back to initialize');
const WIMSE = DRAFT('draft-ietf-wimse-arch', 'WIMSE: how a workload such as the gateway proves itself (an analogy; the enrollment JWT itself is Privilege-specific)');
const ZERO_TRUST = SPEC('NIST SP 800-207', 'Zero Trust Architecture: the gateway plays the policy enforcement point (an analogy; Privilege applies its own JIT policy)');
const MCP_CORE = MCP.slice(0, 4);
const CLIENT_AUTH = SPEC('OIDC Core 1.0 section 9', 'client_secret_post and the other client authentication methods');
const GRPC = [RFC(9113, 'HTTP/2'), SPEC('gRPC over HTTP/2', 'The outbound control-plane stream')];

const ISS = 'https://auth.pingone.com/<envId>/as';
const KID = { alg: 'RS256', typ: 'JWT', kid: 'mock-kid-1' };
const OPERATOR_TOKEN = {
  note: 'Operator access token · issued after the PingOne sign-on',
  header: KID,
  claims: { iss: ISS, sub: '<operator user id>', aud: 'mcpserver.ping.demo', client_id: '<client id used for the sign-in>', scope: 'openid profile email offline_access', iat: 1790000000, exp: 1790003600, jti: 'mock-jti-1' },
};
const MACHINE_TOKEN = {
  note: 'Machine access token · PingOne client_credentials',
  header: KID,
  claims: { iss: ISS, sub: '<machine client id>', aud: 'mcpserver.ping.demo', client_id: '<machine client id>', scope: 'read write mcp:invoke', iat: 1790000000, exp: 1790003600, jti: 'mock-jti-2' },
};

const AUTH_START = 'POST /api/privilege-mcp/auth/start HTTP/1.1\nCookie: connect.sid=<session id>\n\n-> 200 { "authUrl": "<authorization_uri>\n   ?response_type=code&client_id=<client id from registration>\n   &redirect_uri=https://demo.example.com/api/privilege-mcp/auth/callback\n   &scope=openid profile email offline_access&code_challenge=<S256 hash>&code_challenge_method=S256\n   &state=<nonce>&login_hint=<operator email>" }\n\n(authorization_uri comes from the gateway, or from PingOne discovery on the fallback route)';
const DISCOVER = 'GET <PRIVILEGE_MCPGW_URL> HTTP/1.1\n(x-procyon-session-id: <uuid> is added when the URL is a Privilege cloud host; the value is not validated)\n\n-> 401 Unauthorized  (header shape illustrative)\nWWW-Authenticate: Bearer resource_metadata="https://<gateway host>/.well-known/oauth-protected-resource",\n  authorization_uri="https://<gateway AS>/authorize"\nbody: { "authorization_uri": "https://<gateway AS>/authorize", "token_uri": "https://<gateway AS>/token" }\n\nThese are the gateway\'s OWN authorization server endpoints, not PingOne\'s. The BFF reads authorization_uri from the body or the header, and token_uri from the body.\n\nThen it registers a client with that server:\nPOST https://<gateway AS>/register\n{ "redirect_uris": ["https://demo.example.com/api/privilege-mcp/auth/callback"], "client_name": "ai-demo-bff",\n  "application_type": "web", "token_endpoint_auth_method": "client_secret_post" }\n-> 201 { "client_id": "<new client id>", "client_secret": "<secret>" }';
const TOKEN_POST = 'POST <token_uri> HTTP/1.1   (PingOne: https://auth.pingone.com/<envId>/as/token)\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=authorization_code&code=<one-time code>\n&redirect_uri=https://demo.example.com/api/privilege-mcp/auth/callback\n&client_id=<client id>&client_secret=<secret>\n&code_verifier=<PKCE secret>\n\n-> 200 { "access_token": "<JWT>", "refresh_token": "<opaque>", "expires_in": 3600 }';
const CALLBACK = 'GET /api/privilege-mcp/auth/callback?code=<one-time code>&state=<nonce> HTTP/1.1\nCookie: connect.sid=<session id>\n\n(the BFF compares state with the value stored in the session, then POSTs the code to token_uri)';
const INITIALIZE = 'POST <PRIVILEGE_MCPGW_URL> HTTP/1.1\nAuthorization: Bearer <access token>\nx-procyon-session-id: <uuid>   (Privilege cloud hosts)\nContent-Type: application/json\nAccept: application/json, text/event-stream\n\n{ "jsonrpc": "2.0", "id": 1, "method": "initialize",\n  "params": { "protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": { "name": "PingOne Privilege MCP Client", "version": "2.0.0" } } }\n\n-> 200  MCP-Session-Id: <session id>, result.protocolVersion = the version the server chose\nthen { "jsonrpc": "2.0", "method": "notifications/initialized", "params": {} }\n\n(The BFF first tries the newer handshake, a server/discover call that carries 2026-07-28 in params._meta and the MCP-Protocol-Version header. This initialize is the fallback for a gateway that answers method-not-found.)';
const TOOLS_LIST = 'POST <PRIVILEGE_MCPGW_URL> HTTP/1.1\nAuthorization: Bearer <access token>\nMCP-Protocol-Version: <version the server returned from initialize>\nMCP-Session-Id: <session id>\nx-procyon-session-id: <uuid>   (Privilege cloud hosts)\n\n{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }\n\n-> 200 (JSON, or SSE frames)  { "result": { "tools": [ { "name": "<tool name>" } ] } }';
const TOOLS_CALL = 'POST <PRIVILEGE_MCPGW_URL> HTTP/1.1\nAuthorization: Bearer <access token>\nMCP-Protocol-Version: <negotiated version>\nMCP-Session-Id: <session id>\nx-procyon-session-id: <uuid>   (Privilege cloud hosts)\n\n{ "jsonrpc": "2.0", "id": 3, "method": "tools/call",\n  "params": { "name": "<tool name>", "arguments": {} } }';
const REFRESH = 'POST <token_uri> HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=refresh_token&refresh_token=<opaque>\n&client_id=<client id>&client_secret=<secret>\n\n(sent when the stored token expires within 60 seconds)';

const OP_TOKEN_REFS = refs(AUTH, [CLIENT_AUTH]);
const MCP_CALL_REFS = refs(MCP_CORE, BEARER, JSONRPC, [MCP_NEXT]);

export const ARCH_DETAIL = {
  browser: {
    form: 'GET /api/privilege-mcp/state HTTP/1.1\nCookie: connect.sid=<session id>\n\n(the page never speaks MCP and never holds a token: the BFF keeps it in the server-side session)',
    refs: refs(HTTP, [BROWSER_BFF]),
  },
  sse: {
    form: 'GET /api/privilege-mcp/events HTTP/1.1\nAccept: text/event-stream\n\nevent: relay\ndata: {"ts":"<ISO time>","direction":"client->mcp","method":"POST","url":"<PRIVILEGE_MCPGW_URL>","body":{"method":"tools/list"}}',
    refs: refs([SSE], HTTP, [BROWSER_BFF]),
  },
  authz: {
    form: 'User:    GET <authorization_uri>?response_type=code&scope=openid profile email offline_access&code_challenge=<S256 hash>...\nMachine: POST /<envId>/as/token  grant_type=client_credentials&client_id=<machine client id>&client_secret=<secret>\n         &scope=read write mcp:invoke   (a bare client_credentials is rejected: the app holds grants on several resources)',
    tokens: [OPERATOR_TOKEN, MACHINE_TOKEN],
    refs: refs(AUTH, [RFC(6749, 'Client credentials grant (section 4.4)')]),
  },
  session1: {
    form: TOOLS_LIST,
    tokens: [OPERATOR_TOKEN],
    refs: MCP_CALL_REFS,
  },
  enroll: {
    form: 'gRPC over HTTP/2 to grpc.privilege.pingone.com:443  (the gateway dials out; it binds no public port)\nauthenticated by the enrollment JWT from the console gateway wizard\n\nPolicy flows in and session recordings flow out over this one outbound connection. The JWT\'s claims are Privilege-specific, so none are shown here.',
    refs: refs(GRPC, [RFC(7519, 'JSON Web Token'), WIMSE]),
  },
  session2: {
    form: 'POST http://mcp-server:8080/mcp HTTP/1.1\nMCP-Session-Id: <session 2 id>\n\n{ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": "<tool name>" } }\n\n(only after the gateway policy permits the call)',
    refs: refs(MCP_CORE, JSONRPC, [MCP_NEXT, ZERO_TRUST]),
  },
  direct: {
    form: 'POST http://mcp-server:8080/mcp HTTP/1.1\nAuthorization: Bearer <machine token, aud mcpserver.ping.demo>\n\n{ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }\n\n(no human and no Privilege policy on this route)',
    tokens: [MACHINE_TOKEN],
    refs: MCP_CALL_REFS,
  },
  api: {
    form: 'https://privilege.pingone.com/api/mcp\n\nA control-plane endpoint. An MCP client must call the gateway URL; pointing one at this endpoint is the mistake the dashed line warns about.',
    refs: refs(MCP_CORE.slice(0, 2), [MCP_NEXT]),
  },
};

export const SEQ_DETAIL = {
  signInClick: {
    form: 'UI event: click "Sign In with Privilege"\n-> fetch("POST /api/privilege-mcp/auth/start", { credentials: "include" })',
    refs: refs(AUTH.slice(0, 3), [OAUTH21, BROWSER_BFF]),
  },
  authStart: { form: AUTH_START, refs: refs(AUTH.slice(0, 4), [OAUTH21, BROWSER_BFF]) },
  discover: { form: DISCOVER, refs: refs(DISCOVERY, [DCR], MCP.slice(0, 1), [CIMD]) },
  hostedSignOn: {
    form: 'GET <authorization_uri>?response_type=code&client_id=<client id>\n  &code_challenge=<S256 hash>&code_challenge_method=S256&state=<nonce>\n\n(PingOne shows its hosted sign-on; the operator authenticates there, not in the demo)',
    refs: refs(AUTH),
  },
  callback: {
    form: `${CALLBACK}\n\n${TOKEN_POST}`,
    tokens: [OPERATOR_TOKEN],
    refs: OP_TOKEN_REFS,
  },
  authSuccess: {
    form: 'HTTP/1.1 302 Found\nLocation: /privilege-mcp-client?auth=success',
    refs: refs(HTTP, [BROWSER_BFF]),
  },
  loadClick: {
    form: 'UI event: click "Load Tools"\n-> fetch("POST /api/privilege-mcp/tools/list", { credentials: "include" })',
    refs: refs(HTTP, [BROWSER_BFF]),
  },
  toolsListPage: {
    form: 'POST /api/privilege-mcp/tools/list HTTP/1.1\nCookie: connect.sid=<session id>\n\n-> 200 { "tools": [ { "name": "<tool name>" } ] }',
    refs: refs(HTTP, [BROWSER_BFF]),
  },
  handshake: { form: INITIALIZE, tokens: [OPERATOR_TOKEN], refs: MCP_CALL_REFS },
  toolsListGw: { form: TOOLS_LIST, tokens: [OPERATOR_TOKEN], refs: MCP_CALL_REFS },
  toolsListMcp: {
    form: '{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }   (gateway session 2, to mcp-server:8080/mcp)\n\n-> { "result": { "tools": [ { "name": "<tool name>" } ] } }',
    refs: refs(MCP_CORE, JSONRPC, [MCP_NEXT]),
  },
  runClick: {
    form: 'UI event: click "Run" on a tool\n-> fetch("POST /api/privilege-mcp/tools/call", { credentials: "include" })',
    refs: refs(HTTP, [BROWSER_BFF]),
  },
  toolsCallPage: {
    form: 'POST /api/privilege-mcp/tools/call HTTP/1.1\nCookie: connect.sid=<session id>\n\n{ "name": "<tool name>", "arguments": {} }\n\n-> 200 { "result": ... }   or the gateway\'s 4xx, relayed',
    refs: refs(HTTP, [BROWSER_BFF]),
  },
  toolsCallGw: {
    form: `${TOOLS_CALL}\n\nPrivilege decides here: JIT least-privilege policy, with session recording.`,
    tokens: [OPERATOR_TOKEN],
    refs: refs(MCP_CALL_REFS, [ZERO_TRUST]),
  },
  permitted: {
    form: '{ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "<tool name>" } }   (gateway session 2)\n\n-> { "result": { "content": [ { "type": "text", "text": "<tool output>" } ] } }',
    refs: refs(MCP_CORE, JSONRPC, [MCP_NEXT]),
  },
  denied: {
    form: 'HTTP/1.1 4xx   (the gateway\'s own status; the BFF relays it unchanged. The body shape is the gateway\'s and is not specified here.)',
    refs: refs([RFC(9110, 'HTTP status codes')], [ZERO_TRUST, MCP_NEXT]),
  },
};

export const FLOW_DETAIL = {
  state: { form: 'GET /api/privilege-mcp/state HTTP/1.1\nCookie: connect.sid=<session id>\n\n-> 200 { "signedIn": false }   (field names illustrative)', refs: refs(HTTP, [BROWSER_BFF]) },
  start: { form: AUTH_START, refs: refs(AUTH.slice(0, 4), [OAUTH21, BROWSER_BFF]) },
  probe: { form: DISCOVER, refs: refs(DISCOVERY, [DCR], MCP.slice(0, 1), [CIMD]) },
  headerYes: {
    form: 'authorization_uri = https://<gateway AS>/authorize   (from the body or the WWW-Authenticate header)\ntoken_uri         = https://<gateway AS>/token       (from the response body)\n\nThese are the gateway\'s own authorization server, not PingOne. The BFF registers a client there first:\nPOST https://<gateway AS>/register  { "client_name": "ai-demo-bff", "token_endpoint_auth_method": "client_secret_post", ... }\n-> 201 { "client_id": "<new client id>", "client_secret": "<secret>" }',
    refs: refs(DISCOVERY.slice(0, 2), [DCR], AUTH.slice(0, 1), [CIMD]),
  },
  headerNo: {
    form: 'GET https://auth.pingone.com/<PRIVILEGE_SSO_ENV_ID>/as/.well-known/openid-configuration HTTP/1.1\n\n-> 200 { "authorization_endpoint": "...", "token_endpoint": "...", "issuer": "https://auth.pingone.com/<envId>/as" }\n\n(the fallback uses the configured PingOne app, PRIVILEGE_SSO_CLIENT_ID, instead of registering a client)',
    refs: refs(DISCOVERY.slice(1), AUTH.slice(0, 4), [OAUTH21]),
  },
  pkce: {
    form: 'code_verifier  = <43-128 random chars>\ncode_challenge = BASE64URL(SHA256(code_verifier))   method S256\nstate          = <random nonce>, kept in the session\n\n302 Location: <authorization_uri>?client_id=<client id>\n  &code_challenge=<S256 hash>&code_challenge_method=S256&state=<nonce>',
    refs: refs(AUTH),
  },
  callback: { form: CALLBACK, refs: refs(AUTH.slice(0, 3), [OAUTH21]) },
  token: { form: TOKEN_POST, tokens: [OPERATOR_TOKEN], refs: OP_TOKEN_REFS },
  invalidClient: {
    form: 'HTTP/1.1 401 Unauthorized\n{ "error": "invalid_client", "error_description": "Request denied: Unsupported authentication method" }   (text illustrative)\n\nFix: use the right secret, and set the PingOne app to client_secret_post.',
    refs: refs([RFC(6749, 'Error response, invalid_client (section 5.2)')], [CLIENT_AUTH, OAUTH21]),
  },
  store: {
    form: 'clientSessions[sessionId] = { accessToken, refreshToken, expiresAt }   (server-side map; never sent to the browser)\n\nHTTP/1.1 302 Found\nLocation: /privilege-mcp-client?auth=success',
    tokens: [OPERATOR_TOKEN],
    refs: refs(BEARER.slice(0, 1), AUTH.slice(0, 1), HTTP, [BROWSER_BFF]),
  },
  toolsPage: {
    form: 'POST /api/privilege-mcp/tools/list HTTP/1.1\nCookie: connect.sid=<session id>\n\n(the BFF now has a token: it checks expiry, then calls the gateway)',
    refs: refs(HTTP, [BROWSER_BFF]),
  },
  refresh: { form: REFRESH, refs: refs(AUTH.slice(0, 1), [CLIENT_AUTH, OAUTH21]) },
  gateway: { form: INITIALIZE, tokens: [OPERATOR_TOKEN], refs: MCP_CALL_REFS },
  forward: {
    form: '{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }   (to mcp-server:8080/mcp)\n\nmcp-server runs with MCP_AUTH_DISABLED=true in this demo: it returns a stub token and skips its own auth checks.',
    refs: refs(MCP_CORE, JSONRPC, [MCP_NEXT]),
  },
  returned: {
    form: '-> 200 { "tools": [ { "name": "<tool name>" } ] }   (the BFF returns the list to the page)',
    refs: refs(MCP.slice(0, 1), HTTP, [BROWSER_BFF]),
  },
};
