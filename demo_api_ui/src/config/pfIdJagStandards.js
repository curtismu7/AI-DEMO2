// /architecture/pingfederate-id-jag: for every arrow and every call, the request on the wire, the MOCK decoded
// tokens in play and the standards behind it. All values are teaching values: fake hosts (.invalid), placeholders in
// angle brackets, no real secrets and no JWT literals. Vocabulary: pingStyleStandards.js.
//
// Sources for the wire shapes:
//   BFF -> PingFederate ID-JAG exchange   demo_api_server/services/oauthService.js performIdJagExchange
//   BFF -> MCP AS jwt-bearer redemption   demo_api_server/services/oauthService.js redeemIdJag
//   ID-JAG checks and claim names         oauth-mcp/src/oauth/IdJagGrantHandler.ts (IdJagClaims, VerifyOpts)
//   run intent + PF login chain           demo_api_server/routes/oauthUser.js, UC40-PF-IDJAG-SESSION-HANDOFF.md section 3
// Where the repo does not pin a value (a path on a hop that was never traced) the form says so in a # comment.
import { RFC, DRAFT, SPEC, MCP, EXCHANGE } from './pingStyleStandards';

const json = (o) => JSON.stringify(o, null, 2);
// A hop with no token in play still says why (the shared reel only lists tokens that exist).
export const noToken = (reason) => `# No token in play: ${reason}`;

// ---- standards -------------------------------------------------------------------------------------------------
const HTTP = RFC(9110, 'HTTP semantics');
const COOKIE = RFC(6265, 'HTTP cookies: the BFF session the browser holds');
const OAUTH = RFC(6749, 'OAuth 2.0 Authorization Framework');
const PKCE = RFC(7636, 'PKCE: code_challenge / code_verifier');
const BCP = RFC(9700, 'OAuth 2.0 Security BCP');
const OIDC = SPEC('OIDC Core 1.0', 'OpenID Connect sign-in: ID token, nonce, prompt');
const TOKEN_EXCHANGE = RFC(8693, 'OAuth 2.0 Token Exchange: subject_token, requested_token_type, issued_token_type');
const RESOURCE = RFC(8707, 'Resource Indicators: the resource parameter and audience restriction');
const JWT_BEARER = RFC(7523, 'JWT bearer authorization grant (section 2.1)');
const ASSERTION = RFC(7521, 'Assertion framework for OAuth 2.0 grants');
const JWT = RFC(7519, 'JSON Web Token');
const JWS = RFC(7515, 'JSON Web Signature: the RS256 signature and the typ header');
const JWK = RFC(7517, 'JSON Web Key: the JWKS the signature is checked against');
const JWT_BCP = RFC(8725, 'JWT best current practices: explicit typing, pinned algorithm, audience check');
const BEARER_USE = RFC(6750, 'Bearer token usage');
const BFF_PATTERN = DRAFT('draft-ietf-oauth-browser-based-apps', 'OAuth 2.0 for browser-based apps: a backend keeps the tokens off the browser');
const IDJAG = EXCHANGE.find((r) => r.id === 'draft-ietf-oauth-identity-assertion-authz-grant');
const MCP_AUTH = MCP[0];
const MCP_TOOLS = SPEC('MCP tools', 'Tool name, description and JSON Schema inputSchema; tools/call over JSON-RPC 2.0');
const PINGGATEWAY = SPEC('PingGateway', 'Route filters that enforce the access token before the MCP server');
// Not AuthZEN: the gateway calls PingOne Authorize's own decision-endpoint shape, not the OpenID AuthZEN API.
const AUTHORIZE = SPEC('PingOne Authorize', 'Per-action policy decision (PERMIT or DENY) before the tool runs');
const CLIENT_CREDS = RFC(6749, 'client_credentials grant (section 4.4) for the worker token');

// ---- MOCK tokens -----------------------------------------------------------------------------------------------
const PF = 'https://pingfederate.example.invalid';
const MCP_AS = 'https://mcp-as.example.invalid';
const MCP_RS = 'https://mcp.example.invalid';
const T0 = 1790000000;
const RS256 = { alg: 'RS256', typ: 'JWT' };

