// /architecture/token-flow: for each arrow of each scenario, the request on the wire, the MOCK decoded tokens in play and the
// standards behind the hop. Values are teaching values (placeholders such as <access token>, no real secrets or JWT literals).
// Vocabulary: pingStyleStandards.js. Wire shapes follow demo_api_server: services/oauthService.js (performTokenExchangeWithActor),
// services/mcpGatewayClient.js (Bearer + X-Act-Client-Id, 401/403 reasons in WWW-Authenticate), routes/authorize.js and
// services/mcpToolAuthorizationService.js (decision parameters), and docs/TOKEN_FLOW.md (audiences, scopes, may_act).
// TOKEN_FLOW_DETAIL[scenario][i] is the detail of arrow i of that scenario (same order as TOKEN_FLOW_ENDPOINTS in tokenFlowDiagram.js).
import { RFC, SPEC, DRAFT, AUTH, BEARER, CREDS, EXCHANGE, MCP, INTROSPECT, AUTHZ, STEPUP } from './pingStyleStandards';

const json = (o) => JSON.stringify(o, null, 2);
const ISS = 'https://auth.pingone.com/ENV_ID/as';
const NOW = { iat: 1790000000, exp: 1790003600 };
const TOKEN_ENDPOINT = 'POST https://auth.pingone.com/ENV_ID/as/token';
const DECISION_ENDPOINT = 'POST https://api.pingone.com/v1/environments/ENV_ID/decisionEndpoints/MCP_DECISION_ENDPOINT_ID';

const HTTP = RFC(9110, 'HTTP semantics');
const COOKIE = RFC(6265, 'HTTP state management: the session cookie that fronts the BFF-held tokens');
const BFF_DRAFT = DRAFT('draft-ietf-oauth-browser-based-apps', 'OAuth 2.0 for Browser-Based Apps: the BFF keeps the tokens');
const JSONRPC = SPEC('JSON-RPC 2.0', 'Message format MCP uses for tools/list and tools/call');
const P1_TOKEN = SPEC('PingOne token endpoint', 'POST /as/token on the PingOne authorization server');
const P1_AZ = SPEC('PingOne Authorize decision endpoints', 'POST decisionEndpoints/{id} with Trust Framework parameters');
const AGENT_GATEWAY = SPEC('PingOne Agent Gateway', 'MCP gateway: audience, actor chain and per-tool authorization before the server');
const CHAT = SPEC('OpenAI Chat Completions API', 'The wire format the LLM lane speaks');
const WWW_AUTH = RFC(6750, 'Section 3: WWW-Authenticate error codes (invalid_token, insufficient_scope)');
const R428 = RFC(6585, 'Additional HTTP status codes: 428 Precondition Required');
const AZEN = { ...AUTHZ[0], title: 'Standard PEP to PDP API; the call here is PingOne Authorize\'s own Trust Framework shape' };
const uniq = (...refs) => refs.filter((r, i) => refs.findIndex((o) => o.id === r.id) === i);

// ---- MOCK tokens (teaching values) ----
const AUD_USER = 'enduser.ping.demo';
const AUD_AGENT = 'agentgateway.ping.demo';
const AUD_GW = 'mcpgateway.ping.demo';
const USER_SCOPE = 'openid profile email offline_access banking:read banking:write banking:ai:agent';

