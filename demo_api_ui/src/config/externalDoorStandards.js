// /external-door-diagrams: per-step wire forms, MOCK decoded tokens and standards for the topology and the dual-path
// sequence. Shape per key: { form, tokens: [{ note, header?, claims }], noToken?: reason, refs }. A step with no token in
// play has tokens: [] and the reason in noToken (the reason is also printed at the end of the form, which is what the
// step detail panel shows). Source: docs/EXTERNAL_DOOR_MCP_FLOW.md and oauth-mcp/src (OAuthRouter, TokenIssuer,
// TokenResolver), ping-gateway/config/routes/00-mcp-external-door.json and scripts/groovy/p1az-decision.groovy.
// All hosts, ids and secrets are placeholders; token values are teaching values only.
import { RFC, SPEC, AUTH, BEARER, INTROSPECT, MCP } from './pingStyleStandards';

const uniq = (refs) => refs.filter((r, i) => refs.findIndex((x) => x.id === r.id) === i);
const refs = (...lists) => uniq(lists.flat());

const HOST = 'https://<public door host>';
const HTTP = RFC(9110, 'HTTP semantics');
const OAUTH21 = AUTH[6];
const CIMD = MCP[4];
const JSONRPC = SPEC('JSON-RPC 2.0', 'Message framing MCP uses');
const TRANSPORT = SPEC('MCP transports 2025-11-25', 'Streamable HTTP: POST /mcp with a JSON body');
const MCP_AUTH = MCP[0];
const P1AZ = SPEC('PingOne Authorize decision endpoints', 'POST decisionEndpoints/{id} with the request parameters');
const PKCE = AUTH[1];
const OIDC = AUTH[3];
const BCP = AUTH[2];
const LOOPBACK = RFC(8252, 'OAuth 2.0 for Native Apps: the loopback redirect_uri a desktop client registers');
const RESOURCE = RFC(8707, 'Resource Indicators: resource= asks PingOne for a token audienced for the Banking API');
const JWT = INTROSPECT[2];
const JWK = INTROSPECT[3];
const EXCHANGE_SKIPPED = RFC(8693, 'Token Exchange: the Step 9 exchange TokenResolver skips for a self-issued token');

const NO_TOKEN = (reason) => ({ tokens: [], noToken: reason });
const withReason = (form, reason) => `${form}\n\nToken: none. ${reason}`;

const KID = { alg: 'RS256', kid: '<signing key id>' };
const SELF_ISSUED = {
  note: 'oauth-mcp access token (self-signed) · authorization_code, a real user federated',
  header: KID,
  claims: { iss: HOST, sub: '<PingOne user id>', aud: 'mcpserver.ping.demo', client_id: '<registered client id>', scope: 'openid mcp:invoke read', iat: 1790000000, exp: 1790003600, jti: 'mock-jti-1' },
};
const SELF_ISSUED_ID = {
  note: 'oauth-mcp ID token (self-signed) · issued next to the access token because the scope includes openid',
  header: KID,
  claims: { iss: HOST, sub: '<PingOne user id>', aud: '<registered client id>', preferred_username: '<username>', email: '<user email>', auth_time: 1789999990, amr: ['pwd'], nonce: '<client nonce, when sent>', iat: 1790000000, exp: 1790003600 },
};
const SELF_ISSUED_CC = {
  note: 'oauth-mcp access token (self-signed) · client_credentials, no user',
  header: KID,
  claims: { iss: HOST, sub: '<registered client id>', aud: 'mcpserver.ping.demo', client_id: '<registered client id>', scope: 'mcp:invoke read', iat: 1790000000, exp: 1790003600, jti: 'mock-jti-2' },
};
const PINGONE_TOKEN = {
  note: 'PingOne access token (real, kept server-side) · from the federated login',
  header: { alg: 'RS256', kid: '<PingOne signing key id>' },
  claims: { iss: 'https://auth.pingone.com/<envId>/as', sub: '<PingOne user id>', aud: 'enduser.ping.demo', client_id: '<OAUTH_MCP_PINGONE_CLIENT_ID>', scope: 'read', iat: 1790000000, exp: 1790003600, jti: 'mock-jti-3' },
};
const PINGONE_ID_TOKEN = {
  note: 'PingOne ID token (real) · the token oauth-mcp verifies; its sub is the real user',
  header: { alg: 'RS256', kid: '<PingOne signing key id>' },
  claims: { iss: 'https://auth.pingone.com/<envId>/as', sub: '<PingOne user id>', aud: '<OAUTH_MCP_PINGONE_CLIENT_ID>', preferred_username: '<username>', email: '<user email>', auth_time: 1789999990, amr: ['pwd'], acr: '<PingOne sign-on policy>', iat: 1790000000, exp: 1790003600 },
};
const INTROSPECTION = {
  note: 'Introspection response · what the gateway learns about the bearer (RFC 7662, not a token)',
  claims: { active: true, scope: 'openid mcp:invoke read', client_id: '<registered client id>', sub: '<PingOne user id>', aud: 'mcpserver.ping.demo', iss: HOST, exp: 1790003600, iat: 1790000000, jti: 'mock-jti-1', token_type: 'Bearer' },
};

