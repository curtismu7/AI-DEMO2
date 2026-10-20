/**
 * UC6 — Authz denied. Pilot diagram: the deny shape. A valid token, a $2,500
 * transfer over the policy ceiling: Authorize returns DENY before the tool
 * runs, so no money moves. The deny IS the feature.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, AUTHZ } from "../pingStyleStandards";

const NODES = [
  { id: "agent", group: "agent", label: "Banking agent", sub: ["$2,500 transfer"], x: 40, y: 150, detail: "Makes the request with a perfectly valid token — that is not the question." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["asks Authorize"], x: 460, y: 150, detail: "Asks Authorize before any tool runs; enforces the answer instantly." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["policy ceiling"], x: 880, y: 150, detail: "Policy: transfers above $2,000 are denied, whatever the token allows." },
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
    tech: [{ t: "API", c: "gateway returns -32403 insufficient_scope (HTTP form: 403); authorize-decision step recorded" }],
  },
];

// Per-step detail. Tokens are decoded MOCK values. The -32403 deny shape mirrors demo_mcp_gateway/src/index.ts.
const AGENT_TOKEN = {
  note: "MOCK delegated token · valid, scopes allow the tool",
  header: { alg: "RS256", typ: "at+jwt" },
  claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://mcp.ping.demo", scope: "banking:transactions:write", act: { sub: "agent-0001" }, exp: 1790000000 },
};
const steps = [
  {
    beats: [0],
    detail: {
      form: `POST /gateway/mcp
Authorization: Bearer <delegated access token>
Content-Type: application/json

{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "transfer_funds", "arguments": { "amount": 2500, "fromAccountId": "{fromAccountId}", "toAccountId": "{toAccountId}" } } }`,
      tokens: [AGENT_TOKEN],
      refs: [RFC(6750, "Bearer token usage"), RFC(8693, "act claim: who is acting for whom")],
    },
  },
  {
    beats: [1],
    detail: {
      form: `PingOne Authorize decision request (from the gateway, before any tool runs)

subject: alice-0001, actor: agent-0001
resource: tool transfer_funds
attributes: { amount: 2500 }`,
      tokens: [AGENT_TOKEN],
      refs: [AUTHZ[0], AUTHZ[1]],
    },
  },
  {
    beats: [2],
    detail: {
      form: `Decision: DENY
rule: amount > 2000 (deny ceiling) -> DENY, whatever the token's scopes allow.

The ceiling is a policy rule: changing it is a console edit, not a deploy.`,
      tokens: [],
      refs: [AUTHZ[0], AUTHZ[1]],
    },
  },
  {
    beats: [3],
    detail: {
      form: `{ "jsonrpc": "2.0", "id": 1,
  "error": { "code": -32403, "message": "<deny reason>", "data": { "error": "insufficient_scope", "required_scopes": ["<scope>"], "login_required": false } } }

No tool dispatch, no data touched. The authorize-decision step is recorded for the token chain.`,
      tokens: [],
    },
  },
];

export default {
  pingStyle: true,
  id: "UC6",
  result: { label: "DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
