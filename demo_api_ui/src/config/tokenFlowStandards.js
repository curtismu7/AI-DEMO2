// /architecture/token-flow: for each arrow of each scenario, the request on the wire, the MOCK decoded tokens in play and the
// standards behind the hop. Values are teaching values (placeholders such as <access token>, no real secrets or JWT literals).
// Vocabulary: pingStyleStandards.js. Wire shapes follow demo_api_server: services/oauthService.js (performTokenExchangeWithActor),
// services/mcpGatewayClient.js (Bearer + X-Act-Client-Id), routes/oauthUser.js (login + callback), routes/agentRun.js,
// routes/agentInvokeRoute.js and routes/agentConsentRoute.js (BFF bodies), routes/resourceServer.js (identity.show),
// ping-gateway/scripts/groovy/p1az-decision.groovy (403 / 428 bodies, scope backstop), olb-token-exchange.groovy (Exchange #3),
// apikey-dispatch.groovy, demo_mcp_gateway/src/*Dispatch.ts, scope-topology.json (tool scopes) and docs/TOKEN_FLOW.md.
// TOKEN_FLOW_DETAIL[scenario][i] is the detail of arrow i of that scenario (same order as TOKEN_FLOW_ENDPOINTS in tokenFlowDiagram.js).
import { RFC, SPEC, DRAFT, AUTH, BEARER, CREDS, EXCHANGE, MCP, INTROSPECT, AUTHZ } from './pingStyleStandards';

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
const CHAT = SPEC('OpenAI Chat Completions API', 'The wire format the LLM lane speaks');
const R428 = RFC(6585, 'Additional HTTP status codes: 428 Precondition Required');
const SSE = SPEC('WHATWG HTML Living Standard', 'Server-sent events: how the approval card reaches the chat');
const uniq = (...refs) => refs.filter((r, i) => refs.findIndex((o) => o.id === r.id) === i);

// ---- MOCK tokens (teaching values) ----
const AUD_USER = 'enduser.ping.demo';
const AUD_AGENT = 'agentgateway.ping.demo';
const AUD_GW = 'mcpgateway.ping.demo';
const AUD_UPSTREAM = 'mcpserver.ping.demo';
// Scope names are the ones scope-topology.json lists (the gateway reads it): get_my_accounts needs accounts:read,
// create_transfer needs write + transfer, user_profile_card / demo_show_accounts need read, show_mortgage needs mortgage:read.
const USER_SCOPE = 'openid profile email offline_access accounts:read read write transfer';

const USER_AT = { iss: ISS, sub: 'USER_ID', aud: [AUD_USER], client_id: 'BFF_CLIENT_ID', scope: USER_SCOPE, may_act: { sub: 'AI_AGENT_CLIENT_ID' }, ...NOW };
const USER_AT_TOK = { note: 'User access token · aud enduser.ping.demo, held by the BFF, carries may_act for the agent', header: { alg: 'RS256', typ: 'JWT' }, claims: USER_AT };
const ID_TOK = { note: 'ID token · signed JWT proving who signed in; for the app, never sent on to APIs or MCP', header: { alg: 'RS256', typ: 'JWT' }, claims: { iss: ISS, sub: 'USER_ID', aud: 'BFF_CLIENT_ID', email: 'alice@example.com', given_name: 'Alice', nonce: '<random nonce>', ...NOW } };
const ACTOR_TOK = { note: 'Agent actor token · client credentials of the agent client', header: { alg: 'RS256', typ: 'JWT' }, claims: { iss: ISS, sub: 'AI_AGENT_CLIENT_ID', client_id: 'AI_AGENT_CLIENT_ID', aud: [AUD_AGENT], ...NOW } };
const delegated = (scope, extra = {}) => ({ iss: ISS, sub: 'USER_ID', aud: [AUD_GW], client_id: 'BFF_CLIENT_ID', scope, act: { sub: 'AI_AGENT_CLIENT_ID' }, ...NOW, ...extra });
const DELEG = (note, scope = 'accounts:read') => ({ note, header: { alg: 'RS256', typ: 'JWT' }, claims: delegated(scope) });
const GW_TOK = DELEG('Delegated token · aud mcpgateway.ping.demo, sub is the user, act names the agent');
const UPSTREAM_TOK = (scope) => ({ note: 'Token the MCP server holds · PingGateway default route (Exchange #3): aud narrowed to the MCP server; on demo_mcp_gateway it is the delegated token unchanged', header: { alg: 'RS256', typ: 'JWT' }, claims: { iss: ISS, sub: 'USER_ID', aud: [AUD_UPSTREAM], scope, ...NOW } });

