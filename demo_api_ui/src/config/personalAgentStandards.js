// Per-step detail for the Personal Agent design pages (/personal-agent-design and /personal-agent-dual-gateway),
// keyed by the step key used in components/personalAgent/personalAgentData.js (TEXT). The page folds each entry
// into STEPS[i].detail = { form, tokens, refs } for StaticFlowDiagram with pingStyle.
// Everything is a MOCK teaching value: placeholders such as <access token>, never a real secret or JWT literal.
// Endpoint paths come from the repo where it pins them (PingOne /as/token, /as/bc-authorize and the Authorize
// decisionEndpoints call; Privilege /agent-gateway/mcp; PingGateway :8080 /mcp). The airline hosts are fictional.
// The wire shows what PingOne issues today: bearer tokens, act.client_id, audience= on the exchange. DPoP / cnf is marked as the
// PingFederate-only target (docs/personal-agent: PingOne issues no DPoP and no mTLS binding).
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
const RESOURCE = EXCHANGE[1];
const CLIENT_META = MCP[4];
const DPOP_TARGET = RFC(9449, "DPoP: the target sender constraint on PingFederate 13.1 (PingOne issues bearer tokens only)");
const PRIVATE_KEY_JWT = RFC(7523, "JWT client authentication (private_key_jwt): the target for the exchanging client");
const LLM_API = SPEC("Anthropic Messages API", "Tool use: the reply names a tool_use block with its input");

const BEARER_NOTE = "PingOne issues bearer tokens: no DPoP and no mTLS binding. Audience, scope and a minutes-long life carry the load here.";

// The traveller's sign-in token as the chat agent holds it (BFF session store, never in the browser or the model).
const MEMBER_TOKEN = {
  note: "Member sign-in token · issued to the chat agent, kept in the BFF",
  header: HEAD,
  claims: { iss: ISS, sub: "member-1042", aud: "chat-agent-client", client_id: "chat-agent-client", scope: "openid profile loyalty", iat: 1790000000, exp: 1790003600 },
};
// The actor token PingOne wants: an access token already issued by the same environment, here from the agent app's client_credentials grant.
const AGENT_ACTOR_TOKEN = {
  note: "Agent actor token · the agent app's own client_credentials access token (the actor_token)",
  header: HEAD,
  claims: { iss: ISS, sub: "chat-agent-client", aud: "https://api.pingone.com", client_id: "chat-agent-client", iat: 1790000000, exp: 1790000600 },
};
// What the Ping token service returns for the first exchange: one audience, one tool family, minutes, member + agent.
const DELEGATED = {
  note: "Delegated token · for the MCP server only, one tool family, bearer",
  header: HEAD,
  claims: { iss: ISS, sub: "member-1042", aud: MCP_AUD, scope: "loyalty:search", client_id: "token-service-client", act: { client_id: "chat-agent-client" }, jti: "tok-7f3a", ...NOW },
};
const FACADE_TOKEN = {
  note: "Facade token · nested actor chain, scope only narrower",
  header: HEAD,
  claims: { iss: ISS, sub: "member-1042", aud: FACADE_AUD, scope: "loyalty:search", client_id: "token-service-client", act: { client_id: "loyalty-mcp-client", act: { client_id: "chat-agent-client" } }, jti: "tok-9c21", ...NOW },
};
const MCP_ACTOR_TOKEN = {
  note: "MCP server actor token · the MCP server app's own client_credentials access token (the actor_token)",
  header: HEAD,
  claims: { iss: ISS, sub: "loyalty-mcp-client", aud: "https://api.pingone.com", client_id: "loyalty-mcp-client", iat: 1790000000, exp: 1790000600 },
};

const CALL = (host, path, auth, tool, args) =>
  `POST ${path} HTTP/1.1\nHost: ${host}\nAuthorization: ${auth}\nContent-Type: application/json\n\n${j({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: tool, arguments: args } })}`;

const SEARCH_ARGS = { origin: "SFO", destination: "LHR", date: "2026-11-12" };