const USER_AT = { iss: ISS, sub: 'USER_ID', aud: [AUD_USER], client_id: 'BFF_CLIENT_ID', scope: USER_SCOPE, may_act: { sub: 'AI_AGENT_CLIENT_ID' }, ...NOW };
const USER_AT_TOK = { note: 'User access token · aud enduser.ping.demo, held by the BFF, carries may_act for the agent', header: { alg: 'RS256', typ: 'JWT' }, claims: USER_AT };
const ID_TOK = { note: 'ID token · signed JWT proving who signed in; for the app, never sent on to APIs or MCP', header: { alg: 'RS256', typ: 'JWT' }, claims: { iss: ISS, sub: 'USER_ID', aud: 'BFF_CLIENT_ID', email: 'alice@example.com', given_name: 'Alice', nonce: '<random nonce>', ...NOW } };
const ACTOR_TOK = { note: 'Agent actor token · client credentials of the agent client', header: { alg: 'RS256', typ: 'JWT' }, claims: { iss: ISS, sub: 'AI_AGENT_CLIENT_ID', client_id: 'AI_AGENT_CLIENT_ID', aud: [AUD_AGENT], ...NOW } };
const delegated = (scope, extra = {}) => ({ iss: ISS, sub: 'USER_ID', aud: [AUD_GW], client_id: 'BFF_CLIENT_ID', scope, act: { sub: 'AI_AGENT_CLIENT_ID' }, ...NOW, ...extra });
const DELEG = (note, scope = 'banking:read') => ({ note, header: { alg: 'RS256', typ: 'JWT' }, claims: delegated(scope) });
const GW_TOK = DELEG('Delegated token · aud mcpgateway.ping.demo, sub is the user, act names the agent');

// ---- request forms ----
const AUTHORIZE_REQ = `GET https://auth.pingone.com/ENV_ID/as/authorize\n  ?response_type=code&client_id=BFF_CLIENT_ID\n  &redirect_uri=https://<app host>/api/auth/callback\n  &scope=${USER_SCOPE}\n  &state=<random state>&nonce=<random nonce>\n  &code_challenge=<S256 hash>&code_challenge_method=S256`;
const CODE_REQ = `${TOKEN_ENDPOINT}\n  Authorization: Basic <BFF client id:secret>\n  Content-Type: application/x-www-form-urlencoded\n\n  grant_type=authorization_code&code=<one-time code>\n  &redirect_uri=https://<app host>/api/auth/callback&code_verifier=<PKCE secret>`;
const EXCHANGE_REQ = (scope, aud = AUD_GW) => `${TOKEN_ENDPOINT}\n  Content-Type: application/x-www-form-urlencoded\n\n  grant_type=urn:ietf:params:oauth:grant-type:token-exchange\n  &subject_token=<user access token>\n  &subject_token_type=urn:ietf:params:oauth:token-type:access_token\n  &actor_token=<agent client-credentials token>\n  &actor_token_type=urn:ietf:params:oauth:token-type:access_token\n  &requested_token_type=urn:ietf:params:oauth:token-type:access_token\n  &audience=${aud}&scope=${scope}&client_id=BFF_CLIENT_ID`;
const TOOLS_CALL = (tool, args, auth = '<delegated access token>') => `POST /mcp\n  Authorization: Bearer ${auth}\n  X-Act-Client-Id: AI_AGENT_CLIENT_ID\n  Content-Type: application/json\n\n${json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } })}`;
const DECISION = (ctx, method, tool, scopes) => `${DECISION_ENDPOINT}\n  Authorization: Bearer <Authorize worker token>\n  Content-Type: application/json\n\n${json({ parameters: { DecisionContext: ctx, McpMethod: method, UserId: 'USER_ID', ...(tool ? { ToolName: tool } : {}), ActClientId: 'AI_AGENT_CLIENT_ID', TokenScopes: scopes, TokenAudience: AUD_GW } })}`;
const ANSWER = (decision, codes) => `HTTP/1.1 200 OK\n\n${json({ decision, statements: codes.map((code) => ({ code })) })}`;
const NO_TOKEN = (why) => `\n\nNo token on this hop: ${why}`;
const TOOL_RESULT = (tool) => `HTTP/1.1 200 OK\nContent-Type: application/json\n\n${json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '<result of ' + tool + '>' }] } })}`;
const RS_GET = (path, aud = AUD_GW) => `GET ${path}\n  Authorization: Bearer <delegated access token>   (aud ${aud})\n\n  <- 200 OK  (JSON body: the data the tool asked for)`;