const REFRESH_CLAIMS = { client_id: 'ai-demo-pf-user', sub: 'user-123', scope: 'openid profile offline_access', custody: 'BFF session only · never sent to the browser' };
// Opaque to the BFF: these are the values PingFederate holds for the handle, not a decodable JWT.
const REFRESH = { note: 'Refresh token · issued by PingFederate, opaque to the BFF, kept in its session', claims: REFRESH_CLAIMS };
const REFRESH_IN = { note: 'Refresh token · input (subject_token), opaque to the BFF; PingFederate looks it up', claims: REFRESH_CLAIMS };
// The PingFederate user access token. This demo's ATM signs Username (it can omit sub); the audience is ENDUSER_AUDIENCE.
const LOGIN_AT = {
  note: 'Access token · issued by PingFederate at sign-in (the user token later used as subject_token); signs Username, may omit sub',
  header: { alg: 'RS256', typ: 'JWT', kid: '<PingFederate signing key id>' },
  claims: { iss: PF, Username: 'user-123', aud: 'enduser.ping.demo', client_id: 'ai-demo-pf-user', scope: 'openid profile', iat: T0, exp: T0 + 3600 },
};
const ID_TOKEN = {
  note: 'ID token · issued by PingFederate at sign-in',
  header: RS256,
  claims: { iss: PF, sub: 'user-123', aud: 'ai-demo-pf-user', nonce: '<nonce from the sign-in request>', iat: T0, exp: T0 + 3600 },
};
// client_id is the client of the refresh token (ai-demo-pf-user), not the client that redeems the assertion.
// oauth-mcp maps it to the redeeming client with ENTERPRISE_IDP_ID_JAG_CLIENT_MAP (ai-demo-pf-user=demo-bff-mcp-client).
// The lifetime is PingFederate policy: 30 minutes in the lab run recorded for this demo.
const ID_JAG = {
  note: 'ID-JAG · signed assertion, short-lived (lifetime set by PingFederate policy)',
  header: { alg: 'RS256', typ: 'oauth-id-jag+jwt', kid: '<PingFederate signing key id>' },
  claims: { jti: '<single-use id>', iss: PF, sub: 'user-123', aud: MCP_AS, resource: MCP_RS, client_id: 'ai-demo-pf-user', scope: 'accounts:read', iat: T0, exp: T0 + 1800 },
};
// oauth-mcp TokenIssuer: its own key (kid), a jti, one hour, no act claim (the ID-JAG carries no delegation chain).
const MCP_AT = {
  note: 'MCP access token · issued by the MCP authorization server (client_id is the redeeming client)',
  header: { alg: 'RS256', kid: '<oauth-mcp signing key id>' },
  claims: { iss: MCP_AS, sub: 'user-123', aud: MCP_RS, client_id: 'demo-bff-mcp-client', scope: 'accounts:read', iat: T0 + 5, exp: T0 + 3605, jti: '<unique id>' },
};
const MCP_AT_USED = { ...MCP_AT, note: 'MCP access token · the same token, not re-issued' };