// ---- request forms ----
const CALLBACK = 'https://<app host>/api/auth/oauth/user/callback';
const AUTHORIZE_REQ = `GET /api/auth/oauth/user/login   (browser to the BFF)\n  <- 302 Location: https://auth.pingone.com/ENV_ID/as/authorize\n       ?response_type=code&client_id=BFF_CLIENT_ID\n       &redirect_uri=${CALLBACK}\n       &scope=${USER_SCOPE}\n       &state=<random state>&nonce=<random nonce>\n       &code_challenge=<S256 hash>&code_challenge_method=S256\n\n(the BFF mints the PKCE verifier and keeps it in its session; with a pi.flow sign-in the credentials go to POST /api/auth/oauth/user/pi-flow/credentials and the same callback finishes the code exchange)`;
const CODE_REQ = `GET /api/auth/oauth/user/callback?code=<one-time code>&state=<random state>   (browser to the BFF)\n\nBFF to PingOne:\n${TOKEN_ENDPOINT}\n  Authorization: Basic <BFF client id:secret>\n  Content-Type: application/x-www-form-urlencoded\n\n  grant_type=authorization_code&code=<one-time code>\n  &redirect_uri=${CALLBACK}&code_verifier=<PKCE secret>`;
const EXCHANGE_REQ = (scope, aud = AUD_GW) => `${TOKEN_ENDPOINT}\n  Content-Type: application/x-www-form-urlencoded\n\n  grant_type=urn:ietf:params:oauth:grant-type:token-exchange\n  &subject_token=<user access token>\n  &subject_token_type=urn:ietf:params:oauth:token-type:access_token\n  &actor_token=<agent client-credentials token>\n  &actor_token_type=urn:ietf:params:oauth:token-type:access_token\n  &requested_token_type=urn:ietf:params:oauth:token-type:access_token\n  &audience=${aud}&scope=${scope}&client_id=BFF_CLIENT_ID`;
const TOOLS_CALL = (tool, args, auth = '<delegated access token>') => `POST /mcp\n  Authorization: Bearer ${auth}\n  X-Act-Client-Id: AI_AGENT_CLIENT_ID\n  Content-Type: application/json\n\n${json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } })}`;
const DECISION = (ctx, method, tool, scopes) => `${DECISION_ENDPOINT}\n  Authorization: Bearer <Authorize worker token>\n  Content-Type: application/json\n\n${json({ parameters: { DecisionContext: ctx, McpMethod: method, UserId: 'USER_ID', ...(tool ? { ToolName: tool } : {}), ActClientId: 'AI_AGENT_CLIENT_ID', TokenScopes: scopes, TokenAudience: AUD_GW } })}`;
const ANSWER = (decision, codes) => `HTTP/1.1 200 OK\n\n${json({ decision, statements: codes.map((code) => ({ code })) })}`;
const NO_TOKEN = (why) => `\n\nNo token on this hop: ${why}`;
const TOOL_RESULT = (tool) => `HTTP/1.1 200 OK\nContent-Type: application/json\n\n${json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '<result of ' + tool + '>' }] } })}`;
const RS_GET = (path, who) => `GET ${path}\n  Authorization: Bearer <access token the MCP server holds>   (${who})\n\n  <- 200 OK  (JSON body: the data the tool asked for)`;
const CHAT_RUN = (text) => `POST /api/agent/run\n  Cookie: session=<BFF session id>\n  Content-Type: application/json\n\n${json({ threadId: '<thread id>', runId: '<run id>', messages: [{ role: 'user', content: text }] })}`;


