/**
 * UC44 — Workload Agent: OBO customer-data read. A signed-in customer asks a
 * hosted Digital Assistant for her balance; the assistant acts under its own
 * pre-registered PingOne identity, and two RFC 8693 exchanges mint a delegated
 * token (sub = customer, act = assistant) that passes the gateway, Authorize
 * and the MCP resource server with attribution intact.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

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

export default {
  id: "UC44",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
