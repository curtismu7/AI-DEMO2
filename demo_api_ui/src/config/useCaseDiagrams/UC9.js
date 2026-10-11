/**
 * UC9 — Group / entitlement check. The token's scopes would allow the call,
 * but the demo user is not in the privileged group: Authorize denies on group
 * membership regardless of scopes, before any tool runs.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["not in privileged group"], x: 40, y: 150, detail: "The demo user is deliberately outside the vertical's privileged group." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["sensitive details"], x: 340, y: 150, detail: "Asks for sensitive account details — a call the scopes technically allow." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["asks Authorize"], x: 640, y: 150, detail: "Sends the decision to Authorize before any tool runs; enforces the answer instantly." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["group entitlement"], x: 940, y: 150, detail: "Evaluates the user's group-membership claim — scopes are not the question." },
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
    tech: [{ t: "API", c: "gateway returns 403 tool_denied; authorize-decision recorded" }],
  },
];

export default {
  id: "UC9",
  result: { label: "DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
