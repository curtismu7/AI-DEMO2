/**
 * UC40 — Enterprise-Managed MCP Authorization (native ID-JAG). Group policy at
 * the IdP issues a single-use ID-JAG; the agent redeems it at the MCP
 * authorization server for a scoped access token. No consent screen per MCP
 * server, no shared static credential. PingFederate lane (PingOne N/A).
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "it", group: "user", label: "IT (group policy)", sub: ["per emp · per server"], x: 40, y: 150, detail: "Grants MCP access as group policy at the IdP — the decision lives where IT already controls it." },
  { id: "pf", group: "pingone", label: "PingFederate", sub: ["issues ID-JAG"], x: 340, y: 150, detail: "Asserts the grant as a single-use, short-lived ID-JAG — no browser consent screen." },
  { id: "agent", group: "agent", label: "Agent framework", sub: ["no shared secret"], x: 640, y: 150, detail: "Holds no shared static credential; it redeems the ID-JAG at the MCP AS." },
  { id: "mcp", group: "resource", label: "MCP auth server", sub: ["redeem -> token"], x: 940, y: 150, detail: "Validates the ID-JAG and issues a scoped access token, visible on the live token chain." },
  ];

const EDGES = [
  ["it", "pf", "group policy", { detail: "Per-employee, per-server access decided centrally." }],
  ["pf", "agent", "ID-JAG issued", { detail: "Single-use, short-lived assertion of the grant." }],
  ["agent", "mcp", "redeem ID-JAG", { detail: "The redemption is the agent's whole credential story." }],
  ["mcp", "agent", "scoped token", { detail: "The access token calls the tool; every hop is on the chain." }],
  ["it", "it", "grant + revocation", { detail: "Decision, issuance and revocation stay in one place IT controls." }],
];

const walk = [
  {
    title: "Group policy", label: "IT decides",
    nodes: ["it", "pf"], edges: [0],
    lines: [{ who: "IT", text: "Per-employee, per-server MCP access — granted where grants belong." }],
    tech: [{ t: "POLICY", c: "IdP group policy: employee E, server S -> allowed" }],
  },
  {
    title: "ID-JAG issued", label: "Single-use assertion",
    nodes: ["pf", "agent"], edges: [1],
    lines: [{ who: "PingFederate", text: "No consent screen per MCP server — the IdP asserts the grant directly." }],
    tech: [{ t: "TOKEN", c: "ID-JAG: single-use, short-lived (oauth-id-jag+jwt)" }],
  },
  {
    title: "Redeemed at the MCP AS", label: "No shared credential",
    nodes: ["agent", "mcp"], edges: [2],
    lines: [{ who: "Agent", text: "The framework never holds a static secret — the ID-JAG is the proof." }],
    tech: [{ t: "TOKEN", c: "ID-JAG redeemed at MCP authorization server" }],
  },
  {
    title: "Scoped token", label: "Tool called",
    nodes: ["mcp", "agent"], edges: [3],
    lines: [{ who: "MCP AS", text: "The access token is scoped and visible on the live token chain." }],
    tech: [{ t: "TOKEN", c: "chain: user-token -> id-jag-issued -> id-jag-redeemed -> tool" }],
  },
  {
    title: "IT owns it all", label: "Grant + revocation",
    nodes: ["it"], edges: [4],
    lines: [{ who: "Presenter", text: "Decision, issuance, revocation — one place IT already controls." }],
    tech: [{ t: "POLICY", c: "central grant/revocation at the IdP (no per-server screens)" }],
  },
];

export default {
  id: "UC40",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
