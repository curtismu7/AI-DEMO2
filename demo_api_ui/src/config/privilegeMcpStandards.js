// /privilege-mcp-diagrams (AI Agent Gateway / Privilege): for each step of the three diagrams, the request form on the
// wire, the MOCK token in play, and the standards behind it (published RFCs/specs plus emerging work).
// Shape per key: { form?, tokens?: [{ note, header?, claims }], refs }. The vocabulary lives in pingStyleStandards.js.
// All hosts, ids and secrets are placeholders; token values are teaching values only.
import { AUTH, BEARER, MCP, AUTHZ, RFC, SPEC } from './pingStyleStandards';

const uniq = (refs) => refs.filter((r, i) => refs.findIndex((x) => x.id === r.id) === i);
const refs = (...lists) => uniq(lists.flat());

const HTTP = [RFC(9110, 'HTTP semantics'), RFC(6265, 'HTTP state management (the session cookie)')];
const JSONRPC = [SPEC('JSON-RPC 2.0', 'Message framing MCP uses'), SPEC('MCP transports 2025-11-25', 'Streamable HTTP: a JSON body or an SSE stream in reply')];
const SSE = SPEC('WHATWG HTML: Server-Sent Events', 'text/event-stream relay to the browser');
const DISCOVERY = [RFC(9728, 'Protected Resource Metadata (WWW-Authenticate resource_metadata)'), RFC(8414, 'Authorization Server Metadata'), SPEC('OIDC Discovery 1.0', '.well-known/openid-configuration (the PingOne fallback)')];
const CLIENT_AUTH = SPEC('OIDC Core 1.0 section 9', 'client_secret_post and the other client authentication methods');
const GRPC = [RFC(9113, 'HTTP/2'), SPEC('gRPC over HTTP/2', 'The outbound control-plane stream')];

const ISS = 'https://auth.pingone.com/<envId>/as';
const KID = { alg: 'RS256', typ: 'JWT', kid: 'mock-kid-1' };
const OPERATOR_TOKEN = {
  note: 'Operator access token · PingOne',
  header: KID,
  claims: { iss: ISS, sub: '<operator user id>', aud: '<PRIVILEGE_MCPGW_URL>', client_id: '<PRIVILEGE_SSO_CLIENT_ID>', scope: 'openid', iat: 1790000000, exp: 1790003600, jti: 'mock-jti-1' },
};
const MACHINE_TOKEN = {
  note: 'Machine access token · PingOne client_credentials',
  header: KID,
  claims: { iss: ISS, sub: '<machine client id>', aud: 'mcpserver.ping.demo', client_id: '<machine client id>', iat: 1790000000, exp: 1790003600, jti: 'mock-jti-2' },
};
const ENROLLMENT_TOKEN = {
  note: 'Enrollment JWT · Privilege control plane',
  header: KID,
  claims: { iss: 'privilege control plane (mock)', sub: 'gateway:<gateway id>', aud: 'grpc.privilege.pingone.com', iat: 1790000000, exp: 1790086400, jti: 'mock-jti-3' },
};