// ---- wire forms ------------------------------------------------------------------------------------------------
const ID_JAG_REQUEST = `POST /as/token.oauth2 HTTP/1.1
Host: pingfederate.example.invalid
Authorization: Basic <client credentials of ai-demo-pf-user>
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&requested_token_type=urn:ietf:params:oauth:token-type:id-jag
&subject_token=<refresh token>
&subject_token_type=urn:ietf:params:oauth:token-type:refresh_token
&audience=${MCP_AS}
&resource=${MCP_RS}
&scope=accounts:read
&client_id=ai-demo-pf-user`;
// The BFF checks access_token and issued_token_type (oauthService.performIdJagExchange); the draft names no other field it relies on.
const ID_JAG_RESPONSE = `HTTP/1.1 200 OK
Content-Type: application/json

${json({ access_token: '<ID-JAG>', issued_token_type: 'urn:ietf:params:oauth:token-type:id-jag' })}
# RFC 8693 also requires token_type here (N_A for a token that is not an access token); read it from your PingFederate.`;
const REDEEM_REQUEST = `POST /token HTTP/1.1
Host: mcp-as.example.invalid
# demo-bff-mcp-client is a public client by default: no Authorization header, client_id in the body.
# With ENTERPRISE_MCP_AS_CLIENT_SECRET set it becomes confidential: Authorization: Basic <client credentials>
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
&assertion=<ID-JAG>
&client_id=demo-bff-mcp-client
&resource=${MCP_RS}
&scope=accounts:read
# The ID-JAG's client_id is ai-demo-pf-user (the refresh token's client); oauth-mcp maps it to this client
# with ENTERPRISE_IDP_ID_JAG_CLIENT_MAP before the client_id check.`;
const REDEEM_RESPONSE = `HTTP/1.1 200 OK
Content-Type: application/json

${json({ access_token: '<MCP access token>', token_type: 'Bearer', expires_in: 3600, scope: 'accounts:read' })}`;
const MCP_CALL = `POST /mcp HTTP/1.1
Authorization: Bearer <MCP access token>
Content-Type: application/json

${json({ jsonrpc: '2.0', id: 'tool-1', method: 'tools/call', params: { name: 'get_my_accounts', arguments: {} } })}`;
const ACCOUNTS_CALL = 'GET /api/accounts/my HTTP/1.1\nAuthorization: Bearer <MCP access token>';
const AUTHORIZE_URL = `https://pingfederate.example.invalid/as/authorization.oauth2?response_type=code
  &client_id=ai-demo-pf-user
  &redirect_uri=<BFF callback URL>
  &scope=openid profile offline_access
  &state=<random state>&nonce=<random nonce>
  &code_challenge=<S256 hash>&code_challenge_method=S256`;
const AUTHORIZE_REQUEST = `GET ${AUTHORIZE_URL.replace('https://pingfederate.example.invalid', '')} HTTP/1.1
Host: pingfederate.example.invalid`;
const CODE_EXCHANGE = `POST /as/token.oauth2 HTTP/1.1
Host: pingfederate.example.invalid
Authorization: Basic <client credentials of ai-demo-pf-user>
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<authorization code>
&redirect_uri=<BFF callback URL>
&code_verifier=<PKCE secret>`;
const TOKENS_RESPONSE = `HTTP/1.1 200 OK
Content-Type: application/json

${json({ token_type: 'Bearer', access_token: '<access token>', id_token: '<ID token>', refresh_token: '<refresh token>', expires_in: 3600 })}`;
const AGENT_RUN = `POST /api/agent/run HTTP/1.1
Cookie: <session cookie>
Content-Type: application/json
Accept: text/event-stream

${json({ threadId: '<thread id>', runId: '<run id>', messages: [{ role: 'user', content: 'show my balance' }], useCaseId: 'enterprise-managed-mcp-authorization' })}`;
const REASON = `POST /api/agent/reason HTTP/1.1
x-internal-gateway-secret: <redacted>
Content-Type: application/json

${json({ messages: [{ role: 'user', content: 'show my balance' }], tools: [{ name: 'get_my_accounts', description: 'List the signed-in user\'s accounts', inputSchema: { type: 'object', properties: {} } }], provider: '<configured provider>', model: '<configured model>' })}`;
const PROPOSAL = `HTTP/1.1 200 OK
Content-Type: application/json

${json({ toolCall: { name: 'get_my_accounts', arguments: {} } })}`;
// The gateway hop (ping-gateway p1az-decision.groovy): DecisionContext McpToolCall for tools/call, plus the
// token-derived attributes the policy reads. (McpFirstTool is the BFF-side gate, a different call.)
const P1AZ_URL = `POST https://api.pingone.com/v1/environments/<environment id>/decisionEndpoints/<MCP decision endpoint id> HTTP/1.1
Authorization: Bearer <worker access token>
Content-Type: application/json`;
const P1AZ_BASE = { DecisionContext: 'McpToolCall', McpMethod: 'tools/call', ToolName: 'get_my_accounts', UserId: '<token sub>', McpResourceUri: '<gateway resource uri>', TokenAudActual: '<aud of the inbound token>' };
// ID-JAG path: the redeemed token has no act claim, so there is no actor chain.
const P1AZ_REQUEST_JAG = `${P1AZ_URL}

${json({ parameters: { ...P1AZ_BASE, ClientId: '<token sub>', ActClientId: '', ActChainDepth: '0', NestedActClientId: '' } })}
# More attributes follow (TokenScopes, TokenExp, TokenIss, Vertical, UseCaseId, tool annotations).`;
// PingFederate delegation path: the nested act chain is read at both levels.
const P1AZ_REQUEST_LOGIN = `${P1AZ_URL}

${json({ parameters: { ...P1AZ_BASE, ClientId: '<token sub>', ActClientId: '<MCP actor client id>', ActChainDepth: '2', NestedActClientId: '<agent client id>' } })}
# More attributes follow (TokenScopes, TokenExp, TokenIss, Vertical, UseCaseId, tool annotations).`;
const P1AZ_WORKER = {
  note: 'Worker token · client_credentials, used only to call the decision endpoint',
  header: RS256,
  claims: { iss: 'https://auth.pingone.com/<environment id>/as', aud: 'https://api.pingone.com', client_id: '<worker app id>', iat: T0, exp: T0 + 3600 },
};

