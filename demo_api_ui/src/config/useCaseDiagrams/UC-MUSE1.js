/**
 * UC-MUSE1 — External agent (Muse et al.) standard lane. The user's own
 * agent discovers the door (RFC 9728), self-registers (DCR), logs in (PKCE),
 * and calls tools through PingGateway with a delegated token — sub=user,
 * act=agent on every hop. The agent runs on the user's machine; governance
 * is entirely Ping.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["owns the agent"], x: 40, y: 150, detail: "Runs Muse on her machine and asks it for her balance — the agent is hers, not the bank's." },
  { id: "agent", group: "external", label: "Muse agent", sub: ["user's machine"], x: 340, y: 150, detail: "Any spec-compliant MCP client. Discovers the door, self-registers, holds no keys of its own." },
  { id: "door", group: "gateway", label: "MCP door", sub: ["RFC 9728 + DCR"], x: 640, y: 150, detail: "PingGateway external door: discovery, DCR, PKCE login, then enforcement on every /mcp call." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["exchange + policy"], x: 940, y: 150, detail: "Mints the delegated token (sub=alice, act=muse client) and evaluates policy (P1AZ) per tool call." },
  { id: "tool", group: "resource", label: "Bank tools", sub: ["behind the gateway"], x: 1240, y: 150, detail: "Tools execute only after the gateway's P1AZ decision; every hop is audited." },
];

const EDGES = [
  ["user", "agent", "asks for balance", { detail: "Natural language in Muse; the agent picks the tool." }],
  ["agent", "door", "discover, register, log in", { detail: "RFC 9728 metadata -> RFC 7591 DCR -> PKCE login in Alice's browser." }],
  ["door", "p1", "exchange + decide", { detail: "RFC 8693 mints sub=alice, act=muse; P1AZ evaluates the call." }],
  ["p1", "tool", "PERMIT + dispatch", { detail: "Delegated token stamped on the call; the tool runs." }],
  ["tool", "user", "answer", { detail: "Balance lands in Muse; the chain is on the record." }],
];

const walk = [
  {
    title: "The user's agent asks", label: "Muse on Alice's Mac",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "Show my checking balance — asked in Muse, not the bank's app." }],
    tech: [{ t: "API", c: "Muse -> POST /mcp tools/call get_banking_account" }],
  },
  {
    title: "Door onboarding", label: "discover, register, log in",
    nodes: ["agent", "door"], edges: [1],
    lines: [{ who: "Door", text: "Never seen this client. RFC 9728 tells it where to register; DCR takes it from there." }],
    tech: [
      { t: "API", c: "GET /.well-known/oauth-protected-resource/mcp -> authorization_servers" },
      { t: "API", c: "POST /register (RFC 7591 DCR) -> client_id issued" },
      { t: "POLICY", c: "PKCE authorization code + browser login (no pre-registration)" },
    ],
  },
  {
    title: "Authority minted", label: "sub=alice, act=muse",
    nodes: ["door", "p1"], edges: [2],
    lines: [{ who: "PingOne", text: "The agent never holds Alice's password or a long-lived key — authority is minted per call." }],
    tech: [
      { t: "TOKEN", c: "RFC 8693 exchange -> AT: sub=alice, act={sub:muse-client}" },
      { t: "POLICY", c: "P1AZ decision: PERMIT (scope accounts:read)" },
    ],
  },
  {
    title: "Tool runs", label: "behind the gateway",
    nodes: ["p1", "tool"], edges: [3],
    lines: [{ who: "Gateway", text: "Every hop audited: who, which agent, which tool, decision." }],
    tech: [{ t: "API", c: "gateway -> tool dispatch with delegated AT (aud=mcp-gw)" }],
  },
  {
    title: "Answer on the record", label: "chain visible",
    nodes: ["tool", "user"], edges: [4],
    lines: [{ who: "Presenter", text: "Same governance as our own agent — the trust layer never cared whose agent it was." }],
    tech: [{ t: "POLICY", c: "audit: sub=alice act=muse tool=get_banking_account decision=PERMIT" }],
  },
];

export default {
  id: "UC-MUSE1",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
