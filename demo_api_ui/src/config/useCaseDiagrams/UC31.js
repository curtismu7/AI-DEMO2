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
  ["gw", "agent", "one policy live", { lane: 70, detail: "A policy change applies to every agent immediately — no tool edit." }],
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

// Per-step detail (shown for the active beat). Forms mirror services/mcpGatewayClient.js (tools/call body, deny mapping),
// ping-gateway/scripts/groovy/tx-weather-scope.groovy (the real 403 body) and routes/featureFlags.js (PATCH).
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST {gateway}/mcp/weather\nContent-Type: application/json\nAccept: application/json, text/event-stream\nMCP-Protocol-Version: <version>\nX-Correlation-ID: <correlation id>\n(no Authorization header: public tool, guest chip)\n\n{ \"jsonrpc\": \"2.0\", \"id\": \"<correlation id>\", \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_weather\", \"arguments\": { \"city_name\": \"Miami\" },\n             \"correlationId\": \"<correlation id>\" } }",
      refs: [{ id: "MCP tools/call", title: "Model Context Protocol: calling a tool over JSON-RPC", kind: "spec" }],
    },
  },
  {
    beats: [1],
    detail: {
      form: "GET {BFF_WEATHER_FLAG_URL}\nx-internal-gateway-secret: <internal secret>\n\n200 { \"enabled\": true, \"allowedState\": \"texas\",\n       \"blockedCities\": [], \"blockRadiusDeg\": 0.2 }\n\n-> \"miami\": no \", ST\" qualifier and not in the Texas city list -> denied",
    },
  },
  {
    beats: [2],
    detail: {
      form: "403 Forbidden (from the gateway; nothing reaches the weather server)\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": \"<correlation id>\",\n  \"error\": { \"code\": -32000,\n             \"message\": \"Agent Gateway: weather scope restricted to Texas (demo policy) \u2014 city not recognized as Texas\" } }\n\nThe BFF surfaces it as code gateway_policy_denied, httpStatus 403, gatewayErrorCode weather_scope_denied.",
    },
  },
  {
    beats: [3],
    detail: {
      form: "PATCH /api/admin/feature-flags\nContent-Type: application/json\n\n{ \"updates\": { \"ff_weather_mcp_allowed_state\": \"any\" } }\n\n200 { \"updated\": true, \"flags\": [ ... ] }\n(the gateway re-reads the flag on the next call; allowed values: texas | michigan | any | any-except-blocked)",
    },
  },
];

export default {
  id: "UC31",
  result: { label: "DENY", tone: "err" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