const AUTH_START = 'POST /api/privilege-mcp/auth/start HTTP/1.1\nCookie: connect.sid=<session id>\n\n-> 200 { "authUrl": "https://auth.pingone.com/<envId>/as/authorize\n   ?response_type=code&client_id=<PRIVILEGE_SSO_CLIENT_ID>\n   &redirect_uri=https://demo.example.com/api/privilege-mcp/auth/callback\n   &scope=openid&code_challenge=<S256 hash>&code_challenge_method=S256\n   &state=<nonce>&login_hint=<operator email>" }';
const DISCOVER = 'GET <PRIVILEGE_MCPGW_URL> HTTP/1.1\nAccept: application/json, text/event-stream\n\n-> 401 Unauthorized  (header shape illustrative)\nWWW-Authenticate: Bearer resource_metadata="https://<gateway host>/.well-known/oauth-protected-resource",\n  authorization_uri="https://auth.pingone.com/<envId>/as/authorize",\n  token_uri="https://auth.pingone.com/<envId>/as/token"';
const TOKEN_POST = 'POST /<envId>/as/token HTTP/1.1\nHost: auth.pingone.com\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=authorization_code&code=<one-time code>\n&redirect_uri=https://demo.example.com/api/privilege-mcp/auth/callback\n&client_id=<PRIVILEGE_SSO_CLIENT_ID>&client_secret=<secret>\n&code_verifier=<PKCE secret>\n\n-> 200 { "access_token": "<JWT>", "refresh_token": "<opaque>", "expires_in": 3600 }';
const CALLBACK = 'GET /api/privilege-mcp/auth/callback?code=<one-time code>&state=<nonce> HTTP/1.1\nCookie: connect.sid=<session id>\n\n(the BFF compares state with the value stored in the session, then POSTs the code to token_uri)';
const INITIALIZE = 'POST <PRIVILEGE_MCPGW_URL> HTTP/1.1\nAuthorization: Bearer <access token>\nContent-Type: application/json\nAccept: application/json, text/event-stream\n\n{ "jsonrpc": "2.0", "id": 1, "method": "initialize",\n  "params": { "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": { "name": "demo-api-server", "version": "1.0" } } }\n\n-> 200  MCP-Session-Id: <session id>\nthen { "jsonrpc": "2.0", "method": "notifications/initialized" }';
const TOOLS_LIST = 'POST <PRIVILEGE_MCPGW_URL> HTTP/1.1\nAuthorization: Bearer <access token>\nmcp-protocol-version: 2025-11-25\nMCP-Session-Id: <session id>\n\n{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }\n\n-> 200 (JSON, or SSE frames)  { "result": { "tools": [ { "name": "<tool name>" } ] } }';
const TOOLS_CALL = 'POST <PRIVILEGE_MCPGW_URL> HTTP/1.1\nAuthorization: Bearer <access token>\nMCP-Session-Id: <session id>\n\n{ "jsonrpc": "2.0", "id": 3, "method": "tools/call",\n  "params": { "name": "<tool name>", "arguments": {} } }';
const REFRESH = 'POST /<envId>/as/token HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=refresh_token&refresh_token=<opaque>\n&client_id=<PRIVILEGE_SSO_CLIENT_ID>&client_secret=<secret>\n\n(sent when the stored token expires within 60 seconds)';

const OP_TOKEN_REFS = refs(AUTH, CLIENT_AUTH);
const MCP_CALL_REFS = refs(MCP, BEARER, JSONRPC);

export const ARCH_DETAIL = {
  browser: {
    form: 'GET /api/privilege-mcp/state HTTP/1.1\nCookie: connect.sid=<session id>\n\n(the page never speaks MCP and never holds a token: the BFF keeps it in the server-side session)',
    refs: refs(HTTP),
  },
  sse: {
    form: 'GET <relay events endpoint, name illustrative> HTTP/1.1\nAccept: text/event-stream\n\ndata: {"direction":"bff->gateway","method":"tools/list"}',
    refs: [SSE, ...HTTP],
  },
  authz: {
    form: 'User:    GET https://auth.pingone.com/<envId>/as/authorize?response_type=code&code_challenge=<S256 hash>...\nMachine: POST /<envId>/as/token  grant_type=client_credentials&client_id=<machine client id>&client_secret=<secret>',
    tokens: [OPERATOR_TOKEN, MACHINE_TOKEN],
    refs: refs(AUTH, [RFC(6749, 'Client credentials grant (section 4.4)')]),
  },
  session1: {
    form: TOOLS_LIST,
    tokens: [OPERATOR_TOKEN],
    refs: MCP_CALL_REFS,
  },
  enroll: {
    form: 'gRPC over HTTP/2 to grpc.privilege.pingone.com:443  (the gateway dials out; it binds no public port)\nmetadata: authorization: Bearer <enrollment JWT>   (metadata name illustrative)',
    tokens: [ENROLLMENT_TOKEN],
    refs: refs(GRPC, [RFC(7519, 'JSON Web Token')]),
  },
  session2: {
    form: 'POST http://mcp-server:8080/ HTTP/1.1   (path illustrative)\nMCP-Session-Id: <session 2 id>\n\n{ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": "<tool name>" } }\n\n(only after the gateway policy permits the call)',
    refs: refs(MCP, JSONRPC, AUTHZ.slice(0, 1)),
  },
  direct: {
    form: 'POST http://mcp-server:8080/ HTTP/1.1   (path illustrative)\nAuthorization: Bearer <machine token, aud mcpserver.ping.demo>\n\n{ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }\n\n(no human and no Privilege policy on this route)',
    tokens: [MACHINE_TOKEN],
    refs: MCP_CALL_REFS,
  },
  api: {
    form: 'https://privilege.pingone.com/api/mcp\n\nA control-plane endpoint. An MCP client must call the gateway URL; pointing one at this endpoint is the mistake the dashed line warns about.',
    refs: refs(MCP.slice(0, 2)),
  },
};

