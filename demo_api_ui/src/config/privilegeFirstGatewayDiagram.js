// Config for the two figures on /privilege-first-gateway (PrivilegeFirstGatewayPage), in the shared pingStyle shape
// { GROUPS, NODES, EDGES, STEPS } for StaticFlowDiagram. STEPS[i].detail feeds the reel's detail panel:
// the request on the wire, MOCK decoded tokens (teaching values only, no real secrets) and the standards behind the step.
// Reel step k = EDGES[k]; STEPS[i].edges lists the EDGES indexes a step covers.
//
// Sources for the wire formats: docs/ARCHITECTURE-TRUTHS.md T-17, ping-gateway/scripts/groovy/privilege-bridge.groovy
// and olb-token-exchange.groovy, privilege/CURRENT-CONFIGURATION.md. Where the repo does not pin a value (the
// Privilege key formats, the door token shape) the form uses a descriptive placeholder instead of an invented prefix.
import { AUTH, BEARER, EXCHANGE, MCP, INTROSPECT, META, RFC, DRAFT, SPEC } from "./pingStyleStandards";

// Ping palette: red = Ping product (Privilege, Agent Gateway), dark = apps and agents, grey = outside Privilege.
export const GROUPS = {
  caller: { label: "Callers", bg: "#151a24" },
  priv: { label: "Agent Privilege", bg: "#b5231a" },
  ag: { label: "Agent Gateway", bg: "#b5231a" },
  server: { label: "MCP servers", bg: "#151a24" },
  ghost: { label: "Unchanged today", bg: "#5a5f69" },
};

// Product-level standards for this diagram: these are Ping products, not IETF or OpenID documents, so kind is "spec".
const PRIVILEGE = SPEC("PingOne Agent Privilege", "Agentic Apps: policy, approval and recording on the LLM and MCP lanes");
const PRIVILEGE_NO_LOCAL = SPEC("PingOne Agent Privilege", "Cloud providers only today: no lane for local models (decision D2)");
const AUTHORIZE = SPEC("PingOne Authorize", "Per-tool policy decision (P1AZ) before the call is forwarded");
const PINGGATEWAY = SPEC("PingGateway", "MCP route filters: Privilege bridge, introspection, RFC 8693 exchange");
const OPENAI_API = SPEC("OpenAI Chat Completions API", "The wire format Privilege's OpenAI lane and llama.cpp both speak");
// The demo's tx-token is a custom header carrying the caller's exchanged access token. The IETF draft defines a different artifact.
const TX_ANALOGY = DRAFT(
  "draft-ietf-oauth-transaction-tokens",
  "Analogy only: the demo's tx-token header carries an ordinary exchanged access token, not a Txn-Token"
);
const BEARER_SYNTAX_ONLY = RFC(6750, "Header syntax only: this bearer is a shared secret, not an OAuth access token");

// Drops duplicate ids so the panel never lists a standard twice (the reel keys refs by id).
const uniqRefs = (...refs) => refs.filter((r, i) => refs.findIndex((o) => o.id === r.id) === i);

// ---- Figure 1: where every LLM and MCP call enters ----

export const GATEWAY_NODES = [
  { id: "ext", group: "caller", label: "External MCP clients", sub: ["LM Studio, LibreChat MCP", "OAuth (DCR+PKCE) via doors"], x: 0, y: 20 },
  { id: "bff", group: "caller", label: "BFF chat", sub: ["demo-api-server :3001", "LangGraph agent, tool pipeline"], x: 0, y: 150 },
  { id: "side", group: "caller", label: "Sidecar agents", sub: ["ag-ui runtime", "LibreChat, agent-service :3006"], x: 0, y: 280 },
  { id: "proxy", group: "ghost", label: "llm-proxy :8090 · local models", sub: ["llama.cpp / MLX, no auth today", "outside Privilege, no lane (D2)"], x: 0, y: 440 },
  { id: "llm", group: "priv", label: "Privilege · LLM lane", sub: ["virtual keys, /llm/{provider}/v1", "provider key injected here", "model allow-list · usage caps"], x: 330, y: 70 },
  { id: "mcp", group: "priv", label: "Privilege · MCP lane", sub: ["Agentic App agent-gateway", "/agent-gateway/mcp (NEW)", "policy · approval · recording"], x: 330, y: 250 },
  { id: "cloud", group: "caller", label: "Cloud LLM providers", sub: ["OpenAI · Anthropic · Google", "Privilege holds the real key"], x: 660, y: 70 },
  { id: "ag", group: "ag", label: "Agent Gateway", sub: ["ping-gateway :8080 /mcp", "introspection · RFC 8693 · aud", "P1AZ per tool · D-05 · RAR"], x: 660, y: 250 },
  { id: "s1", group: "server", label: "mcp-server", sub: [":8080 banking"], x: 340, y: 440 },
  { id: "s2", group: "server", label: "resource-srv", sub: [":8081 invest"], x: 570, y: 440 },
  { id: "s3", group: "server", label: "mcp-weather", sub: [":8896"], x: 800, y: 440 },
  { id: "s4", group: "server", label: "mcp-brave", sub: [":8897"], x: 1030, y: 440 },
];

