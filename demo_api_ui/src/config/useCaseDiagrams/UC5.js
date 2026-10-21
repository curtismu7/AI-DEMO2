/**
 * UC5 — Wrong / insufficient scope (DENY 403). Scope is a hard ceiling at the
 * gateway, checked before Authorize is even consulted. The agent cannot grant
 * itself more.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, MCP } from "../pingStyleStandards";

const NODES = [
  { id: "atk", group: "external", label: "Attack agent", sub: ["missing scope"], x: 40, y: 150, detail: "Presents a valid token — right issuer, right audience — but it lacks the scope this tool demands." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["scope ceiling"], x: 460, y: 150, detail: "Checks the declared tool scope against the token's set before anything else." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["not consulted"], x: 880, y: 150, detail: "Never sees the call — scope fails before the policy question is asked." },
  ];

const EDGES = [
  ["atk", "gw", "call with narrow token", { detail: "The token is fine by every check except the scope set." }],
  ["gw", "gw", "scope check fails", { detail: "Required scope absent from the token — the agent cannot widen it." }],
  ["gw", "atk", "403", { detail: "Refused at the perimeter; no tool ran, no policy call was spent." }],
  ["gw", "gw", "centralized ceiling", { detail: "One enforcement point covers every tool." }],
];

const walk = [
  {
    title: "Attack presents token", label: "Valid but narrow",
    nodes: ["atk", "gw"], edges: [0],
    lines: [{ who: "Attacker", text: "Every envelope check passes — the scope set is the missing piece." }],
    tech: [{ t: "TOKEN", c: "AT: iss ok, aud ok, exp ok, scp=lacks tool scope" }],
  },
  {
    title: "Gateway checks scope", label: "Before policy",
    nodes: ["gw"], edges: [1],
    lines: [{ who: "Gateway", text: "The tool declares its required scope; the token carries a narrower set." }],
    tech: [{ t: "POLICY", c: "declared tool scope not in token scp -> hard fail" }],
  },
  {
    title: "403 at the perimeter", label: "Nothing downstream ran",
    nodes: ["gw", "atk"], edges: [2],
    lines: [{ who: "Gateway", text: "No tool dispatch, no Authorize decision — the ceiling held." }],
    tech: [{ t: "API", c: "gateway -> 403 insufficient_scope; Authorize not consulted" }],
  },
  {
    title: "Centralized by design", label: "No per-tool code",
    nodes: ["gw"], edges: [3],
    lines: [{ who: "Presenter", text: "No tool re-validates scopes in application code — one point covers all." }],
    tech: [{ t: "POLICY", c: "enforcement point: gateway perimeter (all tools)" }],
  },
];

// Per-step detail. Tokens are decoded MOCK values. The scope ceiling and the -32403 insufficient_scope error mirror demo_mcp_gateway/src/index.ts.
const NARROW_TOKEN = {
  note: "MOCK access token · valid envelope, narrow scope set",
  header: { alg: "RS256", typ: "at+jwt" },
  claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "attacker-0001", aud: "https://mcp.ping.demo", scope: "banking:accounts:read", exp: 1790000000 },
};
const steps = [
  {
    beats: [0],
    detail: {
      form: `POST /gateway/mcp
Authorization: Bearer <access token>
Content-Type: application/json

{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "<tool that needs a wider scope>", "arguments": { } } }`,
      tokens: [NARROW_TOKEN],
      refs: [RFC(6750, "Bearer token usage"), RFC(9068, "JWT profile for access tokens")],
    },
  },
  {
    beats: [1],
    detail: {
      form: `Gateway check (no network call):

required = scopes the tool declares
granted  = scp / scope of the token
required not subset of granted -> hard fail, Authorize is not called`,
      tokens: [NARROW_TOKEN],
      refs: [RFC(6749, "Access token scope (section 3.3)"), RFC(9068, "JWT profile for access tokens")],
    },
  },
  {
    beats: [2],
    detail: {
      form: `{ "jsonrpc": "2.0", "id": 1,
  "error": { "code": -32403, "message": "<reason>",
    "data": { "error": "insufficient_scope", "required_scopes": ["<scope>"], "login_required": false } } }

HTTP-transport form: 403 with WWW-Authenticate: Bearer error="insufficient_scope".`,
      tokens: [],
      refs: [RFC(6750, "Bearer token usage: insufficient_scope error (section 3.1)"), MCP[0]],
    },
  },
  {
    beats: [3],
    detail: {
      form: `One enforcement point: the gateway perimeter reads each tool's declared scope.
No tool re-validates scopes in application code, so a new tool gets the same ceiling by declaring its scope.`,
      tokens: [],
    },
  },
];

export default {
  pingStyle: true,
  id: "UC5",
  result: { label: "DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