export const SEQ_DETAIL = {
  signInClick: {
    form: 'UI event: click "Sign In with Privilege"\n-> fetch("POST /api/privilege-mcp/auth/start", { credentials: "include" })',
    refs: refs(AUTH.slice(0, 3)),
  },
  authStart: { form: AUTH_START, refs: refs(AUTH.slice(0, 4)) },
  discover: { form: DISCOVER, refs: refs(DISCOVERY, MCP.slice(0, 1)) },
  hostedSignOn: {
    form: 'GET https://auth.pingone.com/<envId>/as/authorize?response_type=code&client_id=<PRIVILEGE_SSO_CLIENT_ID>\n  &code_challenge=<S256 hash>&code_challenge_method=S256&state=<nonce>\n\n(PingOne shows its hosted sign-on; the operator authenticates there, not in the demo)',
    refs: refs(AUTH),
  },
  callback: {
    form: `${CALLBACK}\n\n${TOKEN_POST}`,
    tokens: [OPERATOR_TOKEN],
    refs: OP_TOKEN_REFS,
  },
  authSuccess: {
    form: 'HTTP/1.1 302 Found\nLocation: /privilege-mcp-client?auth=success',
    refs: refs(HTTP),
  },
  loadClick: {
    form: 'UI event: click "Load Tools"\n-> fetch("POST /api/privilege-mcp/tools/list", { credentials: "include" })',
    refs: refs(HTTP),
  },
  toolsListPage: {
    form: 'POST /api/privilege-mcp/tools/list HTTP/1.1\nCookie: connect.sid=<session id>\n\n-> 200 { "tools": [ { "name": "<tool name>" } ] }',
    refs: refs(HTTP),
  },
  handshake: { form: INITIALIZE, tokens: [OPERATOR_TOKEN], refs: MCP_CALL_REFS },
  toolsListGw: { form: TOOLS_LIST, tokens: [OPERATOR_TOKEN], refs: MCP_CALL_REFS },
  toolsListMcp: {
    form: '{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }   (gateway session 2, to mcp-server)\n\n-> { "result": { "tools": [ { "name": "<tool name>" } ] } }',
    refs: refs(MCP, JSONRPC),
  },
  runClick: {
    form: 'UI event: click "Run" on a tool\n-> fetch("POST /api/privilege-mcp/tools/call", { credentials: "include" })',
    refs: refs(HTTP),
  },
  toolsCallPage: {
    form: 'POST /api/privilege-mcp/tools/call HTTP/1.1\nCookie: connect.sid=<session id>\n\n{ "name": "<tool name>", "arguments": {} }\n\n-> 200 { "result": ... }   or the gateway\'s 4xx, relayed',
    refs: refs(HTTP),
  },
  toolsCallGw: {
    form: `${TOOLS_CALL}\n\nPrivilege decides here: JIT least-privilege policy, with session recording.`,
    tokens: [OPERATOR_TOKEN],
    refs: refs(MCP_CALL_REFS, AUTHZ.slice(0, 1)),
  },
  permitted: {
    form: '{ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "<tool name>" } }   (gateway session 2)\n\n-> { "result": { "content": [ { "type": "text", "text": "<tool output>" } ] } }',
    refs: refs(MCP, JSONRPC),
  },
  denied: {
    form: 'HTTP/1.1 403 Forbidden   (status illustrative: the gateway relays its own 4xx)\n\n{ "error": "denied by policy" }',
    refs: refs(AUTHZ.slice(0, 1), [RFC(6750, 'Bearer token error responses'), RFC(9110, 'HTTP status codes')]),
  },
};