// ─── Shared wire forms ────────────────────────────────────────────────────────
const AUTHORIZE = `GET /authorize
  ?response_type=code
  &client_id=<registered client id>
  &code_challenge=<client's own S256 challenge>
  &code_challenge_method=S256
  &redirect_uri=http://127.0.0.1:6274/oauth/callback
  &state=<client's own state>
  &scope=openid mcp:invoke read
  &resource=${HOST}/mcp`;
const TOKEN_CODE = `POST /token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<oauth-mcp's own code>
&redirect_uri=http://127.0.0.1:6274/oauth/callback
&client_id=<registered client id>
&client_secret=<client secret>
&code_verifier=<client's own PKCE verifier>

-> 200 { "access_token": "<self-signed JWT>", "token_type": "Bearer", "expires_in": 3600,
         "scope": "openid mcp:invoke read", "id_token": "<OIDC ID token>" }`;
const MCP_CALL = `POST /mcp HTTP/1.1
Host: <public door host>
Authorization: Bearer <access token>
MCP-Protocol-Version: 2025-11-25
Mcp-Session-Id: <session id>
Content-Type: application/json

{ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "get_my_accounts", "arguments": {} } }`;
const DOOR_GATEWAY = '(through ping-gateway: introspect the bearer, one PingOne Authorize decision, then the reverse proxy)';
const RESULT = `{ "jsonrpc": "2.0", "id": 2,
  "result": { "content": [ { "type": "text", "text": "<account data>" } ], "structuredContent": { } } }`;
const MCP_REFS = refs([MCP_AUTH, TRANSPORT, JSONRPC], BEARER.slice(0, 1));

