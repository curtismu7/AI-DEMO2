// Config for the two figures on /privilege-first-gateway (PrivilegeFirstGatewayPage), in the shared pingStyle shape
// { GROUPS, NODES, EDGES, STEPS } for StaticFlowDiagram. STEPS[i].detail feeds the reel's detail panel:
// the request on the wire, MOCK decoded tokens (teaching values only, no real secrets) and the standards behind the step.
// Reel step k = EDGES[k]; STEPS[i].edges lists the EDGES indexes a step covers.
import { AUTH, BEARER, CREDS, EXCHANGE, MCP, INTROSPECT, AUTHZ, META, SPEC } from "./pingStyleStandards";

// Ping palette: red = Ping product (Privilege, Agent Gateway), dark = apps and agents, grey = outside Privilege.
export const GROUPS = {
  caller: { label: "Callers", bg: "#151a24" },
  priv: { label: "Agent Privilege", bg: "#b5231a" },
  ag: { label: "Agent Gateway", bg: "#b5231a" },
  server: { label: "MCP servers", bg: "#151a24" },
  ghost: { label: "Unchanged today", bg: "#5a5f69" },
};

const OPENAI_API = SPEC("OpenAI Chat Completions API", "The wire format Privilege's OpenAI lane and llama.cpp both speak");

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