// ---- shared hops, reused across scenarios ----
const H = {
  userSends: {
    form: `${CHAT_RUN('show me my accounts')}${NO_TOKEN('the browser sends only the session cookie; the user\'s typed message is the payload, and the BFF looks up the tokens it holds')}`,
    tokens: [],
    refs: [HTTP, COOKIE, BFF_DRAFT],
  },
  chatToAgent: {
    form: `${CHAT_RUN('show me my accounts')}\n\n(the SPA's chat message reaches the BFF; the BFF loads req.session.oauthTokens)${NO_TOKEN('the cookie is not an OAuth token; the BFF resolves the stored access token itself')}`,
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
    refs: [CHAT, HTTP],
  },
  exchange: (scope) => ({
    form: `${EXCHANGE_REQ(scope)}\n\n  <- 200 OK\n${json({ access_token: '<delegated access token>', issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: 3600 })}`,
    tokens: [USER_AT_TOK, ACTOR_TOK, DELEG('Issued delegated token · aud narrowed to the gateway, act chain added', scope)],
    refs: [...EXCHANGE.slice(0, 2), P1_TOKEN, CREDS[0], BEARER[2]],
  }),
  arriveGateway: (tool, args, scope) => ({
    form: TOOLS_CALL(tool, args),
    tokens: [DELEG('Delegated token · what the Agent Gateway validates (aud, sub, act.sub, scope)', scope)],
    refs: uniq(MCP[0], MCP[3], BEARER[0], JSONRPC, INTROSPECT[0], EXCHANGE[0]),
  }),
  // The decision call is PingOne Authorize's own endpoint with Trust Framework parameters: not AuthZEN, not XACML, no RAR.
  // RFC 8693 governs only ActClientId (taken from the act claim); RFC 6749 only the worker token that authorizes the call.
  ask: (ctx, method, tool, scopes, answer) => ({
    form: DECISION(ctx, method, tool, scopes) + (answer ? `\n\n  <- 200 OK\n${answer}` : ''),
    tokens: [DELEG('Delegated token · its claims become the decision parameters (UserId, ActClientId, TokenAudience, TokenScopes)', scopes)],
    refs: [P1_AZ, AUTHZ[3], CREDS[0]],
  }),
  permit: (ctx, tool, codes = ['mcp-tool-authorized']) => ({
    form: `${ANSWER('PERMIT', codes)}${NO_TOKEN(`${ctx} for ${tool || 'tools/list'} is a decision answer, not a token; the gateway acts on it`)}`,
    tokens: [],
    refs: [P1_AZ],
  }),
  // Two behaviours live in this repo for the hop after PERMIT; the form shows both so neither is implied to be the only one.
  forward: (scope) => ({
    form: `POST /mcp   (gateway to the MCP server)\n  Authorization: Bearer <access token for the MCP server>\n  Content-Type: application/json\n\n${json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_my_accounts', arguments: {} } })}\n\nToken on this hop, by gateway:\n  demo_mcp_gateway (Node): the delegated token, forwarded unchanged (aud ${AUD_GW})\n  PingGateway default route: olb-token-exchange.groovy runs "Exchange #3" at PingOne, aud ${AUD_UPSTREAM}`,
    tokens: [DELEG('Delegated token · what the gateway received and, on demo_mcp_gateway, forwards byte for byte', scope), UPSTREAM_TOK(scope)],
    refs: uniq(MCP[0], MCP[3], BEARER[0], JSONRPC, EXCHANGE[0], EXCHANGE[1]),
  }),
  toApi: (path, scope = 'accounts:read') => ({
    form: `${RS_GET(path, `aud ${AUD_UPSTREAM} on PingGateway, ${AUD_GW} on demo_mcp_gateway`)}`,
    tokens: [UPSTREAM_TOK(scope)],
    refs: uniq(BEARER[0], BEARER[2], INTROSPECT[2], INTROSPECT[3]),
  }),
  result: {
    form: `${TOOL_RESULT('get_my_accounts')}\n\n(the BFF turns the tool result into the chat answer the SPA shows)${NO_TOKEN('the response carries data only; the tokens stay in the BFF session')}`,
    tokens: [],
    refs: [HTTP, JSONRPC, COOKIE],
  },
};

// A policy DENY from p1az-decision.groovy: 403 with the audit-trail header and a JSON body; there is no WWW-Authenticate header.
const DENY_403 = `HTTP/1.1 403 Forbidden\nContent-Type: application/json\nX-Gw-Audit-Trail: <json audit trail>\n\n${json({ error: 'access_denied', decision: 'DENY', backend: 'real', tool: 'create_transfer', mcp_method: 'tools/call' })}\n\n(before it asks Authorize, the gateway also checks scope-topology.json: create_transfer needs write + transfer, and a token without them gets 403 { "error": "insufficient_scope" } from that local check; the BFF must not retry with the same token)`;
// The gateway mints the challenge at demo_hitl_service after Authorize answers INDETERMINATE with a consent obligation, then answers the BFF.
const HOLD_428 = `(PingOne Authorize answered INDETERMINATE with a consent statement; the gateway created a challenge at demo_hitl_service: POST /challenges)\n\nHTTP/1.1 428 Precondition Required\nContent-Type: application/json\nX-Gw-Audit-Trail: <json audit trail>\n\n${json({ error: 'hitl_required', message: 'Human approval required', decision: 'INDETERMINATE', hitl: true, tool: 'create_transfer', challengeId: '<id>', expiresAt: '<timestamp>', instructions: 'Approve at dashboard, then retry with _hitl_challenge_id in arguments' })}`;
const READ_TOK = DELEG('Delegated token · scope read only, so a write tool cannot pass', 'read');
const WRITE_TOK = DELEG('Delegated token · scope write transfer, as the retry carries it once the human approved', 'write transfer');