// ---- shared hops, reused across scenarios ----
const H = {
  userSends: {
    form: `POST /api/agent/run\n  Cookie: session=<BFF session id>\n  Content-Type: application/json\n\n${json({ message: 'show me my accounts' })}${NO_TOKEN('the browser sends only the session cookie; the user\'s typed message is the payload, and the BFF looks up the tokens it holds')}`,
    tokens: [],
    refs: [HTTP, COOKIE, BFF_DRAFT],
  },
  chatToAgent: {
    form: `POST /api/agent/run\n  Cookie: session=<BFF session id>\n\n(the SPA's chat message reaches the BFF; the BFF loads req.session.oauthTokens)${NO_TOKEN('the cookie is not an OAuth token; the BFF resolves the stored access token itself')}`,
    tokens: [],
    refs: [HTTP, COOKIE, BFF_DRAFT],
  },
  authorize: { form: AUTHORIZE_REQ, tokens: [], refs: [...AUTH.slice(0, 4), AUTH[6]] },
  authorizeNote: AUTHORIZE_REQ + NO_TOKEN('this is the front-channel request; the PKCE challenge is the only secret-derived value, and no token exists yet'),
  tokensIssued: {
    form: `${CODE_REQ}\n\n  <- 200 OK\n${json({ access_token: '<access token>', id_token: '<ID token>', refresh_token: '<refresh token>', token_type: 'Bearer', expires_in: 3600, scope: USER_SCOPE })}`,
    tokens: [USER_AT_TOK, ID_TOK],
    refs: [...AUTH.slice(0, 4), AUTH[6], BEARER[2]],
  },
  llm: {
    form: `POST /llm/<provider>/v1/chat/completions\n  Content-Type: application/json\n\n${json({ model: '<model>', messages: [{ role: 'user', content: 'show me my accounts' }], tools: ['get_my_accounts', '...'] })}\n\n  <- tool_calls: get_my_accounts${NO_TOKEN('the model sees the prompt and tool list, never the user\'s access token; the BFF keeps the token and calls the tool itself')}`,
    tokens: [],
    refs: [CHAT, HTTP, MCP[0]],
  },
  exchange: (scope) => ({
    form: `${EXCHANGE_REQ(scope)}\n\n  <- 200 OK\n${json({ access_token: '<delegated access token>', issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: 3600 })}`,
    tokens: [USER_AT_TOK, ACTOR_TOK, DELEG('Issued delegated token · aud narrowed to the gateway, act chain added', scope)],
    refs: [...EXCHANGE.slice(0, 2), P1_TOKEN, CREDS[0], BEARER[2]],
  }),
  arriveGateway: (tool, args, scope) => ({
    form: TOOLS_CALL(tool, args),
    tokens: [DELEG('Delegated token · what the Agent Gateway validates (aud, sub, act.sub, scope)', scope)],
    refs: uniq(AGENT_GATEWAY, MCP[0], MCP[3], BEARER[0], JSONRPC, INTROSPECT[0], EXCHANGE[0]),
  }),
  ask: (ctx, method, tool, scopes) => ({
    form: DECISION(ctx, method, tool, scopes),
    tokens: [DELEG('Delegated token · its claims become the decision parameters (UserId, ActClientId, TokenAudience, TokenScopes)', scopes)],
    refs: [P1_AZ, AZEN, AUTHZ[3], AUTHZ[2], CREDS[0]],
  }),
  permit: (ctx, tool, codes = ['mcp-tool-authorized']) => ({
    form: `${ANSWER('PERMIT', codes)}${NO_TOKEN(`${ctx} for ${tool || 'tools/list'} is a decision answer, not a token; the gateway acts on it`)}`,
    tokens: [],
    refs: [P1_AZ, AZEN, AUTHZ[1]],
  }),
  forward: {
    form: TOOLS_CALL('get_my_accounts', {}, '<delegated access token, forwarded unchanged>') + '\n\n  (same bearer; no second RFC 8693 exchange after PERMIT)',
    tokens: [DELEG('Delegated token · forwarded to the MCP server byte for byte')],
    refs: uniq(AGENT_GATEWAY, MCP[0], MCP[3], BEARER[0], JSONRPC),
  },
  toApi: (path, scope = 'banking:read') => ({
    form: `${RS_GET(path)}`,
    tokens: [DELEG('Delegated token · the resource server checks signature, exp, aud, scope and act', scope)],
    refs: uniq(BEARER[0], BEARER[2], INTROSPECT[2], INTROSPECT[3], RFC(8707, 'Resource Indicators: the audience the API accepts')),
  }),
  result: {
    form: `${TOOL_RESULT('get_my_accounts')}\n\n(the BFF turns the tool result into the chat answer the SPA shows)${NO_TOKEN('the response carries data only; the tokens stay in the BFF session')}`,
    tokens: [],
    refs: [HTTP, JSONRPC, COOKIE],
  },
};