// The exchange is a server-side act by United's token service, a confidential client separate from the agent.
const EXCHANGE_FORM = (subject, actor, aud, scopeNote) =>
  `${TOKEN_ENDPOINT}\nAuthorization: Basic <token service client id and secret>\n\n${XCHG}\n&subject_token=${subject}\n&subject_token_type=${AT}\n&actor_token=${actor}\n&actor_token_type=${AT}\n&requested_token_type=${AT}\n&audience=${aud}\n&scope=loyalty:search\n\n${scopeNote}`;

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
    refs: [AUTH[0], AUTH[1], AUTH[3], AUTH[4], AUTH[2]],
  },
  model: {
    form: `POST /v1/messages HTTP/1.1   (chat agent to the company LLM gateway, then to Claude on Amazon Bedrock)\nContent-Type: application/json\n\n${j({ messages: [{ role: "user", content: "Find me a flight to London next month" }], tools: [{ name: "search_flights", description: "Search fares", input_schema: { type: "object" } }] })}\n\nThe reply names a tool and arguments: { "type": "tool_use", "name": "search_flights", "input": { ... } }\nNo token on this hop: the prompt carries text and the tool list only. Tokens and capability links in tool results are redacted before they come back here.`,
    tokens: [],
    refs: [HTTP, LLM_API],
  },
  exchange1: {
    form: EXCHANGE_FORM("<member sign-in token>", "<agent actor token>", MCP_AUD, `The agent never calls this endpoint: United's token service does, as a confidential client. The actor token must be an access token the same PingOne environment issued (the agent app's client_credentials grant). PingOne reads the single audience from audience=.\nTarget, not wired: the agent proving itself with a key (private_key_jwt) and a sender-constrained token (DPoP on PingFederate 13.1). ${BEARER_NOTE}`),
    tokens: [MEMBER_TOKEN, AGENT_ACTOR_TOKEN, DELEGATED],
    refs: [EXCHANGE[0], RESOURCE, PRIVATE_KEY_JWT, JWT_AT],
  },
  entryTarget: {
    form: `${CALL("agent-gateway.airline.example", "/loyalty/mcp", "Bearer <delegated token>", "search_flights", SEARCH_ARGS)}\n\n${BEARER_NOTE}\nTarget on PingFederate 13.1: the DPoP authorization scheme plus a proof header signed with the agent key.\n\n# A desktop AI app enters the same door with its own registered identity and its own token:\nAuthorization: Bearer <that client's own token>   (client_id is its Client ID Metadata Document URL or a registered id)`,
    tokens: [DELEGATED],
    refs: [AGENT_GATEWAY, MCP[0], RFC(9728, "Protected Resource Metadata: where the client finds the authorization server"), BEARER[0], RESOURCE, JWT_AT, DPOP_TARGET, CLIENT_META],
  },
  entryDual: {
    form: `${CALL("privilege.airline.example", "/agent-gateway/mcp", "Bearer <delegated token>", "search_flights", SEARCH_ARGS)}\n\nPrivilege checks the token, recognises the agent as a non-human identity, applies the client's tool allowlist and any guardrails, records the session and passes the token through untouched.\n\n# A desktop AI app enters the same door with its own registered identity:\nAuthorization: Bearer <that client's own token>`,
    tokens: [DELEGATED],
    refs: [PRIVILEGE, MCP[0], BEARER[0]],
  },
  gatewayGap: {
    form: `GET /.well-known/oauth-protected-resource HTTP/1.1\nHost: ping-gateway:8080\n<- { "resource": "${MCP_AUD}", "authorization_servers": ["${ISS}"] }\n\n${CALL("ping-gateway:8080", "/mcp", "Bearer <delegated token, as received>", "search_flights", SEARCH_ARGS)}\n\nThe gateway validates the token by introspection at the issuer (RFC 7662), or by signature against the issuer's JWKS in the variant selected by the X-Token-Validation header, then checks audience, expiry and scope. A failure is a 401 with a WWW-Authenticate challenge, never a warning.\n${BEARER_NOTE}`,
    tokens: [DELEGATED],
    refs: [AGENT_GATEWAY, RFC(9728, "Protected Resource Metadata"), INTROSPECT[0], JWT_AT, JWT_RFC, INTROSPECT[3], BEARER[0]],
  },
  policy: {
    form: `POST https://api.pingone.com/v1/environments/ENV_ID/decisionEndpoints/MCP_DECISION_ENDPOINT_ID HTTP/1.1\nAuthorization: Bearer <Authorize worker token>\nContent-Type: application/json\n\n${j({ parameters: { DecisionContext: "McpFirstTool", McpMethod: "tools/call", UserId: "member-1042", ToolName: "add_insurance", ActClientId: "chat-agent-client", CallerType: "agent", ClientId: "token-service-client", TokenAudience: MCP_AUD, TokenScopes: "loyalty:search", Amount: 49 } })}\n\n<- ${j({ decision: "PERMIT", statements: [{ code: "mcp-tool-authorized" }] })}\n   or { "decision": "DENY" }, or a step-up statement that starts the approval. A timeout or an unreachable engine counts as DENY.\n\nThe call is made with the gateway's own worker token; the member and agent are parameters, read from the delegated token (sub, and act.client_id as ActClientId). Amount is a flat attribute the policy compares with a cap. After an approval the call is retried with HitlApproved: true.`,
    tokens: [
      { note: "Authorize worker token · the gateway's own client_credentials grant", header: HEAD, claims: { iss: ISS, aud: "https://api.pingone.com", client_id: "gateway-authorize-client", iat: 1790000000, exp: 1790003600 } },
      DELEGATED,
    ],
    refs: [AUTHORIZE, AUTHZ[3], AGENT_GATEWAY, RFC(6749, "Client credentials grant (section 4.4)")],
  },
  mcp: {
    form: `${CALL("loyalty-mcp.internal", "/mcp", "Bearer <delegated token>", "search_flights", SEARCH_ARGS)}\n\nThe server accepts traffic from the gateway only (network policy), then validates again: signature, aud = ${MCP_AUD}, scope loyalty:search for this tool. A token for another audience is a 401, and the inbound token is never forwarded.`,
    tokens: [DELEGATED],
    refs: [MCP[0], RESOURCE, JWT_AT, MCP[3], INTROSPECT[2], RFC(9700, "OAuth 2.0 Security BCP: audience restriction")],
  },
  exchange2: {
    form: EXCHANGE_FORM("<delegated token received from the gateway>", "<MCP server actor token>", FACADE_AUD, `Made by United's token service for the MCP server, as a confidential client. The actor token is the MCP server app's own client_credentials access token. The result nests the actors: act.client_id = the MCP server, act.act.client_id = the agent.`),
    tokens: [DELEGATED, MCP_ACTOR_TOKEN, FACADE_TOKEN],
    refs: [EXCHANGE[0], RESOURCE, PRIVATE_KEY_JWT, JWT_AT],
  },
  facade: {
    form: `POST /v1/search HTTP/1.1\nHost: facade.airline.example\nAuthorization: Bearer <facade token>\nContent-Type: application/json\n\n${j(SEARCH_ARGS)}\n\nThen the facade asks the session service for an agent session:\nPOST /sessions HTTP/1.1\nAuthorization: Bearer <facade token>\n<- { "session": "<opaque member session id>", "actors": ["loyalty-mcp-client", "chat-agent-client"], "tools": "search" }\n\nThe session lives server side, keyed by a hash of the token. No cookie is involved.`,
    tokens: [
      FACADE_TOKEN,
      { note: "Agent session · opaque in practice; claims as the session service records them", claims: { sub: "member-1042", actors: ["loyalty-mcp-client", "chat-agent-client"], tool_family: "search", via: "agent", exp: 1790000300 } },
    ],
    refs: [BEARER[0], JWT_AT],
  },
  ciba: {
    form: `POST https://auth.pingone.com/ENV_ID/as/bc-authorize HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\nclient_id=chat-agent-client&login_hint=<PingOne user id>\n&scope=loyalty:purchase&binding_message=BK-3F9A9\n<- { "auth_req_id": "<opaque id>", "expires_in": 120, "interval": 5 }\n\nThe push on the phone names the product, the amount and the cart. The agent then polls:\n${TOKEN_ENDPOINT}\n\ngrant_type=urn:openid:params:grant-type:ciba&auth_req_id=<opaque id>&client_id=chat-agent-client\nNo answer in the window is a denial and the agent stops. PingOne limits binding_message to 8 characters, so the cart detail rides in the approval record, not the message.\n\nToday the approval is recorded and the held call is retried on the Authorize decision with HitlApproved: true. A token that carries the cart as authorization_details (RAR) is the design target, not wired.`,
    tokens: [
      { note: "Token returned once the member approves · single use, scope for this purchase", header: HEAD, claims: { iss: ISS, sub: "member-1042", aud: MCP_AUD, scope: "loyalty:purchase", act: { client_id: "chat-agent-client" }, jti: "tok-ap01", ...NOW } },
    ],
    refs: [STEPUP[0], P1_CIBA],
  },
  checkout: {
    form: `GET /checkout?cart=<cart reference> HTTP/1.1\nHost: www.airline.example\nCookie: session=<member's own web session>\n\nThe cart reference is an opaque id: single use, five minutes, bound to cart-5521. Without the member's own session cookie the page demands a sign-in and step-up first.\nNo OAuth token is involved: the link is a reference, not a credential, and the model never sees a card.`,
    tokens: [],
    refs: [HTTP, COOKIE],
  },
  auditTarget: {
    form: `POST /siem/events HTTP/1.1\nContent-Type: application/json\n\n${j({ ts: "2026-10-19T09:14:02Z", jti: "tok-7f3a", member: "member-1042", act_client_id: "chat-agent-client", tool: "add_insurance", arguments: { amount: 49 }, verdict: "step-up", approval: "ap01" })}\n\nOne record per action. The agent has no write path to the log. Policy verdicts, Ping exchanges and facade calls join to it on jti.\nNo token is sent: the record carries only the token id (jti), never the token.`,
    tokens: [],
    refs: [JWT_RFC, AGENT_GATEWAY, AUTHORIZE],
  },
  auditDual: {
    form: `Privilege record (session and tool activity):\n${j({ jti: "tok-7f3a", client: "chat-agent-client", tool: "add_insurance", guardrail: "pass" })}\n\nAgent Gateway record (verdict and actor chain):\n${j({ jti: "tok-7f3a", member: "member-1042", act_client_id: "chat-agent-client", verdict: "step-up" })}\n\nBoth carry the token id, so the two stores join into one timeline. The agent can write to neither.\nNo token is sent: the records carry only the token id (jti), never the token.`,
    tokens: [],
    refs: [JWT_RFC, PRIVILEGE, AGENT_GATEWAY, AUTHORIZE],
  },
};
