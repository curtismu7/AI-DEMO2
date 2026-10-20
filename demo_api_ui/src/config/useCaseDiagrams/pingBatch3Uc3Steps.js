// Per-step detail (cfg.steps) for UC16, UC16b, UC17, UC18, UC19, UC2, UC2.5, UC2.6, UC2.7 and UC21.
// Keyed by config id; each entry covers every walk beat of that config. All tokens are decoded MOCK values and
// every form uses placeholders. Wire shapes follow demo_api_server (services/oauthService.js exchange bodies,
// services/a2aDelegationService.js, services/pingOneAuthorizeService.js decision parameters), demo_mcp_gateway
// (POST /gateway/mcp) and routes/attackSimulator.js (POST /api/demo/attack-sim/run).
import { RFC, SPEC, DRAFT, BEARER, CREDS, EXCHANGE, MCP, INTROSPECT, AUTHZ } from "../pingStyleStandards";

const ISS = "https://auth.pingone.com/ENV_ID/as";
const TOKEN_URL = `${ISS}/token`;
const EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const AT_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const HDR = { alg: "RS256", typ: "at+jwt" };

const HTTP = RFC(9110, "HTTP semantics");
const ACT = RFC(8693, "OAuth 2.0 Token Exchange: subject_token, actor_token and the act claim (section 4.1)");
const A2A = (title) => SPEC("A2A Protocol 1.0", title);
const JSONRPC = SPEC("JSON-RPC 2.0", "Request and response envelope");
const JWT_PROFILE = BEARER[2];
const BEARER_USE = BEARER[0];
const CC = CREDS[0];
const MCP_AUTH = MCP[0];
const AUTHZEN = AUTHZ[0];

const json = (o) => JSON.stringify(o, null, 2);

// ---- MOCK decoded tokens ----
const userToken = (extra = {}) => ({
  note: "MOCK user access token · who Alice is (held server-side by the BFF)",
  header: HDR,
  claims: { iss: ISS, sub: "user-alice-0001", aud: "https://api.ping.demo", scope: "openid profile banking:read", exp: 1790003600, ...extra },
});
const actorToken = (clientId, aud = "https://agentgateway.ping.demo") => ({
  note: `MOCK actor token · client_credentials, names ${clientId} as the ACTOR`,
  header: HDR,
  claims: { iss: ISS, client_id: clientId, aud, scope: "agent:invoke", exp: 1790000300 },
});
const noActToken = {
  note: "MOCK impersonation token · user is the subject, act is ABSENT",
  header: HDR,
  claims: { iss: ISS, sub: "user-alice-0001", aud: "https://mcp.ping.demo", scope: "banking:read", exp: 1790003600 },
};
const delegated = (note, claims) => ({ note, header: HDR, claims: { iss: ISS, sub: "user-alice-0001", aud: "https://mcp.ping.demo", exp: 1790000300, ...claims } });
const agentToken = (note = "MOCK delegated agent token · sub=user, act=agent") =>
  delegated(note, { scope: "banking:read", act: { sub: "agent-client-0001" } });

const exchangeForm = (clientId, audience, scope, subjectLabel = "<user access token>", actorLabel = "<agent actor token>") =>
  `POST ${TOKEN_URL} HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=${EXCHANGE_GRANT}\n&client_id=${clientId}\n&client_secret=CLIENT_SECRET\n&subject_token=${subjectLabel}\n&subject_token_type=${AT_TYPE}\n&actor_token=${actorLabel}\n&actor_token_type=${AT_TYPE}\n&requested_token_type=${AT_TYPE}\n&audience=${audience}\n&scope=${scope}`;
const ccForm = (clientId, extra = "") =>
  `POST ${TOKEN_URL} HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=client_credentials&client_id=${clientId}&client_secret=CLIENT_SECRET${extra}`;
const mcpCall = (tool, args = {}, id = 1) =>
  `POST /gateway/mcp HTTP/1.1\nAuthorization: Bearer <agent access token>\nContent-Type: application/json\n\n${json({ jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, arguments: args } })}`;
const decisionForm = (parameters, response) =>
  `POST https://api.pingone.com/v1/environments/ENV_ID/decisionEndpoints/MCP_DECISION_ENDPOINT_ID HTTP/1.1\nAuthorization: Bearer AUTHORIZE_WORKER_ACCESS_TOKEN\nContent-Type: application/json\n\n${json({ parameters })}\n\nHTTP/1.1 200 OK\n\n${json(response)}`;
