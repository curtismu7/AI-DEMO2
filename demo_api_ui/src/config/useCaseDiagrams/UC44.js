/**
 * UC44 — Workload Agent: OBO customer-data read. A signed-in customer asks a
 * hosted Digital Assistant for her balance; the assistant acts under its own
 * pre-registered PingOne identity, and two RFC 8693 exchanges mint a delegated
 * token (sub = customer, act = assistant) that passes the gateway, Authorize
 * and the MCP resource server with attribution intact.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, SPEC } from "../pingStyleStandards";

const NODES = [
  { id: "user", group: "user", label: "Alice (customer)", sub: ["signs in once"], x: 40, y: 150, detail: "Signed-in customer; her access token is the subject authority the exchange spends — she never becomes a client credential." },
  { id: "agent", group: "agent", label: "Digital Assistant", sub: ["workload agent", "own PingOne identity"], x: 340, y: 150, detail: "Pre-registered Workload Agent with its own PingOne application; it presents a client-credentials actor token and never collapses into the customer identity." },
  { id: "gw", group: "gateway", label: "BFF + Agent Gateway", sub: ["registration check", "2x RFC 8693"], x: 640, y: 150, detail: "The BFF verifies the customer's workload-agent registration, mints the agent actor token, and drives both RFC 8693 exchanges with PingOne before routing the tool call." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["token exchange", "Authorize"], x: 940, y: 150, detail: "PingOne validates subject and actor, mints the nested act chain, and Authorize evaluates the delegation policy for each exchange and each tool call." },
  { id: "acct", group: "resource", label: "Customer-data API", sub: ["get_account_balance", "read-only"], x: 1240, y: 150, detail: "MCP resource server serving get_account_balance; validates the delegated token's audience and scope on every call." },
];

const EDGES = [
  ["user", "agent", "show my balance", { detail: "Alice asks the hosted assistant for her balance; the agent will act under its own identity, for her." }],
  ["agent", "gw", "registered identity", { detail: "The BFF confirms this customer has a registered workload agent — enabled, client_credentials, readable secret — or stops with agent_not_registered." }],
  ["gw", "p1", "RFC 8693 x2", { detail: "Two exchanges: user token plus agent actor token first, then onto the MCP audience — final token carries sub=customer, act=assistant." }],
  ["p1", "acct", "gateway + Authorize", { detail: "The gateway validates the delegated token and Authorize evaluates subject, actor, scopes and ownership before get_account_balance executes." }],
  ["acct", "user", "attribution intact", { detail: "The balance is shown, and the audit trail names both identities: who authorized the read and which workload agent performed it." }],
];

const walk = [
  {
    title: "The ask", label: "show my balance",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "Alice asks the hosted Digital Assistant for her balance; the assistant will act under its own identity, for her." }],
    tech: [
      { t: "API", c: "POST /api/agent/invoke  { prompt: 'show my balance' }" },
      { t: "TOKEN", c: "user AT (session): sub=alice, scope=read — act absent" },
    ],
  },
  {
    title: "Workload agent verified", label: "registered identity",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "BFF", text: "The BFF confirms this customer has a registered workload agent — enabled, client_credentials, readable secret — otherwise the run stops with agent_not_registered." }],
    tech: [
      { t: "POLICY", c: "getRuntimeForUser: PingOne workload app + OAuth client required, else agent_not_registered" },
      { t: "TOKEN", c: "agent actor token (CC): aud=agentgateway.ping.demo, scope=agent:invoke" },
    ],
  },
  {
    title: "Token exchange", label: "RFC 8693 x2",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "BFF → PingOne", text: "PingOne runs two RFC 8693 exchanges: user token plus the agent's actor token first, then onto the MCP audience. The final token carries sub=customer, act=assistant." }],
    tech: [
      { t: "TOKEN", c: "#1 grant_type=token-exchange: subject=user AT, actor=agent CC → intermediate aud=agentgateway.ping.demo, act minted" },
      { t: "TOKEN", c: "#2 subject=intermediate, actor=MCP CC (mcp:invoke) → final aud=mcpserver.ping.demo, act.sub forwarded" },
    ],
  },
  {
    title: "Delegated tool call", label: "gateway + Authorize",
    nodes: ["p1", "acct"], edges: [3],
    lines: [{ who: "MCP gateway", text: "The gateway validates the delegated token and PingOne Authorize evaluates subject, actor, scopes and ownership on every call before get_account_balance executes." }],
    tech: [
      { t: "API", c: "POST /mcp  tools/call get_account_balance  Bearer <final token>" },
      { t: "POLICY", c: "aud + scope=read + resource ownership checked per call → PERMIT" },
    ],
  },
  {
    title: "Balance returns", label: "attribution intact",
    nodes: ["acct", "user"], edges: [4],
    lines: [{ who: "Presenter", text: "The balance is shown, and the audit trail names both identities: who authorized the read and which workload agent performed it." }],
    tech: [
      { t: "API", c: "tool result → reply: balance shown to the customer" },
      { t: "TOKEN", c: "final token audit: sub=alice, act={sub:<agent client>} — attribution preserved" },
    ],
  },
];

// Per-step detail: request forms use placeholders, tokens are decoded MOCK values, refs are published RFCs/specs or marked emerging drafts.
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /api/agent/invoke\nCookie: <session cookie>\nContent-Type: application/json\n\n{ \"prompt\": \"show my balance\" }",
      tokens: [{
        note: "User access token from the session (decoded mock) · no act claim yet",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://bff.ping.demo", scope: "read", exp: 1790000000 },
      }],
      refs: [SPEC("OIDC Core 1.0", "Sign-in that mints the user token")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "POST /as/token   (PingOne, client_credentials for the agent actor token)\nContent-Type: application/x-www-form-urlencoded\nAuthorization: Basic <agent client id:secret>\n\ngrant_type=client_credentials\n&scope=agent:invoke\n&resource=agentgateway.ping.demo\n\nNo registered workload agent -> agent_not_registered, run stops",
      tokens: [{
        note: "Agent actor token (decoded mock)",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "digital-assistant-client", aud: "agentgateway.ping.demo", scope: "agent:invoke", exp: 1790000300 },
      }],
      refs: [RFC(6749, "Client credentials grant (section 4.4)"), RFC(7523, "JWT client authentication (alternative to the secret)")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "POST /as/token   (PingOne, exchange 1 of 2)\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&subject_token=<user access token>\n&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n&actor_token=<agent actor token>\n&actor_token_type=urn:ietf:params:oauth:token-type:access_token\n&audience=agentgateway.ping.demo\n\nExchange 2 repeats with subject_token=<intermediate token>, actor_token=<MCP client credentials token>, audience=mcpserver.ping.demo",
      tokens: [
        { note: "Input · subject_token (user access token, decoded mock)", header: { alg: "RS256", typ: "at+jwt" }, claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", scope: "read" } },
        { note: "Input · actor_token (agent actor token, decoded mock)", header: { alg: "RS256", typ: "at+jwt" }, claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "digital-assistant-client", scope: "agent:invoke" } },
        { note: "Output · final delegated token (decoded mock)", header: { alg: "RS256", typ: "at+jwt" }, claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "mcpserver.ping.demo", scope: "read", act: { sub: "digital-assistant-client" }, exp: 1790000300 } },
      ],
      refs: [RFC(8693, "Token Exchange: subject_token, actor_token and act"), RFC(8707, "Resource Indicators (audience per hop)")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST /mcp\nAuthorization: Bearer <final delegated token>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_account_balance\", \"arguments\": {} } }\n\nPingOne Authorize per call: aud, scope=read and resource ownership -> PERMIT",
      tokens: [{
        note: "Final delegated token the gateway validates (decoded mock)",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "mcpserver.ping.demo", scope: "read", act: { sub: "digital-assistant-client" } },
      }],
      refs: [RFC(6750, "Bearer token usage"), RFC(9068, "JWT profile for access tokens"), SPEC("OpenID AuthZEN", "Standard PEP to PDP authorization API")],
    },
  },
  {
    beats: [4],
    detail: {
      form: "-> 200\n{ \"reply\": \"<balance message>\" }\n\nAudit record: sub=alice-0001 (who authorized), act.sub=digital-assistant-client (who performed it)",
      tokens: [],
      refs: [RFC(8693, "act claim: attribution of the acting party")],
    },
  },
];

export default {
  id: "UC44",
  result: { label: "PERMIT", tone: "ok" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