// dashed = the hop the Phase 0 spike must measure, and the local-model path that stays outside Privilege
export const GATEWAY_EDGES = [
  ["bff", "llm", "chat"],
  ["bff", "mcp", "tools/call"],
  ["side", "llm", "OpenAI lane by env"],
  ["ext", "mcp", "OAuth via facade doors"],
  ["side", "proxy", "local models", { dashed: true, vertical: true }],
  ["llm", "cloud", "real provider key"],
  ["mcp", "ag", "backend hop · Phase 0 decides", { dashed: true }],
  ["ag", "s1", "exchanged token, aud per server", { vertical: true }],
  ["ag", "s2", "", { vertical: true }],
  ["ag", "s3", "", { vertical: true }],
  ["ag", "s4", "", { vertical: true }],
];

// The caller's token as the Agent Gateway receives it in tx-token: gateway-scoped, before the Exchange #3 swap.
const TX_TOKEN = {
  note: "tx-token · caller's token, gateway audience",
  header: { alg: "RS256", typ: "at+jwt", kid: "mock-key-1" },
  claims: {
    iss: "https://auth.pingone.com/MOCK-ENV-ID/as",
    sub: "user-8f3a",
    aud: "mcpgateway.ping.demo",
    scope: "gateway:mcp:invoke",
    exp: 1790000300,
  },
};

// One exchanged-token step per MCP server: the Agent Gateway swaps the caller's token for one whose aud is that server.
// The PingOne branch of olb-token-exchange.groovy sends resource= (RFC 8707); audience= is silently ignored by PingOne.
const serverStep = (i, key, host, aud, scope, server, tool, decision) => ({
  key,
  title: `Agent Gateway to ${server}`,
  what: `The Agent Gateway exchanges the caller's token for one scoped to ${aud} and forwards the tool call. ${decision}`,
  edges: [i],
  detail: {
    form: `# 1. at the PingOne token endpoint, Exchange #3 (RFC 8693 + RFC 8707):
POST https://auth.pingone.com/MOCK-ENV-ID/as/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token=<caller's token from tx-token>
&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&requested_token_type=urn:ietf:params:oauth:token-type:access_token
&resource=${aud}
&scope=${scope}
&client_id=<exchange client>&client_secret=<redacted>

# 2. then the forward:
POST http://${host}/mcp
Authorization: Bearer <exchanged token, aud=${aud}>
Content-Type: application/json

{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"${tool}","arguments":{}}}`,
    tokens: [
      {
        note: `Exchanged token · aud ${aud}`,
        header: { alg: "RS256", typ: "at+jwt", kid: "mock-key-1" },
        claims: {
          iss: "https://auth.pingone.com/MOCK-ENV-ID/as",
          sub: "user-8f3a",
          aud,
          scope,
          client_id: "gateway-exchange-client-mock",
          exp: 1790000300,
        },
      },
    ],
    refs: uniqRefs(EXCHANGE[0], EXCHANGE[1], INTROSPECT[0], BEARER[2], AUTHORIZE, PINGGATEWAY),
  },
});

