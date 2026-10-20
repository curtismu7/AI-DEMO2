/**
 * UC30 — Third-party MCP server, scoped at the gateway. A real, unmodified
 * weather MCP server behind the Agent Gateway: Austin is inside the
 * admin-configured state scope, so the call forwards and weather returns.
 * The gateway enforces the business boundary, not the tool.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "agent", group: "agent", label: "Banking agent", sub: ["weather ask"], x: 640, y: 290, detail: "Sends 'what's the weather in Austin, TX' — no sign-in needed; the tool is public but governed." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["state-scope policy"], x: 340, y: 60, detail: "Enforces a live, admin-configurable state scope (Texas by default) at the edge." },
  { id: "wx", group: "external", label: "Weather MCP", sub: ["unmodified"], x: 640, y: 60, detail: "A real third-party server. Nothing about it was changed to fit the demo." },
];

const EDGES = [
  ["agent", "gw", "weather: Austin, TX", { detail: "The city named in the call is what the policy reads." }],
  ["gw", "gw", "Austin ∈ Texas", { detail: "Inside the configured scope: the check passes." }],
  ["gw", "wx", "forwarded", { detail: "The third-party server receives the call — its backend knows nothing of the restriction." }],
  ["wx", "agent", "weather returns", { vertical: true, detail: "The reply carries the weather with the gateway hop on the record." }],
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

// Per-step detail (shown for the active beat). Forms mirror services/mcpGatewayClient.js (tools/call body, headers,
// /mcp/weather route) and ping-gateway/scripts/groovy/tx-weather-scope.groovy (flag check). The public chip sends no bearer.
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST {gateway}/mcp/weather\nContent-Type: application/json\nAccept: application/json, text/event-stream\nMCP-Protocol-Version: <version>\nX-Correlation-ID: <correlation id>\n(no Authorization header: public tool, guest chip)\n\n{ \"jsonrpc\": \"2.0\", \"id\": \"<correlation id>\", \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_weather\", \"arguments\": { \"city_name\": \"Austin, TX\" },\n             \"correlationId\": \"<correlation id>\" } }",
      refs: [{ id: "MCP tools/call", title: "Model Context Protocol: calling a tool over JSON-RPC", kind: "spec" }],
    },
  },
  {
    beats: [1],
    detail: {
      form: "GET {BFF_WEATHER_FLAG_URL}\nx-internal-gateway-secret: <internal secret>\n\n200 { \"enabled\": true, \"allowedState\": \"texas\",\n       \"blockedCities\": [], \"blockRadiusDeg\": 0.2 }\n\n-> \"austin, tx\": state part \"tx\" is in the Texas abbreviations -> pass",
    },
  },
  {
    beats: [2],
    detail: {
      form: "POST {weather MCP server}\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": \"<correlation id>\", \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_weather\", \"arguments\": { \"city_name\": \"Austin, TX\" } } }",
    },
  },
  {
    beats: [3],
    detail: {
      form: "200 OK\n{ \"jsonrpc\": \"2.0\", \"id\": \"<correlation id>\",\n  \"result\": { \"content\": [{ \"type\": \"text\", \"text\": \"<weather for Austin, TX>\" }] } }\n\nThe gateway also records the hop in X-Gw-Audit-Trail (McpAudit -> TxWeatherScope).",
    },
  },
];

export default {
  id: "UC30",
  result: { label: "PERMIT", tone: "ok" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
