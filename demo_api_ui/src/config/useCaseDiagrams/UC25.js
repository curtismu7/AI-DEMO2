/**
 * UC25 — Enterprise-managed MCP access. One SSO sign-in gates it all: PingOne
 * group policy passes at the IdP, the BFF mints the MCP token via RFC 8693
 * (ID-JAG stand-in), and the agent connects with no consent click.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (employee)", sub: ["in allowed group"], x: 40, y: 150, detail: "Sign-in itself gates access: PingOne group policy decides who gets MCP tokens." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["no consent click"], x: 340, y: 150, detail: "Connects with no separate Connect-to-MCP consent click — the IdP gate already passed." },
  { id: "gw", group: "gateway", label: "Agent gateway / BFF", sub: ["mints MCP token"], x: 640, y: 150, detail: "The BFF mints the MCP token through RFC 8693, labeled as an ID-JAG stand-in." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["group gate at IdP"], x: 940, y: 150, detail: "Users outside the allowed groups are refused with enterprise_mcp_policy_denied." },
];

const EDGES = [
  ["user", "p1", "one SSO sign-in", { detail: "One PingOne sign-in; policy is evaluated at the IdP, not per click." }],
  ["agent", "gw", "show my balance", { detail: "The agent connects directly — enterprise-managed mode, no per-user MCP consent step." }],
  ["gw", "p1", "ID-JAG stand-in exchange", { detail: "RFC 8693 token exchange mints the MCP token under the group gate." }],
  ["p1", "gw", "token issued", { detail: "Issuance is what the group gate controls — deny here and no MCP token exists." }],
  ["gw", "agent", "tool dispatched", { detail: "The token chain shows enterprise-managed mode end to end." }],
];

const walk = [
  {
    title: "One SSO sign-in", label: "Gate at the IdP",
    nodes: ["user", "p1"], edges: [0],
    lines: [{ who: "PingOne", text: "The IT group gate passes at sign-in — access is centralized in PingOne." }],
    tech: [{ t: "TOKEN", c: "ID token minted; enterprise-managed MCP mode on" }],
  },
  {
    title: "Agent connects", label: "No consent click",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Agent", text: "No Connect-to-MCP consent step — the group gate already authorized the session." }],
    tech: [{ t: "API", c: "agent connects to gateway; no per-user MCP consent step" }],
  },
  {
    title: "ID-JAG stand-in", label: "RFC 8693 at the BFF",
    nodes: ["gw", "p1"], edges: [2, 3],
    lines: [{ who: "Gateway", text: "The BFF mints the MCP token through token exchange; outside the group, enterprise_mcp_policy_denied." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 (ID-JAG stand-in) -> MCP AT for allowed group" }],
  },
  {
    title: "Tool dispatched", label: "Enterprise-managed on the chain",
    nodes: ["gw", "agent"], edges: [4],
    lines: [{ who: "Gateway", text: "'show my balance' runs, and the token chain shows enterprise-managed mode end to end." }],
    tech: [{ t: "API", c: "show_balance dispatched; token chain shows enterprise-managed mode" }],
  },
];

export default {
  id: "UC25",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