// ─── Topology ─────────────────────────────────────────────────────────────────
export const TOPO_DETAIL = {
  enter: {
    form: withReason(`GET /.well-known/oauth-protected-resource/mcp HTTP/1.1
Host: <public door host>

GET /.well-known/oauth-authorization-server HTTP/1.1

POST /register HTTP/1.1
Content-Type: application/json

{ "client_name": "MCP Inspector", "redirect_uris": ["http://127.0.0.1:6274/oauth/callback"],
  "grant_types": ["authorization_code", "refresh_token"], "token_endpoint_auth_method": "none",
  "scope": "mcp:invoke read openid" }

(then /authorize, /token and /mcp: every call to the door enters the ingress first)`, 'Discovery and registration are open, so the client holds nothing to send yet. The bearer token appears on the /mcp calls from step 5.'),
    ...NO_TOKEN('Discovery and registration are open, so the client holds nothing to send yet.'),
    refs: refs([MCP_AUTH], [RFC(9728, 'Protected Resource Metadata'), RFC(8414, 'Authorization Server Metadata'), RFC(7591, 'Dynamic Client Registration: open on this door')], [CIMD, OAUTH21]),
  },
  wellKnown: {
    form: withReason(`Ingress rule 1 (path prefix): /.well-known/oauth-protected-resource  ->  mcp-server:8080
ping-gateway is skipped.

GET /.well-known/oauth-protected-resource/mcp HTTP/1.1
Host: <public door host>

-> 200 { "resource": "${HOST}/mcp",
         "authorization_servers": ["${HOST}"],
         "bearer_methods_supported": ["header"],
         "scopes_supported": ["accounts:read", "transactions:read", "transactions:write", "sensitive:read"],
         "resource_name": "Demo MCP Server" }`, 'The metadata document is public: it is how a client learns where to authenticate.'),
    ...NO_TOKEN('The metadata document is public: it is how a client learns where to authenticate.'),
    refs: refs([RFC(9728, 'Protected Resource Metadata: authorization_servers names oauth-mcp itself, not PingOne'), MCP_AUTH, HTTP]),
  },
  everythingElse: {
    form: `Ingress rule 2 (path prefix /): every other path  ->  ping-gateway:8080
  /register /authorize /authorize/callback /token /jwks /introspect /revoke
  /.well-known/oauth-authorization-server /mcp /audit

${MCP_CALL}`,
    tokens: [SELF_ISSUED],
    refs: refs([HTTP, MCP_AUTH, TRANSPORT], BEARER.slice(0, 1)),
  },
  asPassthrough: {
    form: `${TOKEN_CODE}

(ping-gateway route mcp-external-door only matches ^/mcp, so /register, /authorize, /token and /jwks reach mcp-server
 untouched: no introspection, no PingOne Authorize decision, no audit)`,
    tokens: [SELF_ISSUED, SELF_ISSUED_ID],
    refs: refs([AUTH[0], PKCE, RFC(7591, 'Dynamic Client Registration (/register passes through too)'), RFC(8414, 'Authorization Server Metadata'), JWK], [BCP, OAUTH21, CIMD]),
  },
  enforced: {
    form: `${MCP_CALL}
${DOOR_GATEWAY}

The gateway first introspects the bearer at the issuer that minted it:
POST http://mcp-server:8080/introspect HTTP/1.1
Content-Type: application/x-www-form-urlencoded

token=<access token>

-> 200 { "active": true, "scope": "openid mcp:invoke read", "client_id": "<registered client id>",
         "sub": "<PingOne user id>", "aud": "mcpserver.ping.demo", "iss": "${HOST}", "token_type": "Bearer" }

It requires scope mcp:invoke, forwards the Authorization header unchanged (mcp-server checks the same bearer again),
and trims the tools/list reply to the curated set of tools.
A missing or bad token gets a 401 with: WWW-Authenticate: Bearer resource_metadata="${HOST}/.well-known/oauth-protected-resource"`,
    tokens: [SELF_ISSUED, INTROSPECTION],
    refs: refs(INTROSPECT.slice(0, 1), [RFC(9728, 'The 401 challenge carries resource_metadata')], BEARER.slice(0, 1), [MCP_AUTH, TRANSPORT, JSONRPC]),
  },
  decision: {
    form: `POST https://api.pingone.com/v1/environments/<envId>/decisionEndpoints/<decision endpoint id> HTTP/1.1
Authorization: Bearer <Authorize worker access token>
Content-Type: application/json

{ "parameters": { "DecisionContext": "McpToolCall", "McpMethod": "tools/call", "ToolName": "get_my_accounts",
    "UserId": "<PingOne user id>", "TokenScopes": "openid mcp:invoke read",
    "TokenIss": "${HOST}", "TokenAudActual": "mcpserver.ping.demo" } }

-> { "decision": "PERMIT" }  or  { "decision": "DENY" }

One decision per MCP request (initialize, tools/list, tools/call), never once per session.
UserId is the token's sub: the real PingOne user for authorization_code, the client_id for client_credentials.`,
    tokens: [SELF_ISSUED],
    refs: refs([P1AZ, RFC(6749, 'Client credentials grant (section 4.4): the gateway fetches its Authorize worker token this way')]),
  },
  federate: {
    form: `Browser redirect from oauth-mcp /authorize:
Location: https://auth.pingone.com/<envId>/as/authorize
  ?client_id=<OAUTH_MCP_PINGONE_CLIENT_ID>&redirect_uri=${HOST}/authorize/callback&response_type=code
  &scope=openid profile email read&state=<relayState>&code_challenge=<oauth-mcp's own S256 challenge>
  &code_challenge_method=S256&resource=enduser.ping.demo&max_age=<re-auth window, default 1800>

Then, after the real login, oauth-mcp calls PingOne:
POST https://auth.pingone.com/<envId>/as/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=<PingOne code>&redirect_uri=${HOST}/authorize/callback
&client_id=<OAUTH_MCP_PINGONE_CLIENT_ID>&client_secret=<secret>&code_verifier=<oauth-mcp's own verifier>&resource=enduser.ping.demo

oauth-mcp verifies the returned ID token against PingOne's JWKS and issuer (the access token only when no ID token comes back); its sub is the real user.
scope read is there so PingOne audiences the access token to enduser.ping.demo; the access token itself is only stashed.`,
    tokens: [PINGONE_ID_TOKEN, PINGONE_TOKEN],
    refs: refs([AUTH[0], PKCE, OIDC, RESOURCE, BCP, JWT, JWK], [OAUTH21]),
  },
  bankingApi: {
    form: `GET <Banking API path for get_my_accounts> HTTP/1.1
Authorization: Bearer <PingOne access token>

TokenResolver chooses the bearer: the token is self-issued, so the Step 9 exchange is skipped; the jti is found in
the TokenStore, so the stashed PingOne access token is sent instead (source: agent-federated-passthrough).
The Banking API expects a PingOne token with aud enduser.ping.demo; a signature-valid token without that audience gets 401 invalid_token.`,
    tokens: [SELF_ISSUED, PINGONE_TOKEN],
    refs: refs(BEARER.slice(0, 1), [RESOURCE, JWT, EXCHANGE_SKIPPED]),
  },
};

