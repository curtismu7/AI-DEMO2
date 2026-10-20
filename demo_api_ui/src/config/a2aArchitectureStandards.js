// Per-arrow detail for /a2a-architecture (pingStyle). Keyed by EDGES index; MOCK teaching values, no real secrets.
// Wire shapes follow demo_api_server: services/a2aDelegationService.js (Exchange #1 and #2), services/oauthService.js
// (performTokenExchangeAs body), services/a2aProtocolClient.js + a2aProtocolServer.js (SendMessage and the reply),
// middleware/a2aPingOneBearer.js (what the specialist checks on the bearer), services/pingOneAuthorizeService.js
// (the McpFirstTool decision parameters), routes/a2aAgentRoutes.js (POST /api/a2a/message).
import { RFC, SPEC, BEARER, CREDS, EXCHANGE, MCP, INTROSPECT } from './pingStyleStandards';

const HTTP = RFC(9110, 'HTTP semantics');
const COOKIE = RFC(6265, 'HTTP state management (the session cookie)');
const WELL_KNOWN = RFC(8615, 'Well-Known URIs (the Agent Card path)');
const JSONRPC = SPEC('JSON-RPC 2.0', 'Request and response envelope of the A2A JSON-RPC binding');
const A2A = (title) => SPEC('A2A Protocol 1.0', title);
const ACT = { ...EXCHANGE[0], title: 'OAuth 2.0 Token Exchange: subject_token, actor_token and the act claim (section 4.1), nested to record two agents' };

const json = (o) => JSON.stringify(o, null, 2);
const TOKEN_URL = 'https://auth.pingone.com/MOCK-ENV-ID/as/token';
const JWT_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ISS = 'https://auth.pingone.com/MOCK-ENV-ID/as';

// client_credentials as the apps send it: client_id and client_secret in the body (auth method 'post' is the default; 'basic' is selectable per app).
// The generalist names no audience (oauthService.getAiAgentClientCredentialsToken); a specialist names its intermediate audience
// and its own agent:invoke:<appKey> scope (getClientCredentialsTokenAs).
const CC_REQUEST = (clientId, extra) =>
  `POST ${TOKEN_URL} HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=client_credentials&client_id=${clientId}&client_secret=CLIENT_SECRET${extra}`;

// ---- MOCK decoded tokens, teaching values from the recorded run (docs/ACT_CLAIM_VERIFICATION.md) ----
const USER_TOKEN = {
  note: 'User access token · the SUBJECT of Exchange #1; it never leaves the BFF session',
  header: { alg: 'RS256', kid: 'mock-key-1' },
  claims: { iss: ISS, sub: 'user-1aee74ae', aud: ['enduser.ping.demo'], scope: 'ai:agent:read read transfer openid profile', acr: 'Agent-Consent-Login', exp: 1790003600 },
};
const GENERALIST_ACTOR = {
  note: 'Generalist actor token · client_credentials, names Agent 1 as the ACTOR',
  header: { alg: 'RS256', kid: 'mock-key-1' },
  claims: { iss: ISS, client_id: 'banking-agent-client', aud: ['agentgateway.ping.demo'], scope: 'agent:invoke', exp: 1790000300 },
};
const EXCHANGE1_TOKEN = {
  note: 'Exchange #1 token · delegated: sub is the user, act is the generalist',
  header: { alg: 'RS256', kid: 'mock-key-1' },
  claims: { iss: ISS, sub: 'user-1aee74ae', aud: ['a2a-intermediate-<appKey>.ping.demo'], scope: 'agent:invoke:<appKey>', act: { sub: 'banking-agent-client' }, exp: 1790000300 },
};
const SPECIALIST_ACTOR = {
  note: 'Specialist actor token · client_credentials, names Agent 2 as the ACTOR',
  header: { alg: 'RS256', kid: 'mock-key-1' },
  claims: { iss: ISS, client_id: '<appKey>-specialist-client', aud: ['a2a-intermediate-<appKey>.ping.demo'], scope: 'agent:invoke:<appKey>', exp: 1790000300 },
};
const EXCHANGE2_TOKEN = {
  note: 'Exchange #2 token · MCP token with the nested act chain, sub still the user',
  header: { alg: 'RS256', kid: 'mock-key-1' },
  claims: { iss: ISS, sub: 'user-1aee74ae', aud: ['mcpgateway-a2a.ping.demo'], scope: 'purchase:read', act: { sub: '<appKey>-specialist-client', act: { sub: 'banking-agent-client' } }, exp: 1790000300 },
};