export const GATEWAY_STEPS = [
  {
    key: "bff-llm",
    title: "BFF chat enters the LLM lane",
    what: "With ff_privilege_llm_first on, the BFF sends chat to Privilege with a virtual key instead of going vendor-direct.",
    edges: [0],
    detail: {
      form: `POST https://privilege.example.com/llm/openai/v1/chat/completions
Authorization: Bearer <Privilege virtual key>   # not a provider key
Content-Type: application/json

{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Summarise my accounts"}]}`,
      refs: uniqRefs(PRIVILEGE, OPENAI_API),
    },
  },
  {
    key: "bff-mcp",
    title: "BFF tool call enters the MCP lane",
    what: "With ff_mcp_gateway_privilege_first on, the tool pipeline calls Privilege's agent-gateway app instead of the Agent Gateway directly.",
    edges: [1],
    detail: {
      form: `POST https://privilege.example.com/agent-gateway/mcp
Authorization: Bearer <Privilege gateway session token>   # privilegeGatewaySession, not the user's token
tx-token: <caller's token, see claims below>              # custom header, survives the backend hop
Content-Type: application/json

{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_account_balance","arguments":{}}}`,
      tokens: [TX_TOKEN],
      refs: uniqRefs(PRIVILEGE, MCP[0], MCP[1], MCP[2], EXCHANGE[0], TX_ANALOGY),
    },
  },
  {
    key: "side-llm",
    title: "Sidecar agents use the OpenAI lane by env",
    what: "Sidecar agents and LibreChat point AGENT_LLM_BASE_URL at the Privilege OpenAI lane. No agent code changes.",
    edges: [2],
    detail: {
      form: `# env only, no code change
AGENT_LLM_BASE_URL=https://privilege.example.com/llm/openai/v1
AGENT_LLM_API_KEY=<Privilege virtual key>

POST /llm/openai/v1/chat/completions
Authorization: Bearer <Privilege virtual key>`,
      refs: uniqRefs(PRIVILEGE, OPENAI_API),
    },
  },
  {
    key: "ext-mcp",
    title: "External MCP clients sign in through a door",
    what: "A client such as LM Studio registers itself, runs OAuth with PKCE against the door, then calls the MCP lane with the access token. The door's authorization server is the Privilege gateway's own OAuth, not PingOne.",
    edges: [3],
    detail: {
      form: `# <door> is the door's path prefix, e.g. /banking-mcp
GET  /.well-known/oauth-protected-resource   # discover the door's authorization server
POST <door>/register                          # dynamic client registration
GET  <door>/authorize?response_type=code&client_id=MOCK&code_challenge=MOCK&code_challenge_method=S256&resource=https://privilege.example.com/agent-gateway/mcp
POST <door>/token  grant_type=authorization_code&code=MOCK&code_verifier=MOCK

POST /agent-gateway/mcp
Authorization: Bearer <door access token>`,
      tokens: [
        {
          note: "Door access token · issued after DCR and PKCE (shape illustrative)",
          header: { alg: "RS256", typ: "at+jwt", kid: "mock-key-1" },
          claims: {
            iss: "https://privilege.example.com",
            sub: "user-8f3a",
            aud: "https://privilege.example.com/agent-gateway/mcp",
            client_id: "dcr-client-mock",
            exp: 1790000300,
          },
        },
      ],
      refs: uniqRefs(PRIVILEGE, MCP[0], MCP[1], MCP[2], MCP[3], AUTH[0], AUTH[1], META[0]),
    },
  },
  {
    key: "side-proxy",
    title: "Local models stay outside Privilege",
    what: "Sidecar calls to llama.cpp or MLX go to llm-proxy on :8090 with no auth. There is no Privilege lane for them yet (decision D2).",
    edges: [4],
    detail: {
      form: `POST http://llm-proxy:8090/v1/chat/completions
Content-Type: application/json
# no Authorization header: no key, no model allow-list, no usage cap

{"model":"local-model","messages":[{"role":"user","content":"hello"}]}`,
      refs: uniqRefs(PRIVILEGE_NO_LOCAL, OPENAI_API),
    },
  },
  {
    key: "llm-cloud",
    title: "Privilege swaps in the real provider key",
    what: "The LLM lane checks the virtual key, the model allow-list and the usage cap, then calls the provider with the key only Privilege holds.",
    edges: [5],
    detail: {
      form: `POST https://api.openai.com/v1/chat/completions
Authorization: Bearer <provider key held by Privilege, never sent to the caller>
Content-Type: application/json

{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Summarise my accounts"}]}

# Anthropic lane: same swap, header x-api-key instead of Authorization`,
      refs: uniqRefs(PRIVILEGE, OPENAI_API),
    },
  },
  {
    key: "mcp-ag",
    title: "Privilege forwards to the Agent Gateway",
    what: "The MCP lane applies policy, approval and recording, then calls the registered backend. Outcome A (settled 2026-09-10): custom headers such as tx-token survive this hop. The bearer on this hop is the Agentic App's Static Token, a shared secret.",
    edges: [6],
    detail: {
      form: `POST http://ping-gateway.ping-devops-cmuir.svc.cluster.local:8080/mcp
Authorization: Bearer <Static Token: shared secret, MCP_GW_PRIVILEGE_BRIDGE_SECRET>   # Auth Mode None sends no Authorization header
tx-token: <caller's token>             # custom header passes through unchanged
x-forwarded-for: 203.0.113.9
Content-Type: application/json

{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_account_balance","arguments":{}}}

# PingGateway privilege-bridge filter: bearer equals the secret -> tx-token moves into Authorization,
# X-Privilege-Bridge: true is set for audit, then introspection, P1AZ and the RFC 8693 exchange run on the user.`,
      tokens: [TX_TOKEN],
      refs: uniqRefs(PRIVILEGE, PINGGATEWAY, BEARER_SYNTAX_ONLY, MCP[0], TX_ANALOGY),
    },
  },
  serverStep(7, "ag-s1", "mcp-server:8080", "mcpserver.ping.demo", "read", "mcp-server (banking)", "get_account_balance", "PingOne Authorize permits the read scope for this user."),
  serverStep(8, "ag-s2", "resource-srv:8081", "mcp-invest.ping.demo", "invest:read", "resource-srv (invest)", "get_portfolio_summary", "PingOne Authorize decides per tool before the call is forwarded."),
  serverStep(9, "ag-s3", "mcp-weather:8896", "mcpserver.ping.demo", "read", "mcp-weather", "get_weather", "No user data comes back, but the call still carries the user's token: the bridge refuses a tools/call with no subject. The audience shown is the default MCP server resource."),
  serverStep(10, "ag-s4", "mcp-brave:8897", "mcpserver.ping.demo", "read", "mcp-brave", "brave_web_search", "No user data comes back, but the call still carries the user's token: the bridge refuses a tools/call with no subject. The audience shown is the default MCP server resource."),
];

