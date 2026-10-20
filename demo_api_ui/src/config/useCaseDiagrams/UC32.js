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
  { id: "after", group: "agent", label: "Miami → PERMIT", sub: ["Any"], x: 640, y: 300, detail: "The identical query now passes — no restart, no redeploy, no code change." },
  ];

const EDGES = [
  ["before", "admin", "same ask, refused", { detail: "Where the demo starts." }],
  ["admin", "gw", "switch to Any", { detail: "The admin edits the policy value; nothing restarts." }],
  ["gw", "gw", "policy read live", { detail: "The gateway reads the policy value on every request." }],
  ["gw", "after", "same query permitted", { vertical: true, detail: "The next request reads the new value." }],
  ["after", "admin", "baseline restored", { detail: "Leaving the page restores Texas for the documented start state." }],
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
    nodes: ["gw"], edges: [2],
    lines: [{ who: "Gateway", text: "No restart, no redeploy — the next request already reads Any." }],
    tech: [{ t: "POLICY", c: "policy read per-request (no restart)" }],
  },
  {
    title: "Same query permitted", label: "Miami → PERMIT",
    nodes: ["gw", "after"], edges: [3],
    lines: [{ who: "Presenter", text: "The identical Miami query flips decision. Externalized governance, proven." }],
    tech: [{ t: "POLICY", c: "allowed_state=Any -> Miami permitted" }],
  },
  {
    title: "Baseline restored", label: "Texas again on exit",
    nodes: ["after", "admin"], edges: [4],
    lines: [{ who: "Presenter", text: "Leaving the page restores Texas so UC30/UC31 start from the documented policy." }],
    tech: [{ t: "POLICY", c: "demo guard: page exit restores allowed_state=Texas" }],
  },
];

// Per-step detail. Forms mirror the real routes (gateway tx-weather-scope.groovy deny shape,
// PATCH /api/admin/feature-flags, GET /internal/feature-flags/weather-mcp-showcase). No tokens: the policy value is not a credential.
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /mcp/weather\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_current_conditions\", \"arguments\": { \"city_name\": \"Miami\" } } }\n\n-> 403 Forbidden\n{ \"jsonrpc\": \"2.0\", \"id\": 1,\n  \"error\": { \"code\": -32000,\n    \"message\": \"Agent Gateway: weather scope restricted to Texas (demo policy) — city not recognized as Texas\" } }",
    },
  },
  {
    beats: [1],
    detail: {
      form: "PATCH /api/admin/feature-flags\nContent-Type: application/json\nCookie: <session cookie>\n\n{ \"updates\": { \"ff_weather_mcp_allowed_state\": \"any\" } }",
    },
  },
  {
    beats: [2],
    detail: {
      form: "GET /internal/feature-flags/weather-mcp-showcase\nx-internal-gateway-secret: <internal gateway secret>\n\n-> 200\n{ \"enabled\": true, \"allowedState\": \"any\", \"blockedCities\": [...], \"blockRadiusDeg\": ... }",
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST /mcp/weather\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 2, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_current_conditions\", \"arguments\": { \"city_name\": \"Miami\" } } }\n\n-> passes tx-weather-scope and is forwarded to the weather MCP server (allowedState = any)",
    },
  },
  {
    beats: [4],
    detail: {
      form: "PATCH /api/admin/feature-flags   (sent best-effort on page exit)\nContent-Type: application/json\nCookie: <session cookie>\n\n{ \"updates\": { \"ff_weather_mcp_allowed_state\": \"texas\" } }",
    },
  },
];

export default {
  id: "UC32",
  result: { label: "RECONFIGURED", tone: "warn" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