export const TOKEN_FLOW_DETAIL = {
  'full-flow': [
    H.userSends,
    H.chatToAgent,
    { form: H.authorizeNote, tokens: [], refs: H.authorize.refs },
    H.tokensIssued,
    { ...H.chatToAgent, form: `(the sign-in is done; the BFF holds the access token in its session)\n\nPOST /api/agent/invoke\n  Cookie: session=<BFF session id>\n  Content-Type: application/json\n\n${json({ prompt: 'show me my accounts' })}`, tokens: [USER_AT_TOK] },
    H.llm,
    H.exchange('accounts:read'),
    { form: `HTTP/1.1 200 OK (PingOne to the BFF)\nContent-Type: application/json\n\n${json({ access_token: '<delegated access token>', issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: 3600 })}`, tokens: [GW_TOK], refs: uniq(...EXCHANGE.slice(0, 2), BEARER[0], BEARER[2]) },
    H.arriveGateway('get_my_accounts', {}, 'accounts:read'),
    H.ask('McpToolCall', 'tools/call', 'get_my_accounts', 'accounts:read'),
    H.permit('McpToolCall', 'get_my_accounts'),
    H.forward('accounts:read'),
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
    H.exchange('accounts:read'),
    H.arriveGateway('get_my_accounts', {}, 'accounts:read'),
    H.forward('accounts:read'),
    H.toApi('/api/accounts/my'),
  ],
  'get-accounts': [
    H.llm,
    H.ask('McpToolsList', 'tools/list', null, 'accounts:read'),
    H.permit('McpToolsList', null, ['mcp-tool-authorized']),
    H.ask('McpToolCall', 'tools/call', 'get_my_accounts', 'accounts:read'),
    H.permit('McpToolCall', 'get_my_accounts'),
    H.toApi('/api/accounts/my'),
  ],
  withdrawal: [
    { ...H.llm, form: H.llm.form.replace('show me my accounts', 'transfer $5,000 to savings').replace('get_my_accounts', 'create_transfer') },
    H.ask('McpToolCall', 'tools/call', 'create_transfer', 'write transfer', json({ decision: 'INDETERMINATE', statements: [{ code: 'HITLCONSENT' }] })),
    { form: `${HOLD_428}${NO_TOKEN('the hold is a gateway answer built from the policy decision; it is not a token, and the BFF has to bring back an approval receipt')}`, tokens: [], refs: [R428, HTTP] },
    { form: `(server-sent event to the open chat stream; the BFF parks the run as suspended_hitl)\n\n${json({ type: 'CUSTOM', name: 'hitl_consent', value: '<consent payload: the held tool and the challenge id>' })}${NO_TOKEN('the approval card names the action; it carries no token and is not an OAuth message')}`, tokens: [], refs: [SSE, COOKIE] },
    { form: `(the click on Approve in the chat becomes this call)\n\nPOST /api/agent/consent/<runId>\n  Cookie: session=<BFF session id>\n  Content-Type: application/json\n\n${json({ approved: true })}${NO_TOKEN('the approval is a signed-in action over the session cookie; it is not an OAuth token')}`, tokens: [], refs: [HTTP, COOKIE] },
    { ...H.toApi('/api/transactions', 'write transfer'), form: `POST /api/transactions\n  Authorization: Bearer <access token the MCP server holds>\n  Content-Type: application/json\n\n${json({ type: 'transfer', fromAccountId: 'CHK-001', toAccountId: 'SAV-002', amount: 5000 })}\n\n  <- 200 OK  { "transaction": { "id": "<id>" } }\n\n(reached after the retry carrying _hitl_challenge_id passed the gateway)`, tokens: [WRITE_TOK] },
  ],
  'bad-scope': [
    { form: TOOLS_CALL('create_transfer', { from: 'CHK-001', to: 'SAV-002', amount: 5000 }), tokens: [READ_TOK], refs: uniq(MCP[0], BEARER[0], JSONRPC) },
    H.ask('McpToolCall', 'tools/call', 'create_transfer', 'read'),
    { form: `${ANSWER('DENY', ['mcp-authorization-denied'])}${NO_TOKEN('a DENY is a decision answer; the gateway turns it into a 403')}`, tokens: [], refs: [P1_AZ] },
    { form: DENY_403 + NO_TOKEN('the 403 explains the refusal in its JSON body; the read-only token is not replaced or refreshed'), tokens: [], refs: [HTTP] },
    { form: `${json({ role: 'assistant', content: 'I could not complete the transfer: your session lacks the write permission.' })}\n\n(the agent reports the 403 to the user and does not retry)${NO_TOKEN('the user sees a message only')}`, tokens: [], refs: [HTTP, COOKIE] },
  ],
  'api-key-path': [
    { form: TOOLS_CALL('show_mortgage', {}, '<user bearer, aud ' + AUD_GW + '>'), tokens: [DELEG('Bearer arriving at the gateway · scope mortgage:read is enforced next', 'mortgage:read')], refs: uniq(MCP[0], BEARER[0], JSONRPC) },
    { form: `GET http://api-resource-server:8082/mortgage\n  X-API-Key: <service API key, masked: last 4 only shown>\n\n(mortgage:read verified from the bearer, then the bearer is dropped; demo_mcp_gateway also adds X-User-Sub. The service key comes from the vault bridge, not from the user.)\n\n  <- 200 OK  { "mortgage": { "...": "..." } }${NO_TOKEN('the user bearer is dropped here; the service credential is an API key, not a token, and only its last 4 characters are ever shown')}`, tokens: [], refs: [HTTP, RFC(7519, 'JSON Web Token: the bearer\'s scope claim is read before it is dropped')] },
    { form: `(BFF to SPA)\n${json({ route: '/path/mortgage', payload: '<mortgage record, key shown as last 4>' })}${NO_TOKEN('no bearer and no key reach the browser')}`, tokens: [], refs: [HTTP, COOKIE] },
  ],
  'dual-token-path': [
    { form: TOOLS_CALL('user_profile_card', {}, '<user bearer, aud ' + AUD_GW + '>'), tokens: [DELEG('User bearer · arriving at the gateway', 'read')], refs: uniq(MCP[0], BEARER[0], JSONRPC) },
    { form: `POST /api/resource-server/identity   (gateway to banking_resource_server)\n  Authorization: Bearer <user bearer>\n  Content-Type: application/json\n\n${json({ jsonrpc: '2.0', id: 1, method: 'identity.show', params: { idToken: '<ID token fetched from the BFF>' } })}\n\n(the gateway fetches the ID token server to server from the BFF, so it rides on this one hop in the body)`, tokens: [DELEG('Bearer · validated by authenticateToken (signature, exp, aud)', 'read'), ID_TOK], refs: uniq(BEARER[0], SPEC('OIDC Core 1.0', 'ID token validation'), RFC(7519, 'JSON Web Token'), INTROSPECT[3]) },
    { form: `HTTP/1.1 200 OK\nContent-Type: application/json\n\n${json({ credentialPath: 'dual_token', badge: 'ACCESS + ID-TOKEN PATH', accessTokenClaims: { sub: 'USER_ID', aud: [AUD_GW], scope: 'read' }, idTokenClaims: { sub: 'USER_ID', email: 'alice@example.com' }, idTokenSource: 'wire', message: 'CLAIMS ONLY - no raw JWT crosses this boundary.', returnTo: '/dashboard' })}${NO_TOKEN('the response carries decoded, sanitized claims only; no raw JWT is returned')}`, tokens: [], refs: [SPEC('OIDC Core 1.0', 'ID token claims'), BEARER[0], HTTP] },
    { form: `(BFF to SPA)\n${json({ route: '/path/dualtoken-info', payload: { accessTokenClaims: '...', idTokenClaims: '...' } })}${NO_TOKEN('claims only')}`, tokens: [], refs: [HTTP, COOKIE] },
  ],
  // Path C: the gateway forwards the inbound bearer unchanged to the banking resource server (bankingDataDispatch.ts); there is no
  // RFC 8693 exchange on this path. The gateway still asks PingOne Authorize before the call.
  'oauth-bearer-path': [
    { form: TOOLS_CALL('demo_show_accounts', {}, '<user bearer, aud ' + AUD_GW + '>'), tokens: [DELEG('User bearer · arriving at the gateway', 'read')], refs: uniq(MCP[0], BEARER[0], JSONRPC) },
    H.ask('McpToolCall', 'tools/call', 'demo_show_accounts', 'read', json({ decision: 'PERMIT', statements: [{ code: 'mcp-tool-authorized' }] })),
    {
      form: `GET /api/resource-server/accounts   (gateway to banking_resource_server)\n  Authorization: Bearer <user bearer, forwarded unchanged>\n\n  <- 200 OK  (JSON body: the user's accounts)\n\n(no RFC 8693 exchange on this path, no id_token)`,
      tokens: [DELEG('User bearer · forwarded unchanged; authenticateToken checks signature, exp and aud', 'read')],
      refs: uniq(BEARER[0], BEARER[2], INTROSPECT[2], INTROSPECT[3]),
    },
  ],
};