// One exchanged-token step per MCP server: the Agent Gateway swaps the caller's token for one whose aud is that server.
const serverStep = (i, key, host, aud, scope, server, tool, decision) => ({
  key,
  title: `Agent Gateway to ${server}`,
  what: `The Agent Gateway exchanges the caller's token for one scoped to ${aud} and forwards the tool call. ${decision}`,
  edges: [i],
  detail: {
    form: `POST http://${host}/mcp
Authorization: Bearer <exchanged token, aud=${aud}>
Content-Type: application/json

{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"${tool}","arguments":{}}}

# before this hop, at the PingOne token endpoint (RFC 8693):
# grant_type=urn:ietf:params:oauth:grant-type:token-exchange
# subject_token=<caller token>&audience=${aud}&scope=${scope}`,
    tokens: [
      {
        note: `Exchanged token · aud ${server}`,
        header: { alg: "RS256", typ: "at+jwt", kid: "mock-key-1" },
        claims: {
          iss: "https://auth.pingone.com/MOCK-ENV-ID/as",
          sub: "user-8f3a",
          act: { sub: "privilege-bridge" },
          aud,
          scope,
          client_id: "ping-gateway-mock",
          exp: 1790000300,
        },
      },
    ],
    refs: [EXCHANGE[0], EXCHANGE[1], INTROSPECT[0], AUTHZ[2], BEARER[0], BEARER[2]],
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
Authorization: Bearer vk_MOCK_demo_bff   # Privilege virtual key, not a provider key
Content-Type: application/json

{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Summarise my accounts"}]}`,
      refs: [BEARER[0], OPENAI_API],
    },
  },
  {
    key: "bff-mcp",
    title: "BFF tool call enters the MCP lane",
    what: "With ff_mcp_gateway_privilege_first on, the tool pipeline calls Privilege's agent-gateway app instead of the Agent Gateway directly.",
    edges: [1],
    detail: {
      form: `POST https://privilege.example.com/agent-gateway/mcp
Authorization: Bearer ak_MOCK_bff_agent   # Privilege agent key
tx-token: <user's exchanged token, see claims below>
Content-Type: application/json

{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_account_balances","arguments":{"account_id":"acct-1001"}}}`,
      tokens: [
        {
          note: "tx-token · caller's exchanged token",
          header: { alg: "RS256", typ: "at+jwt", kid: "mock-key-1" },
          claims: {
            iss: "https://auth.pingone.com/MOCK-ENV-ID/as",
            sub: "user-8f3a",
            aud: "https://privilege.example.com/agent-gateway/mcp",
            scope: "banking:read",
            exp: 1790000300,
          },
        },
      ],
      refs: [MCP[0], MCP[1], MCP[2], EXCHANGE[0], EXCHANGE[2]],
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
AGENT_LLM_API_KEY=vk_MOCK_sidecar

POST /llm/openai/v1/chat/completions
Authorization: Bearer vk_MOCK_sidecar`,
      refs: [BEARER[0], OPENAI_API],
    },
  },
  {
    key: "ext-mcp",
    title: "External MCP clients sign in through a door",
    what: "A client such as LM Studio registers itself, runs OAuth with PKCE against the door, then calls the MCP lane with the access token.",
    edges: [3],
    detail: {
      form: `GET /.well-known/oauth-protected-resource   # discover the door's authorization server
POST /register                              # dynamic client registration
GET  /authorize?response_type=code&client_id=MOCK&code_challenge=MOCK&code_challenge_method=S256&resource=https://privilege.example.com/agent-gateway/mcp
POST /token  grant_type=authorization_code&code=MOCK&code_verifier=MOCK

POST /agent-gateway/mcp
Authorization: Bearer <door access token>`,
      tokens: [
        {
          note: "Door access token · issued after DCR and PKCE",
          header: { alg: "RS256", typ: "at+jwt", kid: "mock-key-1" },
          claims: {
            iss: "https://auth.pingone.com/MOCK-ENV-ID/as",
            sub: "user-8f3a",
            aud: "https://privilege.example.com/agent-gateway/mcp",
            client_id: "dcr-client-mock",
            scope: "mcp:tools",
            exp: 1790000300,
          },
        },
      ],
      refs: [...MCP, AUTH[0], AUTH[1], META[0]],
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
      refs: [OPENAI_API],
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
      refs: [BEARER[0], OPENAI_API],
    },
  },
  {
    key: "mcp-ag",
    title: "Privilege forwards to the Agent Gateway",
    what: "The MCP lane applies policy, approval and recording, then calls the registered backend. Outcome A (settled 2026-09-10): custom headers such as tx-token survive this hop.",
    edges: [6],
    detail: {
      form: `POST http://ping-gateway.ping-devops-cmuir.svc.cluster.local:8080/mcp
Authorization: Bearer <bridge token>   # Auth Mode Static Token; Auth Mode None sends no Authorization header
tx-token: <caller's exchanged token>   # custom header passes through unchanged
x-forwarded-for: 203.0.113.9
Content-Type: application/json

{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_account_balances","arguments":{"account_id":"acct-1001"}}}`,
      tokens: [
        {
          note: "Bridge token · client_credentials",
          header: { alg: "RS256", typ: "at+jwt", kid: "mock-key-1" },
          claims: {
            iss: "https://auth.pingone.com/MOCK-ENV-ID/as",
            sub: "privilege-bridge",
            client_id: "privilege-bridge",
            aud: "ping-gateway-mock",
            scope: "mcp:tools",
            exp: 1790000300,
          },
        },
      ],
      refs: [CREDS[0], BEARER[0], EXCHANGE[2], MCP[0]],
    },
  },
  serverStep(7, "ag-s1", "mcp-server:8080", "mcp-server", "banking:read", "mcp-server (banking)", "get_account_balances", "PingOne Authorize permits banking:read for this user."),
  serverStep(8, "ag-s2", "resource-srv:8081", "resource-srv", "invest:read", "resource-srv (invest)", "get_portfolio", "PingOne Authorize decides per tool before the call is forwarded."),
  serverStep(9, "ag-s3", "mcp-weather:8896", "mcp-weather", "weather:read", "mcp-weather", "get_forecast", "No user data is involved, so this tool is permitted even without a user subject."),
  serverStep(10, "ag-s4", "mcp-brave:8897", "mcp-brave", "search:read", "mcp-brave", "web_search", "No user data is involved, so this tool is permitted even without a user subject."),
];

// ---- Figure 2: the identity fork on the Privilege to Agent Gateway hop ----

export const FORK_NODES = [
  { id: "pa", group: "priv", label: "Outcome A · Privilege", sub: ["bearer in: session token", "user token in: header"], x: 0, y: 20 },
  { id: "ga", group: "ag", label: "Agent Gateway sees", sub: ["sub = user · act = [privilege-bridge]", "header validated like a bearer", "banking:read: P1AZ decides, PERMIT", "Privilege shows in act chain + audit"], x: 330, y: 20 },
  { id: "pb", group: "priv", label: "Outcome B · Privilege", sub: ["bearer in: session token", "headers dropped"], x: 740, y: 20 },
  { id: "gb", group: "ag", label: "Agent Gateway sees", sub: ["sub = privilege-bridge · no user", "no exchange can mint banking:read", "banking tools: DENY, no user", "weather · brave · opensearch: PERMIT"], x: 1070, y: 20 },
];

export const FORK_EDGES = [
  ["pa", "ga", "Bearer: bridge token + tx-token: user"],
  ["pb", "gb", "Bearer: bridge token (client_credentials)"],
];

export const FORK_STEPS = [
  {
    key: "outcome-a",
    title: "Outcome A: the user token rides in a header",
    what: "Privilege forwards the bridge token as the bearer and the caller's token in tx-token. The Agent Gateway validates it, exchanges it and records Privilege as the actor.",
    edges: [0],
    detail: {
      form: `POST /mcp HTTP/1.1
Authorization: Bearer <bridge token>
tx-token: <caller's exchanged token>
Content-Type: application/json

# Agent Gateway: validate tx-token, exchange (RFC 8693) with actor_token=<bridge token>
# resulting token: sub = user, act = privilege-bridge
# P1AZ: banking:read for this user -> PERMIT`,
      tokens: [
        {
          note: "tx-token · user subject",
          header: { alg: "RS256", typ: "at+jwt", kid: "mock-key-1" },
          claims: {
            iss: "https://auth.pingone.com/MOCK-ENV-ID/as",
            sub: "user-8f3a",
            aud: "https://privilege.example.com/agent-gateway/mcp",
            scope: "banking:read",
            exp: 1790000300,
          },
        },
        {
          note: "Token after exchange · what the Agent Gateway and servers see",
          header: { alg: "RS256", typ: "at+jwt", kid: "mock-key-1" },
          claims: {
            iss: "https://auth.pingone.com/MOCK-ENV-ID/as",
            sub: "user-8f3a",
            act: { sub: "privilege-bridge" },
            aud: "mcp-server",
            scope: "banking:read",
            exp: 1790000300,
          },
        },
      ],
      refs: [EXCHANGE[0], EXCHANGE[2], AUTHZ[3], BEARER[0], INTROSPECT[0]],
    },
  },
  {
    key: "outcome-b",
    title: "Outcome B: headers are dropped, only a machine token arrives",
    what: "If Privilege dropped custom headers the Agent Gateway would see only the bridge client. No exchange can mint banking:read without a user, so banking tools are denied.",
    edges: [1],
    detail: {
      form: `POST /mcp HTTP/1.1
Authorization: Bearer <bridge token>
Content-Type: application/json

# no tx-token: no user subject
# P1AZ: banking:read with no user -> DENY
# weather, brave, opensearch: no user data -> PERMIT`,
      tokens: [
        {
          note: "Bridge token · client_credentials, no user",
          header: { alg: "RS256", typ: "at+jwt", kid: "mock-key-1" },
          claims: {
            iss: "https://auth.pingone.com/MOCK-ENV-ID/as",
            sub: "privilege-bridge",
            client_id: "privilege-bridge",
            aud: "ping-gateway-mock",
            scope: "mcp:tools",
            exp: 1790000300,
          },
        },
      ],
      refs: [CREDS[0], EXCHANGE[0], AUTHZ[3], BEARER[0]],
    },
  },
];
