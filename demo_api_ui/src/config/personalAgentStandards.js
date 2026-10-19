// Per-step detail for the Personal Agent design pages (/personal-agent-design and /personal-agent-dual-gateway),
// keyed by the step key used in components/personalAgent/personalAgentData.js (TEXT). The page folds each entry
// into STEPS[i].detail = { form, tokens, refs } for StaticFlowDiagram with pingStyle.
// Everything is a MOCK teaching value: placeholders such as <access token>, never a real secret or JWT literal.
// Endpoint paths come from the repo where it pins them (PingOne /as/token, /as/bc-authorize and the Authorize
// decisionEndpoints call; Privilege /agent-gateway/mcp; PingGateway :8080 /mcp). The airline hosts are fictional.
// Where the page's own text marks something as an assumption (DPoP on PingOne, Privilege passthrough), the form says so.
// Vocabulary: pingStyleStandards.js.
import { AUTH, BEARER, EXCHANGE, MCP, INTROSPECT, AUTHZ, STEPUP, RFC, SPEC } from "./pingStyleStandards";

// Ping groups for the page. Red = Ping products, dark = what the team builds and the traveller side, grey = outside.
export const PA_GROUPS = {
  traveller: { label: "Traveller", bg: "#151a24" },
  llm: { label: "LLM", bg: "#5a5f69" },
  team: { label: "Built by the team", bg: "#151a24" },
  ping: { label: "Ping identity and policy", bg: "#b5231a" },
  priv: { label: "Agent Privilege", bg: "#b5231a" },
  ag: { label: "Agent Gateway (PingGateway)", bg: "#b5231a" },
  existing: { label: "Existing airline systems", bg: "#5a5f69" },
};

const ISS = "https://auth.pingone.com/ENV_ID/as";
const MCP_AUD = "https://loyalty-mcp.airline.example";
const FACADE_AUD = "https://facade.airline.example";
const NOW = { iat: 1790000000, exp: 1790000300 };
const HEAD = { alg: "RS256", typ: "at+jwt", kid: "mock-key-1" };
const TOKEN_ENDPOINT = "POST https://auth.pingone.com/ENV_ID/as/token HTTP/1.1\nContent-Type: application/x-www-form-urlencoded";
const XCHG = "grant_type=urn:ietf:params:oauth:grant-type:token-exchange";
const AT = "urn:ietf:params:oauth:token-type:access_token";
const JWT = "urn:ietf:params:oauth:token-type:jwt";
const j = (o) => JSON.stringify(o, null, 2);

// Product-level standards: Ping products are not IETF or OpenID documents, so kind is "spec".
const AGENT_GATEWAY = SPEC("PingGateway MCP module (Agent Gateway)", "Resource-server checks, protected-resource metadata and policy call in front of the MCP server");
const PRIVILEGE = SPEC("PingOne Agent Privilege", "Front door for AI clients: claims-based allow, approval, guardrails and recording");
const AUTHORIZE = SPEC("PingOne Authorize", "Policy decision per call: decisionEndpoints with Trust Framework parameters");
const P1_CIBA = SPEC("PingOne CIBA", "POST /as/bc-authorize, then the CIBA grant on /as/token");
const HTTP = RFC(9110, "HTTP semantics");
const COOKIE = RFC(6265, "HTTP state management (the BFF session cookie)");
const JWT_RFC = RFC(7519, "JSON Web Token (jti identifies one token)");
const JWT_AT = BEARER[2];
const DPOP = BEARER[1];
const RESOURCE = EXCHANGE[1];
const TX_TOKENS = EXCHANGE[2];
const CLIENT_META = MCP[4];

