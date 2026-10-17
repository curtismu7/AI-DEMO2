/**
 * UC3 — act gate. "show my balance" runs a delegated balance lookup whose token
 * carries an act claim; the authorization server checks act.sub against the
 * authorized actor before the tool call is permitted. The chain shows the
 * user-token, token-exchange and authorize-decision legs.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["consent grant on file"], x: 40, y: 150, detail: "Signed in; her consent (this agent may act for her) is a server-side grant record. Her token carries sub only." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["holds Alice's token"], x: 340, y: 150, detail: "Calls get_account_balance for Alice; on the exchanged token its client_id becomes act.sub — the identity the gate checks." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["RFC 8693 exchange"], x: 640, y: 150, detail: "Exchanges Alice's user token (subject_token) plus the agent's client-credentials token (actor_token) for the act-carrying MCP token." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["mints act", "evaluates act.sub + grant"], x: 940, y: 150, detail: "Mints act at exchange from the actor token (the agent's own client credential), then the decision endpoint checks the consent grant and compares ActClientId on every tool call." },
  { id: "acct", group: "resource", label: "Accounts API", sub: ["read-only"], x: 1240, y: 150, detail: "Serves the balance only after the decision PERMITs the act-validated token; scope validated per call." },
];

const EDGES = [
  ["user", "agent", "consent grant checked per call", { detail: "Her consent is a server-side grant record naming the AI Agent client; PingOne Authorize checks it on every call (revoke = next call denied, no re-login)." }],
  ["agent", "gw", "tool call", { detail: "'show my balance' becomes a tools/call for get_account_balance, presented with Alice's user token." }],
  ["gw", "p1", "actor token → act", { detail: "RFC 8693 exchange: user token as subject_token, agent's client-credentials token as actor_token — PingOne mints act from the actor token onto the minted MCP token." }],
  ["p1", "acct", "every call", { detail: "The decision endpoint checks act.sub against the authorized actor — no act ⇒ DENY missing_act. PERMIT, then the balance read goes out." }],
  ["acct", "user", "back to Alice", { detail: "The answer returns through the agent, and the panels show the three-leg proof: user-token, token-exchange, authorize-decision." }],
];

const walk = [
  {
    title: "Consent grant on file", label: "consent grant checked per call",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "Alice's consent is a server-side grant record naming the AI Agent client; it is checked per call, not carried in her token." }],
    tech: [
      { t: "TOKEN", c: "user AT: sub=alice (no may_act); grant record: alice -> <AI Agent client_id>" },
      { t: "POLICY", c: "PingOne Authorize: consent grant checked on every tool call" },
    ],
  },
  {
    title: "Agent asks for the balance", label: "tool call",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Agent", text: "'show my balance' becomes a tools/call for get_account_balance, presented with Alice's user token." }],
    tech: [
      { t: "API", c: "POST /gateway/mcp  tools/call get_account_balance" },
      { t: "TOKEN", c: "Authorization: Bearer <user AT>" },
    ],
  },
  {
    title: "Exchange mints act", label: "actor token → act",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "Gateway", text: "RFC 8693 exchange: user token as subject_token, the agent's client-credentials token as actor_token — PingOne mints act from the actor token onto the minted MCP token." }],
    tech: [
      { t: "TOKEN", c: "subject_token=<user AT> + actor_token=<agent CC> -> agent AT: act={sub:<AI Agent client_id>}" },
      { t: "POLICY", c: "PingOne mints act from the actor token; consent grant must match" },
    ],
  },
  {
    title: "The act gate", label: "every call",
    nodes: ["p1", "acct"], edges: [3],
    lines: [{ who: "PingOne Authorize", text: "The decision endpoint checks act.sub against the authorized actor — Rule 2 on the match, Rule 2.5 denies any agent-mediated tool whose act claim is missing. PERMIT, then the balance read goes out." }],
    tech: [
      { t: "POLICY", c: "POST /governance/pap/alpha/policy/:workerId/decision — ActClientId == authorized actor; no act ⇒ DENY missing_act" },
      { t: "API", c: "PERMIT -> GET /api/accounts, Authorization: Bearer <agent AT> -> 200" },
    ],
  },
  {
    title: "Balance, with proof", label: "back to Alice",
    nodes: ["acct", "user"], edges: [4],
    lines: [{ who: "Presenter", text: "The answer returns through the agent, and the panels show the three-leg proof: user-token, token-exchange, authorize-decision." }],
    tech: [{ t: "API", c: "chat reply: balance + evidence legs user-token / token-exchange / authorize-decision" }],
  },
];

export default {
  id: "UC3",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
