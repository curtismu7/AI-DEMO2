import { wrapMessages } from './sequenceWrap';

// CIBA approval sequence: an AI agent books a flight, PingOne Authorize demands out-of-band approval (CIBA), and the call is replayed after the
// user approves on another device. Modelled one-to-one on the Lucidchart sequence (10 lifelines, 71 messages, 3 phase bands, 7 notes, a poll loop
// with an inner alt, and a closing alt), with the chart's real component names. A Mermaid `sequenceDiagram` for SequenceFlowDiagram, in the
// pocFlow.js style: CIBA_APPROVAL_SOURCE (the diagram), CIBA_APPROVAL_DETAILS (per participant), CIBA_APPROVAL_PAYLOADS (none) and
// CIBA_APPROVAL_STEP_DETAILS (per message: what, why, request / response text, tokens, standards, source file).
//
// Payloads are examples, never captured traffic. REPO (below) adds, per message number, what this repository really does and SOURCES names the
// file; the approval plugin, the agent runtime, the Flight MCP server and the flights API live outside this repo, so those steps keep chart-level detail.
// What neither the chart nor the repo states is marked "(not traced)" or "Illustrative".

const J = (o) => JSON.stringify(o, null, 2);
const JSN = 'Content-Type: application/json';
const FORM = 'Content-Type: application/x-www-form-urlencoded';
const SSE = 'Content-Type: text/event-stream';
const AS = 'https://auth.example.com/ENV_ID';
const GW = 'https://ping-ai-gateway.example.com';
const MCPH = 'https://flight-mcp.example.com';
const APIGW = 'https://approval-gateway.example.com';
const PDP = 'https://paz.example.com';
const API = 'https://flights.example.com';
const T = 'urn:ietf:params:oauth:grant-type:token-exchange';
const AT = 'urn:ietf:params:oauth:token-type:access_token';
const CIBA = 'urn:openid:params:grant-type:ciba';
const BASIC = 'Authorization: Basic Y2xpZW50LWV4YW1wbGU6bm90LXJlYWw=';
const times = { iat: 1893455700, exp: 1893456000 };
const hdr = { alg: 'RS256', kid: 'key-1', typ: 'JWT' };
const ILL = 'Illustrative: the chart gives the key fields; the rest is a typical shape (not traced).';

const tok = (label, payload, extra = {}) => ({ label, header: hdr, payload: { iss: AS, ...payload, ...times }, ...extra });
const userToken = tok('User access token', { sub: 'user-123', aud: 'chat-widget-example', scope: 'openid profile' }, { focus: ['sub'], notes: { sub: 'The person everything below is done for. It stays the same in every token in this flow.' } });
const gatewayToken = tok('Gateway-bound token (on behalf of the user)', { sub: 'user-123', aud: 'ping-ai-gateway.example.com', client_id: 'agent-runtime-example' }, { focus: ['sub', 'aud'], notes: { aud: 'Only the AI gateway should accept this token. Any other service must refuse it.' } });
const upstreamToken = tok('Scoped upstream token', { sub: 'user-123', aud: 'approval-gateway.example.com', scope: 'flights-api', client_id: 'flight-mcp-example' }, { focus: ['aud', 'scope'], notes: { aud: 'Narrowed to the one API gateway this call is going to.', scope: 'Narrowed to the flights API only.' } });

