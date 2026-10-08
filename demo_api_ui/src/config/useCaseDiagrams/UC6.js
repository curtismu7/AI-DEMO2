/**
 * UC6 — Authz denied. Pilot diagram: the deny shape. A valid token, a $2,500
 * transfer over the policy ceiling: Authorize returns DENY before the tool
 * runs, so no money moves. The deny IS the feature.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "agent", group: "agent", label: "Banking agent", sub: ["$2,500 transfer"], x: 40, y: 150, detail: "Makes the request with a perfectly valid token — that is not the question." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["asks Authorize"], x: 340, y: 150, detail: "Asks Authorize before any tool runs; enforces the answer instantly." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["policy ceiling"], x: 640, y: 150, detail: "Policy: transfers above $2,000 are denied, whatever the token allows." },
];

const EDGES = [
  ["agent", "gw", "tool call $2,500", { detail: "Token is valid — that's not what policy evaluates." }],
  ["gw", "p1", "evaluate policy", { detail: "Scope-to-tool mapping and ceilings checked in policy, not code." }],
  ["p1", "gw", "DENY", { detail: "Over the ceiling: DENY comes back before the tool runs." }],
  ["gw", "agent", "403 — nothing moved", { detail: "No tool dispatch, no data touched. The deny is the feature." }],
];

const walk = [
  {
    title: "Agent requests $2,500", label: "Valid token, wrong request",
    nodes: ["agent", "gw"], edges: [0],
    lines: [{ who: "Agent", text: "Everything about the token checks out. The amount does not." }],
    tech: [{ t: "API", c: "POST /gateway/mcp tools/call transfer_funds amount=2500" }],
  },
  {
    title: "Gateway asks policy", label: "Before any tool runs",
    nodes: ["gw", "p1"], edges: [1],
    lines: [{ who: "Gateway", text: "The decision belongs to Authorize, not to the agent." }],
    tech: [{ t: "POLICY", c: "Authorize evaluates: scope ok, ceiling check pending" }],
  },
  {
    title: "DENY", label: "Over the $2,000 ceiling",
    nodes: ["p1", "gw"], edges: [2],
    lines: [{ who: "PingOne", text: "The ceiling is a rule; changing it is a console edit, not a deploy." }],
    tech: [{ t: "POLICY", c: "Authorize: amount > deny ceiling 2000 -> DENY (tool never runs)" }],
  },
  {
    title: "Nothing moved", label: "Enforced instantly",
    nodes: ["gw", "agent"], edges: [3],
    lines: [{ who: "Gateway", text: "No tool dispatch. The audience sees DENY in chat and in the token chain." }],
    tech: [{ t: "API", c: "gateway returns 403 tool_denied; authorize-decision step recorded" }],
  },
];

export default {
  id: "UC6",
  result: { label: "DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
