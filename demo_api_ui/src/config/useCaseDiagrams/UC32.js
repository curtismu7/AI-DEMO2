/**
 * UC32 — Live-reconfigure the gateway's scope policy. The Weather MCP page has
 * an admin-editable Allowed State dropdown; the same Miami query flips from
 * denied (Texas) to permitted (Any) with no restart. A policy that needs a
 * code change isn't externalized — this one demonstrably is.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "before", group: "agent", label: "Miami → DENY", sub: ["Texas"], x: 40, y: 150, detail: "Starting state: the same query as UC31 is refused at the gateway." },
  { id: "admin", group: "user", label: "Admin", sub: ["Allowed State dropdown"], x: 340, y: 150, detail: "The Weather MCP page exposes the scope as an admin-editable dropdown: Texas, Michigan, Any." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["reads policy live"], x: 640, y: 150, detail: "The scope is a live policy value (ff_weather_mcp_allowed_state) read on every request." },
  { id: "after", group: "agent", label: "Miami → PERMIT", sub: ["Any"], x: 940, y: 150, detail: "The identical query now passes — no restart, no redeploy, no code change." },
  ];

const EDGES = [
  ["before", "admin", "same ask, refused", { detail: "Where the demo starts." }],
  ["admin", "gw", "switch to Any", { detail: "The admin edits the policy value; nothing restarts." }],
  ["gw", "after", "same query permitted", { detail: "The next request reads the new value." }],
  ["admin", "gw", "baseline restored", { detail: "Leaving the page restores Texas for the documented start state." }],
  ["gw", "gw", "policy read live", { detail: "The gateway reads the policy value on every request." }],
];

const walk = [
  {
    title: "Start denied", label: "Texas",
    nodes: ["before", "admin"], edges: [0],
    lines: [{ who: "Presenter", text: "UC31's result, held on screen as the baseline." }],
    tech: [{ t: "POLICY", c: "allowed_state=Texas -> Miami denied" }],
  },
  {
    title: "Admin opens the dropdown", label: "Texas · Michigan · Any",
    nodes: ["admin", "gw"], edges: [1],
    lines: [{ who: "Admin", text: "The scope is a policy value, not app logic — editing it is a UI act." }],
    tech: [{ t: "POLICY", c: "ff_weather_mcp_allowed_state: Texas -> Any" }],
  },
  {
    title: "Value goes live", label: "Read on every request",
    nodes: ["gw"], edges: [4],
    lines: [{ who: "Gateway", text: "No restart, no redeploy — the next request already reads Any." }],
    tech: [{ t: "POLICY", c: "policy read per-request (no restart)" }],
  },
  {
    title: "Same query permitted", label: "Miami → PERMIT",
    nodes: ["gw", "after"], edges: [2],
    lines: [{ who: "Presenter", text: "The identical Miami query flips decision. Externalized governance, proven." }],
    tech: [{ t: "POLICY", c: "allowed_state=Any -> Miami permitted" }],
  },
  {
    title: "Baseline restored", label: "Texas again on exit",
    nodes: ["after", "admin"], edges: [3],
    lines: [{ who: "Presenter", text: "Leaving the page restores Texas so UC30/UC31 start from the documented policy." }],
    tech: [{ t: "POLICY", c: "demo guard: page exit restores allowed_state=Texas" }],
  },
];

export default {
  id: "UC32",
  result: { label: "RECONFIGURED", tone: "warn" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