const sendMessage = (bearerLabel) =>
  `POST /a2a/specialists/:vertical HTTP/1.1\nHost: api.ping.demo:3001\n${bearerLabel ? `Authorization: Bearer ${bearerLabel}\n` : "# no Authorization header\n"}A2A-Version: 1.0\nContent-Type: application/json\n\n${json({ jsonrpc: "2.0", id: 1, method: "SendMessage", params: { message: { messageId: "<uuid>", role: "ROLE_USER", parts: [{ text: "<subtask text>", mediaType: "text/plain" }] } } })}`;
const note = (s) => `# ${s}`;

// Nested chain tokens shared by UC2, UC2.5, UC2.6
const GEN_TOKEN = delegated("MOCK exchange #1 token · sub=alice, act=generalist", { aud: "a2a-intermediate-<appKey>.ping.demo", scope: "agent:invoke:<appKey>", act: { sub: "generalist-client" } });
const SPEC_TOKEN = delegated("MOCK exchange #2 token · act nests the generalist inside the specialist; scope narrowed", { aud: "mcpgateway-a2a.ping.demo", scope: "purchase:read", act: { sub: "specialist-client", act: { sub: "generalist-client" } } });

export const UC_BATCH3_STEPS = {
  UC16: [
    {
      beats: [0],
      detail: {
        form: `POST /api/demo/attack-sim/run\nCookie: <BFF session cookie>\nContent-Type: application/json\n\n{ "sim": "impersonation-no-act" }\n\n${note("The sim never calls the token endpoint: no grant_type=" + EXCHANGE_GRANT + " request is made, so PingOne has nothing to stamp act onto.")}`,
        tokens: [noActToken],
        refs: [ACT, JWT_PROFILE],
      },
    },
    {
      beats: [1],
      detail: { form: mcpCall("get_my_accounts").replace("<agent access token>", "<user access token, no act claim>"), tokens: [noActToken], refs: [BEARER_USE, MCP_AUTH, JSONRPC] },
    },
    {
      beats: [2],
      detail: {
        form: `PingOne Authorize decision request\n\nsubject: user-alice-0001\nactor: (none)\nresource: agent-mediated tool call\nattributes: { act: absent }\n\nrule: an agent-mediated call without an act claim has no attribution -> reject`,
        tokens: [],
        refs: [AUTHZEN, ACT],
      },
    },
    {
      beats: [3],
      detail: {
        form: `HTTP/1.1 401 Unauthorized\nContent-Type: application/json\n\n{ "error": "<reason: act claim required>" }\n\n${note("No tool dispatched. The response carries no token, so there is nothing to decode.")}`,
        tokens: [],
        refs: [RFC(6750, "Bearer token usage: error responses (section 3)"), HTTP],
      },
    },
  ],

  UC16b: [
    {
      beats: [0],
      detail: {
        form: `POST /api/demo/attack-sim/run\nCookie: <BFF session cookie>\nContent-Type: application/json\n\n{ "sim": "raw-user-token-forwarding" }\n\n${note("Goal of the sim: resolve an MCP tool token for get_my_accounts by presenting Alice's own access token as-is.")}`,
        tokens: [userToken({ scope: "accounts:read" })],
        refs: [JWT_PROFILE, BEARER_USE],
      },
    },
    {
      beats: [1],
      detail: {
        form: `resolveMcpAccessTokenWithEvents(req, "get_my_accounts")\n  ff_skip_token_exchange = true   (armed and restored in-memory by the sim, persist: false)\n  -> custody check runs first, before any gateway or Authorize call\n\n${note("In-process check inside the BFF: no HTTP request is made, no token is minted.")}`,
        tokens: [],
        refs: [ACT, RFC(9700, "OAuth 2.0 Security BCP: keep tokens away from components that do not need them")],
      },
    },
    {
      beats: [2],
      detail: {
        form: `HTTP/1.1 403 Forbidden\nContent-Type: application/json\n\n{ "error": "user_token_forwarding_disabled" }\n\n${note("No MCP request is dispatched. The exchange-skipped event records that RFC 8693 was not run.")}`,
        tokens: [],
        refs: [ACT, RFC(8707, "Resource Indicators: a tool token is minted for its own audience")],
      },
    },
    {
      beats: [3],
      detail: {
        form: `${note("No request reaches the gateway and no PingOne Authorize decision is made on this path.")}\n${note("The absence of an authorize-decision record is the evidence.")}`,
        tokens: [],
        refs: [AUTHZEN],
      },
    },
    {
      beats: [4],
      detail: {
        form: `HTTP/1.1 200 OK   (sim result)\nContent-Type: application/json\n\n{ "verdict": "DENY_403", "error": "user_token_forwarding_disabled" }\n\n${note("Protection point: BFF token custody. Only exchanged, agent-scoped tokens with an act claim leave the BFF.")}`,
        tokens: [],
        refs: [ACT, RFC(9700, "OAuth 2.0 Security BCP")],
      },
    },
  ],

  UC17: [
    {
      beats: [0],
      detail: {
        form: `${note("The delegated token gets a short exp at the RFC 8693 exchange; the TTL is PingOne configuration, not custom rotation code.")}\n${exchangeForm("agent-client-0001", "mcp.ping.demo", "banking:read")}`,
        tokens: [userToken(), actorToken("agent-client-0001"), agentToken("MOCK delegated agent token · exp = now + minutes")],
        refs: [ACT, JWT_PROFILE],
      },
    },
    {
      beats: [1],
      detail: { form: mcpCall("get_account_balance"), tokens: [agentToken()], refs: [BEARER_USE, MCP_AUTH, JSONRPC] },
    },
    {
      beats: [2],
      detail: {
        form: `POST ${ISS}/introspect HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\ntoken=<agent access token>&client_id=GATEWAY_CLIENT_ID&client_secret=CLIENT_SECRET\n\n-> inside the TTL:  { "active": true, "sub": "user-alice-0001", "exp": 1790000300 }\n-> past the TTL:    { "active": false }   (signature still verifies, the call is rejected 401)`,
        tokens: [agentToken("MOCK token being introspected · valid only while now < exp")],
        refs: [...INTROSPECT.slice(0, 1), INTROSPECT[2]],
      },
    },
    {
      beats: [3],
      detail: {
        form: `GET /api/accounts HTTP/1.1\nAuthorization: Bearer <agent access token>\n\n-> 200 { "accounts": [ ... ] }`,
        tokens: [agentToken("MOCK token that passed the TTL check upstream")],
        refs: [BEARER_USE, HTTP],
      },
    },
    {
      beats: [4],
      detail: {
        form: `HTTP/1.1 200 OK\nContent-Type: application/json\n\n{ "balance": "<amount>" }\n\n${note("The answer returns on the same short-lived grant; a token captured now is dead in minutes.")}`,
        tokens: [],
        refs: [HTTP],
      },
    },
  ],

  UC18: [
    {
      beats: [0],
      detail: { form: `${note("call 1, 2, 3 ... repeated back to back, same agent and same tool")}\n${mcpCall("get_my_accounts")}`, tokens: [agentToken()], refs: [MCP_AUTH, BEARER_USE, JSONRPC] },
    },
    {
      beats: [1],
      detail: {
        form: `rate window: 3 calls / 10 s per (agent, tool)\n\n${note("In-gateway counter keyed by the calling agent and the tool name. No wire request.")}`,
        tokens: [],
        refs: [],
      },
    },
    {
      beats: [2],
      detail: { form: `${note("call 4 inside the same 10 s window")}\n${mcpCall("get_my_accounts", {}, 4)}`, tokens: [agentToken()], refs: [MCP_AUTH] },
    },
    {
      beats: [3],
      detail: {
        form: `HTTP/1.1 429 Too Many Requests\nContent-Type: application/json\nRetry-After: <seconds, if the gateway sets it>\n\n{ "error": "<rate limit exceeded>" }\n\n${note("Throttled, not errored. No tool is dispatched. If the sim reports no 429 the limiter is not active.")}`,
        tokens: [],
        refs: [RFC(6585, "Additional HTTP status codes: 429 Too Many Requests"), HTTP],
      },
    },
    {
      beats: [4],
      detail: { form: `${note("No request reaches the Banking MCP past the limiter; the flood ends at the gateway perimeter.")}`, tokens: [], refs: [] },
    },
  ],

  UC19: [
    {
      beats: [0],
      detail: {
        form: `POST /api/agent/invoke\nCookie: <BFF session cookie>\nContent-Type: application/json\n\n{ "prompt": "show my balance", "useCaseId": "UC19" }\n\n${note("The agent app then authenticates as itself with its own client credential.")}\n${ccForm("agent-client-0001", "&scope=agent:invoke")}`,
        tokens: [userToken(), actorToken("agent-client-0001")],
        refs: [CC, JWT_PROFILE],
      },
    },
    {
      beats: [1],
      detail: {
        form: `${exchangeForm("agent-client-0001", "mcp.ping.demo", "banking:read")}\n\n-> 200 { "access_token": "<delegated access token>", "token_type": "Bearer", "expires_in": 300 }`,
        tokens: [userToken(), actorToken("agent-client-0001"), agentToken()],
        refs: [ACT, CC],
      },
    },
    {
      beats: [2],
      detail: {
        form: `PUT https://api.pingone.com/v1/environments/ENV_ID/applications/AGENT_APP_ID HTTP/1.1\nAuthorization: Bearer <admin worker access token>\nContent-Type: application/json\n\n{ "name": "<agent app>", "enabled": false, ... }   (or rotate the client secret in the console)\n\n${note("Console or Management API edit, not an OAuth flow for the agent. Run the same chip again afterwards.")}`,
        tokens: [],
        refs: [RFC(6749, "Client authentication (section 2.3): the credential PingOne checks on every exchange")],
      },
    },
    {
      beats: [3],
      detail: {
        form: `${exchangeForm("agent-client-0001", "mcp.ping.demo", "banking:read")}\n\nHTTP/1.1 401 Unauthorized\nContent-Type: application/json\n\n{ "error": "invalid_client" }\n\n${note("No delegated token comes back, so no tool is reachable.")}`,
        tokens: [],
        refs: [RFC(6749, "Error response (section 5.2): invalid_client"), ACT],
      },
    },
  ],

  UC2: [
    {
      beats: [0],
      detail: {
        form: `${ccForm("generalist-client", "&scope=agent:invoke")}\n\n${exchangeForm("generalist-client", "a2a-intermediate-<appKey>.ping.demo", "agent:invoke:<appKey>", "<user access token>", "<generalist actor token>")}`,
        tokens: [userToken(), actorToken("generalist-client"), GEN_TOKEN],
        refs: [ACT, CC],
      },
    },
    {
      beats: [1],
      detail: {
        form: sendMessage("<exchange #1 access token>"),
        tokens: [GEN_TOKEN],
        refs: [A2A("SendMessage over the JSON-RPC binding with a bearer security scheme"), JSONRPC, BEARER_USE],
      },
    },
    {
      beats: [2],
      detail: {
        form: `${ccForm("specialist-client", "&audience=a2a-intermediate-<appKey>.ping.demo&scope=agent:invoke:<appKey>")}\n\n${exchangeForm("specialist-client", "mcpgateway-a2a.ping.demo", "purchase:read", "<exchange #1 access token>", "<specialist actor token>")}`,
        tokens: [GEN_TOKEN, actorToken("specialist-client", "a2a-intermediate-<appKey>.ping.demo"), SPEC_TOKEN],
        refs: [ACT, CC],
      },
    },
    {
      beats: [3],
      detail: {
        form: `${note("Same request as the second exchange: the scope parameter asks for less than the subject token held.")}\n&scope=purchase:read      (was agent:invoke:<appKey>)\n\n-> 200 { "access_token": "<narrowed access token>", "expires_in": 300 }`,
        tokens: [SPEC_TOKEN],
        refs: [ACT, RFC(8707, "Resource Indicators: audience mcpgateway-a2a.ping.demo")],
      },
    },
    {
      beats: [4],
      detail: {
        form: decisionForm(
          { DecisionContext: "McpFirstTool", McpMethod: "tools/call", UserId: "USER_ID", ToolName: "<tool>", TokenAudience: "mcpgateway-a2a.ping.demo", ActClientId: "specialist-client", NestedActClientId: "generalist-client", ActChainDepth: 2, CallerType: "agent_a2a" },
          { decision: "PERMIT", statements: [{ code: "mcp-tool-authorized" }] },
        ),
        tokens: [SPEC_TOKEN],
        refs: [AUTHZEN, ACT, BEARER_USE],
      },
    },
  ],

  "UC2.5": [
    {
      beats: [0],
      detail: {
        form: `POST /api/a2a/message HTTP/1.1\nCookie: <BFF session cookie>\nContent-Type: application/json\n\n{ "message": "<request the orchestrator is not expert in>", "vertical": "<vertical>" }\n\n${note("No token on this hop: the browser holds only the session cookie.")}`,
        tokens: [],
        refs: [HTTP, RFC(6265, "HTTP state management (the session cookie)")],
      },
    },
    {
      beats: [1],
      detail: {
        form: `specialist = pick(request)   // CrewAI when available, heuristic fallback; no hard-coded task map\n\n${note("In-process decision, no wire request. The choice shows on the activity panel.")}`,
        tokens: [],
        refs: [SPEC("A2A Agent Card", "Skills in a specialist's card describe what it can take")],
      },
    },
    {
      beats: [2],
      detail: {
        form: `${ccForm("generalist-client", "&scope=agent:invoke")}\n\n${exchangeForm("generalist-client", "a2a-intermediate-<appKey>.ping.demo", "agent:invoke:<appKey>", "<user access token>", "<generalist actor token>")}`,
        tokens: [userToken(), actorToken("generalist-client"), GEN_TOKEN],
        refs: [ACT, CC],
      },
    },
    {
      beats: [3],
      detail: {
        form: `${ccForm("specialist-client", "&audience=a2a-intermediate-<appKey>.ping.demo&scope=agent:invoke:<appKey>")}\n\n${exchangeForm("specialist-client", "mcpgateway-a2a.ping.demo", "purchase:read", "<exchange #1 access token>", "<specialist actor token>")}`,
        tokens: [GEN_TOKEN, actorToken("specialist-client", "a2a-intermediate-<appKey>.ping.demo"), SPEC_TOKEN],
        refs: [ACT, CC, RFC(8707, "Resource Indicators")],
      },
    },
    {
      beats: [4],
      detail: {
        form: decisionForm(
          { DecisionContext: "McpFirstTool", McpMethod: "tools/call", UserId: "USER_ID", ToolName: "<tool>", TokenAudience: "mcpgateway-a2a.ping.demo", ActClientId: "specialist-client", NestedActClientId: "generalist-client", ActChainDepth: 2, CallerType: "agent_a2a" },
          { decision: "PERMIT", statements: [{ code: "mcp-tool-authorized" }] },
        ),
        tokens: [SPEC_TOKEN],
        refs: [AUTHZEN, ACT],
      },
    },
  ],

  "UC2.6": [
    {
      beats: [0],
      detail: {
        form: `${note("Replays UC2: two client_credentials calls and two token-exchange requests, then the specialist tool call.")}\n${exchangeForm("specialist-client", "mcpgateway-a2a.ping.demo", "purchase:read", "<exchange #1 access token>", "<specialist actor token>")}`,
        tokens: [GEN_TOKEN, actorToken("specialist-client", "a2a-intermediate-<appKey>.ping.demo"), SPEC_TOKEN],
        refs: [ACT, CC],
      },
    },
    {
      beats: [1],
      detail: {
        form: decisionForm(
          { DecisionContext: "McpFirstTool", McpMethod: "tools/call", TokenAudience: "mcpgateway-a2a.ping.demo", ActClientId: "specialist-client", NestedActClientId: "<registered generalist client id>", ActChainDepth: 2, CallerType: "agent_a2a" },
          { decision: "PERMIT", statements: [{ code: "mcp-tool-authorized" }] },
        ),
        tokens: [SPEC_TOKEN],
        refs: [AUTHZEN, ACT],
      },
    },
    {
      beats: [2],
      detail: {
        form: decisionForm(
          { DecisionContext: "McpFirstTool", McpMethod: "tools/call", TokenAudience: "mcpgateway-a2a.ping.demo", ActClientId: "specialist-client", NestedActClientId: "<fabricated unregistered client id>", ActChainDepth: 2, CallerType: "agent_a2a" },
          { decision: "DENY", statements: [{ code: "invalid_a2a_generalist" }] },
        ),
        tokens: [delegated("MOCK probe token · same shape, but the inner act names an unregistered generalist", { aud: "mcpgateway-a2a.ping.demo", scope: "purchase:read", act: { sub: "specialist-client", act: { sub: "fabricated-generalist" } } })],
        refs: [AUTHZEN, ACT],
      },
    },
    {
      beats: [3],
      detail: {
        form: `${note("The Authorize answer from the probe above: DENY with statement invalid_a2a_generalist.")}\nNestedActClientId != the registered generalist client id -> DENY\n\n${note("The decision response carries no token.")}`,
        tokens: [],
        refs: [AUTHZEN],
      },
    },
  ],

  "UC2.7": [
    {
      beats: [0],
      detail: {
        form: `GET /a2a/specialists/:vertical/.well-known/agent-card.json HTTP/1.1\nHost: api.ping.demo:3001\n\n${note("Public by design: no Authorization header. The card names capabilities and the endpoint, and grants nothing.")}`,
        tokens: [],
        refs: [A2A("Agent Card discovery at a well-known path"), RFC(8615, "Well-Known URIs"), HTTP],
      },
    },
    {
      beats: [1],
      detail: {
        form: `${sendMessage(null)}\n\nHTTP/1.1 401 Unauthorized\n\n${note("A real 401 from a real call: the wire protocol itself is credential-gated.")}`,
        tokens: [],
        refs: [A2A("SendMessage requires a bearer security scheme"), BEARER_USE, JSONRPC],
      },
    },
    {
      beats: [2],
      detail: {
        form: `${ccForm("generalist-client", "&scope=agent:invoke")}\n\n${ccForm("specialist-client", "&audience=a2a-intermediate-<appKey>.ping.demo&scope=agent:invoke:<appKey>")}`,
        tokens: [actorToken("generalist-client"), actorToken("specialist-client", "a2a-intermediate-<appKey>.ping.demo")],
        refs: [CC, JWT_PROFILE],
      },
    },
    {
      beats: [3],
      detail: {
        form: `${exchangeForm("generalist-client", "a2a-intermediate-<appKey>.ping.demo", "agent:invoke:<appKey>", "<user access token>", "<generalist actor token>")}\n\n${exchangeForm("specialist-client", "mcpgateway-a2a.ping.demo", "purchase:read", "<exchange #1 access token>", "<specialist actor token>")}`,
        tokens: [GEN_TOKEN, SPEC_TOKEN],
        refs: [ACT, DRAFT("draft-ietf-oauth-identity-chaining", "Identity chaining across trust domains")],
      },
    },
    {
      beats: [4],
      detail: {
        form: `layer 1  wire protocol  : Agent Card + bearer-gated JSON-RPC  (who may call this endpoint)\nlayer 2  identity chain : client_credentials, then RFC 8693 x2   (who acts for whom)\n\n${note("Two credentials for two layers. No request on this beat, it is the vocabulary step.")}`,
        tokens: [],
        refs: [A2A("Transport protocol and agent discovery"), EXCHANGE[0]],
      },
    },
  ],

  UC21: [
    {
      beats: [0],
      detail: { form: mcpCall("get_sensitive_details"), tokens: [agentToken("MOCK delegated agent token · premium-tier user in sub")], refs: [MCP_AUTH, BEARER_USE, JSONRPC] },
    },
    {
      beats: [1],
      detail: {
        form: decisionForm(
          { DecisionContext: "McpFirstTool", McpMethod: "tools/call", UserId: "USER_ID", ToolName: "get_sensitive_details", "<tier attribute>": "<premium-tier group membership from PingOne>" },
          { decision: "PERMIT" },
        ),
        tokens: [],
        refs: [AUTHZEN, SPEC("XACML 3.0", "Attribute-based policy model: group membership is the tier attribute")],
      },
    },
    {
      beats: [2],
      detail: {
        form: `HTTP/1.1 200 OK   (Authorize decision)\n\n{ "decision": "PERMIT" }   // premium-tier tool set and higher limit\n\n${note("A standard-tier user is not offered these tools at all. Moving the user to a higher group in PingOne changes this with no code change or redeploy.")}`,
        tokens: [],
        refs: [AUTHZEN],
      },
    },
    {
      beats: [3],
      detail: {
        form: `HTTP/1.1 200 OK\nContent-Type: application/json\n\n{ "jsonrpc": "2.0", "id": 1, "result": { "content": [ { "type": "text", "text": "<tool result>" } ] } }\n\n${note("Chain records authorize-decision, then tool-dispatched.")}`,
        tokens: [],
        refs: [JSONRPC, MCP_AUTH],
      },
    },
  ],
};