const req = (method, url, headers, body, notice) => ({ method, url, ...(headers?.length ? { headers } : {}), ...(body ? { body } : {}), ...(notice ? { notice } : {}) });
const res = (status, headers, body, notice) => ({ status, ...(headers?.length ? { headers } : {}), ...(body ? { body } : {}), ...(notice ? { notice } : {}) });
const none = (why) => ({ none: why });
const rpcCall = (id, name, args) => J({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const rpcOk = (id, text) => J({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
const bearer = (n) => `Authorization: Bearer ${n}`;
const r = (spec, section, note) => ({ spec, ...(section ? { section } : {}), ...(note ? { note } : {}) });
const exchangeBody = (extra) => `grant_type=${T}&subject_token=user-token-example&subject_token_type=${AT}&audience=approval-gateway.example.com&scope=flights-api${extra || ''}`;
const exchangeResp = { status: '200 OK', headers: [JSN, 'Cache-Control: no-store'], body: J({ access_token: 'upstream-token-example', issued_token_type: AT, token_type: 'Bearer', expires_in: 300, scope: 'flights-api' }) };

// Lifelines, left to right: [id, label, one short role line].
const PARTICIPANTS = [
  ['user', 'User (chat widget)', 'asks, approves elsewhere'],
  ['agent', 'Agent runtime', 'holds the tool call open'],
  ['aigate', 'AI gateway', 'validates the agent token'],
  ['mcp', 'Flight MCP server', 'exchanges tokens, replays'],
  ['gw', 'API gateway (approval plugin + policy check)', 'approval plugin + policy check'],
  ['store', 'Redis (approval store)', 'short-lived keys'],
  ['pdp', 'PingOne Authorize (PAZ)', 'decides every call'],
  ['as', 'PingOne (CIBA)', 'tokens + approval'],
  ['device', 'Other device (push)', 'where the user approves'],
  ['api', 'Flights API', 'the protected resource'],
];

// One entry per message, in order. A step is { title, what, why, refs, wire }; the wire text is turned into request / response strings below.
const M = [];
const m = (from, to, label, dashed, step) => M.push({ from, to, label, dashed, step });

// ---- Phase 1: search, no approval (messages 1-18) -------------------------------------------------------------------------------------------
m('user', 'agent', '"Book LAX to JFK" + Bearer user token (OIDC via DaVinci login)', false, {
  title: 'The user asks the agent to book a flight',
  what: 'The chat widget sends the request to the agent runtime. The user\'s access token, obtained earlier by signing in with OpenID Connect (through a DaVinci flow), travels with it as a Bearer credential.',
  why: 'The agent acts for this person. The token is the proof of who is asking; without it the agent has nobody to act for and every later hop has nothing to check.',
  refs: [r('OIDC Core 1.0'), r('RFC 6750', '2.1')],
  wire: { request: req('POST', 'https://agent-runtime.example.com/chat', [JSN, bearer('user-token-example')], J({ message: 'Book LAX to JFK' }), ILL), tokens: [userToken] },
});
m('agent', 'as', 'agent identity service OBO exchange (user token -> token, aud = AI Gateway)', false, {
  title: 'The agent swaps the user\'s token for one meant for the AI gateway',
  what: 'agent identity service (beside the agent runtime) asks PingOne for a token whose audience is the AI gateway, presenting the user\'s token as proof (an on-behalf-of exchange). Whether this is RFC 8693 or a vendor-specific variant is (not traced); the shape below is the standard one.',
  why: 'The user\'s own token was issued for the chat widget. A token for the gateway lets the gateway trust the call without the agent ever holding a broader credential.',
  refs: [r('RFC 8693', '2.1'), r('RFC 6749', '3.2')],
  wire: { request: req('POST', `${AS}/as/token`, [FORM, BASIC], `grant_type=${T}&subject_token=user-token-example&subject_token_type=${AT}&audience=ping-ai-gateway.example.com`, ILL) },
});
m('as', 'agent', 'gateway-bound access token', true, {
  title: 'A token for the AI gateway comes back',
  what: 'PingOne answers with an access token whose audience is the AI gateway. It still names the same user as subject.',
  why: 'The audience claim is what stops this token working anywhere else. A service that receives a token meant for another audience must refuse it.',
  refs: [r('RFC 8693', '2.2'), r('RFC 7519', '4.1.3')],
  wire: { response: { ...exchangeResp, body: J({ access_token: 'gateway-token-example', issued_token_type: AT, token_type: 'Bearer', expires_in: 300 }), notice: ILL }, tokens: [gatewayToken] },
});
m('agent', 'aigate', 'tools/call search_flights, Authorization: Bearer gateway token', false, {
  title: 'The agent calls the search_flights tool',
  what: 'The agent runtime sends an MCP tools/call request for search_flights to the AI gateway, with the gateway-bound token in the Authorization header.',
  why: 'Tool calls are the only way the model touches the outside world, and they all pass through the gateway where they can be checked and logged.',
  refs: [r('MCP'), r('RFC 6750', '2.1')],
  wire: { request: req('POST', `${GW}/mcp`, [JSN, bearer('gateway-token-example')], rpcCall(1, 'search_flights', { origin: 'LAX', destination: 'JFK' })), tokens: [gatewayToken] },
});
m('aigate', 'aigate', 'validate token (connection OAuth)', false, {
  title: 'The AI gateway validates the token',
  what: 'The gateway checks the token against its configured OAuth connection: signature, issuer, audience and expiry. Whether it uses published keys or introspection is (not traced).',
  why: 'A forged, expired or wrongly addressed token stops here, before anything reaches a tool.',
  refs: [r('RFC 7519', '4.1'), r('RFC 8725'), r('RFC 7662', '2.2')],
  wire: none('Internal check inside the gateway. Nothing is sent: it reads the token\'s claims and the connection\'s settings.'),
});
m('aigate', 'mcp', 'POST /mcp (agent token forwarded unchanged)', false, {
  title: 'The gateway forwards the call to the Flight MCP server',
  what: 'The gateway passes the MCP request on as is, with the agent\'s token unchanged. The MCP server does not use this token downstream; it exchanges it first (next steps).',
  why: 'Forwarding unchanged keeps the gateway simple. The hard part, getting a token the API gateway will accept, happens at the MCP server.',
  refs: [r('MCP'), r('RFC 9110', '9.3.3')],
  wire: { request: req('POST', `${MCPH}/mcp`, [JSN, bearer('gateway-token-example')], rpcCall(1, 'search_flights', { origin: 'LAX', destination: 'JFK' })) },
});
m('mcp', 'as', 'RFC 8693 token exchange (subject = user token, aud = approval-gateway.example.com, scope = flights-api)', false, {
  title: 'The MCP server exchanges the token for one the API gateway accepts',
  what: 'The Flight MCP server asks PingOne for a new token. The subject is the user\'s token, the audience is the API gateway in front of the flights API, and the scope is narrowed to flights-api.',
  why: 'This is token exchange doing its job: the downstream token is smaller than the one that came in, and it is addressed to exactly one service.',
  refs: [r('RFC 8693', '2.1'), r('RFC 8693', '2.2.1', 'Successful response')],
  wire: { request: req('POST', `${AS}/as/token`, [FORM, BASIC], exchangeBody(), ILL) },
});
m('as', 'mcp', 'scoped upstream token', true, {
  title: 'A narrow upstream token comes back',
  what: 'PingOne returns an access token for the API gateway: same user, audience set to the API gateway, scope flights-api.',
  why: 'If this token leaks it is useful against one gateway for one scope, for five minutes, and nothing else.',
  refs: [r('RFC 8693', '2.2.1'), r('RFC 6749', '5.1')],
  wire: { response: exchangeResp, tokens: [upstreamToken] },
});
m('mcp', 'gw', 'GET /flights, Bearer upstream token', false, {
  title: 'The MCP server calls the flights API through the API gateway',
  what: 'A plain read: GET /flights with the scoped upstream token as a Bearer credential. The API gateway sits in front of the flights API and runs the approval plugin and a policy check on every call.',
  why: 'Every call to the API goes through this one door, so the policy runs no matter which agent or tool made the call.',
  refs: [r('RFC 9110', '9.3.1'), r('RFC 6750', '2.1')],
  wire: { request: req('GET', `${APIGW}/flights?from=LAX&to=JFK`, [bearer('upstream-token-example'), 'Accept: application/json']), tokens: [upstreamToken] },
});
m('gw', 'pdp', 'POST /sideband/request (client-token credential, bearer token + request payload)', false, {
  title: 'The API gateway asks PingOne Authorize for a verdict',
  what: 'The gateway sends a sideband request: the incoming bearer token and a description of the request (method, path, headers). It authenticates itself to PingOne Authorize with its own client token. The exact field names are (not traced).',
  why: 'The gateway enforces; it does not decide. Keeping the decision in a separate policy engine means rules change without changing the gateway.',
  refs: [r('RFC 7662', '2.1'), r('RFC 6750', '2.1')],
  wire: { request: req('POST', `${PDP}/sideband/request`, [JSN, bearer('gateway-client-token-example')], J({ method: 'GET', path: '/flights', headers: { authorization: 'Bearer upstream-token-example' } }), ILL) },
});
m('pdp', 'pdp', 'validate Bearer token, evaluate policy', false, {
  title: 'PingOne Authorize checks the token and the rules',
  what: 'It validates the bearer token (signature, audience, expiry), reads who the user is and what is being asked, and evaluates its policy against that.',
  why: 'Search is a harmless read, so the policy allows it with no approval. The same engine will answer differently for a write (phase 2).',
  refs: [r('RFC 7519', '4.1'), r('RFC 8725')],
  wire: none('Internal evaluation inside PingOne Authorize. Nothing is sent.'),
});
m('pdp', 'gw', 'PERMIT', true, {
  title: 'Verdict: PERMIT',
  what: 'PingOne Authorize tells the gateway to let the request through. The decision shape below is a typical one.',
  why: 'Without a PERMIT the gateway must not forward the request. A failure to get a verdict is treated as a denial, not as a pass.',
  refs: [r('RFC 9110', '15.3.1')],
  wire: { response: res('200 OK', [JSN], J({ decision: 'PERMIT' }), ILL) },
});
m('gw', 'api', 'GET /flights', false, {
  title: 'The API gateway forwards the read to the flights API',
  what: 'With a PERMIT in hand, the gateway sends the original GET /flights to the flights API.',
  why: 'The flights API never sees the call unless policy said yes.',
  refs: [r('RFC 9110', '9.3.1')],
  wire: { request: req('GET', `${API}/flights?from=LAX&to=JFK`, ['Accept: application/json']) },
});
m('api', 'gw', '200 flights', true, {
  title: 'The flights API returns the flight list',
  what: 'A 200 response with the matching flights.',
  why: 'The data the user asked for. Nothing has been written, so no approval was needed.',
  refs: [r('RFC 9110', '15.3.1')],
  wire: { response: res('200 OK', [JSN], J({ flights: [{ id: 'FL-100', from: 'LAX', to: 'JFK', price: 289 }, { id: 'FL-200', from: 'LAX', to: 'JFK', price: 341 }] }), 'Example data only.') },
});
m('gw', 'mcp', '200', true, {
  title: 'The API gateway passes the answer back',
  what: 'The gateway returns the 200 response to the Flight MCP server.',
  why: 'The gateway is transparent on success: the caller sees the API\'s own answer.',
  refs: [r('RFC 9110', '15.3.1')],
  wire: { response: res('200 OK', [JSN], J({ flights: [{ id: 'FL-100' }, { id: 'FL-200' }] }), 'Body shortened.') },
});
m('mcp', 'aigate', 'tools/call result', true, {
  title: 'The MCP server wraps the flights as a tool result',
  what: 'The Flight MCP server turns the API answer into an MCP tools/call result and returns it to the AI gateway.',
  why: 'Tools speak MCP to the agent; the HTTP details of the flights API stay hidden behind the server.',
  refs: [r('MCP')],
  wire: { response: res('200 OK', [JSN], rpcOk(1, 'FL-100 $289, FL-200 $341')) },
});
m('aigate', 'agent', 'forwarded verbatim', true, {
  title: 'The AI gateway returns the result unchanged',
  what: 'The gateway passes the tool result to the agent runtime without altering it.',
  why: 'The gateway validated and logged the call; on the way back it does not edit what the tool said.',
  refs: [r('MCP')],
  wire: { response: res('200 OK', [JSN], rpcOk(1, 'FL-100 $289, FL-200 $341')) },
});
m('agent', 'user', 'SSE: tool_call + text events', true, {
  title: 'The agent streams the answer to the chat widget',
  what: 'The agent runtime sends server-sent events to the chat widget: a tool_call event showing what it did and text events with the answer.',
  why: 'The user sees progress as it happens. This is the end of phase 1: a read needed no approval.',
  refs: [r('MCP')],
  wire: { response: res('200 OK', [SSE], 'event: tool_call\ndata: {"name":"search_flights"}\n\nevent: text\ndata: Two flights found: FL-100 for $289 and FL-200 for $341.\n\n', ILL) },
});

// ---- Phase 2: booking write, PingOne Authorize requires approval (messages 19-37) ------------------------------------------------
m('user', 'agent', '"book it"', false, {
  title: 'The user asks to book',
  what: 'The user types "book it" in the chat widget. The agent now needs the create_booking tool, which writes data.',
  why: 'A write is a different kind of call from a read. The policy that allowed the search will not allow this without approval.',
  refs: [r('OIDC Core 1.0')],
  wire: { request: req('POST', 'https://agent-runtime.example.com/chat', [JSN, bearer('user-token-example')], J({ message: 'book it' })), tokens: [userToken] },
});
m('agent', 'aigate', 'tools/call create_booking (flight, passengers)', false, {
  title: 'The agent calls the create_booking tool',
  what: 'An MCP tools/call for create_booking with the chosen flight and the passenger details, sent to the AI gateway with the gateway-bound token.',
  why: 'This is the call that has side effects, so it is the one the approval flow is built to hold.',
  refs: [r('MCP'), r('RFC 6750', '2.1')],
  wire: { request: req('POST', `${GW}/mcp`, [JSN, bearer('gateway-token-example')], rpcCall(2, 'create_booking', { flight: 'FL-100', passengers: [{ name: 'Alex Example' }] })), tokens: [gatewayToken] },
});
m('aigate', 'mcp', 'POST /mcp', false, {
  title: 'The gateway forwards it to the MCP server',
  what: 'Same as the search: the AI gateway validates the token and forwards the request to the Flight MCP server.',
  why: 'The gateway adds no approval logic. Approval is decided further down, at the API gateway and PingOne Authorize.',
  refs: [r('MCP'), r('RFC 9110', '9.3.3')],
  wire: { request: req('POST', `${MCPH}/mcp`, [JSN, bearer('gateway-token-example')], rpcCall(2, 'create_booking', { flight: 'FL-100', passengers: [{ name: 'Alex Example' }] })) },
});
m('mcp', 'as', 'RFC 8693 token exchange (scope = flights-api, aud = approval-gateway.example.com)', false, {
  title: 'The MCP server exchanges the token again',
  what: 'The same exchange as in phase 1: subject is the user\'s token, audience is the API gateway, scope is flights-api.',
  why: 'Each call gets its own short-lived token. Nothing is reused between the search and the booking.',
  refs: [r('RFC 8693', '2.1')],
  wire: { request: req('POST', `${AS}/as/token`, [FORM, BASIC], exchangeBody(), ILL) },
});
m('as', 'mcp', 'scoped upstream token', true, {
  title: 'A fresh upstream token comes back',
  what: 'A new access token for the API gateway, same shape as before.',
  why: 'It proves who the user is and which gateway it is for. It does not prove anyone approved this booking; that is still missing.',
  refs: [r('RFC 8693', '2.2.1'), r('RFC 6749', '5.1')],
  wire: { response: exchangeResp, tokens: [upstreamToken] },
});
m('mcp', 'gw', 'POST /bookings (no x-ciba-approval header)', false, {
  title: 'The MCP server tries to create the booking',
  what: 'POST /bookings to the API gateway with the upstream token and no x-ciba-approval header, because no approval exists yet.',
  why: 'This is the first attempt. It is expected to be held; the missing header is what tells the gateway there is no approval yet.',
  refs: [r('RFC 9110', '9.3.3'), r('RFC 6750', '2.1')],
  wire: { request: req('POST', `${APIGW}/bookings`, [JSN, bearer('upstream-token-example')], J({ flight: 'FL-100', passengers: [{ name: 'Alex Example' }] })), tokens: [upstreamToken] },
});
m('gw', 'pdp', 'POST /sideband/request', false, {
  title: 'The API gateway asks for a verdict on the booking',
  what: 'The approval plugin runs first (it has priority over the policy plugin). It finds a protected call with no approval header and forwards it for a policy verdict anyway.',
  why: 'Asking PingOne Authorize means the rule lives in one place: the gateway does not hard-code which calls need approval.',
  refs: [r('RFC 7662', '2.1')],
  wire: { request: req('POST', `${PDP}/sideband/request`, [JSN, bearer('gateway-client-token-example')], J({ method: 'POST', path: '/bookings', headers: { authorization: 'Bearer upstream-token-example' } }), ILL) },
});
m('pdp', 'pdp', 'validate Bearer token, evaluate policy', false, {
  title: 'The policy is evaluated for the write',
  what: 'PingOne Authorize validates the token, sees a POST to /bookings and no approval attribute, and decides this needs a step-up approval.',
  why: 'The policy says a booking needs a human to approve it. The agent cannot approve its own action.',
  refs: [r('RFC 7519', '4.1'), r('RFC 8725')],
  wire: none('Internal evaluation inside PingOne Authorize. Nothing is sent.'),
});
m('pdp', 'gw', 'DENY 401, WWW-Authenticate auth_challenge acr_values="ciba-approval"', true, {
  title: 'Verdict: DENY with a challenge to get approval',
  what: 'PingOne Authorize answers 401 with a WWW-Authenticate challenge that asks for the approval method ciba-approval (an acr value). It is a denial that says how to get to a yes.',
  why: 'A plain 403 would end the flow. A 401 with a challenge turns the denial into an instruction: ask the user, then try again.',
  refs: [r('RFC 9110', '15.5.2'), r('RFC 6750', '3'), r('OIDC Core 1.0', undefined, 'acr_values (authentication context class) section')],
  wire: { response: res('401 Unauthorized', ['WWW-Authenticate: Bearer error="auth_challenge", acr_values="ciba-approval"'], undefined, 'Illustrative: the chart gives the status and the acr_values only; the exact header layout is (not traced).') },
});
m('gw', 'gw', 'generate short code BK-XXXX', false, {
  title: 'The gateway makes a short code for the approval',
  what: 'The approval plugin generates a short, human-readable code such as BK-XXXX for this request.',
  why: 'The user will see the code on the other device and in the chat. Matching them shows they are approving the booking they asked for, not someone else\'s.',
  refs: [r('CIBA Core 1.0', undefined, 'binding_message: shown on both devices so the user can match them')],
  wire: none('Internal step inside the gateway plugin: it picks the code and keeps it with the request.'),
});
m('gw', 'as', 'POST /as/cibaAuthorization (client_id + client_secret) scope=openid, login_hint, binding_message=BK-XXXX', false, {
  title: 'The gateway starts a CIBA approval request',
  what: 'The plugin calls the CIBA backchannel authentication endpoint as a client, naming the user (login_hint), scope openid and the binding message BK-XXXX. PingOne will ask that user to approve on a separate device.',
  why: 'CIBA lets the approval happen on a different device from the one that started it. The user is not redirected anywhere; the request waits for them.',
  refs: [r('CIBA Core 1.0', undefined, 'Authentication request at the backchannel endpoint'), r('RFC 6749', '2.3')],
  wire: { request: req('POST', `${AS}/as/cibaAuthorization`, [FORM], 'client_id=approval-plugin-example&client_secret=secret-not-real&scope=openid&login_hint=user-123&binding_message=BK-XXXX', ILL) },
});
m('as', 'gw', 'auth_req_id + expires_in', true, {
  title: 'PingOne accepts the request',
  what: 'It returns an auth_req_id (the handle for this approval) and expires_in (how long the user has).',
  why: 'The handle is the only thing needed to ask later whether the user said yes. It is useless to anyone who cannot also prove the matching caller and request.',
  refs: [r('CIBA Core 1.0', undefined, 'Successful authentication request acknowledgement')],
  wire: { response: res('200 OK', [JSN, 'Cache-Control: no-store'], J({ auth_req_id: 'req-example-1', expires_in: 120, interval: 2 }), 'Illustrative values: the demo tenant uses a 120 s lifetime and a 2 s interval.') },
});
m('as', 'device', 'push: "Approve BK-XXXX"', false, {
  title: 'The user\'s other device gets a push to approve',
  what: 'PingOne sends a push notification to the user\'s enrolled device asking them to approve BK-XXXX.',
  why: 'A second device the agent cannot touch. The agent can ask but it cannot answer for the user.',
  refs: [r('CIBA Core 1.0', undefined, 'The server authenticates the user out of band')],
  wire: none('Delivered by the push service of PingOne. The payload is internal to the product (not traced).'),
});
m('gw', 'store', 'SET approval:request', false, {
  title: 'The gateway remembers what this approval is for',
  what: 'The plugin writes the request to a short-lived store: the auth_req_id bound to the user, the HTTP method, the path and a hash of the parameters.',
  why: 'Later the replay must match exactly what was approved. Binding the approval to the request stops it being used for a different booking.',
  refs: [r('CIBA Core 1.0', undefined, 'auth_req_id identifies the pending request')],
  wire: none('Not HTTP. A Redis write: SET approval:request, value {auth_req_id, sub, method, path, params_hash}, with an expiry matching expires_in.'),
});
m('store', 'gw', 'OK', true, {
  title: 'The store confirms the write',
  what: 'A plain OK from the Redis store.',
  why: 'The gateway does not go on until the record is safely stored, or the replay would have nothing to check against.',
  refs: [r('CIBA Core 1.0')],
  wire: none('Not HTTP. The store replies OK to the write.'),
});
m('gw', 'mcp', '401 approval_required {auth_req_id, code, expires_in}', true, {
  title: 'The gateway tells the MCP server approval is required',
  what: 'The gateway returns 401 with an approval_required body carrying the auth_req_id, the short code and expires_in. The original booking is not sent to the flights API.',
  why: 'The flights API was never called, so nothing was booked. The caller learns exactly how to proceed.',
  refs: [r('RFC 9110', '15.5.2'), r('RFC 6750', '3')],
  wire: { response: res('401 Unauthorized', [JSN], J({ error: 'approval_required', auth_req_id: 'req-example-1', code: 'BK-XXXX', expires_in: 120 }), ILL) },
});
m('mcp', 'aigate', 'tools/call isError=true _meta[com.example/approval]: requestState, code, expiresIn', true, {
  title: 'The MCP server returns the approval request as a tool error',
  what: 'The server turns the 401 into an MCP tool result with isError set and the approval details in the result\'s _meta: the request state, the code and expiresIn.',
  why: 'MCP has no "approval needed" result, so it is carried as metadata on an error. The agent runtime recognises it and does not treat it as a failure.',
  refs: [r('MCP')],
  wire: { response: res('200 OK', [JSN], J({ jsonrpc: '2.0', id: 2, result: { isError: true, content: [{ type: 'text', text: 'Approval required' }], _meta: { 'com.example/approval': { requestState: 'req-example-1', code: 'BK-XXXX', expiresIn: 120 } } } }), '') },
});
m('aigate', 'agent', 'forwarded verbatim', true, {
  title: 'The AI gateway returns it unchanged',
  what: 'The gateway passes the error result, with its _meta, to the agent runtime unchanged.',
  why: 'The gateway must not hide or rewrite an approval request; the runtime needs the exact details.',
  refs: [r('MCP')],
  wire: { response: res('200 OK', [JSN], J({ jsonrpc: '2.0', id: 2, result: { isError: true, _meta: { 'com.example/approval': { requestState: 'req-example-1', code: 'BK-XXXX', expiresIn: 120 } } } }), 'Body shortened.') },
});
m('agent', 'user', 'SSE approval_required [code: BK-XXXX, reference: auth_req_id]', true, {
  title: 'The agent tells the chat widget approval is needed',
  what: 'The runtime sends an approval_required event with the code and the reference to the chat widget. It keeps the tool call open and the model is told nothing yet.',
  why: 'The chat shows a card with the same code that is on the user\'s other device. The model is not part of this exchange, so it cannot approve or talk around it.',
  refs: [r('CIBA Core 1.0', undefined, 'binding_message: the code the user matches')],
  wire: { response: res('200 OK', [SSE], 'event: approval_required\ndata: {"code":"BK-XXXX","reference":"req-example-1"}\n\n', ILL) },
});

// ---- Phase 3: replay and polling (messages 38-63) -------------------------------------------------------------------------------------------
m('agent', 'aigate', 'tools/call create_booking + approval: auth_req_id', false, {
  title: 'The agent retries the booking, naming the approval',
  what: 'The runtime repeats the create_booking call and adds the auth_req_id as an approval argument.',
  why: 'The retry carries the handle, not a verdict. Whether the user approved is checked against PingOne, never taken from the agent.',
  refs: [r('MCP'), r('CIBA Core 1.0', undefined, 'auth_req_id is the handle for the pending request')],
  wire: { request: req('POST', `${GW}/mcp`, [JSN, bearer('gateway-token-example')], rpcCall(3, 'create_booking', { flight: 'FL-100', passengers: [{ name: 'Alex Example' }], approval: 'req-example-1' }), ILL), tokens: [gatewayToken] },
});
m('aigate', 'mcp', 'POST /mcp', false, {
  title: 'The gateway forwards the retry',
  what: 'The AI gateway validates the token again and forwards the request to the Flight MCP server.',
  why: 'Every call is checked from scratch; a retry gets no shortcut.',
  refs: [r('MCP'), r('RFC 9110', '9.3.3')],
  wire: { request: req('POST', `${MCPH}/mcp`, [JSN, bearer('gateway-token-example')], rpcCall(3, 'create_booking', { flight: 'FL-100', approval: 'req-example-1' }), 'Body shortened.') },
});
m('mcp', 'as', 'RFC 8693 token exchange again (fresh upstream token, scope = flights-api)', false, {
  title: 'Another token exchange for the replay',
  what: 'The server exchanges the user\'s token once more for a fresh upstream token with audience API gateway and scope flights-api.',
  why: 'The earlier upstream token was for the first attempt. A new short-lived one is cheap and means nothing stale is replayed.',
  refs: [r('RFC 8693', '2.1')],
  wire: { request: req('POST', `${AS}/as/token`, [FORM, BASIC], exchangeBody(), ILL) },
});
m('as', 'mcp', 'scoped upstream token', true, {
  title: 'A fresh upstream token comes back',
  what: 'A new access token for the API gateway.',
  why: 'Same user, same audience, new lifetime.',
  refs: [r('RFC 8693', '2.2.1'), r('RFC 6749', '5.1')],
  wire: { response: exchangeResp, tokens: [upstreamToken] },
});
m('mcp', 'gw', 'POST /bookings + x-ciba-approval: auth_req_id', false, {
  title: 'The replay reaches the API gateway with the approval handle',
  what: 'POST /bookings again, now with an x-ciba-approval header carrying the auth_req_id. The server reads the approval argument from the tool call and sets the header on this hop.',
  why: 'The header is how the approval handle gets to the gateway. The gateway will check it; it does not trust it.',
  refs: [r('RFC 9110', '9.3.3'), r('CIBA Core 1.0')],
  wire: { request: req('POST', `${APIGW}/bookings`, [JSN, bearer('upstream-token-example'), 'x-ciba-approval: req-example-1'], J({ flight: 'FL-100', passengers: [{ name: 'Alex Example' }] })), tokens: [upstreamToken] },
});
m('gw', 'store', 'GET approval:request', false, {
  title: 'The gateway looks up the stored request',
  what: 'The plugin reads the record it stored in phase 2 for this auth_req_id.',
  why: 'The stored record is the ground truth of what was asked for. The replay is compared with it.',
  refs: [r('CIBA Core 1.0')],
  wire: none('Not HTTP. A Redis read of approval:request for the auth_req_id.'),
});
m('store', 'gw', 'binding {sub, method, path, params_hash}', true, {
  title: 'The store returns what was approved',
  what: 'The record: the user, the HTTP method, the path and a hash of the parameters.',
  why: 'Everything needed to prove the replay is the same request as the one the user was asked about.',
  refs: [r('CIBA Core 1.0')],
  wire: none('Not HTTP. The Redis store returns the stored binding.'),
});
m('gw', 'gw', 'verify sub + method + path + body hash match', false, {
  title: 'The gateway checks the replay matches the approved request',
  what: 'The plugin compares the user, method, path and the hash of the body of the replay with the stored binding.',
  why: 'Without this, an approval for one booking could be used for another one. Any mismatch ends the flow.',
  refs: [r('CIBA Core 1.0'), r('RFC 9110', '15.5.4')],
  wire: none('Internal comparison inside the gateway plugin. Nothing is sent.'),
});
m('gw', 'as', 'POST token endpoint (client_id + client_secret) grant_type=urn:openid:params:grant-type:ciba, auth_req_id', false, {
  title: 'The gateway asks PingOne if the user approved',
  what: 'The plugin polls the token endpoint with the CIBA grant type and the auth_req_id, authenticating as the same client that started the request. It repeats at an interval, up to a hold time.',
  why: 'The user\'s answer exists only at PingOne. Polling is how the gateway learns it without any callback into the demo.',
  refs: [r('CIBA Core 1.0', undefined, 'Token request in poll mode'), r('RFC 6749', '3.2')],
  wire: { request: req('POST', `${AS}/as/token`, [FORM], `grant_type=${CIBA}&auth_req_id=req-example-1&client_id=approval-plugin-example&client_secret=secret-not-real`, ILL) },
});
m('device', 'as', 'approve BK-XXXX', false, {
  title: 'The user approves on the other device',
  what: 'The user opens the push, sees BK-XXXX and the booking, and approves it. The device tells PingOne.',
  why: 'This is the human decision. It happens outside the chat and outside the agent, so the model cannot forge it.',
  refs: [r('CIBA Core 1.0', undefined, 'Out-of-band user authentication and consent')],
  wire: none('Happens inside PingOne\'s own mobile flow. The messages are internal to the product (not traced).'),
});
m('as', 'gw', '200 access_token + id_token (approved)', true, {
  title: 'PingOne answers: approved',
  what: 'The token endpoint returns 200 with an access token and an ID token. They only mean "the user approved".',
  why: 'The gateway does not use these tokens for anything. The only thing that matters is that they were issued, which proves approval.',
  refs: [r('CIBA Core 1.0', undefined, 'Successful token response'), r('RFC 6749', '5.1')],
  wire: { response: res('200 OK', [JSN, 'Cache-Control: no-store'], J({ access_token: 'approval-token-example', token_type: 'Bearer', expires_in: 300, id_token: 'id-token-example' }), ILL), tokens: [tok('Token returned on approval (discarded by the gateway)', { sub: 'user-123', aud: 'approval-plugin-example', scope: 'openid' }, { focus: ['sub'], notes: { sub: 'Confirms which user approved.' } })] },
});
m('as', 'gw', 'authorization_pending', true, {
  title: 'PingOne answers: not yet',
  what: 'The token endpoint returns the error authorization_pending: the user has not answered.',
  why: 'Not an error to give up on. The gateway waits and asks again, until the hold time ends or the answer changes.',
  refs: [r('CIBA Core 1.0', undefined, 'authorization_pending in poll mode'), r('RFC 6749', '5.2')],
  wire: { response: res('400 Bad Request', [JSN], J({ error: 'authorization_pending' })) },
});
m('gw', 'gw', 'ngx.sleep(interval)', false, {
  title: 'The gateway waits one interval',
  what: 'The plugin pauses for the polling interval before asking again.',
  why: 'Polling too fast is rejected by PingOne; a pause keeps the loop polite.',
  refs: [r('CIBA Core 1.0', undefined, 'interval and slow_down in poll mode')],
  wire: none('Internal wait inside the gateway plugin. Nothing is sent.'),
});
m('gw', 'store', 'SET approval:spent', false, {
  title: 'The gateway marks the approval as used',
  what: 'The plugin writes a spent marker for this auth_req_id.',
  why: 'One approval is one booking. Without the marker the same approval could be replayed to book again.',
  refs: [r('CIBA Core 1.0')],
  wire: none('Not HTTP. A Redis write: SET approval:spent for the auth_req_id, with an expiry.'),
});
m('store', 'gw', 'OK', true, {
  title: 'The store confirms',
  what: 'A plain OK from the Redis store.',
  why: 'The marker is in place before the booking goes ahead.',
  refs: [r('CIBA Core 1.0')],
  wire: none('Not HTTP. The store replies OK to the write.'),
});
m('gw', 'gw', 'set upstream x-ciba-approval: approved', false, {
  title: 'The gateway sets approval = approved for the policy check',
  what: 'The plugin replaces whatever header the caller sent with its own trusted x-ciba-approval: approved value.',
  why: 'Callers can send any header they like. Only the gateway, which just checked the real answer, is allowed to say "approved".',
  refs: [r('CIBA Core 1.0'), r('RFC 9110')],
  wire: none('Internal header rewrite inside the gateway plugin. Nothing is sent.'),
});
m('gw', 'pdp', 'POST /sideband/request (policy re-evaluates)', false, {
  title: 'The gateway asks PingOne Authorize again',
  what: 'The same sideband request as in phase 2, now carrying the trusted x-ciba-approval: approved value.',
  why: 'The decision is still the policy engine\'s. The approval is just one more input it can read.',
  refs: [r('RFC 7662', '2.1')],
  wire: { request: req('POST', `${PDP}/sideband/request`, [JSN, bearer('gateway-client-token-example')], J({ method: 'POST', path: '/bookings', headers: { authorization: 'Bearer upstream-token-example', 'x-ciba-approval': 'approved' } }), ILL) },
});
m('pdp', 'pdp', 'policy: x-ciba-approval == "approved"', false, {
  title: 'The policy now finds the approval',
  what: 'The booking policy checks the x-ciba-approval attribute, finds approved, and allows the write.',
  why: 'The same rule that stopped the first attempt now lets this one through. It never changed; the input did.',
  refs: [r('RFC 7519', '4.1')],
  wire: none('Internal evaluation inside PingOne Authorize. Nothing is sent.'),
});
m('pdp', 'gw', 'PERMIT (x-ciba-approval == "approved")', true, {
  title: 'Verdict: PERMIT',
  what: 'PingOne Authorize tells the gateway to let the booking through.',
  why: 'Now the gateway is allowed to forward the write.',
  refs: [r('RFC 9110', '15.3.1')],
  wire: { response: res('200 OK', [JSN], J({ decision: 'PERMIT' }), ILL) },
});
m('gw', 'api', 'POST /bookings', false, {
  title: 'The gateway creates the booking',
  what: 'The original POST /bookings goes to the flights API.',
  why: 'The write happens only after approval, a matching replay and a policy PERMIT.',
  refs: [r('RFC 9110', '9.3.3')],
  wire: { request: req('POST', `${API}/bookings`, [JSN], J({ flight: 'FL-100', passengers: [{ name: 'Alex Example' }] })) },
});
m('api', 'gw', '201 reservation', true, {
  title: 'The flights API confirms the reservation',
  what: 'A 201 Created with the reservation.',
  why: 'The booking exists. Everything before this was about being allowed to do it.',
  refs: [r('RFC 9110', '15.3.2')],
  wire: { response: res('201 Created', [JSN], J({ reservation: 'RES-9001', flight: 'FL-100', status: 'confirmed' }), 'Example data only.') },
});
m('gw', 'mcp', '201', true, {
  title: 'The API gateway returns the 201',
  what: 'The gateway passes the 201 response to the Flight MCP server.',
  why: 'On success the gateway is transparent again.',
  refs: [r('RFC 9110', '15.3.2')],
  wire: { response: res('201 Created', [JSN], J({ reservation: 'RES-9001' })) },
});
m('mcp', 'aigate', 'tools/call success result', true, {
  title: 'The MCP server returns a success result',
  what: 'The server wraps the reservation as a normal tools/call result.',
  why: 'From here on the call looks like any successful tool call.',
  refs: [r('MCP')],
  wire: { response: res('200 OK', [JSN], rpcOk(3, 'Booked: RES-9001 on FL-100')) },
});
m('aigate', 'agent', 'result', true, {
  title: 'The AI gateway returns the result',
  what: 'The gateway passes the success result to the agent runtime.',
  why: 'The held tool call finally completes.',
  refs: [r('MCP')],
  wire: { response: res('200 OK', [JSN], rpcOk(3, 'Booked: RES-9001 on FL-100')) },
});
m('agent', 'user', 'SSE approval_result + tool_result - card clears', true, {
  title: 'The chat widget clears the approval card',
  what: 'The runtime sends approval_result and tool_result events. The card with BK-XXXX goes away.',
  why: 'The user sees the approval was accepted and the tool ran.',
  refs: [r('MCP')],
  wire: { response: res('200 OK', [SSE], 'event: approval_result\ndata: {"code":"BK-XXXX","result":"approved"}\n\nevent: tool_result\ndata: {"name":"create_booking","ok":true}\n\n', ILL) },
});
m('agent', 'user', 'final text: booking confirmed', true, {
  title: 'The agent tells the user the booking is confirmed',
  what: 'The model writes the final answer, which is streamed as text to the chat widget.',
  why: 'This ends the approved path. The model learned the outcome only now.',
  refs: [r('MCP')],
  wire: { response: res('200 OK', [SSE], 'event: text\ndata: Your flight FL-100 is booked. Reservation RES-9001.\n\n', ILL) },
});

// ---- Closing alt: not approved (messages 64-71) --------------------------------------------------------------------------------------------
m('gw', 'as', 'poll', false, {
  title: 'The gateway polls again',
  what: 'Another poll of the token endpoint for the same auth_req_id. In the chart this and the next messages are drawn greyed out, as the branches that are not the happy path.',
  why: 'Poll results other than "approved" decide what the caller is told next.',
  refs: [r('CIBA Core 1.0', undefined, 'Token request in poll mode')],
  wire: { request: req('POST', `${AS}/as/token`, [FORM], `grant_type=${CIBA}&auth_req_id=req-example-1&client_id=approval-plugin-example&client_secret=secret-not-real`, ILL) },
});
m('as', 'gw', 'access_denied or expired_token', true, {
  title: 'PingOne answers: denied or expired',
  what: 'The user said no, or the time ran out. The token endpoint returns access_denied or expired_token.',
  why: 'Final answers. The gateway stops polling and the booking is never made.',
  refs: [r('CIBA Core 1.0', undefined, 'access_denied and expired_token errors'), r('RFC 6749', '5.2')],
  wire: { response: res('400 Bad Request', [JSN], J({ error: 'access_denied' }), 'expired_token has the same shape.') },
});
m('gw', 'mcp', '403 approval_denied / approval_expired', true, {
  title: 'The gateway tells the MCP server: denied or expired',
  what: 'A 403 with approval_denied or approval_expired. Nothing is sent to the flights API.',
  why: 'A 403 is final: the caller must not retry the same approval.',
  refs: [r('RFC 9110', '15.5.4')],
  wire: { response: res('403 Forbidden', [JSN], J({ error: 'approval_denied' }), 'approval_expired has the same shape.') },
});
m('mcp', 'aigate', 'isError, no approval _meta', true, {
  title: 'The MCP server returns a plain tool error',
  what: 'An MCP result with isError set and no approval metadata. In the chart the hop from the AI gateway back to the agent is not drawn for this branch.',
  why: 'With no approval metadata the agent runtime knows this is the end, not a request to try again.',
  refs: [r('MCP')],
  wire: { response: res('200 OK', [JSN], J({ jsonrpc: '2.0', id: 3, result: { isError: true, content: [{ type: 'text', text: 'Approval denied or expired' }] } }), ILL) },
});
m('agent', 'user', 'loop stops, model explains the outcome', true, {
  title: 'The agent stops and explains',
  what: 'The runtime ends the retry loop and the model tells the user the booking was not approved or the request expired.',
  why: 'The user gets a clear answer rather than a hang.',
  refs: [r('MCP')],
  wire: { response: res('200 OK', [SSE], 'event: text\ndata: The approval was declined or expired, so I did not book the flight.\n\n', ILL) },
});
m('gw', 'mcp', '401 approval_pending', true, {
  title: 'The gateway tells the MCP server: still pending',
  what: 'The user has not answered yet. The gateway returns 401 approval_pending (the chart shows this as the second branch of the closing alt).',
  why: 'Pending is not a failure. The caller may try again until the deadline.',
  refs: [r('RFC 9110', '15.5.2'), r('CIBA Core 1.0', undefined, 'authorization_pending in poll mode')],
  wire: { response: res('401 Unauthorized', [JSN], J({ error: 'approval_pending' }), ILL) },
});
m('mcp', 'aigate', 'isError + _meta pending: true', true, {
  title: 'The MCP server returns a pending result',
  what: 'An MCP tool result with isError set and _meta marking the approval as pending.',
  why: 'The runtime reads the pending flag and keeps waiting instead of giving up.',
  refs: [r('MCP')],
  wire: { response: res('200 OK', [JSN], J({ jsonrpc: '2.0', id: 3, result: { isError: true, _meta: { 'com.example/approval': { pending: true } } } }), ILL) },
});
m('agent', 'aigate', 'replay again with same auth_req_id (until deadline from expiresIn)', false, {
  title: 'The agent replays the call with the same approval handle',
  what: 'The runtime sends create_booking again with the same auth_req_id, until the deadline given by expiresIn. The chart draws this arrow from the agent runtime to the AI gateway.',
  why: 'Retrying with the same handle lets the user take their time without the model being involved, and it ends at a fixed deadline.',
  refs: [r('MCP'), r('CIBA Core 1.0')],
  wire: { request: req('POST', `${GW}/mcp`, [JSN, bearer('gateway-token-example')], rpcCall(4, 'create_booking', { flight: 'FL-100', approval: 'req-example-1' }), ILL) },
});


// ---- Bands, frames and notes, by message index (0-based) -------------------------------------------------------------------------------------
const BANDS = [
  { from: 0, to: 17, rgb: '230, 240, 255', over: ['user', 'api'], title: 'Phase 1 - Search (no approval)' },
  { from: 18, to: 36, rgb: '255, 243, 223', over: ['user', 'device'], title: 'Phase 2 - Booking write: PAZ requires approval' },
  { from: 37, to: 62, rgb: '225, 250, 232', over: ['agent', 'api'], title: 'Phase 3 - replay and polling' },
];
const FRAMES = [
  { kind: 'loop', title: 'poll every interval, up to hold_seconds', from: 45, to: 49 },
  { kind: 'alt', title: 'user approves', from: 46, to: 49, elseAt: 48, elseTitle: 'still pending' },
  { kind: 'alt', title: 'denied or expired', from: 63, to: 70, elseAt: 68, elseTitle: 'still pending' },
];
const NOTES = [
  { at: 24, over: ['gw'], text: 'approval plugin (priority 1001): protected call, no approval header' },
  { at: 34, over: ['mcp'], text: 'ApprovalRequiredError caught by withApproval' },
  { at: 36, over: ['agent'], text: 'tool call held open - model sees nothing yet' },
  { at: 36, over: ['user'], text: 'card: "Approve request BK-XXXX on your other device"' },
  { at: 41, over: ['mcp'], text: 'argsApproval reads the approval argument, sets header on the gateway hop' },
  { at: 42, over: ['gw'], text: 'replay path: caller-supplied trusted headers stripped' },
  { at: 50, over: ['gw'], text: 'plugin discards the returned tokens - only the approval verdict matters' },
];

// ---- The Mermaid source ----------------------------------------------------------------------------------------------------------------------
// Built from the same message table as the step details, so the picture and the details cannot disagree. The result is plain Mermaid
// `sequenceDiagram` text (what parseSequence reads), in the pocFlow.js style.
const out = [];
const put = (t) => out.push(`    ${t}`);
put('autonumber');
for (const [id, label, role] of PARTICIPANTS) put(`participant ${id} as ${label}<br/>${role}`);
M.forEach((msg, i) => {
  for (const b of BANDS.filter((x) => x.from === i)) { put(`rect rgb(${b.rgb})`); put(`Note over ${b.over.join(',')}: ${b.title}`); }
  for (const f of FRAMES.filter((x) => x.from === i).sort((x, y) => y.to - x.to)) put(`${f.kind} ${f.title}`);
  for (const f of FRAMES.filter((x) => x.elseAt === i)) put(`else ${f.elseTitle}`);
  for (const n of NOTES.filter((x) => x.at === i)) put(`Note over ${n.over.join(',')}: ${n.text}`);
  put(`${msg.from}${msg.dashed ? '-->>' : '->>'}${msg.to}: ${msg.label}`);
  for (const f of FRAMES.filter((x) => x.to === i).sort((x, y) => y.from - x.from)) put('end');
  for (const b of BANDS.filter((x) => x.to === i)) put('end');
});
const SOURCE = `sequenceDiagram\n${out.join('\n')}\n`;

export const CIBA_APPROVAL_SOURCE = wrapMessages(SOURCE);

// ---- Role text for the movie reel's details row, per participant -----------------------------------------------------------------------------
export const CIBA_APPROVAL_DETAILS = {
  user: 'The person in the chat widget. Signs in with OpenID Connect (a DaVinci login), asks the agent to search and book, and approves the booking on another device. In this repo the demo UI plays this role.',
  agent: 'Agent runtime. Runs the model, makes the MCP tool calls, holds the call open while approval is pending and replays it with the auth_req_id. Lives outside this repo.',
  aigate: 'AI gateway. Validates the agent token (connection OAuth) and forwards MCP calls unchanged. ping-gateway/ in this repo is the PingGateway version of this role.',
  mcp: 'The flights MCP server. Exchanges the token (RFC 8693), calls the flights API through the API gateway, turns the approval 401 into an MCP tool error with _meta, and replays with x-ciba-approval. Lives outside this repo.',
  gw: 'API gateway with the approval and policy-check plugins. Asks PingOne Authorize for a verdict, starts CIBA on a challenge, remembers the request in Redis, checks the replay and polls PingOne. Lives outside this repo; ping-gateway/ shows the Authorize sideband side.',
  store: 'Redis, the approval store. approval:request binds the auth_req_id to user, method, path and a params hash; approval:spent marks it used. Lives outside this repo.',
  pdp: 'PingOne Authorize (PAZ). Decides every call: allows the search, answers the write with a 401 auth_challenge for ciba-approval, and permits the replay once x-ciba-approval is approved. In this repo demo_authz_server mocks it (routes/decision.js, routes/sideband.js).',
  as: 'PingOne (CIBA). Issues and exchanges tokens, runs CIBA backchannel authorization (/as/cibaAuthorization), collects the approval and answers the poll at /as/token. This repo uses it for UC22 (demo_api_server/services/cibaService.js).',
  device: 'Other device (push). Where the user sees BK-XXXX and approves. In this repo\'s PingOne setup the prompt is an email or SMS link through DaVinci, not a push.',
  api: 'flight-api, the protected flights API. Sees GET /flights and POST /bookings only after PERMIT. Lives outside this repo.',
};

// No boxes under the messages: 71 of them would bury the diagram. The wire text is in the step details.
export const CIBA_APPROVAL_PAYLOADS = [];

// ---- Per-message details ---------------------------------------------------------------------------------------------------------------------
// What this repository really does for a message, by message number (1-based). Added to `what`; the file is named in `source` where it exists.
const REPO = {
  5: 'The Ping gateway in this repo validates inbound tokens by introspection or, with ff_mcp_gateway_jwks on, locally by JWKS (signature, exp, iss, aud, scope); a failure is 401 invalid_token with a WWW-Authenticate Bearer challenge.',
  7: 'In this repo the gateway\'s exchange narrows with RFC 8707 resource= because PingOne ignores audience= when the client has grants on several resources.',
  10: 'This repo\'s gateway does the same with the stock PingAuthorizeFilter: it posts method, path, headers and client IP to the Authorize Sideband API (POST /sideband/request; mock in demo_authz_server). The approval plugin is outside this repo.',
  27: 'In this repo Authorize pauses a write as PERMIT with an unfulfilled obligation and the gateway answers 428 consent_pending. A 401 auth_challenge with acr_values is the approval plugin\'s, outside this repo.',
  29: 'The BFF makes the same call with client secret basic auth. There binding_message is limited to 8 characters (BK-XXXX fits) and acr_values is not forwarded: PingOne reads it as a DaVinci policy id.',
  30: 'In the demo tenant auth_req_id lives 120 s with a 2 s poll interval, and PingOne supports poll delivery only.',
  31: 'In this repo\'s PingOne setup the approval prompt is an email or SMS magic link through a DaVinci CIBA flow policy, not a push.',
  38: 'The repo\'s equivalent replay carries a _hitl_challenge_id receipt: the gateway strips it from the tool arguments and the authorization mock verifies it (UUID shape, then the HITL service, fail closed).',
  45: 'In this repo an approval is bound to the exact transaction (type, amount, accounts); without them the retry is challenged again.',
  46: 'The BFF polls the same way: POST /as/token with grant_type urn:openid:params:grant-type:ciba and client secret basic.',
  48: 'The BFF also validates the ID token: audience = that channel\'s app, subject = the signed-in user (a mismatch is 502 ciba_token_invalid).',
  49: 'The BFF treats authorization_pending as keep waiting, and slow_down (not drawn) as add 5 s up to 30 s.',
  54: 'In this repo this is the Sideband call again; the decision stays Authorize\'s.',
  65: 'The BFF treats access_denied and expired_token as final and stops polling.',
};
// The file in this repo that backs the message (only where the repo really has it).
const SOURCES = {
  5: 'ping-gateway/scripts/groovy/jwks-token-validation.groovy',
  7: 'ping-gateway/scripts/groovy/olb-token-exchange.groovy',
  10: 'demo_authz_server/routes/sideband.js',
  25: 'demo_authz_server/routes/sideband.js',
  27: 'demo_authz_server/routes/decision.js',
  29: 'demo_api_server/services/cibaService.js',
  30: 'demo_api_server/services/cibaService.js',
  31: 'docs/ciba-handoff.md',
  38: 'ping-gateway/scripts/groovy/mcp-request-validation.groovy',
  45: 'docs/ciba-handoff.md',
  46: 'demo_api_server/services/cibaService.js',
  48: 'demo_api_server/routes/ciba.js',
  49: 'demo_api_server/services/cibaService.js',
  54: 'demo_authz_server/routes/sideband.js',
  65: 'demo_api_server/services/cibaService.js',
};
// Real open questions only (the design or the chart leaves them unanswered).
const OPEN = {
  2: 'Is the agent identity service on-behalf-of exchange RFC 8693, or a vendor-specific variant?',
  27: 'What is the exact WWW-Authenticate layout the approval plugin and PingOne Authorize agree on?',
  31: 'The chart says push; this repo\'s PingOne path sends an email or SMS link. Which does the approval plugin target?',
};

const wireText = (first, headers, body) => [first, ...(headers || []), ...(body ? ['', body] : [])].join('\n');
const requestText = (r) => { const u = new URL(r.url); return wireText(`${r.method} ${u.pathname}${u.search} HTTP/1.1`, [`Host: ${u.host}`, ...(r.headers || [])], r.body); };
const responseText = (r) => wireText(`HTTP/1.1 ${r.status}`, r.headers, r.body);

export const CIBA_APPROVAL_STEP_DETAILS = M.map(({ step }, i) => {
  const n = i + 1;
  const w = step.wire || {};
  const notes = [w.request?.notice, w.response?.notice, w.notice].filter(Boolean);
  const what = [step.what, REPO[n], w.none, ...notes].filter(Boolean).join(' ');
  return {
    what,
    why: step.why,
    ...(OPEN[n] ? { open: OPEN[n] } : {}),
    ...(w.request ? { request: requestText(w.request) } : {}),
    ...(w.response ? { response: responseText(w.response) } : {}),
    ...(w.tokens?.length ? { tokens: w.tokens.map((t) => ({ label: t.label, header: t.header, payload: t.payload })) } : {}),
    refs: step.refs,
    ...(SOURCES[n] ? { source: SOURCES[n] } : {}),
  };
});
