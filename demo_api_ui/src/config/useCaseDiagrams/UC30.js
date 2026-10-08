/**
 * UC30 — Third-party MCP server, scoped at the gateway. A real, unmodified
 * weather MCP server behind the Agent Gateway: Austin is inside the
 * admin-configured state scope, so the call forwards and weather returns.
 * The gateway enforces the business boundary, not the tool.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "agent", group: "agent", label: "Banking agent", sub: ["weather ask"], x: 40, y: 150, detail: "Sends 'what's the weather in Austin, TX' — no sign-in needed; the tool is public but governed." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["state-scope policy"], x: 340, y: 150, detail: "Enforces a live, admin-configurable state scope (Texas by default) at the edge." },
  { id: "wx", group: "external", label: "Weather MCP", sub: ["unmodified"], x: 640, y: 150, detail: "A real third-party server. Nothing about it was changed to fit the demo." },
];

const EDGES = [
  ["agent", "gw", "weather: Austin, TX", { detail: "The city named in the call is what the policy reads." }],
  ["gw", "gw", "Austin ∈ Texas", { detail: "Inside the configured scope: the check passes." }],
  ["gw", "wx", "forwarded", { detail: "The third-party server receives the call — its backend knows nothing of the restriction." }],
  ["wx", "agent", "weather returns", { detail: "The reply carries the weather with the gateway hop on the record." }],
];

const walk = [
  {
    title: "Austin ask", label: "No sign-in needed",
    nodes: ["agent", "gw"], edges: [0],
    lines: [{ who: "Agent", text: "The chip is public — governance is at the gateway, not the login." }],
    tech: [{ t: "API", c: "tools/call get_weather city='Austin, TX'" }],
  },
  {
    title: "Scope check", label: "Policy at the edge",
    nodes: ["gw"], edges: [1],
    lines: [{ who: "Gateway", text: "The allowed state is a live policy value — Texas by default." }],
    tech: [{ t: "POLICY", c: "allowed_state=Texas; city Austin ∈ Texas -> pass" }],
  },
  {
    title: "Forwarded unmodified", label: "Third party runs",
    nodes: ["gw", "wx"], edges: [2],
    lines: [{ who: "Weather MCP", text: "A real, unmodified third-party server answers the call." }],
    tech: [{ t: "API", c: "gateway -> weather MCP (third-party, unmodified)" }],
  },
  {
    title: "Weather returns", label: "PERMIT on the record",
    nodes: ["wx", "agent"], edges: [3],
    lines: [{ who: "Presenter", text: "Any third-party server can be governed this way — no integration code changed." }],
    tech: [{ t: "POLICY", c: "user-token -> tool-dispatched (gateway hop recorded)" }],
  },
];

export default {
  id: "UC30",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