export const FLOW_DETAIL = {
  state: { form: 'GET /api/privilege-mcp/state HTTP/1.1\nCookie: connect.sid=<session id>\n\n-> 200 { "signedIn": false }   (field names illustrative)', refs: refs(HTTP) },
  start: { form: AUTH_START, refs: refs(AUTH.slice(0, 4)) },
  probe: { form: DISCOVER, refs: refs(DISCOVERY, MCP.slice(0, 1)) },
  headerYes: {
    form: 'authorization_uri = https://auth.pingone.com/<envId>/as/authorize\ntoken_uri         = https://auth.pingone.com/<envId>/as/token\n(both read straight from the 401 WWW-Authenticate header)',
    refs: refs(DISCOVERY.slice(0, 2), AUTH.slice(0, 1)),
  },
  headerNo: {
    form: 'GET https://auth.pingone.com/PRIVILEGE_SSO_ENV_ID/as/.well-known/openid-configuration HTTP/1.1\n\n-> 200 { "authorization_endpoint": "...", "token_endpoint": "...", "issuer": "https://auth.pingone.com/<envId>/as" }',
    refs: refs(DISCOVERY.slice(1), AUTH.slice(0, 4)),
  },
  pkce: {
    form: 'code_verifier  = <43-128 random chars>\ncode_challenge = BASE64URL(SHA256(code_verifier))   method S256\nstate          = <random nonce>, kept in the session\n\n302 Location: https://auth.pingone.com/<envId>/as/authorize?client_id=<PRIVILEGE_SSO_CLIENT_ID>\n  &code_challenge=<S256 hash>&code_challenge_method=S256&state=<nonce>',
    refs: refs(AUTH),
  },
  callback: { form: CALLBACK, refs: refs(AUTH.slice(0, 3)) },
  token: { form: TOKEN_POST, tokens: [OPERATOR_TOKEN], refs: OP_TOKEN_REFS },
  invalidClient: {
    form: 'HTTP/1.1 401 Unauthorized\n{ "error": "invalid_client", "error_description": "Request denied: Unsupported authentication method" }   (text illustrative)\n\nFix: use the right secret, and set the PingOne app to client_secret_post.',
    refs: refs([RFC(6749, 'Error response, invalid_client (section 5.2)')], [CLIENT_AUTH]),
  },
  store: {
    form: 'clientSessions[sessionId] = { accessToken, refreshToken, expiresAt }   (server-side map; never sent to the browser)\n\nHTTP/1.1 302 Found\nLocation: /privilege-mcp-client?auth=success',
    tokens: [OPERATOR_TOKEN],
    refs: refs(BEARER.slice(0, 1), AUTH.slice(0, 1), HTTP),
  },
  toolsPage: {
    form: 'POST /api/privilege-mcp/tools/list HTTP/1.1\nCookie: connect.sid=<session id>\n\n(the BFF now has a token: it checks expiry, then calls the gateway)',
    refs: refs(HTTP),
  },
  refresh: { form: REFRESH, refs: refs(AUTH.slice(0, 1), [CLIENT_AUTH]) },
  gateway: { form: INITIALIZE, tokens: [OPERATOR_TOKEN], refs: MCP_CALL_REFS },
  forward: {
    form: '{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }   (to mcp-server:8080)\n\nmcp-server runs with MCP_AUTH_DISABLED=true in this demo: it returns a stub token and skips its own auth checks.',
    refs: refs(MCP, JSONRPC),
  },
  returned: {
    form: '-> 200 { "tools": [ { "name": "<tool name>" } ] }   (the BFF returns the list to the page)',
    refs: refs(MCP.slice(0, 1), HTTP),
  },
};
