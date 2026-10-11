/**
 * UC42 — Third-party search server — blocked query denied. The mirror of
 * UC41: 'search the news for bitcoin price today' matches the content
 * blocklist at the gateway edge and the call is denied before egress — Brave
 * never sees the query. No vendor log, no billed call, no data leaving the
 * perimeter.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "agent", group: "agent", label: "Banking agent", sub: ["crypto ask"], x: 40, y: 150, detail: "Sends 'search the news for bitcoin price today' — the same chip pattern as UC41; only the query differs." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["blocked term match"], x: 340, y: 150, detail: "Matches 'bitcoin' in the content blocklist at the edge — a policy that only catches bad queries after the vendor ran them is not a control." },
  { id: "brave", group: "external", label: "Brave Search MCP", sub: ["never sees it"], x: 640, y: 150, detail: "The third-party server receives nothing — the query died at the gateway. No vendor log, no billed call, no data left the perimeter." },
];

const EDGES = [
  ["agent", "gw", "search the news for bitcoin price today", { detail: "The query names a blocked topic — demo bank policy says no crypto research through the agent gateway." }],
  ["gw", "gw", "'bitcoin' ∈ blocklist", { detail: "The content blocklist matches at the edge: bitcoin, cryptocurrency, crypto." }],
  ["gw", "brave", "nothing forwarded", { detail: "The deny happens before egress — the request is never sent to Brave." }],
  ["gw", "agent", "DENY before egress", { detail: "The agent gets the refusal from its own gateway — one place, every tool integration, no vendor cooperation." }],
];

const walk = [
  {
    title: "The crypto ask", label: "Same chip, blocked topic",
    nodes: ["agent", "gw"], edges: [0],
    lines: [{ who: "Agent", text: "Identical pattern to UC41 — only the query text differs, and that is what the policy reads." }],
    tech: [{ t: "API", c: "tools/call brave_news_search query='bitcoin price today'" }],
  },
  {
    title: "Blocklist matches", label: "Denied at the edge",
    nodes: ["gw"], edges: [1],
    lines: [{ who: "Gateway", text: "The block has to happen before the request leaves the building — enforced once, here, instead of in every tool integration." }],
    tech: [{ t: "POLICY", c: "blocked terms [bitcoin, cryptocurrency, crypto]; query matches 'bitcoin' -> DENY" }],
  },
  {
    title: "Brave never sees it", label: "No egress",
    nodes: ["gw", "brave"], edges: [2],
    lines: [{ who: "Presenter", text: "No vendor log, no billed call, no data leaving the perimeter — the enforcement point is ours." }],
    tech: [{ t: "API", c: "no request leaves the gateway (tool-dispatch never ran)" }],
  },
  {
    title: "DENY back to the agent", label: "Run 41 and 42 together",
    nodes: ["gw", "agent"], edges: [3],
    lines: [{ who: "Presenter", text: "Same Brave route as the permit case — the contrast is the lesson: one gateway policy, two outcomes." }],
    tech: [{ t: "POLICY", c: "data-egress control centralized at the gateway edge (no vendor-side policy)" }],
  },
];

export default {
  id: "UC42",
  result: { label: "DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