// ---- ARROW DETAIL: ID-JAG token journey (index = EDGES index in pfIdJagDiagrams.js) ----------------------------
export const JAG_DETAIL = [
  { // 0 user -> bff
    form: `${AGENT_RUN}\n\n${noToken('the browser holds only a session cookie; the refresh token stays in the BFF session')}`,
    refs: [HTTP, COOKIE, BFF_PATTERN],
  },
  { // 1 bff -> pingfed
    form: ID_JAG_REQUEST,
    tokens: [REFRESH_IN],
    refs: [TOKEN_EXCHANGE, RESOURCE, OAUTH, IDJAG],
  },
  { // 2 pingfed -> jag (mint)
    form: '# Inside PingFederate (no HTTP call): the token-exchange processor policy (aiDemoPfIdJagPolicy) validates the\n# refresh token, then the assertion connection (aiDemoPfIdJagSp) maps attributes and signs the ID-JAG.',
    tokens: [REFRESH_IN, ID_JAG],
    refs: [TOKEN_EXCHANGE, IDJAG, JWT, JWS, JWT_BCP],
  },
  { // 3 jag -> bff (return)
    form: ID_JAG_RESPONSE,
    tokens: [ID_JAG],
    refs: [TOKEN_EXCHANGE, IDJAG, JWT, JWT_BCP],
  },
  { // 4 bff -> mcpas
    form: REDEEM_REQUEST,
    tokens: [ID_JAG],
    refs: [JWT_BEARER, ASSERTION, RESOURCE, IDJAG, JWK],
  },
  { // 5 mcpas -> bff
    form: REDEEM_RESPONSE,
    tokens: [MCP_AT],
    refs: [OAUTH, BEARER_USE],
  },
  { // 6 bff -> gateway
    form: MCP_CALL,
    tokens: [MCP_AT_USED],
    refs: [BEARER_USE, MCP_AUTH, MCP_TOOLS, PINGGATEWAY],
  },
  { // 7 gateway -> authorize
    form: P1AZ_REQUEST_JAG,
    tokens: [P1AZ_WORKER],
    refs: [AUTHORIZE, CLIENT_CREDS],
  },
  { // 8 gateway -> invest (MCP server)
    form: `${MCP_CALL}\n\n# PingGateway forwards the call after PingOne Authorize answers PERMIT.`,
    tokens: [MCP_AT_USED],
    refs: [BEARER_USE, MCP_AUTH, MCP_TOOLS, PINGGATEWAY],
  },
  { // 9 invest -> banking
    form: ACCOUNTS_CALL,
    tokens: [MCP_AT_USED],
    refs: [BEARER_USE, JWT, JWK],
  },
];

