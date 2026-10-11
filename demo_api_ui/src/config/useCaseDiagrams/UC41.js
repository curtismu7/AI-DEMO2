/**
 * UC41 — Third-party search server, filtered at the gateway. A real Brave
 * Search MCP server behind the Agent Gateway: 'search the news for PingOne
 * DaVinci' carries no blocked term, so the gateway checks the query against
 * the content blocklist and forwards it. The vendor never even knows a policy
 * exists. Mirror of UC42 (the blocked-query deny).
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "agent", group: "agent", label: "Banking agent", sub: ["news ask"], x: 40, y: 150, detail: "Sends 'search the news for PingOne DaVinci' — an ordinary business search, no sign-in needed." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["content blocklist"], x: 340, y: 150, detail: "Checks the query argument against the content policy BEFORE the request leaves the perimeter — egress control on tool calls." },
  { id: "brave", group: "external", label: "Brave Search MCP", sub: ["third-party", "unmodified"], x: 640, y: 150, detail: "A real, unmodified third-party MCP server fronting the Brave Search API — it has no concept of the bank's content policy." },
];

const EDGES = [
  ["agent", "gw", "search the news for PingOne DaVinci", { detail: "The query text is what the policy reads — no blocked term in it." }],
  ["gw", "gw", "no blocked term", { detail: "The content blocklist matches nothing: bitcoin, cryptocurrency, crypto are absent." }],
  ["gw", "brave", "forwarded", { detail: "The gateway forwards the call to the real Brave server — the vendor never sees a policy, only a query." }],
  ["brave", "agent", "live results return", { detail: "Live search results come back through the governed path — the gateway hop is on the record." }],
];

const walk = [
  {
    title: "The business ask", label: "Ordinary search",
    nodes: ["agent", "gw"], edges: [0],
    lines: [{ who: "Agent", text: "An agent that can search the open web is useful and dangerous in the same breath — the policy reads every query." }],
    tech: [{ t: "API", c: "tools/call brave_news_search query='PingOne DaVinci'" }],
  },
  {
    title: "Content check at the edge", label: "Before egress",
    nodes: ["gw"], edges: [1],
    lines: [{ who: "Gateway", text: "The blocklist lives at the gateway edge, before the request leaves the building — not after the vendor has run it." }],
    tech: [{ t: "POLICY", c: "blocked terms [bitcoin, cryptocurrency, crypto]; query contains none -> pass" }],
  },
  {
    title: "Forwarded to the real vendor", label: "Unmodified third party",
    nodes: ["gw", "brave"], edges: [2],
    lines: [{ who: "Gateway", text: "The gateway fronts an unmanaged third-party server without modifying or trusting it — PingGateway Brave route." }],
    tech: [{ t: "API", c: "gateway -> Brave Search MCP (third-party, unmodified); tx-brave-scope.groovy" }],
  },
  {
    title: "Live results", label: "Governed egress",
    nodes: ["brave", "agent"], edges: [3],
    lines: [{ who: "Presenter", text: "The vendor knows nothing of the policy — governance sat entirely at our edge." }],
    tech: [{ t: "API", c: "search results return; chain: user-token -> tool-dispatched" }],
  },
];

export default {
  id: "UC41",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