// The traveller's sign-in token as the chat agent holds it (BFF session store, never in the browser or the model).
const MEMBER_TOKEN = {
  note: "Member sign-in token · issued to the chat agent, kept in the BFF",
  header: HEAD,
  claims: { iss: ISS, sub: "member-1042", aud: "chat-agent-client", client_id: "chat-agent-client", scope: "openid profile loyalty", iat: 1790000000, exp: 1790003600 },
};
const AGENT_ASSERTION = {
  note: "Agent assertion · signed with the agent's key (the actor_token)",
  header: { alg: "ES256", kid: "agent-key-1" },
  claims: { iss: "chat-agent-client", sub: "chat-agent-client", aud: ISS, jti: "<unique id>", iat: 1790000000, exp: 1790000060 },
};
// What the Ping token service returns for the first exchange: one audience, one tool family, minutes, member + agent.
const DELEGATED = {
  note: "Delegated token · for the MCP server only, one tool family",
  header: HEAD,
  claims: { iss: ISS, sub: "member-1042", aud: MCP_AUD, scope: "loyalty:search", client_id: "chat-agent-client", act: { sub: "chat-agent-client" }, cnf: { jkt: "<thumbprint of the agent key>" }, jti: "tok-7f3a", ...NOW },
};
const FACADE_TOKEN = {
  note: "Facade token · nested actor chain, scope only narrower",
  header: HEAD,
  claims: { iss: ISS, sub: "member-1042", aud: FACADE_AUD, scope: "loyalty:search", client_id: "loyalty-mcp-client", act: { sub: "loyalty-mcp-client", act: { sub: "chat-agent-client" } }, jti: "tok-9c21", ...NOW },
};
const MCP_ASSERTION = {
  note: "MCP server assertion · signed with the MCP server's own key (the actor_token)",
  header: { alg: "ES256", kid: "mcp-key-1" },
  claims: { iss: "loyalty-mcp-client", sub: "loyalty-mcp-client", aud: ISS, jti: "<unique id>", iat: 1790000000, exp: 1790000060 },
};

const CALL = (host, path, auth, tool, args) =>
  `POST ${path} HTTP/1.1\nHost: ${host}\nAuthorization: ${auth}\nDPoP: <proof signed with the agent key>\nContent-Type: application/json\n\n${j({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: tool, arguments: args } })}`;

const SEARCH_ARGS = { origin: "SFO", destination: "LHR", date: "2026-11-12" };