// ---- ARROW DETAIL: PingFederate login + agent authorization ----------------------------------------------------
// The two-exchange delegation (pfStandardTokenExchangeService): the result audience is derived by PingFederate policy
// (aiDemoStandardTePolicy), so no audience is sent; each hop runs as its own exchange client and asks for an access token.
// The live user subject is the PF session ACCESS token (aud enduser.ping.demo), see LOGIN_AT.
const ACT_USER = { note: 'User access token · subject_token of exchange 1 (the sign-in access token)', header: LOGIN_AT.header, claims: LOGIN_AT.claims };
const ACT_AGENT = { note: 'Agent actor token · actor_token of exchange 1', header: RS256, claims: { iss: PF, sub: '<agent client id>', client_id: '<agent client id>', scope: 'agent:invoke', iat: T0, exp: T0 + 3600 } };
const ACT_MID = { note: 'Agent-exchanged token · subject_token of exchange 2 (result of exchange 1)', header: RS256, claims: { iss: PF, sub: 'user-123', aud: 'https://agentgateway.ping.demo', act: { sub: '<agent client id>' }, iat: T0 + 2, exp: T0 + 3602 } };
const ACT_MCP = { note: 'MCP actor token · actor_token of exchange 2', header: RS256, claims: { iss: PF, sub: '<MCP actor client id>', client_id: '<MCP actor client id>', scope: 'mcp:invoke', iat: T0, exp: T0 + 3600 } };
// Nested act: act.sub is the MCP service, act.act.sub is the AI agent (validateFinalToken refuses a flat act).
const SCOPED = { note: 'Scoped MCP access token · result of exchange 2 (nested act chain)', header: RS256, claims: { iss: PF, sub: 'user-123', aud: 'https://api.ping.demo:3036/mcp', scope: 'accounts:read', act: { sub: '<MCP actor client id>', act: { sub: '<agent client id>' } }, iat: T0 + 4, exp: T0 + 3604 } };
const SCOPED_USED = { ...SCOPED, note: 'Scoped MCP access token · presented, not re-issued' };
const EXCHANGE_1 = `POST /as/token.oauth2 HTTP/1.1
Authorization: Basic <agent exchange client credentials>
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&requested_token_type=urn:ietf:params:oauth:token-type:access_token
&subject_token=<user access token>&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&actor_token=<agent actor token>&actor_token_type=urn:ietf:params:oauth:token-type:access_token
&scope=<requested scopes>
&client_id=<agent exchange client id>
# no audience: PingFederate's token-exchange policy derives the result audience`;
const EXCHANGE_2 = `POST /as/token.oauth2 HTTP/1.1
Authorization: Basic <MCP exchange client credentials>
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&requested_token_type=urn:ietf:params:oauth:token-type:access_token
&subject_token=<agent-exchanged token>&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&actor_token=<MCP actor token>&actor_token_type=urn:ietf:params:oauth:token-type:access_token
&scope=accounts:read
&client_id=<MCP exchange client id>
# no audience: the policy derives it (the MCP gateway resource)`;

