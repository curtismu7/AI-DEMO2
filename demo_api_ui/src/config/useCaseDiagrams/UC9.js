/**
 * UC9 — Group / entitlement check. The token's scopes would allow the call,
 * but the demo user is not in the privileged group: Authorize denies on group
 * membership regardless of scopes, before any tool runs.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, AUTHZ } from "../pingStyleStandards";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["not in privileged group"], x: 40, y: 150, detail: "The demo user is deliberately outside the vertical's privileged group." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["sensitive details"], x: 460, y: 150, detail: "Asks for sensitive account details — a call the scopes technically allow." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["asks Authorize"], x: 880, y: 150, detail: "Sends the decision to Authorize before any tool runs; enforces the answer instantly." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["group entitlement"], x: 1300, y: 150, detail: "Evaluates the user's group-membership claim — scopes are not the question." },
];

const EDGES = [
  ["user", "agent", "asks sensitive details", { detail: "The token's scopes would allow this; policy asks a different question." }],
  ["gw", "p1", "evaluate entitlement", { detail: "Entitlement lives in Authorize, not in the agent or the gateway code." }],
  ["p1", "gw", "DENY — not in group", { detail: "Group-membership claim evaluated in policy: the user is not entitled." }],
  ["gw", "agent", "403 — nothing ran", { detail: "No tool dispatch. Adding the user to the group flips this with no code change." }],
];

const walk = [
  {
    title: "Sensitive request", label: "Scopes say yes",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Agent", text: "The token's scopes would allow it. Policy asks: who is asking?" }],
    tech: [{ t: "API", c: "POST /gateway/mcp tools/call get_sensitive_details" }],
  },
  {
    title: "Gateway asks policy", label: "Before any tool runs",
    nodes: ["gw", "p1"], edges: [1],
    lines: [{ who: "Gateway", text: "The entitlement decision belongs to Authorize — needs ff_authorize_group_policy ON." }],
    tech: [{ t: "POLICY", c: "Authorize evaluates: group-membership claim vs required privileged group" }],
  },
  {
    title: "Not in the group", label: "DENY regardless of scopes",
    nodes: ["p1", "gw"], edges: [2],
    lines: [{ who: "PingOne", text: "The user is not in the required group — DENY, whatever the scopes say." }],
    tech: [{ t: "POLICY", c: "Authorize: user not in required group -> DENY (scopes insufficient to override)" }],
  },
  {
    title: "403", label: "Enforced instantly",
    nodes: ["gw", "agent"], edges: [3],
    lines: [{ who: "Gateway", text: "No tool dispatch. Entitlement in policy means a console edit changes it, not a deploy." }],
    tech: [{ t: "API", c: "gateway returns -32403 insufficient_scope; authorize-decision recorded" }],
  },
];

// Per-step detail. Tokens are decoded MOCK values. The -32403 deny shape mirrors demo_mcp_gateway/src/index.ts.
const USER_TOKEN = {
  note: "MOCK delegated token · scopes allow the call, no privileged-group membership",
  header: { alg: "RS256", typ: "at+jwt" },
  claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://mcp.ping.demo", scope: "banking:accounts:read", groups: ["customers"], act: { sub: "agent-0001" }, exp: 1790000000 },
};
const steps = [
  {
    beats: [0],
    detail: {
      form: `POST /gateway/mcp
Authorization: Bearer <delegated access token>
Content-Type: application/json

{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "get_sensitive_details", "arguments": { "accountId": "{accountId}" } } }`,
      tokens: [USER_TOKEN],
      refs: [RFC(6750, "Bearer token usage"), RFC(8693, "act claim: who is acting for whom")],
    },
  },
  {
    beats: [1],
    detail: {
      form: `PingOne Authorize decision request (from the gateway; needs ff_authorize_group_policy ON)

subject: alice-0001, actor: agent-0001
resource: tool get_sensitive_details
attributes: { groups: ["customers"], requiredGroup: "<privileged group>" }`,
      tokens: [USER_TOKEN],
      refs: [AUTHZ[0], AUTHZ[1]],
    },
  },
  {
    beats: [2],
    detail: {
      form: `Decision: DENY
rule: user not in the required group -> DENY, even though scopes would allow the call.

Adding the user to the group flips this with no code change.`,
      tokens: [],
      refs: [AUTHZ[0], AUTHZ[1]],
    },
  },
  {
    beats: [3],
    detail: {
      form: `{ "jsonrpc": "2.0", "id": 1,
  "error": { "code": -32403, "message": "<deny reason>", "data": { "error": "insufficient_scope", "required_scopes": ["<scope>"], "login_required": false } } }

No tool dispatch. The authorize-decision step is recorded for the token chain.`,
      tokens: [],
    },
  },
];

export default {
  pingStyle: true,
  id: "UC9",
  result: { label: "DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