export const PA_STEP_DETAIL = {
  ask: {
    form: `POST /api/chat HTTP/1.1\nHost: chat.airline.example\nCookie: session=<chat session id>\nContent-Type: application/json\n\n${j({ message: "Find me a flight to London next month" })}\n\nNo token on this hop: only text and the BFF session cookie travel. The browser never holds an access token.`,
    tokens: [],
    refs: [HTTP, COOKIE],
  },
  signin: {
    form: `POST ${ISS.replace("/as", "")}/as/par HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\nclient_id=chat-agent-client&response_type=code&scope=openid profile loyalty\n&redirect_uri=https://chat.airline.example/callback&code_challenge=<S256 hash>&code_challenge_method=S256\n<- { "request_uri": "urn:ietf:params:oauth:request_uri:<id>", "expires_in": 60 }\n\nGET /as/authorize?client_id=chat-agent-client&request_uri=<request_uri>   (passkey or MFA, then the consent screen)\n\nThen, from the BFF:\n${TOKEN_ENDPOINT}\n\ngrant_type=authorization_code&code=<one-time code>&code_verifier=<PKCE secret>&client_id=chat-agent-client`,
    tokens: [
      MEMBER_TOKEN,
      { note: "ID token · proves who signed in", header: { alg: "RS256", kid: "mock-key-1" }, claims: { iss: ISS, sub: "member-1042", aud: "chat-agent-client", nonce: "<random nonce>", iat: 1790000000, exp: 1790000300 } },
    ],
    refs: AUTH,
  },
  model: {
    form: `POST /v1/messages HTTP/1.1   (chat agent to the company LLM gateway, then to Claude on Amazon Bedrock)\nContent-Type: application/json\n\n${j({ messages: [{ role: "user", content: "Find me a flight to London next month" }], tools: [{ name: "search_flights", description: "Search fares", input_schema: { type: "object" } }] })}\n\nThe reply names a tool and arguments: { "type": "tool_use", "name": "search_flights", "input": { ... } }\nNo token on this hop: the prompt carries text and the tool list only. Tokens and capability links in tool results are redacted before they come back here.`,
    tokens: [],
    refs: [HTTP, MCP[0]],
  },
  exchange1: {
    form: `${TOKEN_ENDPOINT}\n\n${XCHG}\n&subject_token=<member sign-in token>\n&subject_token_type=${AT}\n&actor_token=<agent assertion signed with the agent key>\n&actor_token_type=${JWT}\n&resource=${MCP_AUD}\n&scope=loyalty:search\n&client_id=chat-agent-client\n\nThe cnf.jkt binding is the design target. DPoP on the PingOne authorization server is not documented, so confirm the sender constraint (DPoP on PingFederate 13.1, or certificate-bound tokens) before relying on it.`,
    tokens: [MEMBER_TOKEN, AGENT_ASSERTION, DELEGATED],
    refs: [EXCHANGE[0], RESOURCE, RFC(7523, "JWT assertion format for the actor_token"), DPOP, JWT_AT, TX_TOKENS],
  },
  entryTarget: {
    form: `${CALL("agent-gateway.airline.example", "/loyalty/mcp", "DPoP <delegated token>", "search_flights", SEARCH_ARGS)}\n\n# A desktop AI app enters the same door with its own registered identity and its own token:\nAuthorization: DPoP <that client's own token>   (client_id is its Client ID Metadata Document URL or a registered id)`,
    tokens: [
      DELEGATED,
      { note: "DPoP proof · one per request, signed with the agent key", header: { typ: "dpop+jwt", alg: "ES256", jwk: "<public key of the agent>" }, claims: { htm: "POST", htu: "https://agent-gateway.airline.example/loyalty/mcp", iat: 1790000100, jti: "<unique id>", ath: "<hash of the delegated token>" } },
    ],
    refs: [AGENT_GATEWAY, MCP[0], RFC(9728, "Protected Resource Metadata: where the client finds the authorization server"), DPOP, RESOURCE, JWT_AT, CLIENT_META],
  },
  entryDual: {
    form: `${CALL("privilege.airline.example", "/agent-gateway/mcp", "DPoP <delegated token>", "search_flights", SEARCH_ARGS)}\n\nPrivilege checks the token, recognises the agent as a non-human identity, applies the client's tool allowlist and any guardrails, records the session and passes the token and proof through untouched.\n\n# A desktop AI app enters the same door with its own registered identity:\nAuthorization: Bearer <that client's own token>`,
    tokens: [DELEGATED],
    refs: [PRIVILEGE, MCP[0], BEARER[0], DPOP, EXCHANGE[0], JWT_AT],
  },
  gatewayGap: {
    form: `GET /.well-known/oauth-protected-resource HTTP/1.1\nHost: ping-gateway:8080\n<- { "resource": "${MCP_AUD}", "authorization_servers": ["${ISS}"] }\n\n${CALL("ping-gateway:8080", "/mcp", "DPoP <delegated token, as received>", "search_flights", SEARCH_ARGS)}\n\nThe gateway verifies the signature against the issuer's JWKS, the audience, the expiry and the sender constraint. A failure is a 401 with a WWW-Authenticate challenge, never a warning.`,
    tokens: [DELEGATED],
    refs: [AGENT_GATEWAY, RFC(9728, "Protected Resource Metadata"), JWT_AT, JWT_RFC, RFC(7517, "JSON Web Key: the issuer's JWKS"), RFC(8705, "Certificate-bound tokens: the sender constraint available today"), DPOP],
  },
  policy: {
    form: `POST https://api.pingone.com/v1/environments/ENV_ID/decisionEndpoints/MCP_DECISION_ENDPOINT_ID HTTP/1.1\nAuthorization: Bearer <Authorize worker token>\nContent-Type: application/json\n\n${j({ parameters: { DecisionContext: "McpFirstTool", McpMethod: "tools/call", UserId: "member-1042", ToolName: "add_insurance", AgentClientId: "chat-agent-client", Arguments: { amount: 49, currency: "USD" } } })}\n\n<- ${j({ decision: "PERMIT", statements: [{ code: "mcp-tool-authorized" }] })}\n   or { "decision": "DENY" }, or a step-up statement that starts the approval. A timeout or an unreachable engine counts as DENY.\n\nThe call is made with the gateway's own worker token; the member and agent are parameters, read from the delegated token's sub and act.`,
    tokens: [
      { note: "Authorize worker token · the gateway's own client_credentials grant", header: HEAD, claims: { iss: ISS, aud: "https://api.pingone.com", client_id: "gateway-authorize-client", iat: 1790000000, exp: 1790003600 } },
      DELEGATED,
    ],
    refs: [AUTHORIZE, AUTHZ[0], AUTHZ[3], AUTHZ[2], AGENT_GATEWAY, RFC(6749, "Client credentials grant (section 4.4)")],
  },
  mcp: {
    form: `${CALL("loyalty-mcp.internal", "/mcp", "DPoP <delegated token>", "search_flights", SEARCH_ARGS)}\n\nThe server accepts traffic from the gateway only (network policy), then validates again: signature, aud = ${MCP_AUD}, scope loyalty:search for this tool. A token for another audience is a 401, and the inbound token is never forwarded.`,
    tokens: [DELEGATED],
    refs: [MCP[0], RESOURCE, JWT_AT, MCP[3], INTROSPECT[2], RFC(9700, "OAuth 2.0 Security BCP: audience restriction")],
  },
  exchange2: {
    form: `${TOKEN_ENDPOINT}\n\n${XCHG}\n&subject_token=<delegated token received from the gateway>\n&subject_token_type=${AT}\n&actor_token=<MCP server assertion signed with its own key>\n&actor_token_type=${JWT}\n&resource=${FACADE_AUD}\n&scope=loyalty:search\n&client_id=loyalty-mcp-client`,
    tokens: [DELEGATED, MCP_ASSERTION, FACADE_TOKEN],
    refs: [EXCHANGE[0], RESOURCE, RFC(7523, "JWT assertion format for the actor_token"), JWT_AT, TX_TOKENS],
  },
  facade: {
    form: `POST /v1/search HTTP/1.1\nHost: facade.airline.example\nAuthorization: Bearer <facade token>\nContent-Type: application/json\n\n${j(SEARCH_ARGS)}\n\nThen the facade asks the session service for an agent session:\nPOST /sessions HTTP/1.1\nAuthorization: Bearer <facade token>\n<- { "session": "<opaque member session id>", "actors": ["loyalty-mcp-client", "chat-agent-client"], "tools": "search" }`,
    tokens: [
      FACADE_TOKEN,
      { note: "Agent session · opaque in practice; claims as the session service records them", claims: { sub: "member-1042", actors: ["loyalty-mcp-client", "chat-agent-client"], tool_family: "search", via: "agent", exp: 1790000300 } },
    ],
    refs: [BEARER[0], JWT_AT, EXCHANGE[0], RESOURCE, COOKIE],
  },
  ciba: {
    form: `POST https://auth.pingone.com/ENV_ID/as/bc-authorize HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\nclient_id=chat-agent-client&login_hint=<PingOne user id>\n&scope=loyalty:purchase&binding_message=BK-3F9A9\n<- { "auth_req_id": "<opaque id>", "expires_in": 120, "interval": 5 }\n\nThe push on the phone names the product, the amount and the cart. The agent then polls:\n${TOKEN_ENDPOINT}\n\ngrant_type=urn:openid:params:grant-type:ciba&auth_req_id=<opaque id>&client_id=chat-agent-client\nNo answer in the window is a denial and the agent stops. PingOne limits binding_message to 8 characters, so the cart detail rides in the approval record, not the message.`,
    tokens: [
      { note: "Approval token · single use, bound to this purchase", header: HEAD, claims: { iss: ISS, sub: "member-1042", aud: MCP_AUD, scope: "loyalty:purchase", act: { sub: "chat-agent-client" }, authorization_details: [{ type: "purchase", cart: "cart-5521", amount: "49.00", currency: "USD" }], jti: "tok-ap01", ...NOW } },
    ],
    refs: [...STEPUP.slice(0, 1), P1_CIBA, RFC(9396, "Rich Authorization Requests: the purchase carried in the token"), RFC(9470, "Step-up authentication challenge"), STEPUP[2]],
  },
  checkout: {
    form: `GET /checkout?cart=<cart reference> HTTP/1.1\nHost: www.airline.example\nCookie: session=<member's own web session>\n\nThe cart reference is an opaque id: single use, five minutes, bound to cart-5521. Without the member's own session cookie the page demands a sign-in and step-up first.\nNo OAuth token is involved: the link is a reference, not a credential, and the model never sees a card.`,
    tokens: [],
    refs: [HTTP, COOKIE, RFC(9470, "Step-up authentication challenge at landing"), RFC(9700, "OAuth 2.0 Security BCP: no credential in a URL")],
  },
  auditTarget: {
    form: `POST /siem/events HTTP/1.1\nContent-Type: application/json\n\n${j({ ts: "2026-10-19T09:14:02Z", jti: "tok-7f3a", member: "member-1042", agent: "chat-agent-client", client: "chat-agent-client", tool: "add_insurance", arguments: { amount: 49 }, verdict: "step-up", approval: "ap01" })}\n\nOne record per action. The agent has no write path to the log. Policy verdicts, Ping exchanges and facade calls join to it on jti.\nNo token is sent: the record carries only the token id (jti), never the token.`,
    tokens: [],
    refs: [JWT_RFC, EXCHANGE[0], JWT_AT, AGENT_GATEWAY, AUTHORIZE],
  },
  auditDual: {
    form: `Privilege record (session and tool activity):\n${j({ jti: "tok-7f3a", client: "chat-agent-client", tool: "add_insurance", guardrail: "pass" })}\n\nAgent Gateway record (verdict and actor chain):\n${j({ jti: "tok-7f3a", member: "member-1042", act: ["chat-agent-client"], verdict: "step-up" })}\n\nBoth carry the token id, so the two stores join into one timeline. The agent can write to neither.\nNo token is sent: the records carry only the token id (jti), never the token.`,
    tokens: [],
    refs: [JWT_RFC, EXCHANGE[0], PRIVILEGE, AGENT_GATEWAY, AUTHORIZE],
  },
};