// ─── Dual-path sequence ───────────────────────────────────────────────────────
export const SEQ_DETAIL = {
  authorize: {
    form: withReason(`${AUTHORIZE}

(oauth-mcp checks client_id and redirect_uri against the registered client and requires code_challenge)`, 'This request starts the flow that produces one. The PKCE challenge is not a token.'),
    ...NO_TOKEN('This request starts the flow that produces one. The PKCE challenge is not a token.'),
    refs: refs([AUTH[0], PKCE, RESOURCE, LOOPBACK, BCP], [OAUTH21, CIMD]),
  },
  redirectP1: {
    form: withReason(`HTTP/1.1 302 Found
Location: https://auth.pingone.com/<envId>/as/authorize
  ?client_id=<OAUTH_MCP_PINGONE_CLIENT_ID>
  &redirect_uri=${HOST}/authorize/callback
  &response_type=code&scope=openid profile email read
  &state=<relayState, not the client's state>
  &code_challenge=<oauth-mcp's own S256 challenge>&code_challenge_method=S256
  &resource=enduser.ping.demo   (only when BANKING_API_RESOURCE_URI is set; without it the scope is openid profile email)
  &max_age=<re-auth window, default 1800>   (prompt instead, depending on the BFF's mcp_broker_prompt setting)

The client's state is kept in a pending record keyed by relayState (10 minute life), never sent to PingOne.`, 'An authorization request carries only PKCE material and state.'),
    ...NO_TOKEN('An authorization request carries only PKCE material and state.'),
    refs: refs([AUTH[0], PKCE, OIDC, RESOURCE, BCP], [OAUTH21]),
  },
  callback: {
    form: withReason(`(the user signs in at PingOne: a real login, nothing simulated)

HTTP/1.1 302 Found
Location: ${HOST}/authorize/callback?code=<PingOne code>&state=<relayState>

oauth-mcp looks the relayState up once (the record is consumed).`, 'Only a one-time authorization code travels back; the access token is fetched in the next step.'),
    ...NO_TOKEN('Only a one-time authorization code travels back; the access token is fetched in the next step.'),
    refs: refs([AUTH[0], OIDC, BCP]),
  },
  pingoneToken: {
    form: `POST https://auth.pingone.com/<envId>/as/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<PingOne code>
&redirect_uri=${HOST}/authorize/callback
&client_id=<OAUTH_MCP_PINGONE_CLIENT_ID>
&client_secret=<secret>
&code_verifier=<oauth-mcp's own verifier>
&resource=enduser.ping.demo

-> 200 { "access_token": "<PingOne access token>", "id_token": "<PingOne ID token>", "token_type": "Bearer", "expires_in": 3600 }

oauth-mcp verifies the ID token (the access token only when no ID token comes back) against PingOne's JWKS and the issuer, then
reads sub and the identity claims from it: the real user. The access token is stashed for the Banking API call.`,
    tokens: [PINGONE_ID_TOKEN, PINGONE_TOKEN],
    refs: refs([AUTH[0], PKCE, RESOURCE, JWT, JWK, OIDC], [OAUTH21]),
  },
  mintJwt: {
    form: `oauth-mcp mints its own authorization code, bound to the client, the redirect_uri, the PKCE challenge and the real sub,
and stashes the PingOne access token against it. It redirects the browser to the client:

HTTP/1.1 302 Found
Location: http://127.0.0.1:6274/oauth/callback?code=<oauth-mcp's own code>&state=<client's own state>

${TOKEN_CODE}

The JWT is signed with oauth-mcp's own key (published at /jwks). The PingOne token is kept server-side, keyed by the JWT's jti, and never handed to the client.`,
    tokens: [SELF_ISSUED, SELF_ISSUED_ID],
    refs: refs([AUTH[0], PKCE, JWT, JWK, OIDC], [OAUTH21]),
  },
  mcpCall: {
    form: `${MCP_CALL}
${DOOR_GATEWAY}`,
    tokens: [SELF_ISSUED],
    refs: refs(MCP_REFS, [INTROSPECT[0], P1AZ]),
  },
  resolveFederated: {
    form: `TokenResolver.resolve(): iss is oauth-mcp's own issuer, so skip the Step 9 exchange.
The jti is found in the TokenStore, so the stashed PingOne access token replaces the self-issued JWT (source: agent-federated-passthrough).

GET <Banking API path for get_my_accounts> HTTP/1.1
Authorization: Bearer <PingOne access token>
(aud enduser.ping.demo)

-> 200 <account data>   (the Banking API gates on the audience)`,
    tokens: [SELF_ISSUED, PINGONE_TOKEN],
    refs: refs(BEARER.slice(0, 1), [RESOURCE, JWT, EXCHANGE_SKIPPED]),
  },
  resultFederated: {
    form: withReason(RESULT, 'The tool result is data; the bearer stays with the client and the PingOne token never leaves the server.'),
    ...NO_TOKEN('The tool result is data; the bearer stays with the client and the PingOne token never leaves the server.'),
    refs: refs([MCP_AUTH, TRANSPORT, JSONRPC]),
  },
  ccToken: {
    form: withReason(`POST /token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=<registered client id>
&client_secret=<client secret>
&scope=mcp:invoke read

(the client authenticates with the credentials it got at /register; client_secret_basic and client_secret_post are both accepted)`, 'The credentials from registration are the only input; there is no browser step and no PingOne login.'),
    ...NO_TOKEN('The credentials from registration are the only input; there is no browser step and no PingOne login.'),
    refs: refs([RFC(6749, 'Client credentials grant (section 4.4)'), RFC(7591, 'Dynamic Client Registration: where the credentials came from'), BCP], [OAUTH21]),
  },
  ccJwt: {
    form: `-> 200 { "access_token": "<self-signed JWT>", "token_type": "Bearer", "expires_in": 3600, "scope": "mcp:invoke read" }

oauth-mcp signs with its own key; sub is the client_id. Nothing is stashed against the jti, because no PingOne login happened.`,
    tokens: [SELF_ISSUED_CC],
    refs: refs([RFC(6749, 'Client credentials grant (section 4.4)'), JWT, JWK], [OAUTH21]),
  },
  ccMcpCall: {
    form: `${MCP_CALL}
${DOOR_GATEWAY}`,
    tokens: [SELF_ISSUED_CC],
    refs: refs(MCP_REFS, [INTROSPECT[0], P1AZ]),
  },
  resolvePassthrough: {
    form: `TokenResolver.resolve(): iss is oauth-mcp's own issuer, so skip the Step 9 exchange.
The jti is not in the TokenStore with a PingOne token, so the raw self-issued JWT is forwarded (source: agent-passthrough).

GET <Banking API path for get_my_accounts> HTTP/1.1
Authorization: Bearer <self-issued access token>
(iss ${HOST})

-> whatever the self-issued token is entitled to`,
    tokens: [SELF_ISSUED_CC],
    refs: refs(BEARER.slice(0, 1), [JWT, EXCHANGE_SKIPPED]),
  },
  resultPassthrough: {
    form: withReason(RESULT, 'The tool result is data; no token travels in the reply.'),
    ...NO_TOKEN('The tool result is data; no token travels in the reply.'),
    refs: refs([MCP_AUTH, TRANSPORT, JSONRPC]),
  },
};