// Index = EDGES index in pfIdJagDiagrams.js (LOGIN_EDGES).
export const LOGIN_DETAIL = [
  { // 0 user -> bff
    form: `GET /api/auth/oauth/user/login HTTP/1.1\nHost: <BFF host>\n\n${noToken('nothing has been issued yet; the BFF only starts the sign-in')}`,
    refs: [HTTP, OIDC, BFF_PATTERN],
  },
  { // 1 bff -> pingfed
    form: `HTTP/1.1 302 Found\nLocation: ${AUTHORIZE_URL}\n\n${noToken('this is the authorization request; it carries a PKCE challenge, not a token')}`,
    refs: [OAUTH, PKCE, OIDC, BCP, DRAFT('OAuth 2.1', 'draft-ietf-oauth-v2-1 makes PKCE the default for the code flow')],
  },
  { // 2 pingfed -> user
    form: `HTTP/1.1 200 OK (PingFederate sign-in page)\nContent-Type: text/html\n\n${noToken('the page is an HTML form; the user is not authenticated yet')}`,
    refs: [OIDC, BCP, SPEC('PingFederate authentication policy', 'Decides which sign-in page and factors the user sees')],
  },
  { // 3 user -> pingfed
    form: `POST <PingFederate sign-in form> HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\npf.username=<user>&pf.pass=<password>\n\n${noToken('credentials go to PingFederate only; the BFF never sees them')}`,
    refs: [OIDC, BCP, HTTP],
  },
  { // 4 pingfed -> bff
    form: `HTTP/1.1 302 Found\nLocation: <BFF callback URL>?code=<authorization code>&state=<state>\n\n${noToken('an authorization code is a one-time handle, not a token the BFF can use')}`,
    refs: [OAUTH, BCP, OIDC],
  },
  { // 5 bff -> pingfed
    form: `${CODE_EXCHANGE}\n\n${noToken('the request carries the code and the PKCE verifier; the tokens come back on the next arrow')}`,
    refs: [OAUTH, PKCE, OIDC, BCP],
  },
  { // 6 pingfed -> bff
    form: TOKENS_RESPONSE,
    tokens: [LOGIN_AT, ID_TOKEN, REFRESH],
    refs: [OAUTH, OIDC, JWT, JWT_BCP, BEARER_USE],
  },
  { // 7 bff -> user
    form: `HTTP/1.1 302 Found\nSet-Cookie: <session cookie>; HttpOnly; Secure\nLocation: <signed-in page>\n\n${noToken('the browser gets a session cookie; the tokens stay in the BFF session')}`,
    refs: [COOKIE, BFF_PATTERN, BCP],
  },
  { // 8 user -> bff
    form: `POST /api/agent/invoke HTTP/1.1\nCookie: <session cookie>\nContent-Type: application/json\n\n${json({ prompt: 'Show my account balance', threadId: '<thread id>' })}\n\n${noToken('the browser sends its cookie, never a token')}`,
    refs: [HTTP, COOKIE, BFF_PATTERN],
  },
  { // 9 bff -> agent
    form: `${REASON}\n\n${noToken('the reasoning-only agent service is given no user token')}`,
    refs: [HTTP, MCP_TOOLS],
  },
  { // 10 agent -> bff
    form: `${PROPOSAL}\n\n${noToken('the agent only proposes; the BFF validates and executes the tool call')}`,
    refs: [HTTP, MCP_TOOLS],
  },
  { // 11 bff -> pingfed (two exchanges)
    form: `# Exchange 1: user subject + agent actor\n${EXCHANGE_1}\n\n# Exchange 2: agent-exchanged subject + MCP actor\n${EXCHANGE_2}`,
    tokens: [ACT_USER, ACT_AGENT, ACT_MID, ACT_MCP],
    refs: [TOKEN_EXCHANGE, OAUTH],
  },
  { // 12 pingfed -> bff
    form: `HTTP/1.1 200 OK\nContent-Type: application/json\n\n${json({ access_token: '<scoped MCP access token>', issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: '<seconds>', scope: 'accounts:read' })}`,
    tokens: [SCOPED],
    refs: [TOKEN_EXCHANGE, BEARER_USE, JWT],
  },
  { // 13 bff -> gateway
    form: MCP_CALL,
    tokens: [SCOPED_USED],
    refs: [BEARER_USE, MCP_AUTH, MCP_TOOLS, PINGGATEWAY],
  },
  { // 14 gateway -> authorize
    form: P1AZ_REQUEST_LOGIN,
    tokens: [P1AZ_WORKER],
    refs: [AUTHORIZE, CLIENT_CREDS],
  },
  { // 15 gateway -> mcp
    form: `${MCP_CALL}\n\n# Forwarded only after PingOne Authorize answers PERMIT.`,
    tokens: [SCOPED_USED],
    refs: [BEARER_USE, MCP_AUTH, MCP_TOOLS, PINGGATEWAY],
  },
  { // 16 mcp -> gateway
    form: `HTTP/1.1 200 OK\nContent-Type: application/json\n\n${json({ jsonrpc: '2.0', id: 'tool-1', result: { content: [{ type: 'text', text: '<account list>' }] } })}\n\n${noToken('a tool result carries data, not credentials')}`,
    refs: [MCP_TOOLS, HTTP],
  },
  { // 17 gateway -> bff
    form: `HTTP/1.1 200 OK (same JSON-RPC result, passed back)\n\n${noToken('the result goes back through PingGateway unchanged')}`,
    refs: [MCP_TOOLS, HTTP],
  },
  { // 18 bff -> user
    form: `event: message (text/event-stream)\n${json({ type: 'tool_result', summary: '<account list>' })}\n\n${noToken('the browser receives the answer only; every token stayed server-side')}`,
    refs: [HTTP, BFF_PATTERN, COOKIE],
  },
];