const DENY_403 = `HTTP/1.1 403 Forbidden\nWWW-Authenticate: Bearer error="insufficient_scope", scope="banking:write"\nX-Gw-Audit-Trail: <json audit trail>\n\n${json({ error: 'access_denied', decision: 'DENY', tool: 'create_transfer', mcp_method: 'tools/call' })}\n\n(the BFF must not retry with the same token)`;
const HOLD_428 = `HTTP/1.1 428 Precondition Required\nX-Gw-Audit-Trail: <json audit trail>\n\n${json({ error: 'hitl_required', challengeId: '<id>', expiresAt: '<timestamp>', instructions: 'Approve at the dashboard, then retry with _hitl_challenge_id in arguments' })}`;
const READ_TOK = DELEG('Delegated token · scope banking:read only, so a write tool cannot pass', 'banking:read');

export const TOKEN_FLOW_DETAIL = {
  'full-flow': [
    H.userSends,
    H.chatToAgent,
    { form: H.authorizeNote, tokens: [], refs: H.authorize.refs },
    H.tokensIssued,
    { ...H.chatToAgent, form: `(the sign-in is done; the BFF holds the access token in its session)\n\nPOST /api/agent/invoke\n  Cookie: session=<BFF session id>\n  Content-Type: application/json\n\n${json({ message: 'show me my accounts' })}`, tokens: [USER_AT_TOK] },
    H.llm,
    H.exchange('banking:read'),
    { form: `HTTP/1.1 200 OK (PingOne to the BFF)\nContent-Type: application/json\n\n${json({ access_token: '<delegated access token>', issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: 3600 })}`, tokens: [GW_TOK], refs: uniq(...EXCHANGE.slice(0, 2), BEARER[0], BEARER[2]) },
    H.arriveGateway('get_my_accounts', {}, 'banking:read'),
    H.ask('McpToolCall', 'tools/call', 'get_my_accounts', 'banking:read'),
    H.permit('McpToolCall', 'get_my_accounts'),
    H.forward,
    H.toApi('/api/accounts/my'),
    H.toApi('/api/investment/accounts'),
    H.result,
  ],
  'id-token': [
    { form: AUTHORIZE_REQ + NO_TOKEN('this is the front-channel authorization request; no token exists yet'), tokens: [], refs: H.authorize.refs },
    { form: CODE_REQ + NO_TOKEN('the request carries the one-time code and the PKCE verifier; PingOne checks the verifier against the S256 challenge'), tokens: [], refs: [...AUTH.slice(0, 4), AUTH[6], P1_TOKEN] },
    { form: `<- 200 OK (the id_token member of the token response)\n${json({ id_token: '<ID token>', token_type: 'Bearer' })}`, tokens: [ID_TOK], refs: [AUTH[3], RFC(7519, 'JSON Web Token'), INTROSPECT[3]] },
    { form: `<- 200 OK (the access_token member of the token response)\n${json({ access_token: '<access token>', token_type: 'Bearer', expires_in: 3600, scope: USER_SCOPE })}`, tokens: [USER_AT_TOK], refs: [RFC(6749, 'Access token response (section 5.1)'), BEARER[2], EXCHANGE[0]] },
    { form: `HTTP/1.1 302 Found (BFF to the browser)\nLocation: /dashboard\nSet-Cookie: session=<BFF session id>; HttpOnly; Secure; SameSite=Lax${NO_TOKEN('the browser receives only the session cookie; both tokens stay in the BFF session')}`, tokens: [], refs: [COOKIE, BFF_DRAFT, HTTP] },
  ],
  'user-token': [
    { ...H.chatToAgent, form: `(the BFF reads req.session.oauthTokens.accessToken)${NO_TOKEN('nothing leaves the BFF on this hop; the user token waits in the session to be the subject_token')}`, tokens: [USER_AT_TOK] },
    H.exchange('banking:read'),
    H.arriveGateway('get_my_accounts', {}, 'banking:read'),
    H.forward,
    H.toApi('/api/accounts/my'),
  ],
  'get-accounts': [
    H.llm,
    H.ask('McpToolsList', 'tools/list', null, 'banking:read'),
    H.permit('McpToolsList', null, ['mcp-tool-authorized']),
    H.ask('McpToolCall', 'tools/call', 'get_my_accounts', 'banking:read'),
    H.permit('McpToolCall', 'get_my_accounts'),
    H.toApi('/api/accounts/my'),
  ],
  withdrawal: [
    { ...H.llm, form: H.llm.form.replace('show me my accounts', 'transfer $5,000 to savings').replace('get_my_accounts', 'create_transfer') },
    H.ask('McpToolCall', 'tools/call', 'create_transfer', 'banking:write'),
    { form: `${HOLD_428}${NO_TOKEN('the policy holds the call for a human (HitlApproved is not true); the gateway answers 428, the decision is not a token')}`, tokens: [], refs: [P1_AZ, STEPUP[0], R428, STEPUP[1]] },
    { form: `(the BFF shows the approval card in the chat and parks the call)\n\n${json({ type: 'approval_required', challengeId: '<id>', action: 'create_transfer', amount: 5000, to: 'SAV-002' })}${NO_TOKEN('the approval request names the action and the challenge id; it carries no token')}`, tokens: [], refs: [STEPUP[0], STEPUP[1], R428] },
    { form: `(the click on Approve in the chat becomes this call)\n\nPOST /api/agent/consent/<runId>\n  Cookie: session=<BFF session id>\n  Content-Type: application/json\n\n${json({ approved: true })}${NO_TOKEN('the approval is a signed-in action over the session cookie; it is not an OAuth token')}`, tokens: [], refs: [STEPUP[0], STEPUP[1], COOKIE] },
    { ...H.toApi('/api/transactions', 'banking:write'), form: `POST /api/transactions\n  Authorization: Bearer <delegated access token>   (aud ${AUD_GW})\n  Content-Type: application/json\n\n${json({ type: 'transfer', fromAccountId: 'CHK-001', toAccountId: 'SAV-002', amount: 5000 })}\n\n  <- 200 OK  { "transaction": { "id": "<id>" } }`, tokens: [DELEG('Delegated token · scope banking:write now that the human approved', 'banking:write')] },
  ],
  'bad-scope': [
    { form: TOOLS_CALL('create_transfer', { from: 'CHK-001', to: 'SAV-002', amount: 5000 }), tokens: [READ_TOK], refs: uniq(AGENT_GATEWAY, MCP[0], BEARER[0], JSONRPC) },
    H.ask('McpToolCall', 'tools/call', 'create_transfer', 'banking:read'),
    { form: `${ANSWER('DENY', ['mcp-authorization-denied'])}${NO_TOKEN('a DENY is a decision answer; the gateway turns it into a 403')}`, tokens: [], refs: [P1_AZ, AZEN, AUTHZ[1]] },
    { form: DENY_403 + NO_TOKEN('the 403 explains the refusal in headers and body; the read-only token is not replaced or refreshed'), tokens: [], refs: [WWW_AUTH, HTTP, AGENT_GATEWAY] },
    { form: `${json({ role: 'assistant', content: 'I could not complete the transfer: your session lacks the write permission.' })}\n\n(the agent reports the 403 and offers to re-authenticate with write scope; it does not retry)${NO_TOKEN('the user sees a message only')}`, tokens: [], refs: [WWW_AUTH, HTTP, RFC(9470, 'Step-up authentication challenge: ask for a stronger authorization')] },
  ],
  'api-key-path': [
    { form: TOOLS_CALL('show_mortgage', {}, '<user bearer, aud ' + AUD_GW + '>'), tokens: [DELEG('Bearer arriving at the gateway · scope mortgage:read is enforced next', 'mortgage:read')], refs: uniq(AGENT_GATEWAY, MCP[0], BEARER[0], JSONRPC) },
    { form: `GET http://banking_api_resource_server:8082/mortgage\n  X-API-Key: <service API key, masked: last 4 only shown>\n  X-User-Sub: USER_ID\n\n(mortgage:read verified, the OAuth bearer is dropped; the mortgage service sees only the key and the user's sub)\n\n  <- 200 OK  { "mortgage": { "...": "..." } }${NO_TOKEN('the user bearer is dropped here; the service credential is an API key, not a token, and only its last 4 characters are ever shown')}`, tokens: [], refs: [BEARER[0], RFC(8693, 'The OAuth path would exchange; this path swaps in a service credential instead'), SPEC('PingGateway route filters', 'api_key disposition on /mcp/apikey')] },
    { form: `(BFF to SPA)\n${json({ route: '/path/mortgage', payload: '<mortgage record, key shown as last 4>' })}${NO_TOKEN('no bearer and no key reach the browser')}`, tokens: [], refs: [HTTP, COOKIE] },
  ],
  'dual-token-path': [
    { form: TOOLS_CALL('user_profile_card', {}, '<user bearer, aud ' + AUD_GW + '>'), tokens: [DELEG('User bearer · arriving at the gateway', 'banking:read')], refs: uniq(AGENT_GATEWAY, MCP[0], BEARER[0], JSONRPC) },
    { form: `POST /api/resource-server/identity\n  Authorization: Bearer <user bearer>\n  Content-Type: application/json\n\n${json({ jsonrpc: '2.0', id: 1, method: 'identity', params: { idToken: '<ID token from the BFF session>' } })}`, tokens: [DELEG('Bearer · validated by authenticateToken (signature, exp, aud)'), ID_TOK], refs: uniq(BEARER[0], SPEC('OIDC Core 1.0', 'ID token validation'), RFC(7519, 'JSON Web Token'), INTROSPECT[3]) },
    { form: `HTTP/1.1 200 OK\nContent-Type: application/json\n\n${json({ sub: 'USER_ID', email: 'alice@example.com', scope: 'banking:read', acr: '<acr value>' })}${NO_TOKEN('the server returns decoded claims only; no raw JWT crosses a boundary')}`, tokens: [], refs: [SPEC('OIDC Core 1.0', 'ID token claims'), BEARER[0], HTTP] },
    { form: `(BFF to SPA)\n${json({ route: '/path/dualtoken-info', payload: { accessTokenClaims: '...', idTokenClaims: '...' } })}${NO_TOKEN('claims only')}`, tokens: [], refs: [HTTP, COOKIE] },
  ],
  'oauth-bearer-path': [
    { form: TOOLS_CALL('demo_show_accounts', {}, '<user bearer, aud ' + AUD_GW + '>'), tokens: [DELEG('User bearer · arriving at the gateway', 'banking:read')], refs: uniq(AGENT_GATEWAY, MCP[0], BEARER[0], JSONRPC) },
    {
      form: `${TOKEN_ENDPOINT}\n  grant_type=urn:ietf:params:oauth:grant-type:token-exchange\n  &subject_token=<user bearer>\n  &subject_token_type=urn:ietf:params:oauth:token-type:access_token\n  &requested_token_type=urn:ietf:params:oauth:token-type:access_token\n  &resource=<banking_resource_server URI>&scope=banking:read\n\n  <- 200 OK  { "access_token": "<backend-scoped access token>", "token_type": "Bearer" }`,
      tokens: [DELEG('Subject token · user bearer', 'banking:read'), { note: 'Issued token · aud is the banking resource server (RFC 8707 audience binding)', header: { alg: 'RS256', typ: 'JWT' }, claims: delegated('banking:read', { aud: ['<banking_resource_server URI>'] }) }],
      refs: [...EXCHANGE.slice(0, 2), P1_TOKEN, BEARER[2]],
    },
    H.toApi('/api/resource-server/accounts'),
  ],
};
