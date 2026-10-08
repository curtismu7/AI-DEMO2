/**
 * UC31 — Third-party MCP server, out-of-scope call denied. Miami is outside
 * the configured state scope: the gateway denies egress before the third
 * party runs. The weather server never sees the request.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "agent", group: "agent", label: "Banking agent", sub: ["weather: Miami"], x: 40, y: 150, detail: "Same tool, same chip pattern — but the city is outside the configured state scope." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["egress check"], x: 340, y: 150, detail: "The scope policy is enforced before the third party runs — egress control, not ingress." },
  { id: "wx", group: "external", label: "Weather MCP", sub: ["never sees it"], x: 640, y: 150, detail: "The third-party server receives nothing; the call died at the gateway." },
  ];

const EDGES = [
  ["agent", "gw", "weather: Miami", { detail: "The ask names a city outside Texas." }],
  ["gw", "gw", "Miami ∉ Texas", { detail: "The scope check fails at the edge." }],
  ["gw", "agent", "denied", { detail: "The call is refused before any egress." }],
  ["gw", "agent", "one policy live", { detail: "A policy change applies to every agent immediately — no tool edit." }],
];

const walk = [
  {
    title: "Miami ask", label: "Same tool, out of scope",
    nodes: ["agent", "gw"], edges: [0],
    lines: [{ who: "Agent", text: "Identical chip pattern to UC30 — only the city differs." }],
    tech: [{ t: "API", c: "tools/call get_weather city='Miami'" }],
  },
  {
    title: "Egress check fails", label: "Miami ∉ Texas",
    nodes: ["gw"], edges: [1],
    lines: [{ who: "Gateway", text: "The scope policy reads the city and refuses at the edge." }],
    tech: [{ t: "POLICY", c: "allowed_state=Texas; city Miami ∉ Texas -> egress denied" }],
  },
  {
    title: "Third party never sees it", label: "Denied before egress",
    nodes: ["gw", "wx"], edges: [2],
    lines: [{ who: "Presenter", text: "The weather server receives nothing — the enforcement was at the gateway." }],
    tech: [{ t: "API", c: "no request leaves the gateway (tool-dispatch never ran)" }],
  },
  {
    title: "One policy, every agent", label: "Change once, applies live",
    nodes: ["gw", "agent"], edges: [3],
    lines: [{ who: "Presenter", text: "A policy change takes effect for every agent immediately — no tool edit." }],
    tech: [{ t: "POLICY", c: "scoping enforced once at the gateway (all agents)" }],
  },
];

export default {
  id: "UC31",
  result: { label: "DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