const SEND_MESSAGE = `POST /a2a/specialists/:vertical HTTP/1.1
Host: api.ping.demo:3001
Authorization: Bearer <Exchange #1 access token>
A2A-Version: 1.0
Content-Type: application/json

${json({
  jsonrpc: '2.0',
  id: 1,
  method: 'SendMessage',
  params: {
    message: {
      messageId: '<uuid>',
      role: 'ROLE_USER',
      parts: [{ text: '<subtask text>', mediaType: 'text/plain' }],
      metadata: { vertical: '<vertical>', demoLayer: 'a2a-protocol-wire', tool: '<tool>', args: {}, tenant: '<tenant handle>' },
    },
  },
})}`;

// ---- Figure 1: delegation flow (EDGES 0..8) ----
export const DELEGATION_DETAIL = {
  0: {
    form: `POST /api/a2a/message HTTP/1.1\nCookie: session=SESSION_ID\nContent-Type: application/json\n\n${json({ message: 'hand off to a specialist to review the sensitive details', vertical: 'retail' })}\n\n# No token on this hop: the browser holds only the session cookie. The BFF keeps the user access token server-side.`,
    tokens: [],
    refs: [HTTP, COOKIE],
  },
  1: {
    form: `# 1. the generalist authenticates as itself (the ACTOR)\n${CC_REQUEST('banking-agent-client', '&scope=agent:invoke')}\n\n# 2. Exchange #1 at the PingOne token endpoint\nPOST ${TOKEN_URL} HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=${EXCHANGE_GRANT}\n&client_id=banking-agent-client\n&client_secret=CLIENT_SECRET\n&subject_token=<user access token>\n&subject_token_type=${JWT_TYPE}\n&actor_token=<generalist actor token>\n&actor_token_type=${JWT_TYPE}\n&requested_token_type=${JWT_TYPE}\n&audience=a2a-intermediate-<appKey>.ping.demo\n&scope=agent:invoke:<appKey>`,
    tokens: [USER_TOKEN, GENERALIST_ACTOR, EXCHANGE1_TOKEN],
    refs: [ACT, CREDS[0]],
  },
  2: {
    form: SEND_MESSAGE,
    tokens: [EXCHANGE1_TOKEN],
    refs: [A2A('SendMessage over the JSON-RPC binding with a bearer security scheme'), JSONRPC, BEARER[0], ACT, HTTP],
  },
  3: {
    form: `# 1. the specialist authenticates as itself (its own process, its own credentials)\n${CC_REQUEST('<appKey>-specialist-client', '&audience=a2a-intermediate-<appKey>.ping.demo&scope=agent:invoke:<appKey>')}\n\n# 2. Exchange #2 at the PingOne token endpoint\nPOST ${TOKEN_URL} HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=${EXCHANGE_GRANT}\n&client_id=<appKey>-specialist-client\n&client_secret=CLIENT_SECRET\n&subject_token=<Exchange #1 access token>\n&subject_token_type=${JWT_TYPE}\n&actor_token=<specialist actor token>\n&actor_token_type=${JWT_TYPE}\n&requested_token_type=${JWT_TYPE}\n&audience=mcpgateway-a2a.ping.demo\n&scope=<the tool's delegated scope, e.g. purchase:read>`,
    tokens: [EXCHANGE1_TOKEN, SPECIALIST_ACTOR, EXCHANGE2_TOKEN],
    refs: [ACT, CREDS[0]],
  },
  4: {
    form: `POST https://api.pingone.com/v1/environments/ENV_ID/decisionEndpoints/MCP_DECISION_ENDPOINT_ID HTTP/1.1\nAuthorization: Bearer AUTHORIZE_WORKER_ACCESS_TOKEN\nContent-Type: application/json\n\n${json({
      parameters: {
        DecisionContext: 'McpFirstTool',
        McpMethod: 'tools/call',
        UserId: 'USER_ID',
        ToolName: '<tool>',
        TokenAudience: 'mcpgateway-a2a.ping.demo',
        ActClientId: '<appKey>-specialist-client',
        NestedActClientId: 'banking-agent-client',
        ActChainDepth: 2,
        CallerType: 'agent_a2a',
      },
    })}\n\nHTTP/1.1 200 OK\n\n${json({ decision: 'PERMIT', statements: [{ code: 'mcp-tool-authorized' }] })}`,
    tokens: [EXCHANGE2_TOKEN],
    refs: [ACT, CREDS[0], BEARER[0]],
  },
  5: {
    form: `POST /mcp HTTP/1.1\nHost: mcpgateway-a2a.ping.demo\nAuthorization: Bearer <Exchange #2 access token>\nContent-Type: application/json\n\n${json({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: '<tool>', arguments: {} } })}`,
    tokens: [EXCHANGE2_TOKEN],
    refs: [MCP[0], BEARER[0], INTROSPECT[2], JSONRPC],
  },
  6: {
    form: `HTTP/1.1 200 OK (Agent Gateway to the specialist)\nContent-Type: application/json\n\n${json({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '<tool result>' }] } })}\n\n# No token comes back: only the tool result.`,
    tokens: [],
    refs: [MCP[0], JSONRPC, HTTP],
  },
  7: {
    form: `HTTP/1.1 200 OK (specialist to the generalist)\nContent-Type: application/json\n\n${json({
      jsonrpc: '2.0',
      id: 1,
      result: {
        message: {
          messageId: '<uuid>',
          role: 'ROLE_AGENT',
          parts: [{ text: '{"result":<tool result>,"toolError":null}', mediaType: 'text/plain' }],
          metadata: { vertical: '<vertical>', specialist: '<specialist name>', actChainDepth: 2, scopes: ['purchase:read'], toolError: null, demoLayer: 'a2a-protocol-wire' },
        },
      },
    })}\n\n# No access token crosses back over the A2A response: the reply carries the result and the chain facts.`,
    tokens: [],
    refs: [A2A('SendMessage reply: result.message with a text part and metadata'), JSONRPC, HTTP],
  },
  8: {
    form: `HTTP/1.1 200 OK (BFF to the browser)\nContent-Type: application/json\n\n${json({
      reply: 'Delegation complete: <specialist> retrieved <tool> with narrowed scope purchase:read (act-chain depth 2).',
      success: true,
      toolsCalled: ['orchestrate_delegation', 'delegate_to_specialist', '<tool>'],
      tokenEvents: ['a2a-protocol-bearer', 'a2a-agent-card', 'a2a-protocol-message'],
    })}\n\n# No token is returned: each token event carries decoded claims and the algorithm, never the raw access token.`,
    tokens: [],
    refs: [HTTP, COOKIE],
  },
};