// ---- Figure 2: the identity fork on the Privilege to Agent Gateway hop ----

export const FORK_NODES = [
  { id: "pa", group: "priv", label: "Outcome A · Privilege", sub: ["bearer in: Static Token", "user token in: tx-token header"], x: 0, y: 20 },
  { id: "ga", group: "ag", label: "Agent Gateway sees", sub: ["bridge swaps tx-token in: sub = user", "read scope: P1AZ decides, PERMIT", "Privilege hop marked by header + audit", "act chain does not name Privilege yet"], x: 330, y: 20 },
  { id: "pb", group: "priv", label: "Outcome B · Privilege", sub: ["bearer in: Static Token", "headers dropped"], x: 740, y: 20 },
  { id: "gb", group: "ag", label: "Agent Gateway sees", sub: ["bridge secret, no tx-token: no user", "tools/call: refused, no subject", "initialize, tools/list: machine subject", "plan expected weather and brave to pass"], x: 1070, y: 20 },
];

export const FORK_EDGES = [
  ["pa", "ga", "Bearer: Static Token + tx-token: user"],
  ["pb", "gb", "Bearer: Static Token only"],
];

export const FORK_STEPS = [
  {
    key: "outcome-a",
    title: "Outcome A: the user token rides in a header",
    what: "Privilege forwards the Static Token as the bearer and the caller's token in tx-token. The Agent Gateway swaps the user token in, introspects it, exchanges it and asks PingOne Authorize, all on the real user.",
    edges: [0],
    detail: {
      form: `POST /mcp HTTP/1.1
Authorization: Bearer <Static Token: shared secret>
tx-token: <caller's token>
Content-Type: application/json

# privilege-bridge: bearer == MCP_GW_PRIVILEGE_BRIDGE_SECRET -> Authorization := Bearer <tx-token>, tx-token removed
# X-Privilege-Bridge: true added so audit can record the hop
# then: introspect, RFC 8693 exchange (subject_token = user token, resource=<server>), P1AZ: read for this user -> PERMIT`,
      tokens: [
        TX_TOKEN,
        {
          note: "Token after exchange · what the Agent Gateway forwards to the server",
          header: { alg: "RS256", typ: "at+jwt", kid: "mock-key-1" },
          claims: {
            iss: "https://auth.pingone.com/MOCK-ENV-ID/as",
            sub: "user-8f3a",
            aud: "mcpserver.ping.demo",
            scope: "read",
            client_id: "gateway-exchange-client-mock",
            exp: 1790000300,
          },
        },
      ],
      refs: uniqRefs(PRIVILEGE, PINGGATEWAY, AUTHORIZE, EXCHANGE[0], EXCHANGE[1], INTROSPECT[0], BEARER_SYNTAX_ONLY, TX_ANALOGY),
    },
  },
  {
    key: "outcome-b",
    title: "Outcome B: headers are dropped, only the Static Token arrives",
    what: "If Privilege dropped custom headers the Agent Gateway would see only the shared secret and no user. The plan proposed a machine subject; the shipped bridge refuses a tools/call with no subject, and only read-only discovery may use the gateway's own subject.",
    edges: [1],
    detail: {
      form: `POST /mcp HTTP/1.1
Authorization: Bearer <Static Token: shared secret>
Content-Type: application/json

# no tx-token: the bridge has no subject token
# tools/call -> 401 invalid_token ("Privilege bridge presented no tx-token"), for every tool
# initialize and tools/list may use the gateway machine subject (Node gateway; the PingGateway filter refuses all)
# the plan expected banking DENY and weather, brave, opensearch PERMIT; the shipped bridge refuses instead`,
      refs: uniqRefs(PRIVILEGE, PINGGATEWAY, BEARER_SYNTAX_ONLY, EXCHANGE[0]),
    },
  },
];