// ---- CALL DETAIL: the 19 calls in utils/idJagCallSequence.js (index = call.n - 1) -------------------------------
export const CALL_DETAIL = [
  { // 1 Start the live run
    form: `POST /api/auth/oauth/user/id-jag/intent HTTP/1.1\nOrigin: <frontend origin>\nContent-Type: application/json\n\n${json({ useCaseId: 'enterprise-managed-mcp-authorization', mode: 'live-id-jag', message: 'show my balance', returnTo: '<demo page>' })}\n# 201 Created, plus an HttpOnly run-intent cookie\n\nGET /api/auth/oauth/user/logout?id_jag_handoff=<flag> HTTP/1.1\n\n${noToken('the intent is a pending-run record keyed by a cookie nonce; no OAuth token exists yet')}`,
    refs: [HTTP, COOKIE, BFF_PATTERN],
  },
  { // 2 Sign in
    form: `${AUTHORIZE_REQUEST}\n&prompt=login\n\n${noToken('the browser is sent to PingFederate to authenticate; a PKCE challenge, not a token, travels')}`,
    refs: [OAUTH, PKCE, OIDC, BCP],
  },
  { // 3 Authorization code
    form: `HTTP/1.1 302 Found\nLocation: <BFF callback URL>?code=<authorization code>&state=<state>\n\n${noToken('an authorization code is a one-time handle, not a token')}`,
    refs: [OAUTH, BCP, OIDC],
  },
  { // 4 Swap code for tokens
    form: `${CODE_EXCHANGE}\n\n${TOKENS_RESPONSE}`,
    tokens: [LOGIN_AT, ID_TOKEN, REFRESH],
    refs: [OAUTH, PKCE, OIDC, JWT, BEARER_USE],
  },
  { // 5 Run: show my balance
    form: `${AGENT_RUN}\n\n${noToken('the browser sends its session cookie; the BFF holds every token')}`,
    refs: [HTTP, COOKIE, BFF_PATTERN],
  },
  { // 6 Propose a tool
    form: `${REASON}\n\n${noToken('the reasoning-only agent service is given no token')}`,
    refs: [HTTP, MCP_TOOLS],
  },
  { // 7 Gate the run
    form: `# Inside the BFF (no HTTP call): assertPfIdJagRunAllowed checks the session is PingFederate, a live run intent exists\n# and the ID-JAG feature is on; the group policy then checks the user may reach this MCP server.\n\n${noToken('the gate reads the server-side session, not a token')}`,
    refs: [BFF_PATTERN, COOKIE],
  },
  { // 8 Ask for an ID-JAG
    form: `${ID_JAG_REQUEST}\n\n${ID_JAG_RESPONSE}`,
    tokens: [REFRESH_IN, ID_JAG],
    refs: [TOKEN_EXCHANGE, RESOURCE, OAUTH, IDJAG],
  },
  { // 9 Check the ID-JAG
    form: '# Inside the BFF (no HTTP call): decode the assertion, then refuse unless\n#   header.typ === "oauth-id-jag+jwt", sub and iss are present, iss matches the configured PingFederate issuer,\n#   aud contains the requested audience, and exp is in the future.',
    tokens: [ID_JAG],
    refs: [JWT, JWT_BCP, IDJAG],
  },
  { // 10 Redeem the ID-JAG
    form: REDEEM_REQUEST,
    tokens: [ID_JAG],
    refs: [JWT_BEARER, ASSERTION, RESOURCE, IDJAG],
  },
  { // 11 Fetch PingFederate keys
    form: `GET /pf/JWKS HTTP/1.1\nAccept: application/json\n\n${json({ keys: [{ kty: 'RSA', use: 'sig', alg: 'RS256', kid: '<key id>', x5t: '<thumbprint>', n: '<modulus>', e: 'AQAB' }] })}\n\n${noToken('a JWKS is public keys, not a credential')}`,
    refs: [JWK, JWS, JWT_BCP],
  },
  { // 12 Verify, then mint
    form: `# Inside oauth-mcp: jwtVerify(assertion, { algorithms: ["RS256"], issuer: <PingFederate issuer>, audience: <oauth-mcp issuer> })\n# then typ = oauth-id-jag+jwt, exp, resource in the accepted list, client_id = the redeeming client (after the ENTERPRISE_IDP_ID_JAG_CLIENT_MAP alias), jti not seen before.\n\n${REDEEM_RESPONSE}`,
    tokens: [ID_JAG, MCP_AT],
    refs: [JWT_BEARER, JWT_BCP, JWT, RESOURCE, OAUTH, IDJAG],
  },
  { // 13 Call the tool
    form: MCP_CALL,
    tokens: [MCP_AT_USED],
    refs: [BEARER_USE, MCP_AUTH, MCP_TOOLS, PINGGATEWAY],
  },
  { // 14 Check and route
    form: '# Inside the MCP gateway (not traced): tokenValidator checks the signature against oauth-mcp\'s keys,\n# GatewayTokenPolicy applies policy, and the token is forwarded unchanged when its audience already matches the backend.\n# Otherwise an exchange is attempted and the call stops if it fails. A PingOne Authorize decision happens around here.',
    tokens: [MCP_AT_USED],
    refs: [BEARER_USE, JWT, JWK, TOKEN_EXCHANGE, PINGGATEWAY, AUTHORIZE],
  },
  { // 15 Forward the token
    form: `# To the OLB backend (transport not confirmed: WebSocket or HTTP). The same bearer is passed along.\nAuthorization: Bearer <MCP access token>`,
    tokens: [MCP_AT_USED],
    refs: [BEARER_USE, MCP_AUTH, MCP_TOOLS],
  },
  { // 16 Resolve the token
    form: '# Inside the MCP server: TokenResolver sees a token issued by its own authorization server with no stashed PingOne token,\n# so it skips the extra exchange and passes the token through.',
    tokens: [MCP_AT_USED],
    refs: [BEARER_USE, TOKEN_EXCHANGE, MCP_AUTH],
  },
  { // 17 Read the accounts
    form: ACCOUNTS_CALL,
    tokens: [MCP_AT_USED],
    refs: [BEARER_USE, JWT],
  },
  { // 18 Verify the token
    form: '# Inside the banking API (auth middleware): recognise the oauth-mcp issuer, verify the signature against its JWKS\n# with an exact issuer check, then apply audience, scope and role checks.',
    tokens: [MCP_AT_USED],
    refs: [JWT, JWK, JWT_BCP, BEARER_USE],
  },
  { // 19 Answer flows back
    form: `HTTP/1.1 200 OK\nContent-Type: application/json\n\n${json({ accounts: [{ id: '<account id>', name: '<account name>', balance: '<balance>' }] })}\n\n${noToken('the answer travels back through the MCP server, gateway and BFF; nobody calls PingFederate again')}`,
    refs: [HTTP, MCP_TOOLS, BFF_PATTERN],
  },
];