// ---- Figure 2: card discovery (EDGES 0..2) ----
const CARD = {
  name: '<Specialist name>',
  version: '1.1.0',
  capabilities: { streaming: true, pushNotifications: false, extendedAgentCard: false },
  securitySchemes: { pingoneBearer: { httpAuthSecurityScheme: { scheme: 'Bearer', bearerFormat: 'JWT' } } },
  securityRequirements: [{ schemes: { pingoneBearer: { list: [] } } }],
  skills: [{ id: '<tool>', name: '<Tool>', tags: ['<vertical>', 'a2a'], inputModes: ['text/plain'], outputModes: ['text/plain'] }],
  supportedInterfaces: [{ url: 'https://api.ping.demo:3001/a2a/specialists/<vertical>', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
  signatures: [{ protected: '<base64url JOSE header: alg EdDSA, kid, jku, typ JOSE>', signature: '<base64url EdDSA signature over the canonicalized card>' }],
};

export const DISCOVERY_DETAIL = {
  0: {
    form: 'GET /a2a/specialists/:vertical/.well-known/agent-card.json HTTP/1.1\nHost: api.ping.demo:3001\n\n# Public by design, no Authorization header: the card is capability metadata and grants nothing.\n# A caller that does present a valid bearer also gets its tenant handle in the card interface.',
    tokens: [],
    refs: [A2A('Agent Card discovery at a well-known path'), WELL_KNOWN, HTTP],
  },
  1: {
    form: `HTTP/1.1 200 OK\nContent-Type: application/json\n\n${json(CARD)}\n\n# Abbreviated: description, provider, default input and output modes and per-skill requirements are left out.\n# Signature keys: GET /a2a/specialists/.well-known/jwks.json\n# No token on this hop: the card is signed metadata, not a credential.`,
    tokens: [],
    refs: [A2A('Agent Card: skills, interface and the pingoneBearer security scheme'), RFC(7515, 'JSON Web Signature (the card signature)'), RFC(8785, 'JSON Canonicalization Scheme (what is signed)'), INTROSPECT[3], HTTP],
  },
  2: {
    form: SEND_MESSAGE,
    tokens: [EXCHANGE1_TOKEN],
    refs: [A2A('SendMessage over the JSON-RPC binding with a bearer security scheme'), JSONRPC, BEARER[0], ACT, HTTP],
  },
};
