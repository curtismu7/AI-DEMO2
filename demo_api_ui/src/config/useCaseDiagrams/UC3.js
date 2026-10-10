/**
 * UC3 — act gate. "show my balance" runs a delegated balance lookup whose token
 * carries an act claim; the authorization server checks act.sub against the
 * authorized actor before the tool call is permitted. The chain shows the
 * user-token, token-exchange and authorize-decision legs.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["may_act names her agent"], x: 40, y: 150, detail: "Signed in; her user token carries may_act naming the one agent client allowed to act for her." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["holds Alice's token"], x: 340, y: 150, detail: "Calls get_account_balance for Alice; on the exchanged token its client_id becomes act.sub — the identity the gate checks." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["RFC 8693 exchange"], x: 640, y: 150, detail: "Exchanges Alice's user token (subject_token) plus the agent's client-credentials token (actor_token) for the act-carrying MCP token." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["seeds act", "evaluates act.sub"], x: 940, y: 150, detail: "Seeds act from may_act at mint (resource SPEL: act ← subject's may_act), then the decision endpoint compares ActClientId to the authorized actor on every tool call." },
  { id: "acct", group: "resource", label: "Accounts API", sub: ["read-only"], x: 1240, y: 150, detail: "Serves the balance only after the decision PERMITs the act-validated token; scope validated per call." },
];

const EDGES = [
  ["user", "agent", "authority, seeded", { detail: "Sign-in issues her token with may_act naming the AI Agent client — the only seed; never read at decision time." }],
  ["agent", "gw", "tool call", { detail: "'show my balance' becomes a tools/call for get_account_balance, presented with Alice's user token." }],
  ["gw", "p1", "may_act → act", { detail: "RFC 8693 exchange: user token as subject_token, agent's client-credentials token as actor_token — PingOne seeds act from may_act onto the minted MCP token." }],
  ["p1", "acct", "every call", { detail: "The decision endpoint checks act.sub against the authorized actor — no act ⇒ DENY missing_act. PERMIT, then the balance read goes out." }],
  ["acct", "user", "back to Alice", { detail: "The answer returns through the agent, and the panels show the three-leg proof: user-token, token-exchange, authorize-decision." }],
];

const walk = [
  {
    title: "may_act at sign-in", label: "authority, seeded",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "Sign-in issues her token with may_act naming the AI Agent client — this attribute is the only seed; it is never read at decision time." }],
    tech: [
      { t: "TOKEN", c: "user AT: sub=alice, may_act=<AI Agent client_id>" },
      { t: "POLICY", c: "PingOne config: issue may_act on user tokens naming the permitted actor" },
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
    title: "Exchange seeds act", label: "may_act → act",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "Gateway", text: "RFC 8693 exchange: user token as subject_token, the agent's client-credentials token as actor_token — PingOne seeds act from may_act onto the minted MCP token." }],
    tech: [
      { t: "TOKEN", c: "subject_token=<user AT> + actor_token=<agent CC> -> agent AT: act={sub:<AI Agent client_id>}" },
      { t: "POLICY", c: "PingOne resource SPEL: act ← subject's may_act; actor must match" },
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
